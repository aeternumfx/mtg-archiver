import { useState, useEffect } from 'react';
import {
  Title, Group, Text, Paper, Badge, Button, TextInput, Textarea,
  Modal, ActionIcon, LoadingOverlay, Box, Switch, SegmentedControl, Collapse, Select, Tooltip, Pagination,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash, IconSearch, IconChevronRight, IconChevronDown } from '@tabler/icons-react';
import { api } from '../api/client';
import { CONDITIONS } from '../types';
import type { ScryfallCard, GroupedCard, Condition, Location } from '../types';
import { CardThumb, SetSymbol, GhostThumb } from '../components/CardDisplay';
import { CardGroup } from '../components/CardGroup';
import { useUndo } from '../components/UndoToasts';
import { WantlistFulfilActions } from '../components/WantlistFulfil';

const CONDITION_COLORS: Record<string, string> = {
  M: '#2e7d32', NM: '#00897b', LP: '#1565c0',
  MP: '#f9a825', HP: '#e65100', Dmg: '#c62828',
};

interface WantlistItem {
  id: number; cardId: string | null; cardName: string;
  setCode: string | null; collectorNumber: string | null;
  foil: number; condition: string | null;
  quantity: number; notes: string | null; destinationId: number | null; collectionGoalId: number | null; persistent: number; createdAt: string;
}

interface Goal {
  id: number; locationId: number; locationName: string; kind: string; cardName: string | null;
  targetCount: number | null; fulfilledCount: number; status: string; remaining: number;
}

