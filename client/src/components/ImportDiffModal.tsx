import { useEffect, useState } from 'react';
import {
  Modal, ScrollArea, Stack, Alert, Badge, Text, Group, Card, Table, TextInput, Checkbox,
  Button, ActionIcon, Title,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconTrash, IconX } from '@tabler/icons-react';
import type { ImportDiffReport, ImportOptions } from '../types';

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase());
}

interface Props {
  opened: boolean;
  onClose: () => void;
  report: ImportDiffReport;
  importing: boolean;
  onConfirm: (options: ImportOptions) => void;
}

export default function ImportDiffModal({ opened, onClose, report, importing, onConfirm }: Props) {
  const [defaults, setDefaults] = useState<Record<string, Record<string, string>>>({});
  const [dropExtra, setDropExtra] = useState<string[]>([]);

  useEffect(() => {
    if (!opened) return;
    const d: Record<string, Record<string, string>> = {};
    const drop: string[] = [];
    for (const [entity, col] of Object.entries(report.collections)) {
      for (const m of col.missing) {
        d[entity] = { ...(d[entity] ?? {}), [m.field]: String(m.suggested ?? '') };
      }
      for (const e of col.extra) drop.push(`${entity}.${e}`);
    }
    setDefaults(d);
    setDropExtra(drop);
  }, [opened, report]);

  const setDefault = (entity: string, field: string, value: string) => {
    setDefaults(prev => ({ ...prev, [entity]: { ...(prev[entity] ?? {}), [field]: value } }));
  };

  const toggleDrop = (key: string) => {
    setDropExtra(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const buildOptions = (): ImportOptions => {
    const missingDefaults: Record<string, Record<string, unknown>> = {};
    for (const [entity, fields] of Object.entries(defaults)) {
      const col = report.collections[entity];
      if (!col) continue;
      for (const [field, value] of Object.entries(fields)) {
        const spec = col.missing.find(m => m.field === field);
        if (!spec) continue;
        const raw = value.trim();
        let resolved: unknown;
        if (raw === '') {
          resolved = spec.suggested ?? null;
        } else if (spec.type === 'integer' || spec.type === 'real') {
          const n = Number(raw);
          resolved = Number.isFinite(n) ? n : (spec.suggested ?? null);
        } else {
          resolved = raw;
        }
        missingDefaults[entity] = { ...(missingDefaults[entity] ?? {}), [field]: resolved };
      }
    }
    return { missingDefaults, dropExtra };
  };

  const collections = Object.entries(report.collections)
    .filter(([, col]) => col.missing.length > 0 || col.extra.length > 0);
  const absent = Object.entries(report.collections)
    .filter(([, col]) => !col.present && col.count === 0);

  const totalRows = Object.values(report.collections).reduce((sum, c) => sum + c.count, 0);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>Import review — version differences</Title>}
      size="xl"
      centered
      closeOnClickOutside={false}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light">
          This backup was created by a different version. <b>{totalRows} rows</b> across{' '}
          {Object.keys(report.collections).length} collections will be imported.
          {report.version !== null && <> Backup format version: <b>{report.version}</b>.</>}
        </Alert>

        {report.unknownCollections.length > 0 && (
          <Alert icon={<IconX size={16} />} color="orange" variant="light">
            The backup contains collections this version doesn't understand and will be skipped:{' '}
            <b>{report.unknownCollections.join(', ')}</b>
          </Alert>
        )}

        {collections.length === 0 && absent.length === 0 && report.unknownCollections.length === 0 && (
          <Alert icon={<IconCheck size={16} />} color="green" variant="light">
            No schema differences detected. The backup matches this version.
          </Alert>
        )}

        {collections.map(([entity, col]) => (
          <Card key={entity} withBorder radius="md" padding="sm">
            <Group justify="space-between" mb="sm">
              <Group gap="xs">
                <Text fw={600}>{humanize(entity)}</Text>
                <Badge size="sm" variant="light">{col.count} row{col.count === 1 ? '' : 's'}</Badge>
              </Group>
              <Group gap="xs">
                {col.missing.length > 0 && <Badge size="sm" color="blue" variant="filled">missing {col.missing.length}</Badge>}
                {col.extra.length > 0 && <Badge size="sm" color="orange" variant="filled">unsupported {col.extra.length}</Badge>}
              </Group>
            </Group>

            {col.missing.length > 0 && (
              <>
                <Text size="xs" c="dimmed" mb="xs">
                  Fields present in this version but missing from the backup. Set a default value to fill them in.
                </Text>
                <Table withTableBorder withColumnBorders striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w="40%">Field</Table.Th>
                      <Table.Th>Default value</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {col.missing.map(m => (
                      <Table.Tr key={m.field}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <Text size="sm">{humanize(m.field)}</Text>
                            {m.required && <Badge size="xs" color="red" variant="light">required</Badge>}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <TextInput
                            size="xs"
                            placeholder={m.type === 'text' ? 'text' : 'number'}
                            value={defaults[entity]?.[m.field] ?? ''}
                            onChange={e => setDefault(entity, m.field, e.currentTarget.value)}
                          />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}

            {col.extra.length > 0 && (
              <Stack gap="xs" mt="xs">
                <Text size="xs" c="dimmed">
                  These fields belong to a different version and can't be stored by this build. They won't be imported.
                </Text>
                {col.extra.map(e => {
                  const key = `${entity}.${e}`;
                  return (
                    <Checkbox
                      key={key}
                      size="xs"
                      checked={dropExtra.includes(key)}
                      onChange={() => toggleDrop(key)}
                      label={
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm">{humanize(e)}</Text>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            size="sm"
                            aria-label="Remove from import"
                            onClick={() => {
                              if (!dropExtra.includes(key)) toggleDrop(key);
                            }}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      }
                    />
                  );
                })}
              </Stack>
            )}
          </Card>
        ))}

        {absent.map(([entity]) => (
          <Text key={entity} size="sm" c="dimmed">
            <IconX size={14} style={{ verticalAlign: 'middle' }} /> {humanize(entity)} — not present in this backup (skipped)
          </Text>
        ))}

        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose} disabled={importing}>Cancel</Button>
          <Button color="green" leftSection={<IconCheck size={16} />} loading={importing} onClick={() => onConfirm(buildOptions())}>
            Import with these settings
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
