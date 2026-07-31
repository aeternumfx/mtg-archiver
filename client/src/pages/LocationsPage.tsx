import { useState, useEffect } from 'react';
import {
  Title, Stack, Card, Group, Text, Button, Modal, TextInput, Badge,
  ActionIcon, Box, Select, Radio, Collapse, SegmentedControl, NumberInput, MultiSelect, ScrollArea, Switch, Progress,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconEdit, IconTrash, IconPlus, IconArchive, IconFolder, IconStack, IconBook, IconPackage, IconChevronDown, IconChevronRight, IconInbox, IconTarget, IconSearch } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Location, LocationGroup, ScryfallCard } from '../types';
import { CardThumb } from '../components/CardDisplay';

interface DeckSummary {
  id: number;
  name: string;
  description: string | null;
  cardCount: number;
  groupId: number | null;
}

const ITEM_ICONS: Record<string, any> = {
  binder: IconBook,
  other: IconArchive,
  collection: IconTarget,
};

const ITEM_LABELS: Record<string, string> = {
  binder: 'Binder',
  other: 'Other',
  collection: 'Collection',
};

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [groups, setGroups] = useState<LocationGroup[]>([]);
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [editLoc, setEditLoc] = useState<Location | null>(null);
  const [editGroup, setEditGroup] = useState<LocationGroup | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [itemType, setItemType] = useState<string>('binder');
  const [locGroupId, setLocGroupId] = useState<string | null>(null);
  const [typePickerOpened, { open: openTypePicker, close: closeTypePicker }] = useDisclosure(false);
  const [locOpened, { open: openLoc, close: closeLoc }] = useDisclosure(false);
  const [deckOpened, { open: openDeckModal, close: closeDeckModal }] = useDisclosure(false);
  const [editDeckId, setEditDeckId] = useState<number | null>(null);
  const [groupOpened, { open: openGroup, close: closeGroup }] = useDisclosure(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set(groups.map(g => g.id)));
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteType, setDeleteType] = useState<'location' | 'group' | 'deck' | null>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [collOpened, { open: openColl, close: closeColl }] = useDisclosure(false);
  const [collKind, setCollKind] = useState<'specific' | 'generic' | 'set'>('specific');
  const [collCardSearch, setCollCardSearch] = useState('');
  const [collCardResults, setCollCardResults] = useState<ScryfallCard[]>([]);
  const [collSelectedCard, setCollSelectedCard] = useState<ScryfallCard | null>(null);
  const [collGenericName, setCollGenericName] = useState('');
  const [collSetCodes, setCollSetCodes] = useState<string[]>([]);
  const [collSets, setCollSets] = useState<Array<{ value: string; label: string }>>([]);
  const [collTarget, setCollTarget] = useState<number | ''>(4);
  const [collPerpetual, setCollPerpetual] = useState(false);
  const [collSaving, setCollSaving] = useState(false);
  const navigate = useNavigate();

  const loadData = async () => {
    try {
      const [locs, grps, d, g] = await Promise.all([
        api.locations.list(), api.locationGroups.list(), api.decks.list(), api.collectionGoals.list().catch(() => []),
      ]);
      setLocations(locs);
      setGroups(grps);
      setDecks(d);
      setGoals(g);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const locationsByGroup = (groupId: number | null) =>
    locations.filter(l => (l.groupId ?? null) === groupId);

  const inboxLoc = locations.find(l => l.builtIn);
  const ungroupedLocs = locations.filter(l => !l.groupId && !l.builtIn);
  const ungroupedDecks = decks.filter(d => !d.groupId);

  useEffect(() => {
    api.sets().then(sets => setCollSets(sets.map(s => ({ value: s.setCode, label: `${s.setCode.toUpperCase()} — ${s.setName}` })))).catch(() => {});
  }, []);

  useEffect(() => {
    if (collCardSearch.trim().length < 2) { setCollCardResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await api.cards.find(collCardSearch);
        setCollCardResults(res.slice(0, 12) as unknown as ScryfallCard[]);
      } catch { setCollCardResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [collCardSearch]);

  const openCreateCollection = () => {
    setEditLoc(null); setName(''); setDescription('');
    setCollKind('specific'); setCollCardSearch(''); setCollCardResults([]); setCollSelectedCard(null);
    setCollGenericName(''); setCollSetCodes([]); setCollTarget(4); setCollPerpetual(false);
    closeTypePicker(); openColl();
  };

  const handleSaveCollection = async () => {
    if (!name.trim()) return;
    if (collKind === 'specific' && !collSelectedCard) {
      notifications.show({ title: 'Select a card', message: 'Choose a specific printing to collect', color: 'yellow' });
      return;
    }
    if (collKind === 'generic' && !collGenericName.trim()) {
      notifications.show({ title: 'Enter a card', message: 'Type the card name to collect', color: 'yellow' });
      return;
    }
    if (collKind === 'set' && collSetCodes.length === 0) {
      notifications.show({ title: 'Select sets', message: 'Choose at least one set', color: 'yellow' });
      return;
    }
    setCollSaving(true);
    try {
      await api.collectionGoals.create({
        name: name.trim(),
        description: description.trim() || undefined,
        kind: collKind,
        cardId: collKind === 'specific' ? collSelectedCard!.id : undefined,
        cardName: collKind === 'specific' ? collSelectedCard!.name : (collKind === 'generic' ? collGenericName.trim() : undefined),
        setCodes: collKind === 'set' ? collSetCodes : undefined,
        targetCount: collPerpetual ? null : (typeof collTarget === 'number' ? collTarget : 4),
        perpetual: collPerpetual,
      });
      notifications.show({ title: 'Created', message: 'Collection created', color: 'green' });
      closeColl(); loadData();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setCollSaving(false);
    }
  };

  const openCreateLoc = (type: string) => {
    setEditLoc(null); setName(''); setDescription(''); setItemType(type); setLocGroupId(null);
    closeTypePicker(); openLoc();
  };

  const openEditLoc = (loc: Location) => {
    setEditLoc(loc); setName(loc.name); setDescription(loc.description ?? ''); setItemType(loc.type); setLocGroupId(loc.groupId ? String(loc.groupId) : null); openLoc();
  };

  const handleSaveLoc = async () => {
    if (!name.trim()) return;
    try {
      if (editLoc) {
        await api.locations.update(editLoc.id, { name: name.trim(), description: description.trim() || null, type: itemType });
        if (locGroupId !== (editLoc.groupId ? String(editLoc.groupId) : null)) {
          await api.locations.setGroup(editLoc.id, locGroupId ? Number(locGroupId) : null);
        }
      } else {
        await api.locations.create({ name: name.trim(), description: description.trim() || null, type: itemType });
      }
      closeLoc(); loadData();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openCreateDeck = () => {
    setEditDeckId(null); setName(''); setDescription(''); setLocGroupId(null);
    closeTypePicker(); openDeckModal();
  };

  const openEditDeck = (deck: DeckSummary) => {
    setEditDeckId(deck.id); setName(deck.name); setDescription(deck.description || ''); setLocGroupId(deck.groupId ? String(deck.groupId) : null);
    openDeckModal();
  };

  const handleSaveDeck = async () => {
    if (!name.trim()) return;
    try {
      if (editDeckId) {
        await api.decks.update(editDeckId, { name: name.trim(), description: description.trim() || null });
        if (locGroupId !== null) {
          await api.decks.setGroup(editDeckId, locGroupId ? Number(locGroupId) : null);
        }
      } else {
        const deck = await api.decks.create({ name: name.trim(), description: description.trim() || null });
        if (locGroupId) {
          await api.decks.setGroup(deck.id, Number(locGroupId));
        }
      }
      closeDeckModal(); loadData();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openCreateGroup = () => {
    setEditGroup(null); setName(''); setDescription(''); openGroup();
  };

  const openEditGroup = (g: LocationGroup) => {
    setEditGroup(g); setName(g.name); setDescription(g.description ?? ''); openGroup();
  };

  const handleSaveGroup = async () => {
    if (!name.trim()) return;
    try {
      if (editGroup) {
        await api.locationGroups.update(editGroup.id, { name: name.trim(), description: description.trim() || undefined });
      } else {
        await api.locationGroups.create({ name: name.trim(), description: description.trim() || undefined });
      }
      closeGroup(); loadData();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    try {
      if (deleteType === 'group') {
        await api.locationGroups.delete(deleteId);
      } else if (deleteType === 'deck') {
        await api.decks.delete(deleteId);
      } else {
        await api.locations.delete(deleteId);
      }
      loadData();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
    setDeleteId(null);
  };

  const DeckCard = ({ deck }: { deck: DeckSummary }) => (
    <Card withBorder radius={0} padding="sm">
      <Group justify="space-between">
        <Group gap="sm">
          <IconStack size={18} />
          <div>
            <Text size="sm" fw={500}>{deck.name}</Text>
            {deck.description && <Text size="xs" c="dimmed">{deck.description}</Text>}
            <Text size="xs" c="dimmed">{deck.cardCount} cards</Text>
          </div>
        </Group>
        <Group gap={4}>
          <Button variant="light" size="compact-sm" onClick={() => navigate(`/collection?deck_id=${deck.id}`)}>View</Button>
          <ActionIcon variant="subtle" size="sm" onClick={() => openEditDeck(deck)}><IconEdit size={16} /></ActionIcon>
          <ActionIcon variant="subtle" color="red" size="sm" onClick={() => { setDeleteId(deck.id); setDeleteType('deck'); }}><IconTrash size={16} /></ActionIcon>
        </Group>
      </Group>
    </Card>
  );

  const LocationCard = ({ loc }: { loc: Location }) => {
    const Icon = loc.builtIn ? IconInbox : (ITEM_ICONS[loc.type] || IconArchive);
    const isInbox = loc.builtIn;
    const goal = loc.type === 'collection' ? goals.find(g => g.locationId === loc.id) : null;
    return (
      <Card key={loc.id} withBorder radius={0} padding="sm" bg={isInbox ? 'var(--mantine-color-blue-0)' : undefined}>
        <Group justify="space-between">
          <Group gap="sm">
            <Icon size={18} />
            <div>
              <Text size="sm" fw={500}>{loc.name}{isInbox ? <Badge size="xs" ml="xs" color="blue" variant="light">Default</Badge> : ''}</Text>
              {loc.description && <Text size="xs" c="dimmed">{loc.description}</Text>}
              <Text size="xs" c="dimmed">{loc.cardCount ?? 0} cards</Text>
              {goal && (
                <Group gap={6} mt={2}>
                  {goal.kind === 'set' ? (
                    <>
                      <Badge size="xs" color="teal" variant="light">Set: {goal.fulfilledCount}/{goal.targetCount} cards</Badge>
                      <Progress value={(goal.targetCount ? (goal.fulfilledCount / goal.targetCount) * 100 : 0)} size="xs" w={80} color="teal" />
                    </>
                  ) : (
                    <>
                      <Badge size="xs" color="teal" variant="light">
                        {goal.targetCount != null ? `${goal.fulfilledCount}/${goal.targetCount} copies` : 'Perpetual'}
                      </Badge>
                      {goal.targetCount != null && <Progress value={(goal.targetCount ? (goal.fulfilledCount / goal.targetCount) * 100 : 0)} size="xs" w={80} color="teal" />}
                    </>
                  )}
                  {goal.status === 'complete' && <Badge size="xs" color="green" variant="light">Complete</Badge>}
                </Group>
              )}
            </div>
          </Group>
          <Group gap={4}>
            <Button variant="light" size="compact-sm" onClick={() => navigate(`/collection?location_id=${loc.id}`)}>View</Button>
            {!isInbox && (
              <>
                <ActionIcon variant="subtle" size="sm" onClick={() => openEditLoc(loc)}><IconEdit size={16} /></ActionIcon>
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => { setDeleteId(loc.id); setDeleteType('location'); }}><IconTrash size={16} /></ActionIcon>
              </>
            )}
          </Group>
        </Group>
      </Card>
    );
  };

  return (
    <>
      <Group mb="md" justify="space-between">
        <Title order={2}>Locations</Title>
        <Group>
          <Button leftSection={<IconFolder size={16} />} variant="light" onClick={openCreateGroup}>New Group</Button>
          <Button leftSection={<IconPlus size={16} />} onClick={openTypePicker}>New Item</Button>
        </Group>
      </Group>

      <Stack gap={0}>
        {inboxLoc && <LocationCard loc={inboxLoc} />}

        {groups.map(group => {
          const locs = locationsByGroup(group.id);
          const groupDecks = decks.filter(d => d.groupId === group.id);
          const itemCount = locs.length + groupDecks.length;
          const isExpanded = expandedGroups.has(group.id);
          return (
            <Box key={group.id}>
              <Card withBorder radius={0} padding="sm" bg="var(--mantine-color-default-hover)">
                <Group justify="space-between">
                  <Group gap="sm" style={{ cursor: 'pointer', flex: 1 }} onClick={() => {
                    setExpandedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                      return next;
                    });
                  }}>
                    {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    <IconFolder size={20} />
                    <div>
                      <Text fw={600} size="sm">{group.name}</Text>
                      {group.description && <Text size="xs" c="dimmed">{group.description}</Text>}
                      <Text size="xs" c="dimmed">{itemCount} item{itemCount !== 1 ? 's' : ''}</Text>
                    </div>
                  </Group>
                  <Group gap={4}>
                    <ActionIcon variant="subtle" size="sm" onClick={() => openEditGroup(group)}><IconEdit size={16} /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => { setDeleteId(group.id); setDeleteType('group'); }}><IconTrash size={16} /></ActionIcon>
                  </Group>
                </Group>
              </Card>
              <Collapse in={isExpanded}>
                {locs.map(loc => <LocationCard key={loc.id} loc={loc} />)}
                {groupDecks.map(deck => <DeckCard key={`deck-${deck.id}`} deck={deck} />)}
              </Collapse>
            </Box>
          );
        })}

        {(ungroupedLocs.length > 0 || ungroupedDecks.length > 0) && (
          <Box mt="md">
            <Card withBorder radius="md" padding="sm" bg="var(--mantine-color-blue-0)">
              <Group gap="sm">
                <IconArchive size={20} />
                <Text fw={600} size="sm">Ungrouped</Text>
                <Text size="xs" c="dimmed">({ungroupedLocs.length + ungroupedDecks.length} item{(ungroupedLocs.length + ungroupedDecks.length) !== 1 ? 's' : ''})</Text>
              </Group>
            </Card>
            {ungroupedLocs.map(loc => <LocationCard key={loc.id} loc={loc} />)}
            {ungroupedDecks.map(deck => <DeckCard key={`deck-${deck.id}`} deck={deck} />)}
          </Box>
        )}

        {!loading && locations.length === 0 && decks.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">No locations or decks yet.</Text>
        )}
      </Stack>

      <Modal opened={typePickerOpened} onClose={closeTypePicker} title="New Item" size="sm" centered>
        <Radio.Group value={itemType} onChange={v => setItemType(v)}>
          <Stack gap="sm">
            <Card withBorder radius="sm" padding="sm" style={{ cursor: 'pointer' }}
              onClick={() => { setItemType('binder'); }}
              bg={itemType === 'binder' ? 'var(--mantine-color-blue-0)' : undefined}
            >
              <Group>
                <Radio value="binder" checked={itemType === 'binder'} readOnly />
                <IconBook size={24} />
                <div>
                  <Text fw={500} size="sm">Binder</Text>
                  <Text size="xs" c="dimmed">A physical binder, box, or folder</Text>
                </div>
              </Group>
            </Card>
            <Card withBorder radius="sm" padding="sm" style={{ cursor: 'pointer' }}
              onClick={() => { setItemType('deck'); }}
              bg={itemType === 'deck' ? 'var(--mantine-color-blue-0)' : undefined}
            >
              <Group>
                <Radio value="deck" readOnly />
                <IconStack size={24} />
                <div>
                  <Text fw={500} size="sm">Deck</Text>
                  <Text size="xs" c="dimmed">A playable deck with its own card list</Text>
                </div>
              </Group>
            </Card>
            <Card withBorder radius="sm" padding="sm" style={{ cursor: 'pointer' }}
              onClick={() => { setItemType('other'); }}
              bg={itemType === 'other' ? 'var(--mantine-color-blue-0)' : undefined}
            >
              <Group>
                <Radio value="other" checked={itemType === 'other'} readOnly />
                <IconPackage size={24} />
                <div>
                  <Text fw={500} size="sm">Other</Text>
                  <Text size="xs" c="dimmed">A storage box, pile, or anything else</Text>
                </div>
              </Group>
            </Card>
            <Card withBorder radius="sm" padding="sm" style={{ cursor: 'pointer' }}
              onClick={() => { setItemType('collection'); }}
              bg={itemType === 'collection' ? 'var(--mantine-color-blue-0)' : undefined}
            >
              <Group>
                <Radio value="collection" checked={itemType === 'collection'} readOnly />
                <IconTarget size={24} />
                <div>
                  <Text fw={500} size="sm">Collection</Text>
                  <Text size="xs" c="dimmed">A goal to collect specific cards or sets</Text>
                </div>
              </Group>
            </Card>
          </Stack>
        </Radio.Group>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={closeTypePicker}>Cancel</Button>
          <Button onClick={() => {
            if (itemType === 'deck') { openCreateDeck(); }
            else if (itemType === 'collection') { openCreateCollection(); }
            else { openCreateLoc(itemType); }
          }}>Next</Button>
        </Group>
      </Modal>

      <Modal opened={collOpened} onClose={closeColl} title="New Collection" size="md" centered>
        <TextInput label="Name" value={name} onChange={e => { const v = e.currentTarget.value; setName(v); }} required data-autofocus mb="sm" />
        <TextInput label="Description (optional)" value={description} onChange={e => { const v = e.currentTarget.value; setDescription(v); }} mb="sm" />
        <SegmentedControl fullWidth mb="sm" value={collKind} onChange={v => setCollKind(v as any)}
          data={[{ value: 'specific', label: 'Specific card' }, { value: 'generic', label: 'Generic card' }, { value: 'set', label: 'Set(s)' }]} />
        {collKind !== 'set' && (
          <Box mb="sm">
            <TextInput placeholder="Search for a card..." value={collCardSearch} onChange={e => setCollCardSearch(e.currentTarget.value)}
              leftSection={<IconSearch size={14} />} mb="xs" />
            {collSelectedCard ? (
              <Group gap="sm" mb="xs">
                <Box w={32} h={45}><CardThumb card={collSelectedCard} /></Box>
                <div style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>{collSelectedCard.name}</Text>
                  <Text size="xs" c="dimmed">{collSelectedCard.setCode.toUpperCase()} #{collSelectedCard.collectorNumber}</Text>
                </div>
                {collKind === 'specific' && <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setCollSelectedCard(null)}>Change</Button>}
              </Group>
            ) : null}
            {collKind === 'specific' && !collSelectedCard && collCardResults.length > 0 && (
              <ScrollArea h={180}>
                {collCardResults.map(c => (
                  <Group key={c.id} p="xs" gap="sm" wrap="nowrap" style={{ cursor: 'pointer', borderRadius: 4 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--mantine-color-default-hover)')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                    onClick={() => { setCollSelectedCard(c); setCollCardSearch(''); setCollCardResults([]); }}
                  >
                    <Box w={24} h={34}><CardThumb card={c} /></Box>
                    <div style={{ flex: 1 }}>
                      <Text size="sm" fw={500}>{c.name}</Text>
                      <Text size="xs" c="dimmed">{c.setCode.toUpperCase()} #{c.collectorNumber}</Text>
                    </div>
                  </Group>
                ))}
              </ScrollArea>
            )}
            {collKind === 'generic' && (
              <TextInput placeholder="e.g. Sol Ring (any printing)" value={collGenericName} onChange={e => setCollGenericName(e.currentTarget.value)} />
            )}
          </Box>
        )}
        {collKind === 'set' && (
          <MultiSelect placeholder="Choose set(s) to collect" data={collSets} value={collSetCodes} onChange={setCollSetCodes}
            searchable clearable mb="sm" maxDropdownHeight={220} />
        )}
        {collKind !== 'set' && (
          <Group gap="md" mb="sm" align="flex-end">
            <NumberInput label="Collect how many" value={collTarget} onChange={v => setCollTarget(v as number | '')} min={1} max={999} disabled={collPerpetual} w={140} />
            <Switch label="Perpetual (no limit)" checked={collPerpetual} onChange={e => { const v = e.currentTarget.checked; setCollPerpetual(v); }} />
          </Group>
        )}
        <Button onClick={handleSaveCollection} fullWidth loading={collSaving} leftSection={<IconPlus size={16} />}>Create Collection</Button>
      </Modal>

      <Modal opened={locOpened} onClose={closeLoc} title={editLoc ? 'Edit Item' : `New ${ITEM_LABELS[itemType] || 'Item'}`} size="sm">
        <TextInput label="Name" value={name} onChange={e => { const v = e.currentTarget.value; setName(v); }} required data-autofocus />
        <TextInput label="Description (optional)" value={description} onChange={e => { const v = e.currentTarget.value; setDescription(v); }} mt="sm" />
        <Select label="Group" placeholder="No group" data={[
          { value: '', label: 'No group' },
          ...groups.map(g => ({ value: String(g.id), label: g.name })),
        ]} value={locGroupId} onChange={v => setLocGroupId(v)} clearable mt="sm" />
        <Button onClick={handleSaveLoc} fullWidth mt="md">{editLoc ? 'Save' : 'Create'}</Button>
      </Modal>

      <Modal opened={deckOpened} onClose={closeDeckModal} title={editDeckId ? 'Edit Deck' : 'New Deck'} size="sm">
        <TextInput label="Name" value={name} onChange={e => { const v = e.currentTarget.value; setName(v); }} required data-autofocus />
        <TextInput label="Description (optional)" value={description} onChange={e => { const v = e.currentTarget.value; setDescription(v); }} mt="sm" />
        <Select label="Group" placeholder="No group" data={[
          { value: '', label: 'No group' },
          ...groups.map(g => ({ value: String(g.id), label: g.name })),
        ]} value={locGroupId} onChange={v => setLocGroupId(v)} clearable mt="sm" />
        <Button onClick={handleSaveDeck} fullWidth mt="md">{editDeckId ? 'Save' : 'Create'}</Button>
      </Modal>

      <Modal opened={groupOpened} onClose={closeGroup} title={editGroup ? 'Edit Group' : 'Create Group'} size="sm">
        <TextInput label="Name" value={name} onChange={e => { const v = e.currentTarget.value; setName(v); }} required data-autofocus />
        <TextInput label="Description (optional)" value={description} onChange={e => { const v = e.currentTarget.value; setDescription(v); }} mt="sm" />
        <Button onClick={handleSaveGroup} fullWidth mt="md">{editGroup ? 'Save' : 'Create'}</Button>
      </Modal>

      <Modal opened={deleteId !== null} onClose={() => setDeleteId(null)} title={`Delete ${deleteType === 'group' ? 'Group' : deleteType === 'deck' ? 'Deck' : 'Item'}`} size="sm">
        <Text mb="md">
          {deleteType === 'group'
            ? 'Are you sure? Items in this group will become ungrouped but will not be deleted.'
            : deleteType === 'deck'
            ? 'Are you sure you want to delete this deck? Cards in the deck will not be removed from your collection.'
            : 'Are you sure you want to delete this item? Cards must be moved or removed first.'}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button color="red" onClick={handleDelete}>Delete</Button>
        </Group>
      </Modal>
    </>
  );
}
