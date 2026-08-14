import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  Title, Group, Text, Badge, Modal,
  Select, TextInput, Button, ActionIcon, Box,
  Paper, NumberFormatter, Tooltip, Checkbox, SegmentedControl, Switch, NumberInput, Pagination, Skeleton, Stack, Collapse, Image, Progress,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconArrowRight, IconSearch, IconPencil, IconFilter, IconMapPin, IconChevronUp, IconChevronDown } from '@tabler/icons-react';
import { api, authFetch } from '../api/client';
import { CONDITIONS } from '../types';
import type { Location, LocationGroup, CollectionItem, Condition } from '../types';
import { CardThumb, SetSymbol, Tags, ManaCost, GhostThumb } from '../components/CardDisplay';
import { CardGroup } from '../components/CardGroup';
import { WantlistFulfilActions } from '../components/WantlistFulfil';

interface WantlistGhost {
  id: number; cardId: string | null; cardName: string; setCode: string | null;
  collectorNumber: string | null; destinationId: number | null;
  tradeId?: number | null; notes?: string | null;
}

interface IncomingMove {
  id: number; cardId: string | null; locationId: number; destinationId: number | null;
  foil: number; condition: string | null; quantity: number; notes: string | null;
  sourceName: string;
  card: { name: string; setName: string; setCode: string; collectorNumber: string; imageUris: Record<string, string> | null; cardFaces?: Array<{ image_uris?: Record<string, string> }> | null; layout?: string | null };
}

interface CollectionGroup {
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  cmc: number | null;
  imageUris: Record<string, string> | null;
  cardFaces?: Array<{ image_uris?: Record<string, string> }> | null;
  layout?: string | null;
  setCodes: string[];
  totalQty: number;
  totalValue: number;
  hasFoil: number;
  bestCondition: string | null;
  items: CollectionItem[];
}

interface CopyRow {
  key: string;
  item: CollectionItem;
}

const CONDITION_COLORS: Record<string, string> = {
  M: '#2e7d32', NM: '#00897b', LP: '#1565c0',
  MP: '#f9a825', HP: '#e65100', Dmg: '#c62828',
};

const condLabel = (cond: string | null): string => cond || '-';

const ItemRow = memo(function ItemRow({ row, selected, locations, onToggle, onEdit, onMove, onOpenDest, onDelete }: {
  row: CopyRow;
  selected: boolean;
  locations: Location[];
  onToggle: (key: string, shift: boolean) => void;
  onEdit: (item: CollectionItem) => void;
  onMove: (item: CollectionItem) => void;
  onOpenDest: (item: CollectionItem) => void;
  onDelete: (item: CollectionItem) => void;
}) {
  const { item } = row;
  return (
    <>
      <Checkbox size="xs" checked={selected} onClick={(e) => onToggle(row.key, e.shiftKey)} />
      <CardThumb card={item.card} foil={!!item.foil} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={500}>{item.card.name}</Text>
          <Tags card={item.card} />
        </Group>
        <Group gap={6}>
          <ManaCost manaCost={item.card.manaCost} />
          <Text size="xs" c="dimmed">{item.card.typeLine}</Text>
        </Group>
      </div>
      <Box w={70}><SetSymbol code={item.card.setCode} name={item.card.setName} size={14} /></Box>
      <Text size="xs" w={40}>{item.card.collectorNumber}</Text>
      <Text w={46} ta="center">{item.foil ? 'Y' : 'N'}</Text>
      <Badge size="xs" variant="outline" color="gray" w={40} ta="center">{condLabel(item.condition)}</Badge>
      <Text w={60} ta="center">
        {item.purchasePrice ? <NumberFormatter value={item.purchasePrice} prefix="$" decimalScale={2} fixedDecimalScale /> : '-'}
      </Text>
      <Text w={60} ta="center">
        {(() => {
          const priceStr = item.foil ? item.card.prices?.usd_foil : item.card.prices?.usd;
          const marketPrice = priceStr ? parseFloat(priceStr) : null;
          return marketPrice !== null ? <NumberFormatter value={marketPrice} prefix="$" decimalScale={2} fixedDecimalScale /> : '-';
        })()}
      </Text>
      <Tooltip label={`Location: ${locations.find(l => l.id === item.locationId)?.name || `#${item.locationId}`}`}>
        <Badge size="xs" variant="light" color="blue" w={110} ta="center"
          style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block', textAlign: 'center' }}>
          {locations.find(l => l.id === item.locationId)?.name || `#${item.locationId}`}
        </Badge>
      </Tooltip>
      {item.destinationId ? (
        <Tooltip label={`Move pending from ${locations.find(l => l.id === item.locationId)?.name || `#${item.locationId}`} to ${locations.find(l => l.id === item.destinationId)?.name || `#${item.destinationId}`}`}>
          <Badge size="xs" variant="light" color="green" w={80} ta="center" style={{ textAlign: 'center' }}>→ {locations.find(l => l.id === item.destinationId)?.name || `#${item.destinationId}`}</Badge>
        </Tooltip>
      ) : (
        <Text size="xs" w={80} c="dimmed" ta="center">-</Text>
      )}
      <Tooltip label={item.notes || ''} disabled={!item.notes}>
        <Text size="xs" w={80} lineClamp={1}>{item.notes || '-'}</Text>
      </Tooltip>
      <Text w={40} ta="center">{item.packOpened ? 'P' : '-'}</Text>
      <Group gap={2} w={86}>
        <ActionIcon variant="subtle" size="sm" onClick={() => onEdit(item)}><IconPencil size={14} /></ActionIcon>
        <ActionIcon variant="subtle" size="sm" onClick={() => onMove(item)}><IconArrowRight size={14} /></ActionIcon>
        <ActionIcon variant="subtle" size="sm" color={item.destinationId ? 'green' : 'gray'} onClick={() => onOpenDest(item)}><IconMapPin size={14} /></ActionIcon>
        <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(item)}><IconTrash size={14} /></ActionIcon>
      </Group>
    </>
  );
});

const GhostRow = memo(function GhostRow({ w, locations, hasInternal, onDone, currentLocationId }: {
  w: WantlistGhost;
  locations: Location[];
  hasInternal: boolean;
  onDone: () => void;
  currentLocationId: number | null;
}) {
  if (w.tradeId) {
    return (
      <Group p="sm" gap="sm" wrap="nowrap" opacity={0.55} style={{ filter: 'grayscale(0.6)' }}>
        <Box w={32} h={45}><GhostThumb name={w.cardName} cardId={w.cardId} /></Box>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500}>{w.cardName}</Text>
          <Text size="xs" c="dimmed">{w.notes || 'Pending trade'}</Text>
        </div>
        <Badge size="xs" variant="light" color="orange">Pending trade</Badge>
        <Button size="compact-xs" variant="light" color="orange" component="a" href={`/trades?trade=${w.tradeId}`}>
          View trade
        </Button>
      </Group>
    );
  }
  return (
    <Group p="sm" gap="sm" wrap="nowrap" opacity={0.55} style={{ filter: 'grayscale(0.6)' }}>
      <Box w={32} h={45}><GhostThumb name={w.cardName} cardId={w.cardId} /></Box>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500}>{w.cardName}</Text>
        {w.setCode ? (
          <Group gap={4}>
            <SetSymbol code={w.setCode} name={w.setCode} size={12} />
            <Text size="xs" c="dimmed">{w.setCode.toUpperCase()} #{w.collectorNumber}</Text>
          </Group>
        ) : (
          <Text size="xs" c="dimmed">Generic</Text>
        )}
      </div>
      <Badge size="xs" variant="light" color="teal">Wantlist</Badge>
      <WantlistFulfilActions item={w} locations={locations} hasInternal={hasInternal} onDone={onDone} currentLocationId={currentLocationId} />
    </Group>
  );
});

