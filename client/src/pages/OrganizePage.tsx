import { useState, useEffect } from 'react';
import {
  Title, Group, Text, Paper, Badge, Button, ActionIcon, Box, Checkbox, LoadingOverlay,
  Modal, Select, ScrollArea,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconArrowRight, IconCheck, IconPlus, IconArrowsSort, IconHistory, IconX } from '@tabler/icons-react';
import { api } from '../api/client';
import type { Location, ScryfallCard } from '../types';
import { CardThumb, SetSymbol, GhostThumb } from '../components/CardDisplay';
import { CardGroup } from '../components/CardGroup';
import { useUndo } from '../components/UndoToasts';

interface PendingItem {
  id: number; cardId: string; locationId: number; destinationId: number; quantity: number;
  card: { id: string; name: string; setName: string; setCode: string; collectorNumber: string; imageUris: Record<string, string> | null; prices: Record<string, string | null> | null; };
  sourceLoc: { id: number; name: string }; destLoc: { id: number; name: string };
}

interface CollectionCard {
  id: number; cardId: string; quantity: number; destinationId: number | null;
  card: { name: string; setName: string; setCode: string; collectorNumber: string; imageUris: Record<string, string> | null; };
}

interface MovementEntry {
  id: number; itemId: number | null; cardId: string | null; cardName: string | null;
  action: string; fromLocationId: number | null; toLocationId: number | null;
  quantity: number; details: string | null; undone: number; createdAt: string;
}

