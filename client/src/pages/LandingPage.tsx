import { useState, useEffect } from 'react';
import { Container, Title, Text, Button, Group, Badge, Paper, Stack, SimpleGrid, ThemeIcon, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDatabase, IconArrowRight, IconRocket, IconCards, IconSwords, IconTarget, IconChartBar, IconRefresh, IconShieldLock, IconBolt } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';

const FEATURES = [
  { icon: IconCards, title: 'Catalog your collection', text: 'Add cards in seconds — search by name or set+number, mark foil, foreign, and condition, and see current market values at a glance.' },
  { icon: IconSwords, title: 'Build decks effortlessly', text: 'Draft a deck and see at a glance which cards you already own, track your commanders, and keep a wantlist for the rest.' },
  { icon: IconTarget, title: 'Smart wantlist', text: 'Keep a running list of the cards you’re hunting, with goals and fulfilment tracking so nothing slips through the cracks.' },
  { icon: IconChartBar, title: 'Understand your collection', text: 'Dashboards, value history, and organize tools show where your cards are, what they’re worth, and how your collection grows.' },
  { icon: IconShieldLock, title: 'Private by default', text: 'Your collection and wantlist are private to you. Choose exactly what to share with friends — with optional password protection.' },
  { icon: IconBolt, title: 'Fast and simple', text: 'Quick-add, keyboard shortcuts, undo, and bulk import keep busy sessions smooth. Everything runs on your own server.' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, demoLogin, setupLogin } = useAuth();
  const [instanceName, setInstanceName] = useState('MTG Archiver');
  const [setupDone, setSetupDone] = useState(true);
  const [setupToken, setSetupToken] = useState('');

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
    if (!setupToken.trim()) {
      notifications.show({ title: 'Setup token required', message: 'Enter the one-time setup token from the server console.', color: 'yellow' });
      return;
    }
    try {
      await setupLogin(setupToken.trim());
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
        <Text ta="center" c="dimmed" size="lg" maw={620}>
          Track every card you own, build decks, hunt down wantlist targets and open boosters — all in one private,
          fast, and secure place that lives on your own server.
        </Text>
        <Group>
          {user ? (
            <Button size="md" rightSection={<IconArrowRight size={16} />} onClick={() => navigate(user.role === 'admin' ? '/admin' : '/dashboard')}>
              Go to your {user.role === 'admin' ? 'admin console' : 'collection'}
            </Button>
          ) : needsSetup ? (
            <Stack align="center" gap="md">
              <TextInput
                placeholder="One-time setup token (from server console)"
                value={setupToken}
                onChange={e => setSetupToken(e.currentTarget.value)}
                w={360}
              />
              <Button size="lg" variant="filled" color="green" leftSection={<IconRocket size={18} />}
                rightSection={<IconArrowRight size={18} />} onClick={beginSetup}>
                Setup instance
              </Button>
            </Stack>
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
          <Text size="sm" c="dimmed" ta="center" maw={560}>
            This instance hasn't been set up yet. Enter the one-time setup token printed in the server console to begin.
          </Text>
        )}
        {!user && !needsSetup && (
          <Text size="xs" c="dimmed">
            Don't have an account? Ask your instance administrator for an invite.
          </Text>
        )}
        <Group gap="lg" mt="sm">
          <Group gap={6}><IconShieldLock size={14} color="var(--mantine-color-green-6)" /><Text size="xs" c="dimmed">Encrypted, hashed passwords</Text></Group>
          <Group gap={6}><IconDatabase size={14} color="var(--mantine-color-blue-6)" /><Text size="xs" c="dimmed">Isolated per-user data</Text></Group>
          <Group gap={6}><IconRefresh size={14} color="var(--mantine-color-teal-6)" /><Text size="xs" c="dimmed">Self-hosted & under your control</Text></Group>
        </Group>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
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
