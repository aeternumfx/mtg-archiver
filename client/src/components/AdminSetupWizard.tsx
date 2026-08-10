import { useState, useEffect, useCallback } from 'react';
import {
  Modal, Stack, Group, Text, Button, TextInput, PasswordInput, Alert, Badge, Progress, Card, SimpleGrid,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconArrowRight, IconArrowLeft, IconRocket, IconCheck, IconX } from '@tabler/icons-react';
import { api } from '../api/client';

export default function AdminSetupWizard() {
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [adminContactName, setAdminContactName] = useState('');
  const [adminContactEmail, setAdminContactEmail] = useState('');
  const [enableDemo, setEnableDemo] = useState('yes');

  const load = useCallback(async () => {
    try {
      const s = await api.admin.setupStatus();
      setAdminUsername(s.adminUsername);
      setDone(s.done);
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onInstanceReset = () => load();
    window.addEventListener('mtg:instance-reset', onInstanceReset);
    return () => window.removeEventListener('mtg:instance-reset', onInstanceReset);
  }, [load]);

  if (!ready || done) return null;

  const next = () => {
    setError(null);
    if (step === 0) {
      if (!currentPassword) { setError('Enter your current temporary password.'); return; }
      if (newPassword.length < 8) { setError('You must set a new admin password of at least 8 characters.'); return; }
      if (newPassword === currentPassword) { setError('New password must be different from your current password.'); return; }
    }
    if (step === 1) {
      if (!domain.trim()) { setError('Domain is required.'); return; }
      if (!adminContactName.trim()) { setError('Admin contact name is required.'); return; }
      if (!adminContactEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminContactEmail.trim())) {
        setError('A valid admin contact email is required.'); return;
      }
    }
    setStep(step + 1);
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.admin.completeSetup({
        domain: domain.trim(),
        adminContactName: adminContactName.trim(),
        adminContactEmail: adminContactEmail.trim(),
        demoEnabled: enableDemo === 'yes',
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      notifications.show({ title: 'Setup complete', message: 'Your instance is ready to go.', color: 'green' });
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  const totalSteps = 3;

  return (
    <Modal opened onClose={() => {}} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false}
      size="lg" centered title={<Text fw={700} size="lg">Set up your instance</Text>}>
      <Stack gap="lg">
        <Group gap={8}>
          {['Welcome', 'Instance details', 'Demo user'].map((label, i) => (
            <Badge key={label} size="sm" variant={i === step ? 'filled' : 'light'} color={i < step ? 'green' : 'blue'}>
              {i < step ? <IconCheck size={12} /> : null} {label}
            </Badge>
          ))}
        </Group>

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">{error}</Alert>
        )}

        {step === 0 && (
          <Stack gap="md">
            <Group gap="md" align="flex-start" wrap="nowrap">
              <IconRocket size={28} style={{ flexShrink: 0, color: 'var(--mantine-color-blue-6)' }} />
              <div>
                <Text fw={600} size="md">Welcome!</Text>
                <Text size="sm" c="dimmed">
                  You're signed in as <b>{adminUsername}</b> with a temporary login. Set a new password before
                  continuing.
                </Text>
              </div>
            </Group>
            <PasswordInput label="Current temporary password" value={currentPassword}
              onChange={e => setCurrentPassword(e.currentTarget.value)} required data-autofocus />
            <PasswordInput label="New admin password" value={newPassword}
              onChange={e => setNewPassword(e.currentTarget.value)}
              description="At least 8 characters, and different from the temporary password." required />
          </Stack>
        )}

        {step === 1 && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">Tell us where this instance is hosted and who runs it. This is saved to System Settings.</Text>
            <TextInput label="Domain" placeholder="e.g. mtg.example.com" value={domain}
              onChange={e => setDomain(e.currentTarget.value)} required data-autofocus />
            <Group grow>
              <TextInput label="Admin contact name" placeholder="e.g. Sarah" value={adminContactName}
                onChange={e => setAdminContactName(e.currentTarget.value)} required />
              <TextInput label="Admin contact email" placeholder="e.g. admin@example.com" value={adminContactEmail}
                onChange={e => setAdminContactEmail(e.currentTarget.value)} required />
            </Group>
          </Stack>
        )}

        {step === 2 && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Add a shared <b>demo</b> account so visitors can try the app from the landing page without signing up.
            </Text>
            <Text size="sm" fw={500}>Create the demo user</Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Card withBorder radius="md" padding="md" style={{ cursor: 'pointer' }}
                onClick={() => setEnableDemo('yes')}
                styles={{ root: {
                  borderColor: enableDemo === 'yes' ? 'var(--mantine-color-green-6)' : undefined,
                  background: enableDemo === 'yes' ? 'color-mix(in srgb, var(--mantine-color-green-6) 12%, transparent)' : undefined,
                } }}>
                <Group gap="xs" mb={4}>
                  <IconCheck size={18} color="var(--mantine-color-green-6)" />
                  <Text fw={600} c="green">Enabled</Text>
                </Group>
                <Text size="xs" c="dimmed">Visitors can try the app right from the landing page.</Text>
              </Card>
              <Card withBorder radius="md" padding="md" style={{ cursor: 'pointer' }}
                onClick={() => setEnableDemo('no')}
                styles={{ root: {
                  borderColor: enableDemo === 'no' ? 'var(--mantine-color-red-6)' : undefined,
                  background: enableDemo === 'no' ? 'color-mix(in srgb, var(--mantine-color-red-6) 12%, transparent)' : undefined,
                } }}>
                <Group gap="xs" mb={4}>
                  <IconX size={18} color="var(--mantine-color-red-6)" />
                  <Text fw={600} c="red">Created, but disabled</Text>
                </Group>
                <Text size="xs" c="dimmed">The account is created but hidden until you enable it in System Settings.</Text>
              </Card>
            </SimpleGrid>
            <Alert icon={<IconCheck size={16} />} color="blue" variant="light">
              The demo account will use username <b>demo</b> and password <b>demo</b>. If you choose "disabled", the
              account is still created but the "Try the demo" button won't work until you enable it in System Settings.
            </Alert>
          </Stack>
        )}

        <Progress value={((step + 1) / totalSteps) * 100} size="sm" />

        <Group justify="space-between">
          <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={14} />}
            onClick={() => { setError(null); setStep(Math.max(0, step - 1)); }} disabled={step === 0}>
            Back
          </Button>
          {step < 2 ? (
            <Button onClick={next} rightSection={<IconArrowRight size={14} />}>Continue</Button>
          ) : (
            <Button onClick={finish} loading={busy} color="green">Finish setup</Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
