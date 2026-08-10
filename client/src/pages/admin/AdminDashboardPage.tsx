import { useState, useEffect, useCallback } from 'react';
import {
  Title, Text, Stack, SimpleGrid, Paper, Group, Badge, Button, Table, Progress, Alert,
} from '@mantine/core';
import { IconUsers, IconShieldLock, IconPower, IconUserCheck, IconRefresh, IconCards, IconDatabase, IconPhoto, IconPlug, IconActivity } from '@tabler/icons-react';
import { api } from '../../api/client';

interface ActivityEvent {
  id: number;
  ts: string;
  username: string | null;
  method: string;
  path: string;
  status: number;
}

interface AdminStats {
  users: { total: number; admins: number; disabled: number; active7d: number; active30d: number; activeSessions: number };
  storage: {
    systemDbBytes: number;
    usersBytes: number;
    perUser: Array<{ userId: number; username: string; bytes: number }>;
    images: { files: number; bytes: number };
    dataDirFree: number;
  };
  catalog: { cards: number; sets: number; syncing: boolean; lastSync: string | null; stage: string | null; nextSyncDue: string | null; jobs: string[] };
  calls: { scryfall: number; images: number };
}

function formatBytes(b: number): string {
  if (!b) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Paper p="md" radius="md" withBorder>
      <Group gap="sm" wrap="nowrap">
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
          <Text fw={700} size="xl" style={{ lineHeight: 1.2 }}>{value}</Text>
          {sub && <Text size="xs" c="dimmed" lineClamp={1}>{sub}</Text>}
        </div>
      </Group>
    </Paper>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await api.admin.stats());
    } catch {}
  }, []);

  const loadFeed = useCallback(async () => {
    try {
      setFeed(await api.admin.feed(100));
    } catch {}
  }, []);

  useEffect(() => {
    load();
    loadFeed();
    const t = setInterval(loadFeed, 5000);
    return () => clearInterval(t);
  }, [load, loadFeed]);

  const resync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMsg(body.error || 'Sync failed to start');
      } else {
        setSyncMsg('Sync started. It runs in the background.');
      }
    } catch {
      setSyncMsg('Could not reach the server');
    } finally {
      setSyncing(false);
      setTimeout(load, 2000);
    }
  };

  if (!stats) return <Text c="dimmed">Loading…</Text>;

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');
  const syncColor = stats.catalog.syncing ? 'yellow' : stats.catalog.lastSync ? 'green' : 'red';
  const maxUserBytes = Math.max(...stats.storage.perUser.map(u => u.bytes), 1);

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Admin Dashboard</Title>
        <Text c="dimmed" size="sm">Usage, storage and catalog health for this instance.</Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard icon={<IconUsers size={22} color="var(--mantine-color-blue-5)" />} label="Users" value={String(stats.users.total)}
          sub={`${stats.users.active7d} active in 7d · ${stats.users.active30d} in 30d`} />
        <StatCard icon={<IconShieldLock size={22} color="var(--mantine-color-grape-5)" />} label="Admins" value={String(stats.users.admins)} />
        <StatCard icon={<IconPower size={22} color="var(--mantine-color-orange-5)" />} label="Disabled" value={String(stats.users.disabled)} />
        <StatCard icon={<IconUserCheck size={22} color="var(--mantine-color-green-5)" />} label="Active sessions" value={String(stats.users.activeSessions)} sub="Unexpired sign-ins" />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Paper p="md" radius="md" withBorder>
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Storage</Text>
            <Badge size="sm" variant="light" color="gray">Free: {formatBytes(stats.storage.dataDirFree)}</Badge>
          </Group>
          <Group gap="md" mb="md">
            <Text size="sm" c="dimmed">System DB: <b>{formatBytes(stats.storage.systemDbBytes)}</b></Text>
            <Text size="sm" c="dimmed">User data: <b>{formatBytes(stats.storage.usersBytes)}</b></Text>
            <Text size="sm" c="dimmed">Image cache: <b>{formatBytes(stats.storage.images.bytes)}</b> ({stats.storage.images.files} files)</Text>
          </Group>
          {stats.storage.perUser.length === 0 ? (
            <Text size="sm" c="dimmed">No user databases on disk yet.</Text>
          ) : (
            <Table highlightOnHover styles={{ table: { fontSize: 12 } }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>User</Table.Th>
                  <Table.Th w="40%">Size</Table.Th>
                  <Table.Th ta="right">Bytes</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {stats.storage.perUser.map(u => (
                  <Table.Tr key={u.userId}>
                    <Table.Td>{u.username}</Table.Td>
                    <Table.Td>
                      <Progress value={(u.bytes / maxUserBytes) * 100} size="sm" color={u.bytes > 100 * 1024 * 1024 ? 'orange' : 'blue'} />
                    </Table.Td>
                    <Table.Td ta="right">{formatBytes(u.bytes)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Paper>

        <Paper p="md" radius="md" withBorder>
          <Group justify="space-between" mb="sm">
            <Text fw={600}>Catalog & sync</Text>
            <Button size="compact-sm" variant="light" color="blue" onClick={resync} loading={syncing}
              leftSection={<IconRefresh size={14} />} disabled={stats.catalog.syncing}>
              Resync
            </Button>
          </Group>
          <Group gap="md" mb="md">
            <StatMini icon={<IconCards size={16} />} label="Cards" value={stats.catalog.cards.toLocaleString()} />
            <StatMini icon={<IconDatabase size={16} />} label="Sets" value={stats.catalog.sets.toLocaleString()} />
          </Group>
          <Stack gap={6}>
            <Text size="sm">Status: <Badge size="sm" variant="light" color={syncColor}>{stats.catalog.syncing ? 'Syncing' : stats.catalog.lastSync ? 'Up to date' : 'Never synced'}</Badge></Text>
            {stats.catalog.syncing && <Text size="sm" c="dimmed">{stats.catalog.stage ?? 'Starting…'}</Text>}
            <Text size="sm" c="dimmed">Last sync: <b>{fmtDate(stats.catalog.lastSync)}</b></Text>
            <Text size="sm" c="dimmed">Next sync due: <b>{fmtDate(stats.catalog.nextSyncDue)}</b></Text>
            <Text size="sm" c="dimmed">Jobs: {stats.catalog.jobs.join(', ')}</Text>
          </Stack>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper p="md" radius="md" withBorder>
          <Group gap="sm" mb="xs">
            <IconPlug size={18} color="var(--mantine-color-teal-5)" />
            <Text fw={600}>Outbound API calls</Text>
          </Group>
          <Text size="sm" c="dimmed">Total external requests made since counters were introduced.</Text>
          <Group gap="lg" mt="md">
            <StatMini icon={<IconPlug size={16} />} label="Scryfall" value={stats.calls.scryfall.toLocaleString()} />
            <StatMini icon={<IconPhoto size={16} />} label="Card images" value={stats.calls.images.toLocaleString()} />
          </Group>
        </Paper>
        <Paper p="md" radius="md" withBorder>
          <Group gap="sm" mb="xs">
            <IconPhoto size={18} color="var(--mantine-color-cyan-5)" />
            <Text fw={600}>Image cache</Text>
          </Group>
          <Text size="sm" c="dimmed">Card images are cached on disk so clients never hit the Scryfall CDN directly.</Text>
          <Group gap="lg" mt="md">
            <StatMini icon={<IconPhoto size={16} />} label="Cached files" value={stats.storage.images.files.toLocaleString()} />
            <StatMini icon={<IconDatabase size={16} />} label="Cache size" value={formatBytes(stats.storage.images.bytes)} />
          </Group>
        </Paper>
      </SimpleGrid>

      <Paper p="md" radius="md" withBorder>
        <Group gap="sm" mb="sm">
          <IconActivity size={18} color="var(--mantine-color-blue-5)" />
          <Text fw={600}>API activity</Text>
          <Badge size="sm" variant="light" color="gray" ml="auto">Last {feed.length} requests · auto-refreshes</Badge>
        </Group>
        <Table highlightOnHover styles={{ table: { fontSize: 12 } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>User</Table.Th>
              <Table.Th>Method</Table.Th>
              <Table.Th>Path</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {feed.map(ev => (
              <Table.Tr key={ev.id}>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>{new Date(ev.ts).toLocaleTimeString()}</Table.Td>
                <Table.Td>{ev.username ?? '—'}</Table.Td>
                <Table.Td><Badge size="xs" variant="light" color="gray">{ev.method}</Badge></Table.Td>
                <Table.Td style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.path}</Table.Td>
                <Table.Td>
                  <Badge size="xs" color={ev.status < 400 ? 'green' : ev.status < 500 ? 'yellow' : 'red'} variant="light">{ev.status}</Badge>
                </Table.Td>
              </Table.Tr>
            ))}
            {feed.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}><Text size="sm" c="dimmed" ta="center" py="sm">No API activity yet.</Text></Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      {syncMsg && (
        <Alert icon={<IconRefresh size={16} />} color="blue" variant="light">
          {syncMsg}
        </Alert>
      )}
    </Stack>
  );
}

function StatMini({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Group gap={8} wrap="nowrap">
      {icon}
      <div>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
        <Text fw={700} size="lg">{value}</Text>
      </div>
    </Group>
  );
}
