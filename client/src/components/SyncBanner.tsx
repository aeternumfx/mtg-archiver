import { useState, useEffect } from 'react';
import { Alert, Progress, Group, Text } from '@mantine/core';
import { IconCloudDownload, IconCheck, IconX } from '@tabler/icons-react';
import type { SyncStatus } from '../types';

const DISMISS_KEY = 'mtg-sync-dismissed';

export default function SyncBanner({ syncStatus }: { syncStatus: SyncStatus }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (syncStatus.syncing) {
      setDismissed(false);
      return;
    }
    if (syncStatus.lastSync) {
      setDismissed(localStorage.getItem(DISMISS_KEY) === syncStatus.lastSync);
    }
  }, [syncStatus.syncing, syncStatus.lastSync]);

  const dismiss = () => {
    setDismissed(true);
    if (syncStatus.lastSync) localStorage.setItem(DISMISS_KEY, syncStatus.lastSync);
  };

  const isSyncing = syncStatus.syncing;
  const isComplete = syncStatus.progress === 100 && !isSyncing;
  const isError = syncStatus.stage === 'Sync failed' && !isSyncing;

  if (dismissed || (!isSyncing && !isComplete && !isError)) return null;

  if (isComplete) {
    return (
      <Alert
        icon={<IconCheck size={18} />}
        title="Sync complete"
        color="green"
        mb="md"
        withCloseButton
        onClose={dismiss}
      >
        Card database is up to date.
      </Alert>
    );
  }

  if (isError) {
    return (
      <Alert
        icon={<IconX size={18} />}
        title="Sync failed"
        color="red"
        mb="md"
        withCloseButton
        onClose={dismiss}
      >
        Could not update card data. Check your connection and try again.
      </Alert>
    );
  }

  return (
    <Alert
      icon={<IconCloudDownload size={18} />}
      title="Syncing card data from Scryfall"
      color="blue"
      mb="md"
    >
      <Text size="sm">{syncStatus.stage ?? 'Starting...'}</Text>
      {syncStatus.progress !== null && (
        <Group gap="xs" mt="xs">
          <Progress value={syncStatus.progress} size="sm" animated style={{ flex: 1 }} />
          <Text size="xs" c="dimmed" style={{ minWidth: 38, textAlign: 'right' }}>
            {syncStatus.progress}%
          </Text>
        </Group>
      )}
    </Alert>
  );
}
