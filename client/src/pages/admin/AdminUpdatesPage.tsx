import { useState, useEffect, useCallback } from 'react';
import {
  Title, Text, Stack, Paper, Group, Button, Badge, Alert, Modal, Progress, Code, FileInput, TextInput, Table,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconRefresh, IconRocket, IconAlertTriangle, IconCheck, IconExternalLink, IconUpload, IconTrash } from '@tabler/icons-react';
import { api, type UpdateStatus } from '../../api/client';
import type { DbSchemaHealth } from '../../types';

export default function AdminUpdatesPage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [reconnected, setReconnected] = useState<{ ok: boolean; version: string | null } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [schemaHealth, setSchemaHealth] = useState<DbSchemaHealth | null>(null);
  const [pruning, setPruning] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.admin.updateStatus());
    } catch {}
    try {
      setSchemaHealth(await api.admin.dbSchema());
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setBusy(true);
    try {
      setStatus(await api.admin.updateCheck());
      notifications.show({ title: 'Update check', message: status?.updateAvailable ? 'An update is available.' : 'You are up to date.', color: status?.updateAvailable ? 'yellow' : 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    try {
      await api.admin.backupDownload();
      notifications.show({ title: 'Backup', message: 'A backup was downloaded to your computer.', color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  const doUpdate = async () => {
    setConfirmUpdate(false);
    setUpdating(true);
    try {
      // Download a local copy first, then trigger the server-side update (which also backs up internally).
      await api.admin.backupDownload();
      const res = await api.admin.updateNow();
      notifications.show({ title: 'Update started', message: res.message, color: 'blue' });
      await waitForReconnect();
    } catch (err: any) {
      setUpdating(false);
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const doRestore = async () => {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreMsg(null);
    try {
      const res = await api.admin.restore(restoreFile);
      setRestoreMsg({ type: 'ok', text: res.message });
      setRestoreFile(null);
      setRestoreConfirm('');
    } catch (err: any) {
      setRestoreMsg({ type: 'error', text: err.message });
    } finally {
      setRestoring(false);
    }
  };

  const doPrune = async (userId: number, username: string) => {
    setPruning(userId);
    try {
      const res = await api.admin.pruneDbSchema(userId);
      notifications.show({
        title: res.removed.length ? 'Columns removed' : 'Nothing to remove',
        message: res.removed.length
          ? `${res.removed.length} unsupported column(s) removed from ${username}.`
          : `No removable unsupported columns found for ${username}.`,
        color: res.removed.length ? 'green' : 'blue',
      });
      if (res.errors.length) {
        notifications.show({ title: 'Some columns could not be removed', message: res.errors.join(', '), color: 'yellow' });
      }
      setSchemaHealth(await api.admin.dbSchema());
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setPruning(null);
    }
  };

  const waitForReconnect = () => new Promise<void>((resolve) => {
    const started = Date.now();
    const poll = async () => {
      try {
        const meta = await api.meta();
        setReconnected({ ok: true, version: meta.version });
        setUpdating(false);
        resolve();
        return;
      } catch {
        if (Date.now() - started > 120_000) {
          setReconnected({ ok: false, version: null });
          setUpdating(false);
          resolve();
          return;
        }
        setTimeout(poll, 3000);
      }
    };
    setTimeout(poll, 3000);
  });

  if (!status) return <Text c="dimmed">Loading…</Text>;

  const isUpToDate = !status.updateAvailable;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Updates &amp; Backup</Title>
        <Text c="dimmed" size="sm">Back up your data, restore from a backup, and update this instance.</Text>
      </div>

      <Paper p="md" radius="md" withBorder>
        <Group justify="space-between" wrap="wrap" mb="md">
          <Group gap="xl">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Current version</Text>
              <Text fw={700} size="xl">{status.version}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Latest</Text>
              <Text fw={700} size="xl">{status.latestVersion ?? '—'}</Text>
            </div>
            <Badge size="lg" color={isUpToDate ? 'green' : 'yellow'} variant="light">
              {isUpToDate ? 'Up to date' : `Update available`}
            </Badge>
          </Group>
          <Group>
            <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={checkNow} loading={busy}>
              Check for updates
            </Button>
            <Button variant="light" color="blue" leftSection={<IconDownload size={16} />} onClick={backup} loading={busy}>
              Back up & download
            </Button>
            <Button color="green" leftSection={<IconRocket size={16} />} disabled={isUpToDate}
              onClick={() => (status.autoUpdateAvailable ? setConfirmUpdate(true) : setManualOpen(true))}>
              Update
            </Button>
          </Group>
        </Group>

        {status.updateAvailable && status.latestUrl && (
          <Text size="sm" c="dimmed">
            <a href={status.latestUrl} target="_blank" rel="noreferrer">
              View release notes <IconExternalLink size={12} style={{ verticalAlign: 'middle' }} />
            </a>
          </Text>
        )}
        {!status.autoUpdateAvailable && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light" mt="md">
            In-app auto-update isn't enabled on this instance (no Docker socket access). Use the manual fallback after
            backing up.
          </Alert>
        )}
      </Paper>

      {updating && (
        <Paper p="md" radius="md" withBorder>
          <Group gap="sm" mb="xs">
            <Progress value={100} size="sm" animated style={{ flex: 1 }} />
            <Text size="sm">Updating the instance… the app will restart.</Text>
          </Group>
        </Paper>
      )}

      {reconnected && (
        <Alert icon={reconnected.ok ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}
          color={reconnected.ok ? 'green' : 'yellow'} variant="light">
          {reconnected.ok
            ? `The instance is back online (version ${reconnected.version}).`
            : 'The instance didn\'t come back within 2 minutes. Check the container logs on the host.'}
          <Button size="compact-sm" ml="sm" onClick={() => window.location.reload()}>Reload</Button>
        </Alert>
      )}

      <Modal opened={confirmUpdate} onClose={() => setConfirmUpdate(false)} title="Update this instance?" size="sm" centered>
        <Stack gap="md">
          <Alert icon={<IconAlertTriangle size={16} />} color="orange" variant="light">
            Updating will: download a local backup to your computer, back up the data on the server, then pull the new
            image and restart the app. It may be offline for a minute.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmUpdate(false)}>Cancel</Button>
            <Button color="green" leftSection={<IconRocket size={16} />} onClick={doUpdate}>Update now</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={manualOpen} onClose={() => setManualOpen(false)} title="Update manually" size="md" centered>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This instance can't update itself automatically. Back up your data, then run this on the host:
          </Text>
          <Code block>
            ./update.sh
          </Code>
          <Text size="xs" c="dimmed">
            (equivalent to <Code>docker compose pull && docker compose up -d</Code>)
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setManualOpen(false)}>Close</Button>
          </Group>
        </Stack>
      </Modal>

      <Paper p="md" radius="md" withBorder style={{ borderColor: 'var(--mantine-color-orange-7)' }}>
        <Group gap="sm" mb="xs">
          <IconUpload size={20} color="var(--mantine-color-orange-6)" />
          <Text fw={700}>Restore from a backup</Text>
        </Group>
        <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light" mb="md">
          This will <b>overwrite ALL current data</b> — users, collections, settings and requests — and replace it
          entirely with the contents of the backup. This cannot be undone.
        </Alert>
        <Text size="sm" c="dimmed" mb="md">
          We strongly recommend <b>backing up your current data first</b> so you can switch back if needed.
        </Text>
        <Group justify="flex-start" mb="md">
          <Button variant="light" color="blue" leftSection={<IconDownload size={16} />} onClick={backup} loading={busy}>
            Back up current data
          </Button>
        </Group>
        <Group align="flex-end" gap="md">
          <FileInput
            label="Backup file"
            placeholder="Select a .zip backup"
            accept=".zip"
            value={restoreFile}
            onChange={f => { setRestoreFile(f); setRestoreMsg(null); }}
            style={{ flex: 1, minWidth: 220 }}
          />
          <TextInput
            label="Type RESTORE to confirm"
            placeholder="RESTORE"
            value={restoreConfirm}
            onChange={e => setRestoreConfirm(e.currentTarget.value.toUpperCase())}
            w={200}
          />
          <Button color="orange" leftSection={<IconUpload size={16} />} onClick={doRestore}
            loading={restoring} disabled={!restoreFile || restoreConfirm !== 'RESTORE'}>
            Restore
          </Button>
        </Group>
        {restoreMsg && (
          <Alert mt="md" icon={restoreMsg.type === 'ok' ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}
            color={restoreMsg.type === 'ok' ? 'green' : 'red'} variant="light">
            {restoreMsg.text}
          </Alert>
        )}
      </Paper>

      <Paper p="md" radius="md" withBorder>
        <Group gap="sm" mb="xs">
          <Text fw={700}>Database schema health</Text>
          {schemaHealth && <Badge size="sm" variant="light">schema v{schemaHealth.schemaVersion}</Badge>}
        </Group>
        <Text size="sm" c="dimmed" mb="md">
          Checks each user database for columns that the current version doesn't support. These can appear when data was
          created or restored by a different version of the app. Unsupported columns are ignored by this build but can be
          removed to keep the databases clean.
        </Text>
        {!schemaHealth ? (
          <Text size="sm" c="dimmed">Loading…</Text>
        ) : schemaHealth.issues.length === 0 ? (
          <Alert icon={<IconCheck size={16} />} color="green" variant="light">
            All user databases match the current schema. No unsupported columns found.
          </Alert>
        ) : (
          <Table withTableBorder withColumnBorders striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>User</Table.Th>
                <Table.Th>DB schema</Table.Th>
                <Table.Th>Unsupported columns</Table.Th>
                <Table.Th w={90}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {schemaHealth.issues.map(issue => (
                <Table.Tr key={issue.userId}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{issue.username}</Text>
                    {issue.error && <Text size="xs" c="red">{issue.error}</Text>}
                  </Table.Td>
                  <Table.Td>
                    <Badge size="sm" variant="light">v{issue.version}</Badge>
                  </Table.Td>
                  <Table.Td>
                    {issue.tables.map(t => (
                      <div key={t.table}>
                        <Text size="xs" c="dimmed">{t.table}</Text>
                        <Text size="xs">{t.extra.join(', ')}</Text>
                      </div>
                    ))}
                    {issue.unknownTables?.length > 0 && (
                      <Text size="xs" c="orange">Unknown tables: {issue.unknownTables.join(', ')}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="compact-xs"
                      color="red"
                      variant="light"
                      leftSection={<IconTrash size={12} />}
                      loading={pruning === issue.userId}
                      disabled={pruning !== null}
                      onClick={() => doPrune(issue.userId, issue.username)}
                    >
                      Remove
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}
