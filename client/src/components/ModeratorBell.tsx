import { useState, useEffect, useCallback } from 'react';
import { ActionIcon, Badge, Tooltip, Stack, Group, Text, Paper } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { api } from '../api/client';

const TYPE_LABELS: Array<{ key: string; label: string; color: string }> = [
  { key: 'help', label: 'Help', color: 'blue' },
  { key: 'feature', label: 'Feature', color: 'grape' },
  { key: 'bug', label: 'Bug', color: 'red' },
  { key: 'feedback', label: 'Feedback', color: 'teal' },
  { key: 'other', label: 'Other', color: 'gray' },
];

export default function ModeratorBell() {
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0 });

  const load = useCallback(async () => {
    try {
      setCounts(await api.moderator.summary());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const total = counts.all ?? 0;

  const tooltipContent = (
    <Paper p="xs" radius="md" style={{ background: 'var(--mantine-color-dark-7)', color: '#fff' }}>
      <Stack gap={4}>
        <Text size="xs" fw={700}>Pending requests</Text>
        {TYPE_LABELS.map(t => (
          <Group key={t.key} gap={8} justify="space-between" wrap="nowrap">
            <Badge size="xs" variant="light" color={t.color}>{t.label}</Badge>
            <Text size="sm" fw={700}>{counts[t.key] ?? 0}</Text>
          </Group>
        ))}
      </Stack>
    </Paper>
  );

  return (
    <Tooltip label={tooltipContent} withArrow multiline w={180} openDelay={200} transitionProps={{ transition: 'pop', duration: 150 }}>
      <ActionIcon variant="subtle" size="sm" style={{ position: 'relative' }}>
        <IconBell size={18} />
        {total > 0 && (
          <Badge size="xs" variant="filled" color="red" radius="xl" px={4}
            style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, fontSize: 9, lineHeight: '14px' }}>
            {total > 99 ? '99+' : total}
          </Badge>
        )}
      </ActionIcon>
    </Tooltip>
  );
}