export default function OrganizePage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [locations, setLocations] = useState<Location[]>([]);
  const [scheduleOpened, { open: openSchedule, close: closeSchedule }] = useDisclosure(false);
  const [moveOpened, { open: openMove, close: closeMove }] = useDisclosure(false);
  const [srcLoc, setSrcLoc] = useState<string | null>(null);
  const [destLoc, setDestLoc] = useState<string | null>(null);
  const [locCards, setLocCards] = useState<CollectionCard[]>([]);
  const [locCardsLoading, setLocCardsLoading] = useState(false);
  const [selCardIds, setSelCardIds] = useState<Set<number>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [movementHistory, setMovementHistory] = useState<MovementEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histCards, setHistCards] = useState<Record<string, ScryfallCard>>({});
  const [resolveAllOpened, setResolveAllOpened] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ type: 'schedule' | 'move'; count: number } | null>(null);
  const [pendingExpanded, setPendingExpanded] = useState<Set<string>>(new Set());
  const [cancelConfirmId, setCancelConfirmId] = useState<number | null>(null);
  const { push: pushUndo } = useUndo();

  const loadPending = async () => {
    setLoading(true);
    try {
      const [data, locs] = await Promise.all([api.organize.pending(), api.locations.list()]);
      setItems(data); setLocations(locs);
    } catch {} finally { setLoading(false); }
  };

  const loadHistory = async () => {
    setHistLoading(true);
    try {
      const data = await api.organize.history();
      setMovementHistory(data);
      const ids = [...new Set(data.map(e => e.cardId).filter(Boolean) as string[])];
      const found: Record<string, ScryfallCard> = {};
      await Promise.all(ids.map(id => api.cards.get(id).then(c => { found[id] = c; }).catch(() => {})));
      setHistCards(found);
    } catch {} finally { setHistLoading(false); }
  };

  useEffect(() => { loadPending(); }, []);

  useEffect(() => {
    if (!srcLoc) { setLocCards([]); return; }
    setLocCardsLoading(true);
    fetch(`/api/collection/grouped?location_id=${srcLoc}&pageSize=100`)
      .then(r => r.json())
      .then(data => {
        const cards: CollectionCard[] = (data.groups || []).flatMap((g: any) =>
          (g.items || []).map((i: any) => ({ id: i.id, cardId: i.cardId, quantity: i.quantity, destinationId: i.destinationId, card: { name: i.card.name, setName: i.card.setName, setCode: i.card.setCode, collectorNumber: i.card.collectorNumber, imageUris: i.card.imageUris } })));
        setLocCards(cards);
      }).catch(() => setLocCards([])).finally(() => setLocCardsLoading(false));
  }, [srcLoc]);

  const toggleSelect = (id: number) => setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const handleResolveAll = async () => {
    try {
      const res = await api.organize.resolve({ all: true });
      if (res.undo) {
        const history = res.undo;
        pushUndo(`${history.length} movement(s) resolved`, async () => {
          await api.organize.undoResolve({ history }).catch(() => {});
          loadPending();
        }, 'Undo resolve');
      }
      notifications.show({ title: 'Resolved', message: 'All movements resolved', color: 'green' });
      loadPending();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
  };

  const handleResolveSelected = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      const res = await api.organize.resolve({ itemIds: ids });
      if (res.undo) {
        const history = res.undo;
        pushUndo(`${ids.length} movement(s) resolved`, async () => {
          await api.organize.undoResolve({ history }).catch(() => {});
          loadPending();
        }, 'Undo resolve');
      }
      notifications.show({ title: 'Resolved', message: `${ids.length} movement(s) resolved`, color: 'green' });
      setSelectedIds(new Set()); loadPending();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
  };

  const handleResolveSingle = async (id: number) => {
    try {
      const res = await api.organize.resolve({ itemIds: [id] });
      if (res.undo) {
        const history = res.undo;
        pushUndo('Movement resolved', async () => {
          await api.organize.undoResolve({ history }).catch(() => {});
          loadPending();
        }, 'Undo resolve');
      }
      loadPending();
    } catch {}
  };

  const handleCancelMove = async () => {
    if (cancelConfirmId === null) return;
    const item = items.find(i => i.id === cancelConfirmId);
    try {
      await api.collection.update(cancelConfirmId, { destinationId: null } as any);
      setCancelConfirmId(null);
      if (item) {
        const name = item.card.name;
        pushUndo(`Scheduled move for ${name} cancelled`, async () => {
          await api.collection.update(cancelConfirmId, { destinationId: item.destinationId } as any).catch(() => {});
          loadPending();
        }, 'Undo cancel');
      }
      loadPending();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openScheduleModal = () => { setSrcLoc(null); setDestLoc(null); setLocCards([]); setSelCardIds(new Set()); openSchedule(); };
  const openMoveModal = () => { setSrcLoc(null); setDestLoc(null); setLocCards([]); setSelCardIds(new Set()); openMove(); };

  const handleSchedule = async () => {
    if (!destLoc || selCardIds.size === 0) return;
    const pendingCount = locCards.filter(c => selCardIds.has(c.id) && c.destinationId).length;
    if (pendingCount > 0) {
      setPendingConfirm({ type: 'schedule', count: pendingCount });
      return;
    }
    await doSchedule();
  };

  const doSchedule = async () => {
    if (!destLoc || selCardIds.size === 0) return;
    try {
      for (const id of selCardIds) { await api.collection.splitCopy(id, Number(destLoc)); }
      notifications.show({ title: 'Scheduled', message: `${selCardIds.size} card(s) scheduled`, color: 'green' });
      closeSchedule(); loadPending();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
  };

  const handleMove = async () => {
    if (!destLoc || selCardIds.size === 0) return;
    const pendingCount = locCards.filter(c => selCardIds.has(c.id) && c.destinationId).length;
    if (pendingCount > 0) {
      setPendingConfirm({ type: 'move', count: pendingCount });
      return;
    }
    await doMove();
  };

  const doMove = async () => {
    if (!destLoc || selCardIds.size === 0) return;
    const prevState: Array<{ id: number; locId: number; historyId: number | null }> = [];
    try {
      for (const id of selCardIds) {
        const split = await api.collection.splitCopy(id, null);
        const moved = await api.collection.update(split.id, { locationId: Number(destLoc) } as any);
        prevState.push({ id: split.id, locId: Number(srcLoc), historyId: (moved as any).movedHistoryId ?? null });
      }
      pushUndo(`${selCardIds.size} card(s) moved`, async () => {
        for (const m of prevState) {
          await api.collection.update(m.id, { locationId: m.locId } as any).catch(() => {});
        }
        if (prevState.some(m => m.historyId != null)) {
          await api.organize.markHistoryUndone(prevState.map(m => m.historyId).filter((h): h is number => h != null)).catch(() => {});
        }
        loadPending();
      }, 'Undo move');
      notifications.show({ title: 'Moved', message: `${selCardIds.size} card(s) moved`, color: 'green' });
      closeMove(); loadPending();
    } catch (err: any) { notifications.show({ title: 'Error', message: err.message, color: 'red' }); }
  };

  const toggleCardSelect = (id: number) => setSelCardIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const toggleHistory = () => {
    if (!showHistory) loadHistory();
    setShowHistory(!showHistory);
  };

  const actionColors: Record<string, string> = { added: 'green', moved: 'blue', traded: 'violet', booster: 'orange', resolved: 'teal' };
  const locationNames = new Map(locations.map(l => [l.id, l.name]));

  return (
    <>
      <Group mb="md" justify="space-between">
        <Title order={2}>Organize</Title>
        <Group>
          <Button variant="light" leftSection={<IconHistory size={16} />} onClick={toggleHistory}>
            {showHistory ? 'Pending' : 'History'}
          </Button>
          <Button leftSection={<IconPlus size={16} />} variant="light" onClick={openScheduleModal}>Schedule</Button>
          <Button leftSection={<IconArrowsSort size={16} />} variant="light" onClick={openMoveModal}>Move</Button>
          {selectedIds.size > 0 && <Button leftSection={<IconCheck size={16} />} onClick={handleResolveSelected}>Resolve ({selectedIds.size})</Button>}
          {items.length > 0 && <Button variant="light" color="red" onClick={() => setResolveAllOpened(true)}>Resolve All</Button>}
        </Group>
      </Group>

      {showHistory ? (
        <Box pos="relative">
          <LoadingOverlay visible={histLoading} />
          {movementHistory.length === 0 && !histLoading && <Text c="dimmed" ta="center" py="xl">No movement history yet</Text>}
          <Paper withBorder mb={0} radius={0} style={{ overflow: 'hidden' }}>
            <Group p="sm" gap="sm" wrap="nowrap" bg="var(--mantine-color-default-hover)">
              <Text size="xs" fw={600} style={{ flex: 1 }}>Action</Text>
              <Text size="xs" fw={600} w={80}>Qty</Text>
              <Text size="xs" fw={600} w={80}>From</Text>
              <Box w={16} />
              <Text size="xs" fw={600} w={80}>To</Text>
              <Text size="xs" fw={600} w={120}>Date</Text>
            </Group>
          </Paper>
          {movementHistory.map(entry => {
            const undone = !!entry.undone;
            return (
            <Paper key={entry.id} withBorder mb={0} radius={0} opacity={undone ? 0.55 : 1}>
              <Group p="sm" gap="sm" wrap="nowrap">
                <Box w={32} h={45} style={{ borderRadius: 4, overflow: 'hidden', flexShrink: 0, filter: undone ? 'grayscale(0.8)' : undefined }}>
                  {entry.cardId ? (
                    histCards[entry.cardId] ? (
                      <CardThumb card={histCards[entry.cardId]} />
                    ) : (
                      <Box w={32} h={45} style={{ background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Text size="xs" c="dimmed">…</Text>
                      </Box>
                    )
                  ) : (
                    <GhostThumb name={entry.cardName} />
                  )}
                </Box>
                <div style={{ flex: 1 }}>
                  <Text size="sm" style={{ textDecoration: undone ? 'line-through' : undefined }}>{entry.cardName || `Item #${entry.itemId}`}</Text>
                  <Group gap={4}>
                    <Badge size="xs" color={actionColors[entry.action] || 'gray'} variant="light">{entry.action}</Badge>
                    {undone && <Badge size="xs" color="red" variant="light">Undone</Badge>}
                  </Group>
                </div>
                <Badge size="xs" variant="light" color="blue" w={80}>{entry.fromLocationId ? locationNames.get(entry.fromLocationId) || `#${entry.fromLocationId}` : '-'}</Badge>
                <IconArrowRight size={14} opacity={0.4} />
                <Badge size="xs" variant="light" color="green" w={80}>{entry.toLocationId ? locationNames.get(entry.toLocationId) || `#${entry.toLocationId}` : '-'}</Badge>
                <Text size="xs" c="dimmed" w={120}>{entry.createdAt?.slice(0, 10)}</Text>
              </Group>
            </Paper>
            );
          })}
        </Box>
      ) : (
        <Box pos="relative">
          <LoadingOverlay visible={loading} />
          {items.length === 0 && !loading && <Text c="dimmed" ta="center" py="xl">No pending movements.</Text>}
          {items.length > 0 && (() => {
            const grouped: Record<string, PendingItem[]> = {};
            for (const item of items) {
              if (!grouped[item.card.name]) grouped[item.card.name] = [];
              grouped[item.card.name].push(item);
            }
            const toggleGroup = (name: string) => setPendingExpanded(prev => {
              const n = new Set(prev);
              if (n.has(name)) n.delete(name); else n.add(name);
              return n;
            });

            return Object.entries(grouped).map(([name, groupItems]) => {
              const rep = groupItems[0];
              const isExpanded = pendingExpanded.has(name);
              const renderRow = (item: PendingItem, idx: number) => (
                <Group key={item.id} p="sm" gap="sm" wrap="nowrap"
                  bg={selectedIds.has(item.id) ? 'var(--mantine-color-blue-0)' : idx % 2 === 1 ? 'var(--mantine-color-default-hover)' : undefined}>
                  <Checkbox size="xs" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} />
                  <Box w={24} h={34}><CardThumb card={item.card} /></Box>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500}>{item.card.name}</Text>
                    <Group gap={4}>
                      <SetSymbol code={item.card.setCode} name={item.card.setName} size={12} />
                      <Text size="xs" c="dimmed">#{item.card.collectorNumber}</Text>
                    </Group>
                  </div>
                  <Badge size="sm" variant="light" color="blue" w={120}>{item.sourceLoc.name}</Badge>
                  <IconArrowRight size={16} opacity={0.4} />
                  <Badge size="sm" variant="light" color="green" w={120}>{item.destLoc.name}</Badge>
                  <ActionIcon variant="subtle" color="red" size="sm" onClick={() => setCancelConfirmId(item.id)}><IconX size={16} /></ActionIcon>
                  <ActionIcon variant="subtle" color="green" size="sm" onClick={() => handleResolveSingle(item.id)}><IconCheck size={16} /></ActionIcon>
                </Group>
              );

              return (
                <CardGroup key={name} card={rep.card} name={name} manaCost={null} typeLine={null}
                  isSingle={groupItems.length === 1} expanded={isExpanded} onToggle={() => toggleGroup(name)}
                  rightSection={<Badge size="sm" variant="light">{groupItems.length} {groupItems.length !== 1 ? 'moves' : 'move'}</Badge>}
                >
                  <Box>
                    {groupItems.map((item, idx) => renderRow(item, idx))}
                  </Box>
                </CardGroup>
              );
            });
          })()}
        </Box>
      )}

      <Modal opened={scheduleOpened} onClose={closeSchedule} title="Schedule Movement" size="lg" centered>
        <Select label="From Location" placeholder="Select source" data={locations.map(l => ({ value: String(l.id), label: l.name }))}
          value={srcLoc} onChange={v => { setSrcLoc(v); setSelCardIds(new Set()); }} mb="sm" searchable />
        {srcLoc && (
          <>
            <Text size="xs" fw={600} mb="xs">Cards in this location:</Text>
            {locCardsLoading ? <Text size="xs" c="dimmed" py="md" ta="center">Loading...</Text>
            : locCards.length === 0 ? <Text size="xs" c="dimmed" py="md" ta="center">No cards</Text>
            : <ScrollArea h={250} mb="sm">
                {locCards.map(c => (
                  <Group key={c.id} p="xs" gap="sm" wrap="nowrap" style={{ borderRadius: 4, cursor: 'pointer' }}
                    bg={selCardIds.has(c.id) ? 'var(--mantine-color-blue-0)' : undefined} onClick={() => toggleCardSelect(c.id)}>
                    <Checkbox size="xs" checked={selCardIds.has(c.id)} readOnly />
                    <Box w={24} h={34}><CardThumb card={c.card} /></Box>
                    <div style={{ flex: 1 }}>
                      <Text size="sm" fw={500}>{c.card.name}</Text>
                      <Group gap={4}>
                        <SetSymbol code={c.card.setCode} name={c.card.setName} size={12} />
                        <Text size="xs" c="dimmed">#{c.card.collectorNumber}</Text>
                        {c.destinationId && (
                          <Badge size="xs" variant="light" color="orange">
                            Pending → {locations.find(l => l.id === c.destinationId)?.name || '?'}
                          </Badge>
                        )}
                      </Group>
                    </div>
                  </Group>
                ))}
              </ScrollArea>
            }
            <Select label="To Location" placeholder="Select destination" data={locations.filter(l => l.id !== Number(srcLoc)).map(l => ({ value: String(l.id), label: l.name }))}
              value={destLoc} onChange={setDestLoc} mb="md" searchable />
            <Button fullWidth onClick={handleSchedule} disabled={selCardIds.size === 0 || !destLoc}>Schedule {selCardIds.size} card(s)</Button>
          </>
        )}
      </Modal>

      <Modal opened={moveOpened} onClose={closeMove} title="Move Card" size="lg" centered>
        <Select label="From Location" placeholder="Select source" data={locations.map(l => ({ value: String(l.id), label: l.name }))}
          value={srcLoc} onChange={v => { setSrcLoc(v); setSelCardIds(new Set()); }} mb="sm" searchable />
        {srcLoc && (
          <>
            <Text size="xs" fw={600} mb="xs">Cards in this location:</Text>
            {locCardsLoading ? <Text size="xs" c="dimmed" py="md" ta="center">Loading...</Text>
            : locCards.length === 0 ? <Text size="xs" c="dimmed" py="md" ta="center">No cards</Text>
            : <ScrollArea h={250} mb="sm">
                {locCards.map(c => (
                  <Group key={c.id} p="xs" gap="sm" wrap="nowrap" style={{ borderRadius: 4, cursor: 'pointer' }}
                    bg={selCardIds.has(c.id) ? 'var(--mantine-color-blue-0)' : undefined} onClick={() => toggleCardSelect(c.id)}>
                    <Checkbox size="xs" checked={selCardIds.has(c.id)} readOnly />
                    <Box w={24} h={34}><CardThumb card={c.card} /></Box>
                    <div style={{ flex: 1 }}>
                      <Text size="sm" fw={500}>{c.card.name}</Text>
                      <Group gap={4}>
                        <SetSymbol code={c.card.setCode} name={c.card.setName} size={12} />
                        <Text size="xs" c="dimmed">#{c.card.collectorNumber}</Text>
                        {c.destinationId && (
                          <Badge size="xs" variant="light" color="orange">
                            Pending → {locations.find(l => l.id === c.destinationId)?.name || '?'}
                          </Badge>
                        )}
                      </Group>
                    </div>
                  </Group>
                ))}
              </ScrollArea>
            }
            <Select label="To Location" placeholder="Select destination" data={locations.filter(l => l.id !== Number(srcLoc)).map(l => ({ value: String(l.id), label: l.name }))}
              value={destLoc} onChange={setDestLoc} mb="md" searchable />
            <Button fullWidth onClick={handleMove} disabled={selCardIds.size === 0 || !destLoc}>Move {selCardIds.size} card(s)</Button>
          </>
        )}
      </Modal>

      <Modal opened={resolveAllOpened} onClose={() => setResolveAllOpened(false)} title="Resolve All Movements" size="sm" centered>
        <Text mb="md">Resolve all <b>{items.length}</b> pending movement(s)? This will move the cards to their destination locations.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setResolveAllOpened(false)}>Cancel</Button>
          <Button color="red" onClick={() => { setResolveAllOpened(false); handleResolveAll(); }}>Resolve All</Button>
        </Group>
      </Modal>

      <Modal opened={pendingConfirm !== null} onClose={() => setPendingConfirm(null)} size="sm" centered
        title={pendingConfirm?.type === 'move' ? 'Cancel Pending Move' : 'Pending Move Exists'}>
        <Text mb="md">
          {pendingConfirm?.type === 'move'
            ? `${pendingConfirm?.count} selected card(s) already have a pending scheduled move. Moving them now will cancel the pending schedule for the moved copies.`
            : `${pendingConfirm?.count} selected card(s) already have a pending scheduled move. Schedule another copy anyway?`}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setPendingConfirm(null)}>Cancel</Button>
          <Button color="orange" onClick={() => {
            const t = pendingConfirm?.type;
            setPendingConfirm(null);
            if (t === 'move') doMove(); else doSchedule();
          }}>Confirm</Button>
        </Group>
      </Modal>

      <Modal opened={cancelConfirmId !== null} onClose={() => setCancelConfirmId(null)} title="Cancel Scheduled Move" size="sm" centered>
        <Text mb="md">Cancel this scheduled move? The card will stay in its current location.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setCancelConfirmId(null)}>Keep Move</Button>
          <Button color="red" onClick={handleCancelMove}>Cancel Move</Button>
        </Group>
      </Modal>
    </>
  );
}
