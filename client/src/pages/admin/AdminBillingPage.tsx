import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Title, Group, Button, Table, Badge, Modal, Stack, Text, Textarea, Alert, ActionIcon, Paper, NumberInput, Box, SimpleGrid, Code, TextInput, SegmentedControl,
} from '@mantine/core';
import { Calendar } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconCoin, IconRefresh, IconPencil, IconAlertCircle, IconCheck, IconSearch, IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

type MembershipTier = 'trial' | 'complimentary' | 'basic' | 'pro';

const TIERS: MembershipTier[] = ['trial', 'complimentary', 'basic', 'pro'];

const TIER_META: Record<MembershipTier, { label: string; color: string }> = {
  trial: { label: 'Trial', color: 'yellow' },
  complimentary: { label: 'Complimentary', color: 'gray' },
  basic: { label: 'Basic', color: 'blue' },
  pro: { label: 'Pro', color: 'violet' },
};

const DURATIONS = [1, 2, 3, 6, 12];

interface BillingUser {
  id: number;
  username: string;
  displayName: string | null;
  role: string;
  disabled: number;
  demo: boolean;
  membershipTier: string;
  paidUntil: string | null;
  paidOn: string | null;
  freeMonths: number;
  paidMonths: number;
  trialWeeks: number;
  billingNotes: string | null;
  paymentRef: string | null;
}

function tierOf(u: BillingUser): MembershipTier {
  return TIERS.includes(u.membershipTier as MembershipTier) ? (u.membershipTier as MembershipTier) : 'complimentary';
}

const fmtDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const strToDate = (s: string | null): Date | null => (s ? new Date(s + 'T00:00:00') : null);

// Milliseconds until the account's valid-until date. null = no expiry (e.g. complimentary).
function remainingMs(u: BillingUser, now: number): number | null {
  if (!u.paidUntil) return null;
  const end = new Date(u.paidUntil + 'T23:59:59');
  const endTime = end.getTime();
  if (Number.isNaN(endTime)) return null;
  return endTime - now;
}

