import { useState, useEffect } from 'react';
import { Container, Title, Text, Button, Group, Badge, Paper, Stack, SimpleGrid, ThemeIcon } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLock, IconDatabase, IconArrowRight, IconUsers, IconRocket } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';

const FEATURES = [
  { icon: IconDatabase, title: 'Your own collection', text: 'Every user gets their own isolated database — your cards, decks, trades and wantlist are private to you.' },
  { icon: IconUsers, title: 'Managed enrollment', text: 'Accounts are created by the instance admin, so you know exactly who is using the server.' },
  { icon: IconLock, title: 'Secure by default', text: 'Password hashing, session cookies, per-user storage and access controls keep each collection safe.' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, demoLogin, setupLogin } = useAuth();
  const [instanceName, setInstanceName] = useState('MTG Archiver');
  const [setupDone, setSetupDone] = useState(true);

  useEffect(() => {
    api.meta().then(m => {
      setInstanceName(m.instanceName);
      setSetupDone(m.instanceSetupDone);
    }).catch(() => {});
  }, []);

  const tryDemo = async () => {
    try {
      await demoLogin();
      navigate('/dashboard');
    } catch (err: any) {
      notifications.show({ title: 'Demo unavailable', message: err.message || 'The demo account is not available.', color: 'yellow' });
    }
  };

  const beginSetup = async () => {
    try {
      await setupLogin();
      navigate('/admin');
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message || 'Could not start setup.', color: 'red' });
    }
  };

  const needsSetup = !user && !setupDone;

  return (
    <Container size="lg" py={60}>
      <Stack align="center" gap="lg" mb={50}>
        <Badge size="lg" variant="light" color="green">MTG Collection Manager</Badge>
        <Title order={1} ta="center" style={{ fontSize: 44, lineHeight: 1.1 }}>
          {instanceName}
        </Title>
        <Text ta="center" c="dimmed" size="lg" maw={560}>
          Track every card you own, build decks, manage a wantlist, log trades and open boosters —
          all in one self-hosted app with private per-user databases.
        </Text>
        <Group>
          {user ? (
            <Button size="md" rightSection={<IconArrowRight size={16} />} onClick={() => navigate(user.role === 'admin' ? '/admin' : '/dashboard')}>
              Go to your {user.role === 'admin' ? 'admin console' : 'collection'}
            </Button>
          ) : needsSetup ? (
            <Button size="lg" variant="filled" color="green" leftSection={<IconRocket size={18} />}
              rightSection={<IconArrowRight size={18} />} onClick={beginSetup}>
              Setup instance
            </Button>
          ) : (
            <>
              <Button size="md" rightSection={<IconArrowRight size={16} />} onClick={() => navigate('/login')}>
                Sign in
              </Button>
              <Button size="md" variant="light" color="orange" rightSection={<IconArrowRight size={16} />} onClick={tryDemo}>
                Try the demo
              </Button>
            </>
          )}
        </Group>
        {needsSetup && (
          <Text size="sm" c="dimmed">
            This instance hasn't been set up yet. Set up the admin account, contact details and demo user to get started.
          </Text>
        )}
        {!user && !needsSetup && (
          <Text size="xs" c="dimmed">
            Don't have an account? Contact your instance administrator to be set up.
          </Text>
        )}
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
        {FEATURES.map(f => (
          <Paper key={f.title} p="lg" radius="md" withBorder>
            <Stack gap="sm">
              <ThemeIcon size={44} radius="md" variant="light" color="blue">
                <f.icon size={24} />
              </ThemeIcon>
              <Text fw={600} size="lg">{f.title}</Text>
              <Text size="sm" c="dimmed">{f.text}</Text>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
    </Container>
  );
}
