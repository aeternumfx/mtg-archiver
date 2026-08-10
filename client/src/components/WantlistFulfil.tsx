import { useState } from 'react';
import { Box, Text, Group, Button, Modal, Select, ScrollArea, Badge, ActionIcon, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconExternalLink, IconArchive, IconPlus, IconBolt, IconCalendarClock } from '@tabler/icons-react';
import { api, authFetch } from '../api/client';
import type { Location } from '../types';
import { SetSymbol, GhostThumb } from './CardDisplay';
export interface WantlistFulfilItem {
  id: number;
  cardId: string | null;
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
  destinationId: number | null;
}

interface InternalCopy {
  id: number; locationId: number; condition: string | null; foil: number; quantity: number;
  setName: string; setCode: string; collectorNumber: string;
}

export function WantlistFulfilActions({ item, locations, hasInternal, onDone, currentLocationId }: {
  item: WantlistFulfilItem;
  locations: Location[];
  hasInternal: boolean;
  onDone: () => void;
  currentLocationId?: number | null;
}) {
  const [externalOpened, { open: openExternal, close: closeExternal }] = useDisclosure(false);
  const [internalOpened, { open: openInternal, close: closeInternal }] = useDisclosure(false);
  const [fulfilLoc, setFulfilLoc] = useState<string | null>(null);
  const [internalCopies, setInternalCopies] = useState<InternalCopy[]>([]);
  const [internalLoading, setInternalLoading] = useState(false);
  const [fulfilling, setFulfilling] = useState(false);

  const hereId = currentLocationId != null ? currentLocationId : (item.destinationId ?? null);
  const hereName = locations.find(l => l.id === hereId)?.name || 'this location';

  const openFulfilExternal = () => {
    const inbox = locations.find(l => l.builtIn || l.name === 'Inbox');
    setFulfilLoc(hereId != null
      ? String(hereId)
      : (locations.length > 0 ? String(inbox?.id ?? locations[0].id) : null));
    openExternal();
  };

  const handleFulfilExternal = async () => {
    if (!fulfilLoc) return;
    setFulfilling(true);
    try {
      let cardId = item.cardId;
      if (!cardId) {
        const res = await api.cards.grouped(item.cardName, 1);
        cardId = res.data[0]?.id ?? null;
      }
      if (!cardId) {
        notifications.show({ title: 'Error', message: `Could not resolve "${item.cardName}" to a card`, color: 'red' });
        return;
      }
      const scheduled = currentLocationId != null
        ? (Number(fulfilLoc) === currentLocationId ? null : currentLocationId)
        : (item.destinationId ?? undefined);
      await api.wantlist.fulfil(item.id, 1).catch(() => ({ removed: true, goal: null }));
      await api.collection.add({
        cardId,
        locationId: Number(fulfilLoc),
        quantity: 1,
        forceNew: true,
        destinationId: scheduled ?? undefined,
      });
      const msg = currentLocationId != null && Number(fulfilLoc) !== currentLocationId
        ? `${item.cardName} added elsewhere, scheduled to move to ${hereName}`
        : `${item.cardName} added${item.destinationId && !currentLocationId ? ' and move scheduled' : ''}`;
      notifications.show({ title: 'Fulfilled', message: msg, color: 'green' });
      closeExternal(); onDone();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setFulfilling(false);
    }
  };

  const openFulfilInternal = async () => {
    setInternalCopies([]);
    openInternal();
    setInternalLoading(true);
    try {
      const res = await authFetch(`/api/collection/grouped?q=${encodeURIComponent(item.cardName)}`);
      const data = await res.json();
      const items = (data.groups || []).flatMap((g: any) => g.items || []);
      setInternalCopies(items
        .filter((i: any) => i.card && i.card.name.toLowerCase() === item.cardName.toLowerCase())
        .filter((i: any) => !item.setCode || (i.card.setCode || '').toLowerCase() === item.setCode.toLowerCase())
        .filter((i: any) => !item.collectorNumber || i.card.collectorNumber === item.collectorNumber)
        .map((i: any) => ({
          id: i.id, locationId: i.locationId, condition: i.condition, foil: i.foil, quantity: i.quantity,
          setName: i.card.setName, setCode: i.card.setCode, collectorNumber: i.card.collectorNumber,
        })));
    } catch { setInternalCopies([]); }
    setInternalLoading(false);
  };

  const handleFulfilInternal = async (copy: InternalCopy, mode: 'now' | 'schedule') => {
    setFulfilling(true);
    try {
      if (currentLocationId != null) {
        if (mode === 'now') {
          if (copy.locationId !== currentLocationId) {
            await api.collection.move([{ id: copy.id, quantity: 1 }], currentLocationId);
          }
        } else {
          await api.collection.splitCopy(copy.id, currentLocationId);
        }
      } else if (item.destinationId) {
        await api.collection.splitCopy(copy.id, item.destinationId);
      }
      await api.wantlist.fulfil(item.id, 1).catch(() => {});
      const msg = currentLocationId != null
        ? (mode === 'now' ? `Filled here in ${hereName}` : `Scheduled to move to ${hereName}`)
        : (item.destinationId ? 'Move scheduled to fulfil this want' : 'Wantlist entry fulfilled');
      notifications.show({ title: 'Fulfilled', message: msg, color: 'green' });
      closeInternal(); onDone();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setFulfilling(false);
    }
  };

  return (
    <>
      <Tooltip label="Fulfil externally — add a new card">
        <ActionIcon variant="subtle" color="green" size="sm" onClick={openFulfilExternal}><IconExternalLink size={14} /></ActionIcon>
      </Tooltip>
      <Tooltip label={hasInternal ? 'Fulfil from collection — use an existing copy' : 'No matching copies in your collection'}>
        <ActionIcon variant="subtle" color={hasInternal ? 'blue' : 'gray'} size="sm" disabled={!hasInternal} onClick={openFulfilInternal}><IconArchive size={14} /></ActionIcon>
      </Tooltip>

      <Modal opened={externalOpened} onClose={closeExternal} title={`Fulfil Externally — ${item.cardName}`} size="sm" centered>
        <Group gap="md" mb="md" wrap="nowrap" align="flex-start">
          <Box w={100}><GhostThumb name={item.cardName} cardId={item.cardId} /></Box>
          <div style={{ flex: 1 }}>
            <Text fw={600} size="sm">{item.cardName}</Text>
            {item.setCode && <Text size="xs" c="dimmed">{item.setCode.toUpperCase()} #{item.collectorNumber}</Text>}
            {currentLocationId != null ? (
              <Text size="xs" c="dimmed">Filling into <b>{hereName}</b></Text>
            ) : (
              item.destinationId && (
                <Text size="xs" c="dimmed">→ {locations.find(l => l.id === item.destinationId)?.name || `#${item.destinationId}`}</Text>
              )
            )}
          </div>
        </Group>
        <Select label="Add card to location" data={locations.map(l => ({ value: String(l.id), label: l.name }))}
          value={fulfilLoc} onChange={setFulfilLoc} mb="xs" searchable />
        {currentLocationId != null && fulfilLoc !== String(currentLocationId) && (
          <Text size="xs" c="dimmed" mb="sm">Card will be scheduled to move to <b>{hereName}</b>.</Text>
        )}
        <Button onClick={handleFulfilExternal} fullWidth loading={fulfilling} leftSection={<IconPlus size={16} />}>
          Add & Fulfil
        </Button>
      </Modal>

      <Modal opened={internalOpened} onClose={closeInternal} title={`Fulfil from Collection — ${item.cardName}`} size="md" centered>
        {currentLocationId != null && <Text size="xs" c="dimmed" mb="sm">Filling into <b>{hereName}</b>. Pick a copy below.</Text>}
        {internalLoading ? (
          <Text c="dimmed" ta="center" py="xl">Loading collection copies...</Text>
        ) : internalCopies.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">No matching copies of this card found in your collection.</Text>
        ) : (
          <ScrollArea h={320}>
            {internalCopies.map(c => (
              <Group key={c.id} p="xs" gap="sm" wrap="nowrap">
                <Box w={24} h={34}><GhostThumb name={item.cardName} /></Box>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={4}>
                    <SetSymbol code={c.setCode} name={c.setName} size={12} />
                    <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                    {c.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge> : null}
                  </Group>
                  <Group gap={6} mt={2}>
                    <Badge size="xs" variant="outline" color="gray">{c.condition || '-'}</Badge>
                    <Badge size="xs" variant="light">{c.quantity}x</Badge>
                    <Text size="xs" c="dimmed">@ {locations.find(l => l.id === c.locationId)?.name || `#${c.locationId}`}</Text>
                  </Group>
                </div>
                {currentLocationId != null ? (
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="light" color="blue" loading={fulfilling} leftSection={<IconBolt size={12} />}
                      onClick={() => handleFulfilInternal(c, 'now')}>
                      Move now
                    </Button>
                    <Button size="compact-xs" variant="light" color="teal" loading={fulfilling} leftSection={<IconCalendarClock size={12} />}
                      onClick={() => handleFulfilInternal(c, 'schedule')}>
                      Schedule
                    </Button>
                  </Group>
                ) : (
                  <Button size="compact-xs" variant="light" color="blue" loading={fulfilling} onClick={() => handleFulfilInternal(c, 'now')}>
                    Use this copy
                  </Button>
                )}
              </Group>
            ))}
          </ScrollArea>
        )}
      </Modal>
    </>
  );
}
