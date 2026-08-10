import { useState, useEffect } from 'react';
import { Center, Paper, Title, TextInput, PasswordInput, Button, Stack, Text, Alert } from '@mantine/core';
import { IconCards, IconAlertCircle } from '@tabler/icons-react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [instanceName, setInstanceName] = useState('MTG Archiver');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.meta().then(m => setInstanceName(m.instanceName)).catch(() => {});
  }, []);

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await login(username.trim(), password);
      const dest = u.mustChangePassword ? '/login' : (u.role === 'admin' ? '/admin' : '/dashboard');
      navigate(dest, { replace: true });
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center h="100vh" style={{ background: 'radial-gradient(circle at 30% 20%, rgba(70,130,246,0.12), transparent 45%)' }}>
      <Paper shadow="lg" radius="md" p="xl" w={380} withBorder>
        <form onSubmit={submit}>
          <Stack gap="md">
            <Center>
              <IconCards size={40} />
            </Center>
            <Title order={3} ta="center">{instanceName}</Title>
            <Text ta="center" c="dimmed" size="sm">Sign in to your collection</Text>
            {error && (
              <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light" title="Sign in failed">
                {error}
              </Alert>
            )}
            <TextInput
              label="Username"
              value={username}
              onChange={e => setUsername(e.currentTarget.value)}
              autoFocus
              required
            />
            <PasswordInput
              label="Password"
              value={password}
              onChange={e => setPassword(e.currentTarget.value)}
              required
            />
            <Button type="submit" loading={busy} fullWidth>Sign in</Button>
            <Text size="xs" c="dimmed" ta="center">
              Accounts are provisioned by your instance administrator.
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
