import { useState, useEffect, useCallback } from 'react';
import {
  Title, Text, Stack, Paper, Group, TextInput, NumberInput, Button, Alert, SimpleGrid, Modal, Checkbox, Badge,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh, IconSettings, IconAlertTriangle, IconTrash, IconEraser } from '@tabler/icons-react';
import { api, type SystemSettings } from '../../api/client';

interface ConfirmAction {
  key: string;
  title: string;
  description: string;
  requireText?: string;
  run: () => Promise<void>;
}

export default function AdminSystemSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dangerZone, setDangerZone] = useState(false);
  const [demo, setDemo] = useState<{ exists: boolean; enabled: boolean; username: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await api.admin.settings());
    } catch {}
    try {
      setDemo(await api.admin.demoStatus());
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

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
      });
      setSettings(updated);
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

      <Paper p="md" radius="md" withBorder>
        <Stack gap="lg">
          <TextInput
            label="Instance name"
            description="Shown on the landing page and sign-in page."
            value={settings.instanceName}
            onChange={e => { const v = e.currentTarget.value; setSettings(s => s ? { ...s, instanceName: v } : s); }}
            maxLength={64}
          />

          <Paper withBorder p="md" radius="md" style={{ background: 'transparent' }}>
            <Text fw={600} size="sm" mb="xs">System admin contact</Text>
            <Text size="xs" c="dimmed" mb="md">
              Shown to users when they flag a request as urgent.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput
                label="Name"
                placeholder="e.g. Sarah"
                value={settings.adminContactName}
                onChange={e => { const v = e.currentTarget.value; setSettings(s => s ? { ...s, adminContactName: v } : s); }}
                maxLength={64}
              />
              <TextInput
                label="Email address"
                placeholder="e.g. admin@example.com"
                value={settings.adminContactEmail}
                onChange={e => { const v = e.currentTarget.value; setSettings(s => s ? { ...s, adminContactEmail: v } : s); }}
                maxLength={128}
              />
            </SimpleGrid>
          </Paper>

          <TextInput
            label="Domain"
            description="The domain the instance is hosted on. Used to build share links (e.g. when sharing a new user's credentials)."
            placeholder="e.g. mtg.example.com"
            value={settings.domain}
            onChange={e => { const v = e.currentTarget.value; setSettings(s => s ? { ...s, domain: v } : s); }}
            maxLength={128}
          />

          <Paper withBorder p="md" radius="md" style={{ background: 'transparent' }}>
            <Group justify="space-between" mb="xs" wrap="nowrap">
              <div>
                <Text fw={600} size="sm">Demo user</Text>
                <Text size="xs" c="dimmed">
                  Lets visitors try the app from the landing page. Username: <b>demo</b> · Password: <b>demo</b>.
                </Text>
              </div>
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
            </Group>
          </Paper>

          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            <NumberInput
              label="Catalog re-sync interval"
              description="Hours before the full Scryfall catalog (prices + cards) is re-downloaded. 1–168."
              value={settings.scryfallStaleHours}
              onChange={v => setSettings(s => s ? { ...s, scryfallStaleHours: Number(v) || s.scryfallStaleHours } : s)}
              min={1}
              max={168}
              step={1}
            />
            <NumberInput
              label="Sets refresh interval"
              description="Hours between lightweight set-list refreshes. 1–24."
              value={settings.setsRefreshHours}
              onChange={v => setSettings(s => s ? { ...s, setsRefreshHours: Number(v) || s.setsRefreshHours } : s)}
              min={1}
              max={24}
              step={1}
            />
            <NumberInput
              label="Session timeout"
              description="Days before sign-ins expire. Applies to new sessions. 1–365."
              value={settings.sessionTtlDays}
              onChange={v => setSettings(s => s ? { ...s, sessionTtlDays: Number(v) || s.sessionTtlDays } : s)}
              min={1}
              max={365}
              step={1}
            />
          </SimpleGrid>

          <Group justify="space-between">
            {saved ? (
              <Alert icon={<IconRefresh size={16} />} color="green" variant="light" p="xs" style={{ flex: 1 }}>
                {saved}
              </Alert>
            ) : <div />}
            <Button leftSection={<IconSettings size={16} />} onClick={save} loading={saving}>Save settings</Button>
          </Group>
        </Stack>
      </Paper>

      <Paper p="md" radius="md" withBorder style={{ borderColor: 'var(--mantine-color-red-8)' }}>
        <Group justify="space-between" mb="xs">
          <Group gap="sm">
            <IconAlertTriangle size={20} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Danger zone</Text>
          </Group>
          <Checkbox
            label="Enter danger zone"
            checked={dangerZone}
            onChange={e => setDangerZone(e.currentTarget.checked)}
          />
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          These actions are destructive and cannot be undone.
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
                  {a.label === 'Reset the entire instance' ? 'Reset' : 'Clear'}
                </Button>
              </Group>
            );
          })}
        </Stack>
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
