import { useState, useEffect } from 'react';
import { Center, Paper, Title, Stack, Text, Button, Alert, Group } from '@mantine/core';
import { IconUserOff, IconAlertTriangle, IconArrowLeft } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function AccountDisabledPage() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<{ instanceName: string; adminContactName: string; adminContactEmail: string } | null>(null);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  return (
    <Center h="100vh" style={{ background: 'radial-gradient(circle at 30% 20%, rgba(70,130,246,0.12), transparent 45%)' }}>
      <Paper shadow="lg" radius="md" p="xl" w={420} withBorder>
        <Stack gap="md" align="center">
          <IconUserOff size={44} color="var(--mantine-color-red-6)" />
          <div style={{ textAlign: 'center' }}>
            <Title order={3}>{meta?.instanceName ?? 'MTG Archiver'}</Title>
            <Text fw={600} size="lg">Account disabled</Text>
          </div>
          <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light" ta="left">
            Your account has been disabled by an administrator and you can no longer sign in.
          </Alert>
          <Text size="sm" c="dimmed" ta="center">
            To have your account reinstated or permanently deleted, please contact the instance administrator.
          </Text>
          {meta && (meta.adminContactName || meta.adminContactEmail) && (
            <Paper withBorder p="sm" radius="md" w="100%" style={{ background: 'transparent' }}>
              <Stack gap={6} ta="left">
                {meta.adminContactName && (
                  <Group gap="sm"><Text size="xs" c="dimmed" w={90}>Contact</Text><Text size="sm" fw={500}>{meta.adminContactName}</Text></Group>
                )}
                {meta.adminContactEmail && (
                  <Group gap="sm"><Text size="xs" c="dimmed" w={90}>Email</Text><Text size="sm" fw={500}>{meta.adminContactEmail}</Text></Group>
                )}
              </Stack>
            </Paper>
          )}
          <Button fullWidth variant="light" leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}