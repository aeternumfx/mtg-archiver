import type { ReactNode, CSSProperties } from 'react';
import { Group, Text, Paper, Box, Collapse } from '@mantine/core';
import { IconChevronRight, IconChevronDown } from '@tabler/icons-react';
import { CardThumb, Tags, ManaCost } from './CardDisplay';
import type { CardImageData, CardTagData } from './CardDisplay';

interface CardGroupProps {
  card: CardImageData & CardTagData;
  thumb?: ReactNode;
  name: ReactNode;
  manaCost: string | null;
  typeLine: string | null;
  isSingle: boolean;
  expanded: boolean;
  onToggle: () => void;
  rightSection?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}

export function CardGroup({ card, thumb, name, manaCost, typeLine, isSingle, expanded, onToggle, rightSection, style, children }: CardGroupProps) {
  if (isSingle) {
    return (
      <Paper withBorder mb={0} radius={0} style={{ overflow: 'hidden', ...style }}>
        {children}
      </Paper>
    );
  }

  return (
    <Paper withBorder mb={0} radius={0} style={{ overflow: 'hidden', ...style }}
      bg={expanded ? 'var(--mantine-color-default)' : undefined}
    >
      <Box
        p="sm"
        onClick={onToggle}
        style={{ cursor: 'pointer', userSelect: 'none' }}
        bg="var(--mantine-color-default-hover)"
      >
        <Group justify="space-between">
          <Group gap="sm">
            {expanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            {thumb ?? <CardThumb card={card} />}
            <div>
              <Group gap={4}>
                <Text fw={500} size="sm">{name}</Text>
                <Tags card={card} />
              </Group>
              <Group gap={6}>
                <ManaCost manaCost={manaCost} />
                <Text size="xs" c="dimmed">{typeLine}</Text>
              </Group>
            </div>
          </Group>
          {rightSection}
        </Group>
      </Box>
      <Collapse in={expanded} transitionDuration={0}>
        {children}
      </Collapse>
    </Paper>
  );
}
