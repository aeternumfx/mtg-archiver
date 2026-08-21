import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Title, Text, Stack, Paper, Group, TextInput, NumberInput, Button, Alert, SimpleGrid, Modal, Checkbox, SegmentedControl, Tabs, Badge,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconTrash, IconEraser, IconBuildingStore, IconMail, IconCreditCard, IconWallet,
  IconClock, IconCalendarStats, IconCards, IconLock, IconKey, IconDeviceFloppy,
} from '@tabler/icons-react';
import { api, type SystemSettings } from '../../api/client';

interface ConfirmAction {
  key: string;
  title: string;
  description: string;
  requireText?: string;
  run: () => Promise<void>;
}

type TabValue = 'general' | 'billing' | 'sync' | 'access' | 'danger';

const TABS: Array<{ value: TabValue; label: string; icon: React.ElementType; color?: string }> = [
  { value: 'general', label: 'General', icon: IconBuildingStore },
  { value: 'billing', label: 'Billing', icon: IconCreditCard },
  { value: 'sync', label: 'Sync & sessions', icon: IconCalendarStats },
  { value: 'access', label: 'Access', icon: IconKey },
  { value: 'danger', label: 'Danger zone', icon: IconAlertTriangle, color: 'red' },
];

export default function AdminSystemSettingsPage() {
  const [tab, setTab] = useState<TabValue>('general');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [original, setOriginal] = useState<SystemSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dangerZone, setDangerZone] = useState(false);
  const [demo, setDemo] = useState<{ exists: boolean; enabled: boolean; username: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.admin.settings();
      setSettings(s);
      setOriginal(s);
      setSaved(null);
    } catch {}
    try {
      setDemo(await api.admin.demoStatus());
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(
    () => !!(settings && original && JSON.stringify(settings) !== JSON.stringify(original)),
    [settings, original],
  );

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setSaved(null);
    try {
      const updated = await api.admin.updateSettings({
        scryfallStaleHours: settings.scryfallStaleHours,
        setsRefreshHours: settings.setsRefreshHours,
        sessionTtlDays: settings.sessionTtlDays,
        instanceName: settings.instanceName,
        domain: settings.domain,
        adminContactName: settings.adminContactName,
        adminContactEmail: settings.adminContactEmail,
        basicPrice: settings.basicPrice,
        proPrice: settings.proPrice,
        accountName: settings.accountName,
        accountHolder: settings.accountHolder,
        arrearsDays: settings.arrearsDays,
        arrearsAction: settings.arrearsAction,
      });
      setSettings(updated);
      setOriginal(updated);
      setSaved(`Saved at ${new Date().toLocaleTimeString()}`);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await confirm.run();
      notifications.show({ title: 'Done', message: 'Action completed.', color: 'green' });
      if (confirm.key === 'reset-settings' || confirm.key === 'reset-instance') {
        setSettings(await api.admin.settings());
      }
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setBusy(false);
      setConfirm(null);
      setConfirmText('');
    }
  };

  const toggleDemo = async () => {
    if (!demo) return;
    setBusy(true);
    try {
      const res = await api.admin.setDemo(!demo.enabled);
      setDemo({ ...demo, enabled: res.enabled });
      notifications.show({ title: 'Demo user', message: res.message, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<SystemSettings>) => setSettings(s => (s ? { ...s, ...patch } : s));

  const dangerActions: Array<{ label: string; description: string; confirm: ConfirmAction; color?: string }> = [
    {
      label: 'Reset the entire instance',
      description: 'Permanently remove every user except you, their databases, all requests, activity log and image cache, and restore default settings. The card catalog is kept.',
      color: 'red',
      confirm: {
        key: 'reset-instance',
        title: 'Reset the entire instance?',
        description: 'This permanently deletes all other users and their data. Type RESET to confirm.',
        requireText: 'RESET',
        run: async () => {
          await api.admin.resetInstance();
          window.dispatchEvent(new Event('mtg:instance-reset'));
        },
      },
    },
    {
      label: 'Delete all user requests',
      description: 'Remove every request submitted by users.',
      confirm: {
        key: 'clear-requests',
        title: 'Delete all user requests?',
        description: 'All submitted requests will be permanently removed.',
        run: async () => { await api.admin.clearRequests(); },
      },
    },
    {
      label: 'Clear API activity log',
      description: 'Clear the live feed of API calls shown on the admin dashboard.',
      confirm: {
        key: 'clear-activity',
        title: 'Clear the API activity log?',
        description: 'The activity feed will start fresh.',
        run: async () => { await api.admin.clearActivity(); },
      },
    },
    {
      label: 'Clear image cache',
      description: 'Delete all cached card images on disk.',
      confirm: {
        key: 'clear-images',
        title: 'Clear the image cache?',
        description: 'Cached card images will be deleted and re-fetched on demand.',
        run: async () => { await api.admin.clearImages(); },
      },
    },
    {
      label: 'Reset system settings to defaults',
      description: 'Restore all settings above to their defaults.',
      color: 'orange',
      confirm: {
        key: 'reset-settings',
        title: 'Reset system settings?',
        description: 'All settings will return to defaults.',
        run: async () => { await api.admin.resetSettings(); },
      },
    },
  ];

  if (!settings) return <Text c="dimmed">Loading…</Text>;

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>System Settings</Title>
        <Text c="dimmed" size="sm">Instance-wide configuration. Changes take effect without a restart.</Text>
      </div>

      <Tabs value={tab} onChange={v => setTab((v ?? 'general') as TabValue)}>
        <Tabs.List>
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <Tabs.Tab key={t.value} value={t.value} leftSection={<Icon size={16} />}
                color={t.color ?? undefined}>
                {t.label}
              </Tabs.Tab>
            );
          })}
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
          <Stack gap="md">
            <Paper p="md" radius="md" withBorder>
              <Group gap="sm" mb="xs">
                <IconBuildingStore size={18} color="var(--mantine-color-blue-5)" />
                <Text fw={600}>Instance</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="md">Identity of this instance, used across the app.</Text>
              <Stack gap="md">
                <TextInput
                  label="Instance name"
                  description="Shown on the landing page and sign-in page."
                  value={settings.instanceName}
                  onChange={e => set({ instanceName: e.currentTarget.value })}
                  maxLength={64}
                />
                <TextInput
                  label="Domain"
                  description="The domain the instance is hosted on. Used to build share links (e.g. when sharing a new user's credentials)."
                  placeholder="e.g. mtg.example.com"
                  value={settings.domain}
                  onChange={e => set({ domain: e.currentTarget.value })}
                  maxLength={128}
                />
              </Stack>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Group gap="sm" mb="xs">
                <IconMail size={18} color="var(--mantine-color-cyan-5)" />
                <Text fw={600}>System admin contact</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="md">Shown to users when they flag a request as urgent.</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <TextInput
                  label="Name"
                  placeholder="e.g. Sarah"
                  value={settings.adminContactName}
                  onChange={e => set({ adminContactName: e.currentTarget.value })}
                  maxLength={64}
                />
                <TextInput
                  label="Email address"
                  placeholder="e.g. admin@example.com"
                  value={settings.adminContactEmail}
                  onChange={e => set({ adminContactEmail: e.currentTarget.value })}
                  maxLength={128}
                />
              </SimpleGrid>
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="billing" pt="md">
          <Stack gap="md">
            <Paper p="md" radius="md" withBorder>
              <Group gap="sm" mb="xs">
                <IconCreditCard size={18} color="var(--mantine-color-teal-5)" />
                <Text fw={600}>Plans & pricing</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="md">Prices shown to users when choosing a plan.</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <TextInput
                  label="Basic plan price"
                  placeholder="e.g. 5.00 / month"
                  value={settings.basicPrice}
                  onChange={e => set({ basicPrice: e.currentTarget.value })}
                  maxLength={16}
                />
                <TextInput
                  label="Pro plan price"
                  placeholder="e.g. 10.00 / month"
                  value={settings.proPrice}
                  onChange={e => set({ proPrice: e.currentTarget.value })}
                  maxLength={16}
                />
              </SimpleGrid>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Group gap="sm" mb="xs">
                <IconWallet size={18} color="var(--mantine-color-blue-5)" />
                <Text fw={600}>Payment details</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="md">
                The account users send payments to. Also appears on each user's profile page.
              </Text>
              <Stack gap="md">
                <TextInput
                  label="Account number"
                  description="The account users should send payments to."
                  placeholder="e.g. IBAN / sort code + account number"
                  value={settings.accountName}
                  onChange={e => set({ accountName: e.currentTarget.value })}
                  maxLength={64}
                />
                <TextInput
                  label="Account holder name"
                  description="The name the account is registered to."
                  placeholder="e.g. Sarah Johnson"
                  value={settings.accountHolder}
                  onChange={e => set({ accountHolder: e.currentTarget.value })}
                  maxLength={64}
                />
              </Stack>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Group gap="sm" mb="xs">
                <IconClock size={18} color="var(--mantine-color-orange-5)" />
                <Text fw={600}>Arrears</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="md">
                How long an unpaid user can keep using their account after their plan ends, and what happens when that
                grace period runs out.
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <NumberInput
                  label="Arrears grace period (days)"
                  description="Default 14 (2 weeks). 0 disables the grace period."
                  value={settings.arrearsDays}
                  onChange={v => set({ arrearsDays: Number(v) || 0 })}
                  min={0}
                  max={365}
                  step={1}
                />
                <div>
                  <Text size="sm" fw={500} mb={6}>When arrears expires</Text>
                  <SegmentedControl
                    fullWidth
                    value={settings.arrearsAction}
                    onChange={v => set({ arrearsAction: v as 'disable' | 'none' })}
                    data={[
                      { value: 'disable', label: 'Disable account' },
                      { value: 'none', label: 'Do nothing' },
                    ]}
                  />
                </div>
              </SimpleGrid>
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="sync" pt="md">
          <Stack gap="md">
            <Paper p="md" radius="md" withBorder>
              <Group gap="sm" mb="xs">
                <IconCards size={18} color="var(--mantine-color-grape-5)" />
                <Text fw={600}>Catalog & sync</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="md">How often the card catalog is refreshed from Scryfall.</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <NumberInput
                  label="Catalog re-sync interval"
                  description="Hours before the full Scryfall catalog (prices + cards) is re-downloaded. 1–168."
                  value={settings.scryfallStaleHours}
                  onChange={v => set({ scryfallStaleHours: Number(v) || settings.scryfallStaleHours })}
                  min={1}
                  max={168}
                  step={1}
                />
                <NumberInput
                  label="Sets refresh interval"
                  description="Hours between lightweight set-list refreshes. 1–24."
                  value={settings.setsRefreshHours}
                  onChange={v => set({ setsRefreshHours: Number(v) || settings.setsRefreshHours })}
                  min={1}
                  max={24}
                  step={1}
                />
              </SimpleGrid>
            </Paper>

            <Paper p="md" radius="md" withBorder>
              <Group gap="sm" mb="xs">
                <IconLock size={18} color="var(--mantine-color-green-5)" />
                <Text fw={600}>Sessions</Text>
              </Group>
              <Text size="xs" c="dimmed" mb="md">How long sign-ins stay valid before they expire.</Text>
              <NumberInput
                label="Session timeout (days)"
                description="Days before sign-ins expire. Applies to new sessions. 1–365."
                value={settings.sessionTtlDays}
                onChange={v => set({ sessionTtlDays: Number(v) || settings.sessionTtlDays })}
                min={1}
                max={365}
                step={1}
              />
            </Paper>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="access" pt="md">
          <Paper p="md" radius="md" withBorder>
            <Group gap="sm" mb="xs">
              <IconKey size={18} color="var(--mantine-color-green-6)" />
              <Text fw={600}>Demo user</Text>
            </Group>
            <Text size="xs" c="dimmed" mb="md">
              Lets visitors try the app from the landing page. Username: <b>demo</b> · Password: <b>demo</b>.
            </Text>
            {demo && (
              <Group gap="sm" wrap="nowrap">
                <Badge size="sm" color={demo.enabled ? 'green' : 'red'} variant="light">
                  {demo.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Button size="compact-sm" variant="light" color={demo.enabled ? 'orange' : 'green'} loading={busy}
                  onClick={toggleDemo}>
                  {demo.enabled ? 'Disable demo' : 'Enable demo'}
                </Button>
              </Group>
            )}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="danger" pt="md">
          <Paper p="md" radius="md" withBorder style={{ borderColor: 'var(--mantine-color-red-8)' }}>
            <Group justify="space-between" mb="xs">
              <Group gap="sm">
                <IconAlertTriangle size={20} color="var(--mantine-color-red-6)" />
                <Text fw={700}>Danger zone</Text>
              </Group>
              <Checkbox
                label="Enable destructive actions"
                checked={dangerZone}
                onChange={e => setDangerZone(e.currentTarget.checked)}
              />
            </Group>
            <Text size="xs" c="dimmed" mb="md">
              These actions are destructive and cannot be undone. Enable them above before they can be triggered.
            </Text>
            <Stack gap="xs" style={{ opacity: dangerZone ? 1 : 0.45, transition: 'opacity 150ms ease' }}>
              {dangerActions.map(a => {
                const Icon = a.color ? IconTrash : IconEraser;
                return (
                  <Group key={a.label} justify="space-between" p="xs" style={{ borderRadius: 8 }}
                    styles={{ root: { backgroundColor: 'color-mix(in srgb, var(--mantine-color-red-2) 15%, transparent)' } }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600}>{a.label}</Text>
                      <Text size="xs" c="dimmed">{a.description}</Text>
                    </div>
                    <Button size="compact-sm" variant="light" color={a.color ?? 'orange'}
                      leftSection={<Icon size={14} />} disabled={!dangerZone}
                      onClick={() => { setConfirmText(''); setConfirm(a.confirm); }}>
                      {a.confirm.key.startsWith('reset') ? 'Reset' : 'Clear'}
                    </Button>
                  </Group>
                );
              })}
            </Stack>
          </Paper>
        </Tabs.Panel>
      </Tabs>

      <Paper p="sm" radius="md" withBorder
        style={{ position: 'sticky', bottom: 12, zIndex: 10, boxShadow: 'var(--mantine-shadow-md)' }}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c={saved && !dirty ? 'green' : 'dimmed'} lineClamp={1}>
            {dirty
              ? 'You have unsaved changes.'
              : saved
                ? saved
                : 'All settings are up to date.'}
          </Text>
          <Group gap="sm" wrap="nowrap">
            <Button variant="light" color="orange" loading={busy}
              onClick={() => setTab('danger')}>
              Danger zone
            </Button>
            <Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={saving} disabled={!dirty}>
              Save settings
            </Button>
          </Group>
        </Group>
      </Paper>

      <Modal opened={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title ?? ''} size="sm" centered>
        {confirm && (
          <Stack gap="md">
            <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
              {confirm.description}
            </Alert>
            {confirm.requireText ? (
              <TextInput
                label={`Type ${confirm.requireText} to confirm`}
                value={confirmText}
                onChange={e => setConfirmText(e.currentTarget.value.toUpperCase())}
                autoFocus
              />
            ) : null}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button color="red" loading={busy} disabled={!!confirm.requireText && confirmText !== confirm.requireText}
                onClick={runConfirmed}>
                {confirm.requireText ? 'Reset' : 'Confirm'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}