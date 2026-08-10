import { useState, useEffect, useCallback } from 'react';
import {
  Title, Text, Stack, Paper, Group, Badge, Tabs, Table, Button, Alert, SegmentedControl,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck, IconTrash } from '@tabler/icons-react';
import { api, type UserRequest, type RequestType } from '../../api/client';
import { useUndo } from '../../components/UndoToasts';

const TABS: Array<{ value: RequestType | 'all'; label: string; color: string }> = [
  { value: 'all', label: 'All', color: 'gray' },
  { value: 'help', label: 'Help', color: 'blue' },
  { value: 'feature', label: 'Feature', color: 'grape' },
  { value: 'bug', label: 'Bug', color: 'red' },
  { value: 'feedback', label: 'Feedback', color: 'teal' },
  { value: 'other', label: 'Other', color: 'gray' },
];

const TYPE_COLORS: Record<string, string> = {
  help: 'blue', feature: 'grape', bug: 'red', feedback: 'teal', other: 'gray',
};

export default function AdminRequestsPage() {
  const [tab, setTab] = useState<RequestType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [data, setData] = useState<UserRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const { push: pushUndo } = useUndo();

  const load = useCallback(async (type: RequestType | 'all', status: 'open' | 'all') => {
    try {
      const res = await api.admin.requests(type, status);
      setData(res.data);
      setCounts(res.counts);
    } catch {}
  }, []);

  useEffect(() => {
    load(tab, statusFilter);
  }, [load, tab, statusFilter]);

  const toggleStatus = async (r: UserRequest) => {
    const next = r.status === 'open' ? 'resolved' : 'open';
    try {
      await api.admin.updateRequest(r.id, next);
      await load(tab, statusFilter);
      pushUndo(
        `${r.subject} ${next === 'resolved' ? 'resolved' : 'reopened'}`,
        async () => {
          await api.admin.updateRequest(r.id, r.status);
          await load(tab, statusFilter);
        },
        'Undo',
      );
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const remove = async (r: UserRequest) => {
    try {
      await api.admin.deleteRequest(r.id);
      await load(tab, statusFilter);
      pushUndo(
        `${r.subject} deleted`,
        async () => {
          await api.admin.restoreRequest(r);
          await load(tab, statusFilter);
        },
        'Undo',
      );
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>User Requests</Title>
        <Text c="dimmed" size="sm">Requests submitted by users from the header button. Organized by type.</Text>
      </div>

      <Tabs value={tab} onChange={v => setTab((v ?? 'all') as RequestType | 'all')}>
        <Group justify="space-between" mb={0}>
          <Tabs.List>
            {TABS.map(t => (
              <Tabs.Tab key={t.value} value={t.value}>
                {t.label}
                {counts[t.value] ? <Badge size="xs" ml={6} variant="light" color={t.color}>{counts[t.value]}</Badge> : null}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <SegmentedControl
            size="xs"
            value={statusFilter}
            onChange={v => setStatusFilter(v as 'open' | 'all')}
            data={[{ label: 'Open', value: 'open' }, { label: 'All', value: 'all' }]}
          />
        </Group>

        <Tabs.Panel value={tab} pt="md">
          <Paper p="md" radius="md" withBorder>
            {data.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">
                No {statusFilter === 'open' ? 'open' : ''} requests here.
              </Text>
            ) : (
              <Table highlightOnHover styles={{ table: { fontSize: 13 } }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Subject</Table.Th>
                    <Table.Th>From</Table.Th>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.map(r => (
                    <Table.Tr key={r.id} opacity={r.status === 'resolved' ? 0.55 : 1}>
                      <Table.Td>
                        <Group gap={4}>
                          <Badge size="sm" variant="light" color={TYPE_COLORS[r.type] ?? 'gray'}>{r.type}</Badge>
                          {!!r.urgent && <Badge size="sm" variant="filled" color="red">Urgent</Badge>}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={600}>{r.subject}</Text>
                        {r.message && (
                          <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', maxWidth: 420 }}>
                            {r.message}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{r.username}</Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleString()}</Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={r.status === 'open' ? 'yellow' : 'green'}>{r.status}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Button size="compact-xs" variant="light" color={r.status === 'open' ? 'green' : 'gray'}
                            leftSection={<IconCheck size={14} />} onClick={() => toggleStatus(r)}>
                            {r.status === 'open' ? 'Mark resolved' : 'Reopen'}
                          </Button>
                          <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />}
                            onClick={() => remove(r)}>
                            Delete
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Tabs.Panel>
      </Tabs>

      <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
        Switch the "All" filter to see resolved requests. Tab badges show the total count per type.
      </Alert>
    </Stack>
  );
}
