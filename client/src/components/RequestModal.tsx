import { useState, useEffect } from 'react';
import { Modal, Stack, TextInput, Textarea, SegmentedControl, Checkbox, Button, Group, Alert, Text } from '@mantine/core';
import { IconAlertCircle, IconMessageCircle, IconMail } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { api, type RequestType } from '../api/client';

const REQUEST_TYPE_OPTIONS: Array<{ value: RequestType; label: string }> = [
  { value: 'help', label: 'Help' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'other', label: 'Other' },
];

const TYPE_COLORS: Record<RequestType, string> = {
  help: '#f9a825',
  feature: '#be4bdb',
  bug: '#e03131',
  feedback: '#12b886',
  other: '#868e96',
};

const TYPE_DESCRIPTIONS: Record<RequestType, string> = {
  help: 'Need help using the app, or have an account problem',
  feature: 'Request a feature to be added to the app or updated',
  bug: 'Report something that isn\u2019t working as expected',
  feedback: 'General feedback or suggestions about the app',
  other: 'Anything else you\u2019d like the admin to know',
};

export function RequestModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [type, setType] = useState<RequestType | null>('help');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState('');

  useEffect(() => {
    if (opened) {
      api.meta().then(m => setContactEmail(m.adminContactEmail)).catch(() => {});
    }
  }, [opened]);

  const reset = () => {
    setType('help');
    setSubject('');
    setMessage('');
    setUrgent(false);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setError(null);
    if (!subject.trim()) {
      setError('A subject is required.');
      return;
    }
    if (!message.trim()) {
      setError('Please add some details to your request.');
      return;
    }
    setBusy(true);
    try {
      await api.requests.submit({
        type: type ?? 'help',
        subject: subject.trim(),
        message: message.trim() || undefined,
        urgent,
      });
      notifications.show({ title: 'Request sent', message: 'The admin has been notified.', color: 'green' });
      close();
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened={opened} onClose={close} title="Submit a request" size="md" centered>
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">{error}</Alert>
        )}
        <div>
          <Text size="sm" fw={500} mb={4}>Type</Text>
          <SegmentedControl
            value={type ?? 'help'}
            onChange={v => setType(v as RequestType)}
            data={REQUEST_TYPE_OPTIONS}
            fullWidth
            styles={{
              root: { gap: 2 },
              label: { fontWeight: 600, fontSize: 12, padding: '2px 8px' },
              indicator: { backgroundColor: TYPE_COLORS[type ?? 'help'] },
            }}
          />
          <Text size="xs" c="dimmed" mt={6}>
            {TYPE_DESCRIPTIONS[type ?? 'help']}
          </Text>
        </div>
        <TextInput
          label="Subject"
          placeholder="What's this about?"
          value={subject}
          onChange={e => setSubject(e.currentTarget.value)}
          maxLength={200}
          data-autofocus
        />
        <Textarea
          label="Details"
          placeholder="Give as much detail as you can…"
          value={message}
          onChange={e => setMessage(e.currentTarget.value)}
          minRows={4}
          maxLength={5000}
        />
        <Checkbox
          label="This is urgent"
          checked={urgent}
          onChange={e => setUrgent(e.currentTarget.checked)}
        />
        {urgent && (
          <Alert icon={<IconMail size={16} />} color="red" variant="light" title="Urgent requests">
            Urgent requests such as account security issues should be emailed to{' '}
            {contactEmail ? <b>{contactEmail}</b> : 'the system administrator'}.
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>Cancel</Button>
          <Button onClick={submit} loading={busy} leftSection={<IconMessageCircle size={16} />}>
            Submit request
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