const IncomingMoveRow = memo(function IncomingMoveRow({ m, locations }: { m: IncomingMove; locations: Location[] }) {
  const destName = locations.find(l => l.id === m.destinationId)?.name || (m.destinationId ? `#${m.destinationId}` : '');
  return (
    <Group p="sm" gap="sm" wrap="nowrap" opacity={0.55} style={{ filter: 'grayscale(0.6)' }}>
      <Box w={32} h={45} style={{ flexShrink: 0 }}>
        <GhostThumb name={m.card?.name} cardId={m.cardId} />
      </Box>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={500}>{m.card?.name || 'Unknown'}</Text>
        {m.card?.setCode ? (
          <Group gap={4}>
            <SetSymbol code={m.card.setCode} name={m.card.setName} size={12} />
            <Text size="xs" c="dimmed">{m.card.setCode.toUpperCase()} #{m.card.collectorNumber}</Text>
          </Group>
        ) : null}
      </div>
      <Badge size="xs" variant="light" color="violet">Scheduled move</Badge>
      <Badge size="xs" variant="light" color="blue">{m.sourceName}</Badge>
      <IconArrowRight size={14} opacity={0.4} />
      <Badge size="xs" variant="light" color="green">{destName || '?'}</Badge>
    </Group>
  );
});

const copyKeyFor = (item: CollectionItem, copyIdx: number) => `${item.id}-${copyIdx}`;

const expandItems = (items: CollectionItem[]): CopyRow[] => {
  const rows: CopyRow[] = [];
  for (const item of items) {
    for (let i = 0; i < item.quantity; i++) {
      rows.push({ key: copyKeyFor(item, i), item });
    }
  }
  return rows;
};