function formatRemaining(ms: number | null): string {
  if (ms === null) return 'Unlimited';
  if (ms <= 0) {
    const days = Math.ceil(-ms / 86400000);
    return days > 0 ? `Expired ${days}d ago` : 'Expired today';
  }
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(minutes, 1)}m`;
}

function remainingColor(ms: number | null): string {
  if (ms === null) return 'gray';
  if (ms <= 0) return 'red';
  if (ms < 3 * 86400000) return 'orange';
  if (ms < 14 * 86400000) return 'yellow';
  return 'green';
}

// Last day of the month that is (months) months after the received month.
// e.g. anchor in April, 1 month -> end of April; 2 months -> end of May.
function endDateFor(anchor: Date, months: number): Date {
  if (months <= 0) return anchor;
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + months - 1;
  return new Date(y, m + 1, 0);
}

function dayAfter(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

// Trial end = received date + (weeks * 7) days.
function endDateForWeeks(anchor: Date, weeks: number): Date {
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + weeks * 7);
}

function sameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function LegendSwatch({ color, ring, label }: { color?: string; ring?: boolean; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box
        w={16} h={16} style={{
          borderRadius: 4,
          background: color,
          border: ring ? '2px solid var(--mantine-color-blue-6)' : '1px solid var(--mantine-color-default-border)',
        }}
      />
      <Text size="xs" c="dimmed">{label}</Text>
    </Group>
  );
}

export default function AdminBillingPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<BillingUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<BillingUser | null>(null);
  const [editTier, setEditTier] = useState<MembershipTier>('complimentary');
  const [received, setReceived] = useState<Date | null>(null);
  const [freeMonths, setFreeMonths] = useState<number>(0);
  const [paidMonths, setPaidMonths] = useState<number>(1);
  const [trialWeeks, setTrialWeeks] = useState<number>(4);
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [sortKey, setSortKey] = useState<'username' | 'paymentRef' | 'tier' | 'remaining'>('remaining');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const toggleSort = (k: 'username' | 'paymentRef' | 'tier' | 'remaining') => {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.admin.users();
      setUsers(all.filter(u => !u.demo));
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openEdit = (u: BillingUser) => {
    setEditing(u);
    setEditTier(tierOf(u));
    setReceived(strToDate(u.paidOn ?? u.paidUntil));
    setFreeMonths(u.freeMonths || 0);
    setPaidMonths(u.paidMonths || 1);
    setTrialWeeks(u.trialWeeks || 4);
    setEditNotes(u.billingNotes ?? '');
  };

  const closeEdit = () => {
    setEditing(null);
    setEditTier('complimentary');
    setReceived(null);
    setFreeMonths(0);
    setPaidMonths(1);
    setTrialWeeks(4);
    setEditNotes('');
  };

  // Calendar ranges (only meaningful when a received date is chosen).
  const freeStart = received;
  const freeEnd = received ? endDateFor(received, freeMonths) : null;
  // The billed period includes the day payment is received when there are no
  // free months; with free months it begins right after the free period ends.
  const paidStart = (freeMonths > 0 && freeEnd) ? dayAfter(freeEnd) : (received ?? null);
  const paidEnd = editTier === 'trial'
    ? (received ? endDateForWeeks(received, trialWeeks) : null)
    : (received ? endDateFor(received, freeMonths + paidMonths) : null);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.admin.updateBilling(editing.id, {
        membershipTier: editTier,
        paidOn: received ? fmtDate(received) : null,
        paidUntil: paidEnd ? fmtDate(paidEnd) : null,
        freeMonths: editTier === 'trial' ? 0 : freeMonths,
        paidMonths: editTier === 'trial' ? 0 : paidMonths,
        trialWeeks: editTier === 'trial' ? trialWeeks : 0,
        billingNotes: editNotes.trim() || null,
      });
      notifications.show({ title: 'Saved', message: `Membership updated for @${editing.username}`, color: 'green' });
      closeEdit();
      await load();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const counts = TIERS.reduce<Record<MembershipTier, number>>((acc, t) => {
    acc[t] = users.filter(u => tierOf(u) === t).length;
    return acc;
  }, { trial: 0, complimentary: 0, basic: 0, pro: 0 });

  const enabledCount = users.filter(u => !u.disabled).length;
  const disabledCount = users.length - enabledCount;

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = users.filter(u => {
      if (statusFilter === 'enabled' && u.disabled) return false;
      if (statusFilter === 'disabled' && !u.disabled) return false;
      if (!q) return true;
      return u.username.toLowerCase().includes(q)
        || (u.displayName?.toLowerCase().includes(q) ?? false)
        || (u.paymentRef?.toLowerCase().includes(q) ?? false);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'username') cmp = a.username.localeCompare(b.username);
      else if (sortKey === 'paymentRef') cmp = (a.paymentRef ?? '').localeCompare(b.paymentRef ?? '');
      else if (sortKey === 'tier') cmp = TIERS.indexOf(tierOf(a)) - TIERS.indexOf(tierOf(b));
      else cmp = (remainingMs(a, now) ?? Infinity) - (remainingMs(b, now) ?? Infinity);
      return cmp * dir;
    });
  }, [users, query, statusFilter, sortKey, sortDir, now]);

  const renderDay = (date: Date) => {
    const isTrial = editTier === 'trial';
    const isComplimentary = editTier === 'complimentary';
    const isToday = sameDate(date, new Date());

    // Determine color band for this day.
    let band: 'free' | 'paid' | 'trial' | null = null;
    if (!isComplimentary) {
      if (isTrial) {
        if (received && paidEnd && date >= received && date <= paidEnd) band = 'trial';
      } else {
        if (freeStart && freeEnd && freeMonths > 0 && date >= freeStart && date <= freeEnd) band = 'free';
        if (paidStart && paidEnd && paidMonths > 0 && date >= paidStart && date <= paidEnd) band = 'paid';
      }
    }

    const isBandEnd = band === 'trial' && paidEnd && sameDate(date, paidEnd)
      || band === 'free' && freeEnd && sameDate(date, freeEnd)
      || band === 'paid' && paidEnd && sameDate(date, paidEnd);

    const colors: Record<'free' | 'paid' | 'trial', { bg: string; text: string }> = {
      free: { bg: 'var(--mantine-color-green-6)', text: '#fff' },
      paid: { bg: 'var(--mantine-color-blue-0)', text: 'var(--mantine-color-blue-8)' },
      trial: { bg: 'var(--mantine-color-yellow-0)', text: 'var(--mantine-color-yellow-9)' },
    };

    let bg = undefined;
    let color = undefined;
    let fw = undefined;
    let boxShadow = undefined;
    let border = undefined;
    if (band && !isComplimentary) {
      bg = colors[band].bg;
      color = colors[band].text;
      if (band === 'free' || band === 'paid') fw = band === 'paid' ? 400 : 700;
      if (band === 'trial') fw = 400;
    }
    if (isBandEnd) {
      boxShadow = band === 'free'
        ? 'inset 0 0 0 2px var(--mantine-color-green-7)'
        : band === 'trial'
          ? 'inset 0 0 0 2px var(--mantine-color-yellow-7)'
          : 'inset 0 0 0 2px var(--mantine-color-blue-6)';
    } else if (isToday && !band) {
      border = '1px solid var(--mantine-color-violet-6)';
      color = 'var(--mantine-color-violet-7)';
      fw = 600;
    }

    return (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: (band === 'free' || band === 'trial') ? 8 : 0,
          background: band === 'free' ? bg : band === 'paid' ? bg : band === 'trial' ? bg : undefined,
          color,
          fontWeight: fw,
          cursor: 'pointer',
          boxShadow,
          border,
          transition: 'background 120ms ease',
        }}
      >
        {date.getDate()}
      </div>
    );
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}><Group gap="xs" wrap="nowrap"><IconCoin size={24} /> Billing</Group></Title>
          <Text c="dimmed" size="sm">
            Manually track each user's membership tier and payments. Record when payment was received, any free-month
            credit (shown in green, before the billed period), and how many months it covers.
          </Text>
        </div>
        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={load} loading={loading}>Refresh</Button>
      </Group>

      <Group gap="md" wrap="nowrap" align="center">
        <TextInput
          leftSection={<IconSearch size={16} />}
          placeholder="Search by name or reference"
          value={query}
          onChange={e => setQuery(e.currentTarget.value)}
          style={{ flex: 1 }}
          size="sm"
        />
        <SegmentedControl
          size="sm"
          value={statusFilter}
          onChange={v => setStatusFilter(v as 'all' | 'enabled' | 'disabled')}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Enabled', value: 'enabled' },
            { label: 'Disabled', value: 'disabled' },
          ]}
        />
      </Group>

      <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
        Membership tiers: <b>{counts.trial}</b> trial, <b>{counts.complimentary}</b> complimentary,{' '}
        <b>{counts.basic}</b> basic, <b>{counts.pro}</b> pro — {enabledCount} enabled, {disabledCount} disabled.
      </Alert>

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {([
              ['username', 'User'],
              ['paymentRef', 'Reference'],
              ['tier', 'Tier'],
            ] as const).map(([k, label]) => (
              <Table.Th key={k} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                onClick={() => toggleSort(k)}>
                <Group gap={4} wrap="nowrap">
                  {label}
                  {sortKey === k && (sortDir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}
                </Group>
              </Table.Th>
            ))}
            <Table.Th>Paid on</Table.Th>
            <Table.Th>Credit</Table.Th>
            <Table.Th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} onClick={() => toggleSort('remaining')}>
              <Group gap={4} wrap="nowrap">
                Valid until
                {sortKey === 'remaining' && (sortDir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}
              </Group>
            </Table.Th>
            <Table.Th>Notes</Table.Th>
            <Table.Th ta="right">Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {visibleUsers.length === 0 ? (
            <Table.Tr>
              <Table.Td colSpan={8}>
                <Text size="sm" c="dimmed" ta="center" py="sm">No users match this filter.</Text>
              </Table.Td>
            </Table.Tr>
          ) : visibleUsers.map(u => {
            const meta = TIER_META[tierOf(u)];
            const rem = remainingMs(u, now);
            const urgent = rem !== null && rem < 7 * 86400000;
            return (
              <Table.Tr key={u.id} opacity={u.disabled ? 0.5 : 1}>
                <Table.Td>
                  <Group gap="sm" wrap="nowrap">
                    <Text size="sm" fw={600}>@{u.username}</Text>
                    {u.id === me?.id && <Badge size="xs" variant="light" color="blue">you</Badge>}
                    {u.role === 'admin' && <Badge size="xs" color="grape" variant="light">Admin</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {u.paymentRef ? (
                    <Code style={{ letterSpacing: '0.05em' }}>{u.paymentRef}</Code>
                  ) : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td>
                  <Badge size="sm" color={meta.color} variant="light">{meta.label}</Badge>
                </Table.Td>
                <Table.Td>
                  {u.paidOn ? <Text size="sm" tt="nowrap">{u.paidOn}</Text> : <Text size="sm" c="dimmed">—</Text>}
                </Table.Td>
                <Table.Td>
                  {tierOf(u) === 'trial'
                    ? (u.trialWeeks > 0
                        ? <Badge size="sm" color="yellow" variant="light">{u.trialWeeks} wk</Badge>
                        : <Text size="sm" c="dimmed">—</Text>)
                    : (u.freeMonths > 0
                        ? <Badge size="sm" color="green" variant="light">{u.freeMonths} mo</Badge>
                        : <Text size="sm" c="dimmed">—</Text>)}
                </Table.Td>
                <Table.Td>
                  {u.paidUntil ? (
                    <>
                      <Text size="sm" tt="nowrap">{u.paidUntil}</Text>
                      <Text size="xs" c={remainingColor(rem)} fw={urgent ? 600 : 400}>
                        {formatRemaining(rem)}
                      </Text>
                    </>
                  ) : (
                    <Badge size="xs" variant="light" color="gray">Unlimited</Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  {u.billingNotes ? (
                    <Text size="sm" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.billingNotes}>
                      {u.billingNotes}
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">—</Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon variant="subtle" color="blue" title="Edit membership"
                      onClick={() => openEdit(u)} disabled={u.id === me?.id}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>

      <Modal opened={!!editing} onClose={closeEdit} title={`Membership — @${editing?.username ?? ''}`} size="md" centered>
        <Stack gap="md">
          <Text size="xs" c="dimmed">Choose the tier, then pick the date payment was received, any free-month credit,
            and how many billed months it covers. Free months show in green, billed months in blue; trials show in yellow.</Text>

          <SimpleGrid cols={{ base: 2, sm: 2 }} spacing="xs">
            {TIERS.map(t => {
              const selected = editTier === t;
              const meta = TIER_META[t];
              return (
                <Button
                  key={t}
                  size="compact-md"
                  fullWidth
                  variant={selected ? 'filled' : 'light'}
                  color={meta.color}
                  style={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    textTransform: 'capitalize',
                    boxShadow: selected ? `0 2px 8px color-mix(in srgb, var(--mantine-color-${meta.color}-6) 35%, transparent)` : undefined,
                  }}
                  onClick={() => setEditTier(t)}
                >
                  {selected ? <IconCheck size={14} style={{ marginRight: 6 }} /> : null}
                  {meta.label}
                </Button>
              );
            })}
          </SimpleGrid>

          <Text size="sm" fw={600} mt="sm">Payment received</Text>
          <Text size="xs" c="dimmed">Click a day on the calendar.</Text>
          <Paper withBorder radius="md" p="sm" style={{ background: 'var(--mantine-color-default-hover)' }}>
            <Calendar
              getDayProps={(date) => ({ onClick: () => setReceived(date) })}
              renderDay={renderDay}
              size="sm"
              styles={{
                month: { width: '100%' },
                day: { height: 34, fontSize: 14, borderRadius: 8, width: 38 },
                weekday: { fontSize: 11, textTransform: 'uppercase', paddingBottom: 8, opacity: 0.6 },
                monthsList: { width: '100%' },
                monthsListCell: { justifyContent: 'center' },
                monthCell: { justifyContent: 'center' },
                calendarHeaderLevel: { fontWeight: 700 },
              }}
            />
          </Paper>

          {editTier === 'trial' ? (
            <Group align="flex-end" wrap="wrap" gap="lg">
              <div style={{ flex: 1, minWidth: 200 }}>
                <Text size="sm" fw={600} mb={6}>Trial length</Text>
                <Group gap={6} mb={6} wrap="nowrap">
                  {[1, 2, 4, 6, 12].map(d => (
                    <Button key={d} size="compact-sm" variant={trialWeeks === d ? 'filled' : 'light'} color="yellow"
                      onClick={() => setTrialWeeks(d)}>
                      {d} wk
                    </Button>
                  ))}
                </Group>
                <NumberInput
                  label="Custom weeks"
                  value={trialWeeks}
                  onChange={v => setTrialWeeks(Number(v) || 1)}
                  min={1}
                  max={120}
                  size="xs"
                  style={{ maxWidth: 160 }}
                />
              </div>
              <Paper withBorder radius="md" p="lg" style={{ textAlign: 'center', minWidth: 160 }}>
                <Text size="xs" c="dimmed" mb={4}>Valid until</Text>
                <Text fw={700} size="xl" c="yellow">{paidEnd ? fmtDate(paidEnd) : '—'}</Text>
              </Paper>
            </Group>
          ) : (
            <>
              <Group gap="md" wrap="wrap" align="flex-end">
                <div style={{ flex: 1, minWidth: 260 }}>
                  <Text size="sm" fw={600} mb={6}>Free month credit</Text>
                  <Group gap={6} mb={6} wrap="nowrap">
                    {[0, 1, 2, 3].map(d => (
                      <Button key={d} size="compact-sm" variant={freeMonths === d ? 'filled' : 'light'} color="green"
                        onClick={() => setFreeMonths(d)}>
                        {d} mo
                      </Button>
                    ))}
                  </Group>
                  <NumberInput
                    label="Free months"
                    value={freeMonths}
                    onChange={v => setFreeMonths(Math.max(0, Number(v) || 0))}
                    min={0}
                    max={120}
                    size="xs"
                    style={{ maxWidth: 160 }}
                  />
                </div>
              </Group>

              <Group align="flex-end" wrap="wrap" gap="lg">
                <div style={{ flex: 1, minWidth: 260 }}>
                  <Text size="sm" fw={600} mb={6}>Billed months</Text>
                  <Group gap={6} mb={6} wrap="nowrap">
                    {DURATIONS.map(d => (
                      <Button key={d} size="compact-sm" variant={paidMonths === d ? 'filled' : 'light'} color="blue"
                        onClick={() => setPaidMonths(d)}>
                        {d} mo
                      </Button>
                    ))}
                  </Group>
                  <NumberInput
                    label="Custom months"
                    description="Any whole number of months"
                    value={paidMonths}
                    onChange={v => setPaidMonths(Number(v) || 1)}
                    min={1}
                    max={120}
                    step={1}
                    size="xs"
                    style={{ maxWidth: 200 }}
                  />
                </div>
                <Paper withBorder radius="md" p="lg" style={{ textAlign: 'center', minWidth: 160 }}>
                  <Text size="xs" c="dimmed" mb={4}>Valid until</Text>
                  <Text fw={700} size="xl" c="blue">{paidEnd ? fmtDate(paidEnd) : '—'}</Text>
                </Paper>
              </Group>
            </>
          )}

          <Group gap="md" wrap="wrap">
            {editTier === 'trial' ? (
              <LegendSwatch color="var(--mantine-color-yellow-0)" label="Trial period" />
            ) : (
              <>
                {freeMonths > 0 && <LegendSwatch color="var(--mantine-color-green-6)" label="Free period" />}
                {paidMonths > 0 && <LegendSwatch color="var(--mantine-color-blue-0)" label="Billed period" />}
              </>
            )}
          </Group>

          <Textarea label="Notes" value={editNotes} onChange={e => setEditNotes(e.currentTarget.value)}
            placeholder="e.g. annual plan, gifted, etc." autosize minRows={2} maxRows={5} />

          <Group justify="flex-end">
            <Button variant="default" onClick={closeEdit}>Cancel</Button>
            <Button onClick={save} loading={saving} leftSection={<IconCheck size={16} />}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
