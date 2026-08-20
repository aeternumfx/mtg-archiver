import { useState } from 'react';
import { Modal, PasswordInput, Button, Stack, Text, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useAuth } from './AuthContext';
import { useInstanceSetupVisible } from './instanceSetupState';
import { api } from '../api/client';

export function ChangePasswordModal() {
  const { user, setUser } = useAuth();
  const instanceSetup = useInstanceSetupVisible();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // While the one-time instance setup wizard is showing, don't also force the
  // per-user "set your password" dialog (the admin sets their password there).
  const opened = !!user?.mustChangePassword && !instanceSetup;

  const submit = async () => {
    setError(null);
    if (!current.trim()) {
      setError('Please enter your temporary password.');
      return;
    }
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next === current) {
      setError('New password must be different from your temporary password.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.auth.changePassword(current, next);
      setUser(res.user);
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={() => {}} withCloseButton={false} closeOnClickOutside={false} closeOnEscape={false}
      title="Set your password" centered size="sm">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Your administrator has given you a temporary password. Please set your own password to continue.
        </Text>
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">{error}</Alert>
        )}
        <PasswordInput label="Temporary password" value={current} onChange={e => setCurrent(e.currentTarget.value)} data-autofocus required />
        <PasswordInput label="New password" value={next} onChange={e => setNext(e.currentTarget.value)}
          description="At least 8 characters" required />
        <PasswordInput label="Confirm new password" value={confirm} onChange={e => setConfirm(e.currentTarget.value)} required />
        <Button onClick={submit} loading={busy} fullWidth>Set password</Button>
      </Stack>
    </Modal>
  );
}