export default function CollectionPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationGroups, setLocationGroups] = useState<LocationGroup[]>([]);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(() => new URLSearchParams(window.location.search).get('location_id'));
  const [selectedGroup, setSelectedGroup] = useState<string | null>(() => new URLSearchParams(window.location.search).get('group_id'));
  const [selectedDeck, setSelectedDeck] = useState<string | null>(() => new URLSearchParams(window.location.search).get('deck_id'));
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('price');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [groups, setGroups] = useState<CollectionGroup[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [moveOpened, { open: openMove, close: closeMove }] = useDisclosure(false);
  const [destLoc, setDestLoc] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [editItem, setEditItem] = useState<CollectionItem | null>(null);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [deleteConfirmOpened, { open: openDeleteConfirm, close: closeDeleteConfirm }] = useDisclosure(false);
  const [editForm, setEditForm] = useState({ quantity: 1, foil: false, condition: '' as Condition | '', purchasePrice: '', packOpened: false, notes: '' });
  const [editDestLoc, setEditDestLoc] = useState<string | null>(null);
  const [destOpened, { open: openDest, close: closeDest }] = useDisclosure(false);
  const [destItem, setDestItem] = useState<CollectionItem | null>(null);
  const [destValue, setDestValue] = useState<string | null>(null);
  const [bulkScheduleOpened, { open: openBulkSchedule, close: closeBulkSchedule }] = useDisclosure(false);
  const [bulkDestValue, setBulkDestValue] = useState<string | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState<null | { mode: 'single'; source: 'dest' | 'edit'; item: CollectionItem; destId: number | null } | { mode: 'bulk'; destId: number }>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [wantGhosts, setWantGhosts] = useState<WantlistGhost[]>([]);
  const [incomingMoves, setIncomingMoves] = useState<IncomingMove[]>([]);
  const [ghostPage, setGhostPage] = useState(1);
  const [ghostTotalPages, setGhostTotalPages] = useState(1);
  const [ghostLoading, setGhostLoading] = useState(false);
  const [collectionNames, setCollectionNames] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState<Array<{ id: number; locationId: number; locationName: string; kind: string; cardName: string | null; setCodes: string | null; targetCount: number | null; fulfilledCount: number; status: string; remaining: number; remainingCost: number; percent: number }>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadWantGhosts = useCallback(async (targetPage = 1) => {
    if (!selectedLoc) { setWantGhosts([]); setGhostTotalPages(1); return; }
    setGhostLoading(true);
    try {
      const [res, names, g] = await Promise.all([
        api.wantlist.paged(targetPage, 40, {
          destinationId: Number(selectedLoc),
          q: search,
          sort,
          order,
          filters,
          tradeGhosts: '1',
        }),
        api.collection.names().catch(() => []),
        api.collectionGoals.list().catch(() => []),
      ]);
      setWantGhosts(res.data);
      setGhostTotalPages(res.totalPages);
      setCollectionNames(new Set(names));
      setGoals(g);
    } catch { setWantGhosts([]); setGhostTotalPages(1); }
    setGhostLoading(false);
  }, [selectedLoc, search, sort, order, filters]);

  useEffect(() => {
    if (ghostDebounceRef.current) clearTimeout(ghostDebounceRef.current);
    ghostDebounceRef.current = setTimeout(() => {
      setGhostPage(1);
      loadWantGhosts(1);
    }, 250);
    return () => { if (ghostDebounceRef.current) clearTimeout(ghostDebounceRef.current); };
  }, [loadWantGhosts]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedLoc) params.set('location_id', selectedLoc);
      if (selectedGroup) params.set('group_id', selectedGroup);
      if (selectedDeck) params.set('deck_id', selectedDeck);
      if (search) params.set('q', search);
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      params.set('sort', sort);
      params.set('order', order);
      params.set('page', String(page));
      params.set('pageSize', '50');
      const res = await authFetch(`/api/collection/grouped?${params}`);
      const data = await res.json();
      setGroups(data.groups || []);
      setIncomingMoves(data.incoming || []);
      setTotalPages(data.totalPages || 1);
    } catch {
      notifications.show({ title: 'Error', message: 'Failed to load collection', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [selectedLoc, selectedGroup, selectedDeck, search, sort, order, page, filters]);

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {});
    api.locationGroups.list().then(setLocationGroups).catch(() => {});
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  useEffect(() => {
    setPage(1);
  }, [search, sort, order, selectedLoc, selectedGroup, selectedDeck, filters]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadGroups(), 300);
  }, [search, sort, order, selectedLoc, selectedGroup, selectedDeck, page, filters]);

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [groups]);

  const toggleSort = (key: string) => {
    if (sort === key) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(key); setOrder(key === 'price' ? 'desc' : 'asc'); }
  };

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allItems = groups.flatMap(g => g.items);

  const scheduleSourceLocIds = useMemo(() => {
    const ids = new Set<number>();
    for (const key of selectedKeys) {
      const itemId = Number(key.split('-')[0]);
      const item = allItems.find(i => i.id === itemId);
      if (item) ids.add(item.locationId);
    }
    return ids;
  }, [selectedKeys, allItems]);

  const lastSelectRef = useRef<string | null>(null);

  const rowKeysOrdered = useMemo(() => groups.flatMap(g => expandItems(g.items).map(r => r.key)), [groups]);

  const handleSelect = useCallback((key: string, shift: boolean) => {
    if (shift && lastSelectRef.current) {
      const start = rowKeysOrdered.indexOf(lastSelectRef.current);
      const end = rowKeysOrdered.indexOf(key);
      if (start !== -1 && end !== -1) {
        const [lo, hi] = start <= end ? [start, end] : [end, start];
        setSelectedKeys(prev => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(rowKeysOrdered[i]);
          return next;
        });
      }
    } else {
      toggleSelect(key);
    }
    lastSelectRef.current = key;
  }, [rowKeysOrdered, toggleSelect]);

  const allSelected = rowKeysOrdered.length > 0 && rowKeysOrdered.every(k => selectedKeys.has(k));

  const handleSelectAll = () => {
    if (allSelected) setSelectedKeys(new Set());
    else setSelectedKeys(new Set(rowKeysOrdered));
  };

  const handleToggleExpandAll = () => {
    const expandableGroupNames = groups
      .filter(g => expandItems(g.items).length + (ghostByName[g.name]?.length || 0) > 1)
      .map(g => g.name);
    const allExpanded = expandableGroupNames.length > 0 && expandableGroupNames.every(n => expanded.has(n));
    if (allExpanded) setExpanded(new Set());
    else setExpanded(new Set(expandableGroupNames));
  };

  const ghostByName: Record<string, WantlistGhost[]> = {};
  for (const w of wantGhosts) {
    if (!ghostByName[w.cardName]) ghostByName[w.cardName] = [];
    ghostByName[w.cardName].push(w);
  }
  // Incoming scheduled moves: cards coming into this location, shown as ghosts
  // tagged with their source location.
  const incomingByName: Record<string, IncomingMove[]> = {};
  for (const m of incomingMoves) {
    const name = m.card?.name || 'Unknown';
    if (!incomingByName[name]) incomingByName[name] = [];
    incomingByName[name].push(m);
  }
  const serverNames = new Set(groups.map(g => g.name));
  const ghostOnlyNames = Object.keys(ghostByName).filter(n => !serverNames.has(n));
  const incomingOnlyNames = Object.keys(incomingByName).filter(n => !serverNames.has(n) && !ghostByName[n]);

  const expandableGroupNames = groups
    .filter(g => expandItems(g.items).length + (ghostByName[g.name]?.length || 0) + (incomingByName[g.name]?.length || 0) > 1)
    .map(g => g.name);
  const allExpanded = expandableGroupNames.length > 0 && expandableGroupNames.every(n => expanded.has(n));

  const handleBatchDelete = async () => {
    const byItem = new Map<number, number>();
    for (const key of selectedKeys) {
      const itemId = Number(key.split('-')[0]);
      byItem.set(itemId, (byItem.get(itemId) || 0) + 1);
    }
    let removed = 0;
    for (const [itemId, count] of byItem) {
      const item = allItems.find(i => i.id === itemId);
      if (!item) continue;
      try {
        if (count >= item.quantity) {
          await api.collection.remove(itemId);
        } else {
          await api.collection.update(itemId, { quantity: item.quantity - count } as any);
        }
        removed += count;
      } catch {}
    }
    notifications.show({ title: 'Removed', message: `${removed} card(s) removed`, color: 'green' });
    closeDeleteConfirm();
    setSelectedKeys(new Set());
    loadGroups();
  };

  const [moveSourceLocs, setMoveSourceLocs] = useState<Map<number, string>>(new Map());
  const [moveSourceLocId, setMoveSourceLocId] = useState<number | null>(null);

  const openMoveDialog = useCallback((items: CollectionItem[], perItemQty?: number) => {
    const srcLocs = new Map<number, string>();
    let commonLocId: number | null = items.length > 0 ? items[0].locationId : null;
    for (const item of items) {
      const loc = locations.find(l => l.id === item.locationId);
      if (loc) srcLocs.set(item.id, loc.name);
      if (item.locationId !== commonLocId) commonLocId = null;
    }
    setMoveSourceLocs(srcLocs);
    setMoveSourceLocId(commonLocId);
    const inbox = locations.find(l => l.name === 'Inbox' || (l as any).builtIn);
    setDestLoc(locations.length > 0 ? String(inbox?.id ?? locations[0].id) : null);
    setMoveItems(items.map(i => ({ item: i, qty: perItemQty ?? i.quantity })));
    openMove();
  }, [locations, openMove]);

  const [moveItems, setMoveItems] = useState<Array<{ item: CollectionItem; qty: number }>>([]);

  const handleMove = async () => {
    if (!destLoc || moveItems.length === 0) return;
    const destLocId = Number(destLoc);
    try {
      await api.collection.move(moveItems.map(m => ({ id: m.item.id, quantity: m.qty })), destLocId);
      closeMove();
      setSelectedKeys(new Set());
      loadGroups();
      notifications.show({ title: 'Moved', message: `${moveItems.reduce((s, m) => s + m.qty, 0)} card(s) moved`, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleMoveSelected = () => {
    const byItem = new Map<number, number>();
    for (const key of selectedKeys) {
      const itemId = Number(key.split('-')[0]);
      byItem.set(itemId, (byItem.get(itemId) || 0) + 1);
    }
    const items = allItems.filter(i => byItem.has(i.id));
    if (items.length === 0) return;
    const srcLocs = new Map<number, string>();
    let commonLocId: number | null = items[0].locationId;
    for (const item of items) {
      const loc = locations.find(l => l.id === item.locationId);
      if (loc) srcLocs.set(item.id, loc.name);
      if (item.locationId !== commonLocId) commonLocId = null;
    }
    setMoveSourceLocs(srcLocs);
    setMoveSourceLocId(commonLocId);
    const inbox = locations.find(l => l.name === 'Inbox' || (l as any).builtIn);
    setDestLoc(locations.length > 0 ? String(inbox?.id ?? locations[0].id) : null);
    setMoveItems(items.map(i => ({ item: i, qty: byItem.get(i.id) || 1 })));
    openMove();
  };

  const openDestDialog = useCallback((item: CollectionItem) => {
    setDestItem(item);
    setDestValue(item.destinationId ? String(item.destinationId) : null);
    openDest();
  }, [openDest]);

  const handleSaveDest = async () => {
    if (!destItem) return;
    const destId = destValue ? Number(destValue) : null;
    if (destItem.destinationId && destItem.destinationId !== destId) {
      setOverwriteConfirm({ mode: 'single', source: 'dest', item: destItem, destId });
      return;
    }
    await doSaveDest(destItem, destId);
  };

  const doSaveDest = async (item: CollectionItem, destId: number | null) => {
    try {
      await api.collection.splitCopy(item.id, destId);
      notifications.show({ title: 'Scheduled', message: destId ? 'Move scheduled' : 'Destination cleared', color: 'green' });
      closeDest();
      setOverwriteConfirm(null);
      loadGroups();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleScheduleSelected = async () => {
    if (!bulkDestValue) return;
    const destLocId = Number(bulkDestValue);
    const byId = new Map(allItems.map(i => [i.id, i]));
    const pendingCount = [...selectedKeys].filter(key => {
      const item = byId.get(Number(key.split('-')[0]));
      return !!item && item.destinationId != null;
    }).length;
    if (pendingCount > 0) {
      setOverwriteConfirm({ mode: 'bulk', destId: destLocId });
      return;
    }
    await doBulkSchedule(destLocId);
  };

  const doBulkSchedule = async (destLocId: number) => {
    try {
      for (const key of selectedKeys) {
        const itemId = Number(key.split('-')[0]);
        await api.collection.splitCopy(itemId, destLocId);
      }
      notifications.show({ title: 'Scheduled', message: `${selectedKeys.size} card(s) scheduled for move`, color: 'green' });
      setSelectedKeys(new Set());
      closeBulkSchedule();
      setBulkDestValue(null);
      setOverwriteConfirm(null);
      loadGroups();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openBulkScheduleDialog = () => {
    setBulkDestValue(null);
    openBulkSchedule();
  };

  const openEditDialog = useCallback((item: CollectionItem) => {
    setEditItem(item);
    setEditForm({
      quantity: item.quantity,
      foil: !!item.foil,
      condition: (item.condition || '') as Condition | '',
      purchasePrice: item.purchasePrice ? String(item.purchasePrice) : '',
      packOpened: !!item.packOpened,
      notes: item.notes || '',
    });
    openEdit();
  }, [openEdit]);

  const handleDeleteItem = useCallback((item: CollectionItem) => {
    setSelectedKeys(new Set(expandItems([item]).map(r => r.key)));
    openDeleteConfirm();
  }, [openDeleteConfirm]);

  const handleMoveOne = useCallback((item: CollectionItem) => {
    openMoveDialog([item]);
  }, [openMoveDialog]);

  const handleSaveEdit = async () => {
    if (!editItem) return;
    try {
      const destId = editDestLoc ? Number(editDestLoc) : null;
      if (editItem.destinationId && editItem.destinationId !== destId) {
        setOverwriteConfirm({ mode: 'single', source: 'edit', item: editItem, destId });
        return;
      }
      await doSaveEditDest(editItem.id, destId);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const doSaveEditDest = async (itemId: number, destId: number | null) => {
    try {
      await api.collection.update(itemId, {
        quantity: editForm.quantity,
        foil: editForm.foil ? 1 : 0,
        condition: editForm.condition || null,
        purchasePrice: editForm.purchasePrice ? parseFloat(editForm.purchasePrice) : null,
        packOpened: editForm.packOpened ? 1 : 0,
        notes: editForm.notes || null,
        destinationId: destId,
      } as any);
      notifications.show({ title: 'Updated', message: 'Item updated', color: 'green' });
      closeEdit();
      setOverwriteConfirm(null);
      loadGroups();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const sortIcon = (key: string) => {
    if (sort !== key) return '';
    return order === 'asc' ? ' ↑' : ' ↓';
  };

  const selectedInGroup = (items: CollectionItem[]) => expandItems(items).some(r => selectedKeys.has(r.key));

  const locGoal = selectedLoc ? goals.find(g => g.locationId === Number(selectedLoc)) : null;

  return (
    <>
      <Group mb="md" justify="space-between" data-tour="collection-header">
        <Title order={2}>Collection</Title>
        <Group>
          <Select
            placeholder="All locations"
            data={locations.map(l => ({ value: String(l.id), label: l.name }))}
            value={selectedLoc}
            onChange={v => { setSelectedLoc(v); setExpanded(new Set()); }}
            clearable w={180} size="sm"
          />
          <Select
            placeholder="All groups"
            data={locationGroups.map(g => ({ value: String(g.id), label: g.name }))}
            value={selectedGroup}
            onChange={v => { setSelectedGroup(v); setExpanded(new Set()); }}
            clearable w={160} size="sm"
          />
        </Group>
      </Group>

      {locGoal && (
        <Paper withBorder p="sm" mb="md" radius="md" style={{ borderColor: 'var(--mantine-color-teal-6)' }}>
          <Group justify="space-between" mb="xs" wrap="wrap">
            <Group gap="xs">
              <Text size="sm" fw={600}>{locGoal.locationName}</Text>
              <Badge size="xs" color="teal" variant="light">
                {locGoal.kind === 'set' ? `Set collection` : locGoal.kind === 'specific' ? 'Specific card' : 'Generic card'}
              </Badge>
              {locGoal.status === 'complete' && <Badge size="xs" color="green" variant="light">Complete</Badge>}
            </Group>
            <Group gap="lg">
              <Box>
                <Text fw={700} size="sm">{locGoal.targetCount != null ? `${locGoal.fulfilledCount}/${locGoal.targetCount}` : 'Perpetual'}</Text>
                <Text size="10px" c="dimmed">{locGoal.kind === 'set' ? 'cards collected' : 'copies collected'}</Text>
              </Box>
              <Box>
                <Text fw={700} size="sm">{locGoal.remaining}</Text>
                <Text size="10px" c="dimmed">to go</Text>
              </Box>
              <Box>
                <Text fw={700} size="sm">${locGoal.remainingCost.toFixed(2)}</Text>
                <Text size="10px" c="dimmed">cost to complete</Text>
              </Box>
            </Group>
          </Group>
          <Progress value={locGoal.percent} size="md" color="teal" />
          <Group justify="space-between" mt={4}>
            <Text size="xs" c="dimmed">{locGoal.percent}% complete</Text>
            {locGoal.setCodes && <Text size="xs" c="dimmed">Sets: {locGoal.setCodes.split(',').map(c => c.toUpperCase()).join(', ')}</Text>}
          </Group>
        </Paper>
      )}

      <TextInput
        mb="md"
        placeholder="Search cards..."
        value={search}
        onChange={e => {
          setSearch(e.currentTarget.value);
          if (debounceRef.current) clearTimeout(debounceRef.current);
        }}
        leftSection={<IconSearch size={16} />}
        size="sm"
      />

      <Group mb="sm" gap="xs">
        <Button size="compact-sm" variant={showFilters ? 'filled' : 'light'} onClick={() => setShowFilters(!showFilters)} leftSection={<IconFilter size={14} />}>
          Filters {Object.keys(filters).length > 0 ? `(${Object.keys(filters).length})` : ''}
        </Button>
        <Button size="compact-sm" variant="light" color={allSelected ? 'red' : 'blue'} leftSection={<Checkbox size="xs" checked={allSelected} readOnly />}
          onClick={handleSelectAll}>
          {allSelected ? 'Deselect All' : 'Select All'}
        </Button>
        <Button size="compact-sm" variant="light" color="gray" leftSection={allExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          onClick={handleToggleExpandAll}>
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </Button>
        {Object.keys(filters).length > 0 && (
          <Button size="compact-sm" variant="subtle" color="gray" onClick={() => { setFilters({}); }}>
            Clear
          </Button>
        )}
      </Group>

      <Collapse in={showFilters}>
        <Paper withBorder p="sm" mb="sm" radius="md">
          <Text size="xs" fw={600} mb={4}>Colors</Text>
          <Group gap={4} mb="sm">
            {['W','U','B','R','G','C'].map(c => {
              const key = `c_${c}`;
              const val = filters[key];
              const isInc = val === 'include';
              const isExc = val === 'exclude';
              return (
                <Box key={c}
                  onClick={() => {
                    const next = isInc ? 'exclude' : isExc ? undefined : 'include';
                    setFilters(f => { const n = { ...f }; if (next) n[key] = next; else delete n[key]; return n; });
                  }}
                  style={{ cursor: 'pointer', lineHeight: 0, borderRadius: '50%', border: isExc ? '3px solid #cc0000' : isInc ? '2px solid var(--mantine-color-blue-5)' : '2px solid transparent', opacity: isExc ? 0.3 : isInc ? 1 : 0.5 }}
                >
                  <Image
                    src={`https://svgs.scryfall.io/card-symbols/${c}.svg`}
                    w={28} h={28} fit="contain"
                    fallbackSrc={`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Crect fill='%23ccc' width='28' height='28' rx='14'/%3E%3Ctext x='14' y='20' text-anchor='middle' font-size='16' font-weight='bold' fill='%23666'%3E${encodeURIComponent(c)}%3C/text%3E%3C/svg%3E`}
                  />
                </Box>
              );
            })}
          </Group>
          <Group gap="sm" mb="sm" align="flex-end">
            <div>
              <Text size="xs" fw={600} mb={2}>CMC Min</Text>
              <NumberInput value={filters.cmcMin ?? ''} onChange={v => setFilters(f => { const n = { ...f }; if (v !== '' && v !== null) n.cmcMin = String(v); else delete n.cmcMin; return n; })} min={0} max={20} w={70} size="xs" />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2}>CMC Max</Text>
              <NumberInput value={filters.cmcMax ?? ''} onChange={v => setFilters(f => { const n = { ...f }; if (v !== '' && v !== null) n.cmcMax = String(v); else delete n.cmcMax; return n; })} min={0} max={20} w={70} size="xs" />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2}>Value Min ($)</Text>
              <NumberInput value={filters.valueMin ?? ''} onChange={v => setFilters(f => { const n = { ...f }; if (v !== '' && v !== null) n.valueMin = String(v); else delete n.valueMin; return n; })} min={0} w={80} size="xs" decimalScale={2} />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2}>Value Max ($)</Text>
              <NumberInput value={filters.valueMax ?? ''} onChange={v => setFilters(f => { const n = { ...f }; if (v !== '' && v !== null) n.valueMax = String(v); else delete n.valueMax; return n; })} min={0} w={80} size="xs" decimalScale={2} />
            </div>
          </Group>
          <Group gap="sm" mb="sm" align="flex-end">
            <div>
              <Text size="xs" fw={600} mb={2}>Rarity</Text>
              <Group gap={4}>
                {[['common','Common'],['uncommon','Uncommon'],['rare','Rare'],['mythic','Mythic'],['special','Special']].map(([k,label]) => {
                  const active = (filters.rarity || '').split(',').includes(k);
                  return (
                    <Badge key={k} size="sm" variant={active ? 'filled' : 'outline'} color={active ? 'blue' : 'gray'}
                      style={{ cursor: 'pointer', textTransform: 'none' }}
                      onClick={() => setFilters(f => {
                        const n = { ...f };
                        const current = (n.rarity || '').split(',').filter(Boolean);
                        if (current.includes(k)) { const next = current.filter(x => x !== k); if (next.length) n.rarity = next.join(','); else delete n.rarity; }
                        else { current.push(k); n.rarity = current.join(','); }
                        return n;
                      })}
                    >{label}</Badge>
                  );
                })}
              </Group>
            </div>
            <div>
              <Text size="xs" fw={600} mb={2}>Condition</Text>
              <Group gap={4}>
                {['M','NM','LP','MP','HP','Dmg'].map(cond => {
                  const active = (filters.condition || '').split(',').includes(cond);
                  return (
                    <Badge key={cond} size="sm" variant={active ? 'filled' : 'outline'} color={active ? 'blue' : 'gray'}
                      style={{ cursor: 'pointer', textTransform: 'none' }}
                      onClick={() => setFilters(f => {
                        const n = { ...f };
                        const current = (n.condition || '').split(',').filter(Boolean);
                        if (current.includes(cond)) { const next = current.filter(x => x !== cond); if (next.length) n.condition = next.join(','); else delete n.condition; }
                        else { current.push(cond); n.condition = current.join(','); }
                        return n;
                      })}
                    >{cond}</Badge>
                  );
                })}
              </Group>
            </div>
            <Switch size="xs" label="Foil only" checked={filters.foil === '1'}
              onChange={e => { const v = e.currentTarget.checked; setFilters(f => { const n = { ...f }; if (v) n.foil = '1'; else delete n.foil; return n; }); }} />
          </Group>
        </Paper>
      </Collapse>

      {selectedDeck && (
        <Group mb="md" gap="xs">
          <Badge size="lg" variant="filled" color="blue" rightSection={
            <ActionIcon size="xs" color="blue" variant="filled" onClick={() => { setSelectedDeck(null); setExpanded(new Set()); }}>
              ✕
            </ActionIcon>
          }>
            Deck: #{selectedDeck}
          </Badge>
        </Group>
      )}

      <Paper
        withBorder={selectedKeys.size > 0}
        p="sm" mb="md" radius="md"
        bg={selectedKeys.size > 0 ? 'var(--mantine-color-blue-0)' : 'transparent'}
        style={selectedKeys.size > 0 ? undefined : { borderColor: 'transparent', minHeight: 48 }}
      >
        <Group justify="space-between" style={{ minHeight: 32 }}>
          <Text size="sm" fw={500} style={{ visibility: selectedKeys.size > 0 ? 'visible' : 'hidden' }}>
            {selectedKeys.size} card(s) selected
          </Text>
          <Group gap="sm" style={{ visibility: selectedKeys.size > 0 ? 'visible' : 'hidden' }}>
            <Button size="compact-sm" variant="light" color="teal"
              onClick={openBulkScheduleDialog}
              leftSection={<IconMapPin size={14} />}
            >
              Schedule Move
            </Button>
            <Button size="compact-sm" variant="light" color="blue"
              onClick={handleMoveSelected}
              leftSection={<IconArrowRight size={14} />}
            >
              Move Selected
            </Button>
            <Button size="compact-sm" variant="light" color="red"
              onClick={openDeleteConfirm}
              leftSection={<IconTrash size={14} />}
            >
              Delete Selected
            </Button>
            <Button size="compact-sm" variant="subtle" color="gray"
              onClick={() => setSelectedKeys(new Set())}
            >
              Clear
            </Button>
          </Group>
        </Group>
      </Paper>

      <Box pos="relative">
        {loading && groups.length === 0 && (
          <Stack gap={0}>
            {[1,2,3,4,5].map(i => (
              <Box key={i}>
                <Paper withBorder radius={0} p="sm" bg="var(--mantine-color-default-hover)">
                  <Group gap="sm">
                    <Skeleton w={16} h={16} />
                    <Skeleton w={20} h={20} circle />
                    <div style={{ flex: 1 }}>
                      <Skeleton h={14} w="40%" mb={4} />
                      <Skeleton h={11} w="25%" />
                    </div>
                    <Skeleton h={14} w={60} />
                  </Group>
                </Paper>
                {[1,2].map(j => (
                  <Paper key={j} withBorder radius={0} p="sm">
                    <Group gap="sm" wrap="nowrap">
                      <Skeleton w={22} h={22} />
                      <Skeleton w={32} h={45} />
                      <div style={{ flex: 1 }}>
                        <Skeleton h={14} w="35%" mb={4} />
                        <Skeleton h={11} w="20%" />
                      </div>
                      <Skeleton h={14} w={80} />
                      <Skeleton h={14} w={40} />
                      <Skeleton h={14} w={50} />
                      <Skeleton h={14} w={46} />
                      <Skeleton h={14} w={40} />
                      <Skeleton h={14} w={70} />
                      <Skeleton h={14} w={40} />
                      <Skeleton h={14} w={80} />
                    </Group>
                  </Paper>
                ))}
              </Box>
            ))}
          </Stack>
        )}

        {!loading && groups.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">No cards in collection</Text>
        )}

        {groups.length > 0 && (
          <Paper withBorder mb={0} radius={0} style={{ overflow: 'hidden' }}>
            <Group p="sm" gap="sm" wrap="nowrap" bg="var(--mantine-color-default-hover)">
              <Box w={22} />
              <Box w={32} />
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text size="xs" fw={600} style={{ cursor: 'pointer' }} onClick={() => toggleSort('name')}>
                  Name{sortIcon('name')}
                </Text>
              </Box>
              <Text size="xs" fw={600} w={70} style={{ cursor: 'pointer' }} onClick={() => toggleSort('set')}>
                Set{sortIcon('set')}
              </Text>
              <Text size="xs" fw={600} w={40}>#</Text>
              <Text size="xs" fw={600} w={46} style={{ cursor: 'pointer' }} onClick={() => toggleSort('foil')}>
                Foil{sortIcon('foil')}
              </Text>
              <Text size="xs" fw={600} w={40} style={{ cursor: 'pointer' }} onClick={() => toggleSort('cond')}>
                Cond{sortIcon('cond')}
              </Text>
              <Text size="xs" fw={600} w={60} style={{ cursor: 'pointer' }} onClick={() => toggleSort('price')}>
                Cost{sortIcon('price')}
              </Text>
              <Text size="xs" fw={600} w={60}>Value</Text>
              <Text size="xs" fw={600} w={110}>Loc</Text>
              <Text size="xs" fw={600} w={80}>Dest</Text>
              <Text size="xs" fw={600} w={80}>Notes</Text>
              <Text size="xs" fw={600} w={40}>Pack</Text>
              <Box w={86} />
            </Group>
          </Paper>
        )}

        {groups.map(group => {
          const rows = expandItems(group.items);
          const ghosts = ghostByName[group.name] || [];
          const incoming = incomingByName[group.name] || [];

          if (rows.length + ghosts.length + incoming.length === 1) {
            if (rows.length === 1) {
              const row = rows[0];
              return (
                <CardGroup key={group.name} card={group} name={group.name} manaCost={group.manaCost} typeLine={group.typeLine}
                  isSingle expanded={false} onToggle={() => {}}
                >
                  <Group p="sm" gap="sm" wrap="nowrap" bg={selectedKeys.has(row.key) ? 'var(--mantine-color-blue-0)' : undefined}>
                    <ItemRow row={row} selected={selectedKeys.has(row.key)} locations={locations}
                      onToggle={handleSelect} onEdit={openEditDialog} onMove={handleMoveOne}
                      onOpenDest={openDestDialog} onDelete={handleDeleteItem} />
                  </Group>
                  {incoming.map(m => (
                    <IncomingMoveRow key={`incoming-${m.id}`} m={m} locations={locations} />
                  ))}
                </CardGroup>
              );
            }
            const ghost = ghosts[0];
            return (
              <CardGroup key={group.name} card={group} name={group.name} manaCost={group.manaCost} typeLine={group.typeLine}
                isSingle expanded={false} onToggle={() => {}}
                thumb={<GhostThumb name={ghost.cardName} cardId={ghost.cardId} />}
              >
                <GhostRow w={ghost} locations={locations} hasInternal={collectionNames.has(ghost.cardName)} onDone={() => loadWantGhosts(ghostPage)} currentLocationId={selectedLoc ? Number(selectedLoc) : null} />
                {incoming.map(m => (
                  <IncomingMoveRow key={`incoming-${m.id}`} m={m} locations={locations} />
                ))}
              </CardGroup>
            );
          }

          const isExpanded = ghosts.length > 0 || incoming.length > 0 ? true : expanded.has(group.name);
          return (
            <CardGroup key={group.name} card={group} name={group.name} manaCost={group.manaCost} typeLine={group.typeLine}
              isSingle={false} expanded={isExpanded} onToggle={() => toggleExpand(group.name)}
              rightSection={
                <Group gap="md">
                  <Badge size="sm" variant="light" color="gray"><NumberFormatter value={group.totalQty} /> cards</Badge>
                  <Badge size="sm" variant="light" color="gray">
                    <NumberFormatter value={group.totalValue} prefix="$" decimalScale={2} fixedDecimalScale />
                  </Badge>
                  {ghosts.length > 0 && <Badge size="sm" variant="light" color="teal">{ghosts.length} wanted</Badge>}
                  {incoming.length > 0 && <Badge size="sm" variant="light" color="violet">{incoming.length} incoming</Badge>}
                  {selectedInGroup(group.items) && (
                    <Badge size="sm" variant="filled" color="blue">{rows.filter(r => selectedKeys.has(r.key)).length} selected</Badge>
                  )}
                </Group>
              }
            >
              <Box px="sm" pb="xs" style={{ background: 'var(--mantine-color-default)', borderLeft: '3px solid var(--mantine-color-gray-5)', paddingLeft: 'calc(var(--mantine-spacing-sm) + 6px)' }}>
                <Group gap="sm" wrap="nowrap" bg="var(--mantine-color-default-hover)" p="sm">
                  <Box w={22} />
                  <Box w={32} />
                  <Text size="xs" fw={600} style={{ flex: 1 }}>Name</Text>
                  <Text size="xs" fw={600} w={70}>Set</Text>
                  <Text size="xs" fw={600} w={40}>#</Text>
                  <Text size="xs" fw={600} w={46}>Foil</Text>
                  <Text size="xs" fw={600} w={40}>Cond</Text>
                  <Text size="xs" fw={600} w={60}>Cost</Text>
                  <Text size="xs" fw={600} w={60}>Value</Text>
                  <Text size="xs" fw={600} w={110}>Loc</Text>
                  <Text size="xs" fw={600} w={80}>Dest</Text>
                  <Text size="xs" fw={600} w={80}>Notes</Text>
                  <Text size="xs" fw={600} w={40}>Pack</Text>
                  <Box w={86} />
                </Group>
                {rows.map((row, idx) => (
                  <Group key={row.key} p="sm" gap="sm" wrap="nowrap"
                    bg={selectedKeys.has(row.key) ? 'var(--mantine-color-blue-0)' : idx % 2 === 1 ? 'var(--mantine-color-default-hover)' : undefined}
                  >
                    <ItemRow row={row} selected={selectedKeys.has(row.key)} locations={locations}
                      onToggle={handleSelect} onEdit={openEditDialog} onMove={handleMoveOne}
                      onOpenDest={openDestDialog} onDelete={handleDeleteItem} />
                  </Group>
                ))}
                {ghosts.map(w => (
                  <GhostRow key={`ghost-${w.id}`} w={w} locations={locations}
                    hasInternal={collectionNames.has(w.cardName)}
                    onDone={() => loadWantGhosts(ghostPage)} currentLocationId={selectedLoc ? Number(selectedLoc) : null} />
                ))}
                {incoming.map(m => (
                  <IncomingMoveRow key={`incoming-${m.id}`} m={m} locations={locations} />
                ))}
              </Box>
            </CardGroup>
          );
        })}

        {ghostOnlyNames.length > 0 && (
          <Group mt="lg" mb="sm" gap="xs">
            <Badge size="sm" color="teal" variant="light">Wantlist</Badge>
            <Text size="sm" c="dimmed">Cards wanted in this location</Text>
          </Group>
        )}

        {ghostOnlyNames.map(name => {
          const ghosts = ghostByName[name];
          const rep = ghosts[0];
          if (ghosts.length === 1) {
            return (
              <CardGroup key={`ghost-${name}`} card={{} as CollectionGroup} name={name} manaCost={null} typeLine={null}
                isSingle expanded={false} onToggle={() => {}}
                thumb={<GhostThumb name={name} cardId={rep.cardId} />}
              >
                <GhostRow w={ghosts[0]} locations={locations} hasInternal={collectionNames.has(name)} onDone={() => loadWantGhosts(ghostPage)} currentLocationId={selectedLoc ? Number(selectedLoc) : null} />
              </CardGroup>
            );
          }
          return (
            <CardGroup key={`ghost-${name}`} card={{} as CollectionGroup} name={name} manaCost={null} typeLine={null}
              isSingle={false} expanded onToggle={() => {}}
              thumb={<GhostThumb name={name} cardId={rep.cardId} />}
              rightSection={<Badge size="sm" variant="light" color="teal">Wantlist</Badge>}
              style={{ opacity: 0.7 }}
            >
              <Box px="sm" pb="xs">
                {ghosts.map(w => (
                  <GhostRow key={`ghost-${w.id}`} w={w} locations={locations}
                    hasInternal={collectionNames.has(name)}
                    onDone={() => loadWantGhosts(ghostPage)} currentLocationId={selectedLoc ? Number(selectedLoc) : null} />
                ))}
              </Box>
            </CardGroup>
          );
        })}

        {ghostLoading && <Text size="xs" c="dimmed" ta="center" py="sm">Loading wanted cards...</Text>}
        {ghostTotalPages > 1 && (
          <Group justify="center" mt="md">
            <Pagination total={ghostTotalPages} value={ghostPage} onChange={p => { setGhostPage(p); loadWantGhosts(p); }} size="sm" />
          </Group>
        )}

        {incomingOnlyNames.length > 0 && (
          <>
            <Group mt="lg" mb="sm" gap="xs">
              <Badge size="sm" color="violet" variant="light">Scheduled moves</Badge>
              <Text size="sm" c="dimmed">Cards on their way to this location</Text>
            </Group>
            {incomingOnlyNames.map(name => {
              const moves = incomingByName[name];
              const rep = moves[0];
              const thumb = <GhostThumb name={name} cardId={rep.cardId} />;
              if (moves.length === 1) {
                return (
                  <CardGroup key={`incoming-${name}`} card={{} as CollectionGroup} name={name} manaCost={null} typeLine={null}
                    isSingle expanded={false} onToggle={() => {}}
                    thumb={thumb}
                  >
                    <IncomingMoveRow m={moves[0]} locations={locations} />
                  </CardGroup>
                );
              }
              return (
                <CardGroup key={`incoming-${name}`} card={{} as CollectionGroup} name={name} manaCost={null} typeLine={null}
                  isSingle={false} expanded onToggle={() => {}}
                  thumb={thumb}
                  rightSection={<Badge size="sm" variant="light" color="violet">{moves.length} incoming</Badge>}
                  style={{ opacity: 0.7 }}
                >
                  <Box px="sm" pb="xs">
                    {moves.map(m => (
                      <IncomingMoveRow key={`incoming-${m.id}`} m={m} locations={locations} />
                    ))}
                  </Box>
                </CardGroup>
              );
            })}
          </>
        )}

        {totalPages > 1 && (
          <Group justify="center" mt="md">
            <Pagination total={totalPages} value={page} onChange={setPage} size="sm" />
          </Group>
        )}
      </Box>

      <Modal opened={moveOpened} onClose={closeMove} title={`Move ${moveItems.reduce((s, m) => s + m.qty, 0)} card(s)`} size="sm" centered>
        {moveItems.length > 0 && (
          <Box mb="md">
            {moveSourceLocs.size > 0 && (
              <Group gap="xs" mb="xs">
                <Text size="sm" c="dimmed">From:</Text>
                {moveItems.slice(0, 3).map(m => (
                  <Badge key={m.item.id} size="sm" variant="light" color="gray">
                    {moveSourceLocs.get(m.item.id) || `Location #${m.item.locationId}`}
                  </Badge>
                ))}
                {moveItems.length > 3 && <Text size="xs" c="dimmed">+{moveItems.length - 3} more</Text>}
              </Group>
            )}
            <Group gap="xs">
              <Text size="sm" c="dimmed">To:</Text>
              <Select
                placeholder="Destination location"
                data={locations
                  .filter(l => moveSourceLocId === null || l.id !== moveSourceLocId)
                  .map(l => ({ value: String(l.id), label: l.name }))}
                value={destLoc} onChange={setDestLoc}
                size="xs" w={200}
              />
            </Group>
          </Box>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={closeMove}>Cancel</Button>
          <Button onClick={handleMove}>Move</Button>
        </Group>
      </Modal>

      <Modal opened={destOpened} onClose={closeDest} title={`Schedule Move — ${destItem?.card.name || ''}`} size="sm" centered>
        <Text size="xs" c="dimmed" mb="sm">
          Current location: <b>{locations.find(l => l.id === destItem?.locationId)?.name || '-'}</b>
        </Text>
        <Select label="Destination" placeholder="No destination" clearable
          data={locations.filter(l => l.id !== destItem?.locationId).map(l => ({ value: String(l.id), label: l.name }))}
          value={destValue} onChange={setDestValue} mb="md" searchable size="sm"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={closeDest}>Cancel</Button>
          <Button onClick={handleSaveDest}>Save</Button>
        </Group>
      </Modal>

      <Modal opened={bulkScheduleOpened} onClose={closeBulkSchedule} title={`Schedule Move — ${selectedKeys.size} card(s)`} size="sm" centered>
        <Select label="Destination" placeholder="Select destination" clearable searchable
          data={locations.filter(l => !scheduleSourceLocIds.has(l.id)).map(l => ({ value: String(l.id), label: l.name }))}
          value={bulkDestValue} onChange={setBulkDestValue} mb="md"
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={closeBulkSchedule}>Cancel</Button>
          <Button color="teal" onClick={handleScheduleSelected} disabled={!bulkDestValue}>Schedule</Button>
        </Group>
      </Modal>

      <Modal opened={overwriteConfirm !== null} onClose={() => setOverwriteConfirm(null)} title="Pending Move Detected" size="sm" centered>
        <Text size="sm" mb="md">
          {overwriteConfirm?.mode === 'single'
            ? `${overwriteConfirm.item.card.name} already has a scheduled move. Overwrite it with the new destination?`
            : 'Some selected card(s) already have a scheduled move. Overwrite them with the new destination?'}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setOverwriteConfirm(null)}>Cancel</Button>
          <Button color="red" onClick={() => {
            if (overwriteConfirm?.mode === 'single' && overwriteConfirm.source === 'dest') {
              doSaveDest(overwriteConfirm.item, overwriteConfirm.destId);
            } else if (overwriteConfirm?.mode === 'single' && overwriteConfirm.source === 'edit') {
              doSaveEditDest(overwriteConfirm.item.id, overwriteConfirm.destId);
            } else if (overwriteConfirm?.mode === 'bulk') {
              doBulkSchedule(overwriteConfirm.destId);
            }
          }}>Overwrite</Button>
        </Group>
      </Modal>

      <Modal opened={editOpened} onClose={closeEdit} title={`Edit ${editItem?.card.name || ''}`} size="sm" centered>
        {editItem && (
          <Box>
            <NumberInput label="Quantity" value={editForm.quantity} onChange={v => setEditForm(f => ({ ...f, quantity: Number(v) || 1 }))} min={1} max={999} mb="sm" />
            <Switch label="Foil" checked={editForm.foil} onChange={e => { const v = e.currentTarget.checked; setEditForm(f => ({ ...f, foil: v })); }} mb="sm" />
            <Box mb="sm">
              <Text size="sm" fw={500} mb={4}>Condition</Text>
              <SegmentedControl value={editForm.condition} onChange={v => setEditForm(f => ({ ...f, condition: v as Condition }))}
                data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs" fullWidth={false}
                styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[editForm.condition] || '#00897b' } }} />
            </Box>
            <TextInput label="Purchase Price ($)" value={editForm.purchasePrice} onChange={e => { const v = e.currentTarget.value; setEditForm(f => ({ ...f, purchasePrice: v })); }} mb="sm" />
            <Switch label="Pack Opened" checked={editForm.packOpened} onChange={e => { const v = e.currentTarget.checked; setEditForm(f => ({ ...f, packOpened: v })); }} mb="sm" />
            <TextInput label="Notes" value={editForm.notes} onChange={e => { const v = e.currentTarget.value; setEditForm(f => ({ ...f, notes: v })); }} mb="sm" />
            <Select label="Destination (optional)" placeholder="No destination" clearable
              data={locations.map(l => ({ value: String(l.id), label: l.name }))}
              value={editDestLoc} onChange={setEditDestLoc} mb="md" size="sm" />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeEdit}>Cancel</Button>
              <Button onClick={handleSaveEdit}>Save</Button>
            </Group>
          </Box>
        )}
      </Modal>

      <Modal opened={deleteConfirmOpened} onClose={closeDeleteConfirm} title="Delete cards" size="sm" centered>
        <Text size="sm" mb="md">Delete {selectedKeys.size} card(s)? This cannot be undone.</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeDeleteConfirm}>Cancel</Button>
          <Button color="red" onClick={handleBatchDelete}>Delete</Button>
        </Group>
      </Modal>

    </>
  );
}