export default function WantlistPage() {
  const [items, setItems] = useState<WantlistItem[]>([]);
  const [cardData, setCardData] = useState<Record<string, ScryfallCard>>({});
  const [loading, setLoading] = useState(false);
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<GroupedCard[]>([]);
  const [printings, setPrintings] = useState<Record<string, ScryfallCard[]>>({});
  const [loadingPrintings, setLoadingPrintings] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(null);
  const [formOpened, { open: openForm, close: closeForm }] = useDisclosure(false);
  const [foil, setFoil] = useState(false);
  const [condition, setCondition] = useState<Condition | ''>('NM');
  const [notes, setNotes] = useState('');
  const [wantExpanded, setWantExpanded] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [collectionNames, setCollectionNames] = useState<Set<string>>(new Set());

  const loadItems = async (targetPage?: number) => {
    setLoading(true);
    try {
      const p = targetPage ?? page;
      const [data, g, names] = await Promise.all([
        api.wantlist.paged(p, 50),
        api.collectionGoals.list().catch(() => []),
        api.collection.names().catch(() => []),
      ]);
      setItems(data.data);
      setTotalPages(data.totalPages);
      setGoals(g);
      setCollectionNames(new Set(names));
      for (const item of data.data) {
        if (item.cardId && !cardData[item.cardId]) {
          api.cards.get(item.cardId).then(c => {
            setCardData(prev => ({ ...prev, [item.cardId!]: c }));
          }).catch(() => {});
        }
      }
    } catch {
      notifications.show({ title: 'Error', message: 'Failed to load wantlist', color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadItems(); }, []);

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); setPrintings({}); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await api.cards.grouped(search, 1);
        setResults(res.data);
        setPrintings({});
        setExpanded(new Set());
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const loadPrintings = async (name: string) => {
    if (expanded.has(name)) {
      setExpanded(prev => { const n = new Set(prev); n.delete(name); return n; });
      return;
    }
    setExpanded(prev => new Set(prev).add(name));
    if (!printings[name]) {
      setLoadingPrintings(prev => new Set(prev).add(name));
      try {
        const cards = await api.cards.printings(name) as unknown as ScryfallCard[];
        setPrintings(prev => ({ ...prev, [name]: cards }));
      } catch {}
      setLoadingPrintings(prev => { const n = new Set(prev); n.delete(name); return n; });
    }
  };

  const [locations, setLocations] = useState<Location[]>([]);
  const [destLoc, setDestLoc] = useState<string | null>(null);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
  }, []);

  const handleSelectPrinting = (card: ScryfallCard) => {
    setSelectedCard(card);
    setFoil(false);
    setCondition('NM');
    setNotes('');
    setDestLoc(null);
    openForm();
  };

  const handleAddSpecific = async () => {
    if (!selectedCard) return;
    try {
      await api.wantlist.add({
        cardId: selectedCard.id, cardName: selectedCard.name,
        setCode: selectedCard.setCode, collectorNumber: selectedCard.collectorNumber,
        foil, condition: condition || null, notes: notes || undefined,
        destinationId: destLoc ? Number(destLoc) : null,
      });
      notifications.show({ title: 'Added', message: `${selectedCard.name} added to wantlist`, color: 'green' });
      closeForm(); setSelectedCard(null); loadItems();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleAddGenericByName = async (name: string) => {
    try {
      await api.wantlist.add({ cardName: name, destinationId: destLoc ? Number(destLoc) : null });
      notifications.show({ title: 'Added', message: `${name} added to wantlist (generic)`, color: 'green' });
      closeAdd(); setSearch(''); setResults([]);
      loadItems();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const { push: pushUndo } = useUndo();

  const handleDeleteConfirm = async () => {
    if (deleteConfirmId === null) return;
    const item = items.find(i => i.id === deleteConfirmId);
    try {
      await api.wantlist.remove(deleteConfirmId);
      setDeleteConfirmId(null);
      loadItems();
      if (item) {
        pushUndo(`${item.cardName} removed from wantlist`, async () => {
          await api.wantlist.add({
            cardId: item.cardId || undefined,
            cardName: item.cardName,
            setCode: item.setCode || undefined,
            collectorNumber: item.collectorNumber || undefined,
            foil: !!item.foil,
            condition: item.condition,
            notes: item.notes || undefined,
            collectionGoalId: item.collectionGoalId ?? undefined,
            persistent: !!item.persistent,
          }).catch(() => {});
          loadItems();
        }, 'Undo remove');
      }
    } catch {
      notifications.show({ title: 'Error', message: 'Failed to remove item', color: 'red' });
    }
  };

  const openAddDialog = () => {
    setSearch(''); setResults([]); setExpanded(new Set());
    openAdd();
  };

  const getCardPrice = (item: WantlistItem): number | null => {
    if (!item.cardId) return null;
    const data = cardData[item.cardId];
    if (!data?.prices) return null;
    const priceStr = item.foil ? data.prices.usd_foil : data.prices.usd;
    return priceStr ? parseFloat(priceStr) : null;
  };

  const getCardImage = (item: WantlistItem): { imageUris: Record<string, string> | null; cardFaces?: Array<{ image_uris?: Record<string, string> }> | null; layout?: string | null } | null => {
    if (!item.cardId) return null;
    const c = cardData[item.cardId];
    if (!c) return null;
    return { imageUris: c.imageUris, cardFaces: c.cardFaces, layout: c.layout };
  };

  const cardNames = results.map(g => g.name);

  return (
    <>
      <Group mb="md" justify="space-between">
        <Title order={2}>Wantlist</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={openAddDialog}>Add Card</Button>
      </Group>

      <Box pos="relative" data-tour="wantlist-list">
        <LoadingOverlay visible={loading} />

        {items.length === 0 && !loading && (
          <Text c="dimmed" ta="center" py="xl">Your wantlist is empty. Click "Add Card" to add cards you're looking for.</Text>
        )}

        {items.length > 0 && (() => {
          const grouped: Record<string, WantlistItem[]> = {};
          for (const item of items) {
            if (!grouped[item.cardName]) grouped[item.cardName] = [];
            grouped[item.cardName].push(item);
          }
          const toggleGroup = (name: string) => setWantExpanded(prev => {
            const n = new Set(prev);
            if (n.has(name)) n.delete(name); else n.add(name);
            return n;
          });

          return Object.entries(grouped).map(([name, groupItems]) => {
            const rep = groupItems[0];
            const isExpanded = wantExpanded.has(name);
            const renderRow = (item: WantlistItem, idx: number) => (
              <Group key={item.id} p="sm" gap="sm" wrap="nowrap"
                bg={idx % 2 === 1 ? 'var(--mantine-color-default-hover)' : undefined}>
                <Box w={32} h={45} style={{ borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                  {item.cardId ? <CardThumb card={getCardImage(item) ?? { imageUris: null }} /> : <GhostThumb name={item.cardName} />}
                </Box>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500} lineClamp={1}>{item.cardName}</Text>
                  {item.setCode ? (
                    <Group gap={4}>
                      <SetSymbol code={item.setCode} name={cardData[item.cardId || '']?.setName || item.setCode.toUpperCase()} size={12} />
                      <Text size="xs" c="dimmed">{item.setCode.toUpperCase()} #{item.collectorNumber}</Text>
                    </Group>
                  ) : (
                    <Text size="xs" c="dimmed">Generic</Text>
                  )}
                  {item.notes && <Text size="xs" c="dimmed" lineClamp={1}>{item.notes}</Text>}
                </div>
                {item.destinationId && (
                  <Badge size="xs" variant="light" color="green" w={90}>
                    → {locations.find(l => l.id === item.destinationId)?.name || `#${item.destinationId}`}
                  </Badge>
                )}
                {item.collectionGoalId && (
                  <Tooltip label={`Part of a collection (${goals.find(g => g.id === item.collectionGoalId)?.locationName || ''})`}>
                    <Badge size="xs" color="teal" variant="light">
                      {(() => {
                        const g = goals.find(x => x.id === item.collectionGoalId);
                        if (!g) return 'Collection';
                        return g.targetCount != null ? `${g.fulfilledCount}/${g.targetCount}` : 'Perpetual';
                      })()}
                    </Badge>
                  </Tooltip>
                )}
                <Text size="xs" w={46}>{item.foil ? '✦' : 'N'}</Text>
                <Badge size="xs" variant="outline" color="gray" w={46}>{item.condition || '-'}</Badge>
                <Text size="xs" w={70}>
                  {item.cardId ? (() => {
                    const p = getCardPrice(item);
                    return p !== null ? `$${p.toFixed(2)}` : '-';
                  })() : '-'}
                </Text>
                <Text size="xs" c="dimmed" w={80}>{item.createdAt?.slice(0, 10)}</Text>
                <WantlistFulfilActions item={item} locations={locations}
                  hasInternal={collectionNames.has(item.cardName)}
                  onDone={() => loadItems()} />
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => { setDeleteConfirmId(item.id); setDeleteConfirmName(item.cardName); }}><IconTrash size={14} /></ActionIcon>
              </Group>
            );

            return (
              <CardGroup key={name} card={getCardImage(rep) ?? { imageUris: null }}
                thumb={rep.cardId ? <CardThumb card={getCardImage(rep) ?? { imageUris: null }} /> : <GhostThumb name={name} />}
                name={name} manaCost={null} typeLine={null}
                isSingle={groupItems.length === 1} expanded={isExpanded} onToggle={() => toggleGroup(name)}
                rightSection={<Badge size="sm" variant="light">{groupItems.length} {groupItems.length !== 1 ? 'cards' : 'card'}</Badge>}
              >
                <Box>
                  {groupItems.map((item, idx) => renderRow(item, idx))}
                </Box>
              </CardGroup>
            );
          });
        })()}
        {totalPages > 1 && (
          <Group justify="center" mt="md">
            <Pagination total={totalPages} value={page} onChange={p => { setPage(p); loadItems(p); }} size="sm" />
          </Group>
        )}
      </Box>

      <Modal opened={addOpened} onClose={closeAdd} title="Add to Wantlist" size="lg" centered>
        <Select label="Destination (when acquired)" placeholder="No destination" clearable
          data={locations.map(l => ({ value: String(l.id), label: l.name }))}
          value={destLoc} onChange={setDestLoc} mb="sm" size="sm" />
        <TextInput placeholder="Search for a card..." value={search}
          onChange={e => setSearch(e.currentTarget.value)} leftSection={<IconSearch size={14} />} mb="md" />

        {cardNames.length > 0 && (
          <Box mb="md">
            {cardNames.map(groupName => {
              const isExpanded = expanded.has(groupName);
              const groupPrintings = printings[groupName];
              const group = results.find(g => g.name === groupName);
              return (
                <Paper key={groupName} withBorder mb={2} radius={0}>
                  <Group p="xs" gap="sm" wrap="nowrap" style={{ cursor: 'pointer' }}
                    bg="var(--mantine-color-default-hover)"
                    onClick={() => loadPrintings(groupName)}
                  >
                    {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    <div style={{ flex: 1 }}>
                      <Text size="sm" fw={500}>{groupName}</Text>
                      <Text size="xs" c="dimmed">{group?.printings || 1} printing{(group?.printings || 1) !== 1 ? 's' : ''}</Text>
                    </div>
                  </Group>
                  <Collapse in={isExpanded}>
                    {loadingPrintings.has(groupName) && <Text size="xs" c="dimmed" p="xs">Loading printings...</Text>}
                    {groupPrintings && groupPrintings.map(c => (
                      <Group key={c.id} p="xs" gap="sm" wrap="nowrap" style={{ cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--mantine-color-default-hover)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onClick={() => handleSelectPrinting(c)}
                      >
                        <Box w={24} h={34}><CardThumb card={c} /></Box>
                        <SetSymbol code={c.setCode} name={c.setName} size={12} />
                        <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                        <Text size="xs" c="dimmed" style={{ flex: 1 }}>{c.setName}</Text>
                        <Badge size="xs" variant="light">{c.rarity}</Badge>
                      </Group>
                    ))}
                  </Collapse>
                  <Box p="xs" style={{ cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--mantine-color-default-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                    onClick={() => handleAddGenericByName(groupName)}
                  >
                    <Group gap="sm" wrap="nowrap">
                      <Box w={24} h={34} style={{ background: '#1a1a2e', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Text size="xs" c="dimmed" style={{ fontSize: 20 }}>?</Text>
                      </Box>
                      <Text size="sm" c="dimmed" fs="italic">Generic</Text>
                      <Badge size="xs" variant="light" color="gray">Any printing</Badge>
                    </Group>
                  </Box>
                </Paper>
              );
            })}
          </Box>
        )}
      </Modal>

      <Modal opened={formOpened} onClose={closeForm} title={`Add ${selectedCard?.name || ''}`} size="sm" centered>
        {selectedCard && (
          <Box>
            <Group gap="md" mb="md" wrap="nowrap" align="flex-start">
              <Box w={100}><CardThumb card={selectedCard} /></Box>
              <div style={{ flex: 1 }}>
                <Text fw={600} size="sm">{selectedCard.name}</Text>
                <Group gap={4} mt={2}>
                  <SetSymbol code={selectedCard.setCode} name={selectedCard.setName} size={12} />
                  <Text size="xs" c="dimmed">#{selectedCard.collectorNumber}</Text>
                </Group>
              </div>
            </Group>
            <Switch label="Foil" checked={foil} onChange={e => { const v = e.currentTarget.checked; setFoil(v); }} mb="sm" />
            <Box mb="sm">
              <Text size="sm" fw={500} mb={4}>Desired Condition</Text>
              <SegmentedControl value={condition} onChange={v => setCondition(v as Condition)}
                data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs"
                styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[condition || 'NM'] || '#00897b' } }} />
            </Box>
            <Select label="Destination (when acquired)" placeholder="No destination" clearable
              data={locations.map(l => ({ value: String(l.id), label: l.name }))}
              value={destLoc} onChange={setDestLoc} mb="sm" size="sm" />
            <Textarea label="Notes" value={notes} onChange={e => setNotes(e.currentTarget.value)} mb="md" />
            <Button onClick={handleAddSpecific} fullWidth>Add to Wantlist</Button>
          </Box>
        )}
      </Modal>

      <Modal opened={deleteConfirmId !== null} onClose={() => setDeleteConfirmId(null)} title="Remove from Wantlist" size="sm" centered>
        <Text mb="md">Remove <b>{deleteConfirmName}</b> from your wantlist?</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
          <Button color="red" onClick={handleDeleteConfirm}>Remove</Button>
        </Group>
      </Modal>
    </>
  );
}
