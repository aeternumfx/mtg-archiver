import { useState, useEffect } from 'react';
import { Group, Text, Button, Alert } from '@mantine/core';
import { IconRocket } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api, type UpdateStatus } from '../api/client';

const DISMISS_KEY = 'mtg-update-banner-dismissed';

export default function AdminUpdateBanner() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.admin.updateStatus().then(s => {
      if (cancelled) return;
      setStatus(s);
      if (s.updateAvailable) {
        setDismissed(localStorage.getItem(DISMISS_KEY) === `${s.latestVersion}`);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!status?.updateAvailable || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, `${status.latestVersion}`);
  };

  return (
    <Alert icon={<IconRocket size={18} />} color="yellow" variant="light" mb="md" px="md" py="xs"
      withCloseButton onClose={dismiss}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm">
          An update is available: <b>v{status.latestVersion}</b> (you're on {status.version}).
        </Text>
        <Button size="compact-xs" variant="light" color="yellow" onClick={() => navigate('/admin/updates')}>
          Update now
        </Button>
      </Group>
    </Alert>
  );
}
