import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Title, Group, Text, Paper, Badge, Button, TextInput, NumberInput, Textarea,
  Box, ActionIcon, Modal, ScrollArea, Select, Alert,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconTrash, IconSearch, IconHistory, IconPlus, IconRotate, IconRotateClockwise, IconAlertTriangle } from '@tabler/icons-react';
import { api, authFetch } from '../api/client';
import type { ScryfallCard, Location } from '../types';
import { CardThumb, SetSymbol } from '../components/CardDisplay';
import {
  useTradeBuilder, getBuilder, patchActiveTrade, clearActiveTrade, setShowHistory, setSelectedLoc,
  type TradeItem, type Trade,
} from '../stores/tradeBuilder';

let tempIdCounter = 0;
function nextTempId() { return `tmp_${++tempIdCounter}`; }

function SidePanel({ side, items, onAdd, onRemove, onUpdate, cash, onCashChange, sideLabel,
  tradeQtyByCardId, locations, selectedLoc, onLocChange }: {
  side: string; items: TradeItem[]; onAdd: (item: TradeItem) => void;
  onRemove: (id: string) => void; onUpdate: (id: string, updates: Partial<TradeItem>) => void;
  cash: number; onCashChange: (v: number) => void;
  sideLabel: string;
  tradeQtyByCardId: Map<string, number>;
  locations: Location[];
  selectedLoc: string | null;
  onLocChange: (v: string | null) => void;
}) {
  const [addOpened, { open: openAdd, close: closeAdd }] = useDisclosure(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(ScryfallCard & { ownedQty?: number })[]>([]);
  const [ownedByCardId, setOwnedByCardId] = useState<Map<string, number>>(new Map());
  const total = items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);

  const fetchCollection = async (searchQuery: string) => {
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim().length >= 2) params.set('q', searchQuery);
      if (selectedLoc) params.set('location_id', selectedLoc);
      if (!params.has('q') && !params.has('location_id')) { setResults([]); return; }
      params.set('pageSize', '20');
      const res = await authFetch(`/api/collection/grouped?${params}`);
      const data = await res.json();
      const qtyMap = new Map<string, number>();
      const mapped: (ScryfallCard & { ownedQty?: number; locationId?: number })[] = (data.groups || []).flatMap((g: any) =>
        (g.items || []).map((i: any) => {
          const id = i.cardId;
          qtyMap.set(id, (qtyMap.get(id) || 0) + (i.quantity || 0));
          return {
            id, name: i.card.name, setName: i.card.setName,
            setCode: i.card.setCode, collectorNumber: i.card.collectorNumber,
            prices: i.card.prices, imageUris: i.card.imageUris, ownedQty: i.quantity,
            foil: i.foil, locationId: i.locationId,
          } as ScryfallCard & { ownedQty?: number; foil?: number; locationId?: number };
        }));
      setOwnedByCardId(qtyMap);
      setResults(mapped);
    } catch { setResults([]); }
  };

  useEffect(() => {
    if (side === 'yours') {
      if (q.trim().length >= 2) {
        const timeout = setTimeout(() => fetchCollection(q), 300);
        return () => clearTimeout(timeout);
      } else if (selectedLoc) {
        fetchCollection('');
      } else {
        setResults([]);
      }
    } else {
      if (q.trim().length < 2) { setResults([]); return; }
      const timeout = setTimeout(async () => {
        try {
          const res = await api.cards.find(q);
          setResults(res.slice(0, 15) as unknown as ScryfallCard[]);
        } catch { setResults([]); }
      }, 300);
      return () => clearTimeout(timeout);
    }
  }, [q, selectedLoc, side]);

  const handleSelect = (c: ScryfallCard & { foil?: number; locationId?: number }) => {
    const isFoil = c.foil || 0;
    const autoPrice = parseFloat(isFoil ? (c.prices?.usd_foil || '0') : (c.prices?.usd || '0')) || null;
    onAdd({
      tempId: nextTempId(), side, cardId: c.id, cardName: c.name,
      setCode: c.setCode, collectorNumber: c.collectorNumber,
      quantity: 1, foil: isFoil, price: autoPrice,
      imageUris: c.imageUris, prices: c.prices,
      locationId: (c as any).locationId ?? undefined,
    });
    closeAdd();
    setQ('');
    setResults([]);
  };

  const isYours = side === 'yours';
  const itemSlots = [...items, null] as (TradeItem | null)[];

  return (
    <>
      <Paper withBorder p="sm" radius="md" style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} size="sm" mb="sm">{sideLabel}</Text>
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {itemSlots.map((item, idx) => (
            item ? (
              <Paper key={item.tempId} withBorder p={4} radius="sm">
                <Box style={{ aspectRatio: '5/7', overflow: 'hidden', borderRadius: 4, position: 'relative', background: '#1a1a2e' }}>
                  {item.imageUris ? (
                    <img src={item.imageUris.small || item.imageUris.art_crop || ''}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                  ) : (
                    <Box style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Text size="xs" c="dimmed" style={{ fontSize: 24 }}>?</Text>
                    </Box>
                  )}
                </Box>
                <Text size="xs" fw={500} lineClamp={1} ta="center" mt={2}>{item.cardName}</Text>
                <Text size="xs" ta="center" c="dimmed">{item.setCode?.toUpperCase()} #{item.collectorNumber}{item.foil ? ' ✦' : ''}</Text>
                <Group gap={2} justify="center" mt={2}>
                  <NumberInput value={item.quantity}
                    onChange={v => {
                      const newQty = Number(v) || 1;
                      if (isYours && item.cardId) {
                        const owned = ownedByCardId.get(item.cardId) || 0;
                        const clamped = Math.min(newQty, owned);
                        onUpdate(item.tempId, { quantity: clamped });
                      } else {
                        onUpdate(item.tempId, { quantity: newQty });
                      }
                    }}
                    min={1} max={isYours && item.cardId ? (ownedByCardId.get(item.cardId) || 999) : 999} w={40} size="xs" />
                  <TextInput value={item.price !== null ? String(item.price) : ''} onChange={e => onUpdate(item.tempId, { price: e.currentTarget.value ? parseFloat(e.currentTarget.value) : null })}
                    placeholder={item.prices ? parseFloat(item.foil ? (item.prices.usd_foil || '0') : (item.prices.usd || '0')).toFixed(2) : '0'}
                    w={56} size="xs" leftSection={<Text size="xs" c="dimmed">$</Text>} />
                  <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onRemove(item.tempId)}><IconTrash size={12} /></ActionIcon>
                </Group>
                {!isYours && (
                  <Group gap={4} justify="center" mt={2} align="flex-end" wrap="nowrap">
                    <div>
                      <Text size="9px" c="dimmed" ta="center" mb={2}>Location</Text>
                      <Select
                        size="xs"
                        w={76}
                        data={[{ value: '', label: 'Default' }, ...locations.map(l => ({ value: String(l.id), label: l.name }))]}
                        value={item.locationId ? String(item.locationId) : ''}
                        onChange={v => onUpdate(item.tempId, { locationId: v ? Number(v) : null })}
                        styles={{ input: { fontSize: 11, minHeight: 24, height: 24 } }}
                      />
                    </div>
                    <div>
                      <Text size="9px" c="dimmed" ta="center" mb={2}>Destination</Text>
                      <Select
                        size="xs"
                        w={76}
                        data={[{ value: '', label: 'Default' }, ...locations.map(l => ({ value: String(l.id), label: l.name }))]}
                        value={item.destinationId ? String(item.destinationId) : ''}
                        onChange={v => onUpdate(item.tempId, { destinationId: v ? Number(v) : null })}
                        styles={{ input: { fontSize: 11, minHeight: 24, height: 24 } }}
                      />
                    </div>
                  </Group>
                )}
              </Paper>
            ) : (
              <Paper key={`empty-${idx}`} withBorder p="md" radius="sm" style={{ cursor: 'pointer', aspectRatio: '5/7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => { setQ(''); setResults([]); openAdd(); }}>
                <IconPlus size={32} opacity={0.3} />
              </Paper>
            )
          ))}
        </Box>

        <Group justify="space-between" mt="sm">
          <Group gap={4}>
            <Text size="xs" c="dimmed">Cash:</Text>
            <NumberInput value={cash} onChange={v => onCashChange(typeof v === 'number' ? v : 0)} min={0} w={90} size="xs"
              decimalScale={2} leftSection={<Text size="xs" c="dimmed">$</Text>} />
          </Group>
          <Text size="sm" fw={600}>Total: ${(total + cash).toFixed(2)}</Text>
        </Group>
      </Paper>

      <Modal opened={addOpened} onClose={closeAdd} title={`Add Card to ${sideLabel}`} size="md" centered>
        {isYours && (
          <Select placeholder="Filter by location" clearable data={locations.map(l => ({ value: String(l.id), label: l.name }))}
            value={selectedLoc} onChange={v => onLocChange(v)} mb="sm" size="sm" />
        )}
        <TextInput placeholder={isYours ? 'Search your collection...' : 'Search any card...'} value={q}
          onChange={e => setQ(e.currentTarget.value)} leftSection={<IconSearch size={14} />} mb="sm" autoFocus />
        <ScrollArea h={350}>
          {results.length === 0 && q.trim().length >= 2 && (
            <Text c="dimmed" ta="center" py="xl">No cards found</Text>
          )}
          {results.map(c => {
            const inTrade = tradeQtyByCardId.get(c.id) || 0;
            const totalOwned = isYours ? ((c as any).ownedQty || 0) : 999;
            const available = totalOwned - inTrade;
            const disabled = isYours && available <= 0;
            return (
              <Group key={c.id} p="xs" gap="sm" wrap="nowrap" style={{ cursor: disabled ? 'default' : 'pointer', borderRadius: 4, opacity: disabled ? 0.4 : 1 }}
                onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--mantine-color-default-hover)'; }}
                onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = ''; }}
                onClick={() => { if (!disabled) handleSelect(c); }}
              >
                <Box w={32} h={45}><CardThumb card={c} /></Box>
                <div style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>{c.name}</Text>
                  <Group gap={4}>
                    <SetSymbol code={c.setCode} name={c.setName} size={12} />
                    <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                  </Group>
                </div>
                {disabled ? (
                  <Badge size="xs" color="gray" variant="light">Already in trade</Badge>
                ) : (
                  <Badge size="xs" variant="light">${parseFloat(c.prices?.usd || '0').toFixed(2)}</Badge>
                )}
              </Group>
            );
          })}
        </ScrollArea>
      </Modal>
    </>
  );
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const { activeTrade, showHistory, selectedLoc } = useTradeBuilder();
  const [resetOpen, { open: openReset, close: closeReset }] = useDisclosure(false);
  const [searchParams] = useSearchParams();

  const loadTrades = async () => {
    try {
      const data = await api.trades.list();
      setTrades(data);
      return data;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    loadTrades();
    api.locations.list().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    const tradeParam = searchParams.get('trade');
    if (!tradeParam) return;
    loadTrades().then(data => {
      const t = data.find(x => String(x.id) === tradeParam);
      if (t) loadTrade(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const addItem = (_side: string, item: TradeItem) => {
    patchActiveTrade({ items: [...activeTrade.items, { ...item }] });
  };

  const removeItem = (tempId: string) => {
    const item = activeTrade.items.find(i => i.tempId === tempId);
    if (!item) return;
    patchActiveTrade({ items: activeTrade.items.filter(i => i.tempId !== tempId) });
    const removed = { ...item };
    notifications.show({
      title: 'Removed',
      message: `${removed.cardName} removed`,
      color: 'orange',
      icon: <IconRotate size={16} />,
      onClick: () => {
        patchActiveTrade({ items: [...getBuilder().activeTrade.items, { ...removed, tempId: nextTempId() }] });
      },
    });
  };

  const updateItem = (tempId: string, updates: Partial<TradeItem>) => {
    patchActiveTrade({ items: activeTrade.items.map(i => i.tempId === tempId ? { ...i, ...updates } : i) });
  };

  const yourItems = activeTrade.items.filter(i => i.side === 'yours');
  const theirItems = activeTrade.items.filter(i => i.side === 'theirs');

  const tradeQtyByCardId = new Map<string, number>();
  for (const item of yourItems) {
    if (item.cardId) tradeQtyByCardId.set(item.cardId, (tradeQtyByCardId.get(item.cardId) || 0) + item.quantity);
  }

  const yourTotal = yourItems.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0) + activeTrade.yourCash;
  const theirTotal = theirItems.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0) + activeTrade.theirCash;
  const diff = theirTotal - yourTotal;

  const saveCurrentTrade = async (status: string) => {
    try {
      const payload = {
        status, title: activeTrade.title, yourCash: activeTrade.yourCash,
        theirCash: activeTrade.theirCash, contactInfo: activeTrade.contactInfo,
        notes: activeTrade.notes,
        receivedLocationId: activeTrade.receivedLocationId ?? null,
        receivedDestinationId: activeTrade.receivedDestinationId ?? null,
        items: activeTrade.items,
      };
      if (activeTrade.id) {
        await api.trades.update(activeTrade.id, payload);
      } else {
        await api.trades.create(payload);
      }
      loadTrades();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleSave = async () => {
    await saveCurrentTrade('active');
    notifications.show({ title: 'Saved', message: 'Trade saved', color: 'green' });
    clearActiveTrade();
  };

  const handlePending = async () => {
    await saveCurrentTrade('pending');
    notifications.show({ title: 'Pending', message: 'Trade marked as pending', color: 'yellow' });
    clearActiveTrade();
  };

  const handleComplete = async () => {
    await saveCurrentTrade('completed');
    notifications.show({ title: 'Completed', message: 'Trade marked as complete', color: 'green' });
    clearActiveTrade();
  };

  const handleDiscard = async () => {
    if (activeTrade.items.length > 0 || activeTrade.yourCash > 0 || activeTrade.theirCash > 0) {
      await saveCurrentTrade('cancelled');
      notifications.show({ title: 'Cancelled', message: 'Trade discarded and saved as cancelled', color: 'red' });
    }
    clearActiveTrade();
  };

  const loadTrade = async (trade: Trade) => {
    const items = await Promise.all((trade.items || []).map(async (item: TradeItem) => {
      if (item.cardId && !item.imageUris) {
        try {
          const card = await api.cards.get(item.cardId);
          return { ...item, tempId: nextTempId(), imageUris: card.imageUris };
        } catch { return { ...item, tempId: nextTempId() }; }
      }
      return { ...item, tempId: nextTempId() };
    }));
    patchActiveTrade({ ...trade, items });
    setShowHistory(false);
  };

  return (
    <>
      <Alert icon={<IconAlertTriangle size={18} />} color="yellow" variant="filled" mb="md" px="lg" py="sm"
        styles={{ message: { fontSize: 15, fontWeight: 600, textAlign: 'center' } }}>
        This is a beta feature and may currently have some bugs. We do not recommend using these features yet.
      </Alert>
      <Group mb="md" justify="space-between" data-tour="trades-header">
        <Title order={2}>Trades</Title>
        <Button variant="light" leftSection={<IconHistory size={16} />} onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'New Trade' : 'History'}
        </Button>
      </Group>

      {showHistory ? (
        <Box>
          {trades.length === 0 && <Text c="dimmed" py="xl" ta="center">No trade history yet</Text>}
          {trades.map(trade => {
            const yItems = (trade as any).items?.filter((i: any) => i.side === 'yours') || [];
            const tItems = (trade as any).items?.filter((i: any) => i.side === 'theirs') || [];
            const yTotal = yItems.reduce((s: number, i: any) => s + (i.price ?? 0) * i.quantity, 0) + (trade.yourCash ?? 0);
            const tTotal = tItems.reduce((s: number, i: any) => s + (i.price ?? 0) * i.quantity, 0) + (trade.theirCash ?? 0);
            return (
              <Paper key={trade.id} withBorder p="sm" mb="sm" radius="md" style={{ cursor: 'pointer' }}
                onClick={() => loadTrade(trade)}
              >
                <Group justify="space-between">
                  <div>
                    <Group gap="xs">
                      <Text fw={500} size="sm">{trade.title || `Trade #${trade.id}`}</Text>
                      <Badge size="sm" color={trade.status === 'completed' ? 'green' : trade.status === 'active' ? 'blue' : trade.status === 'pending' ? 'yellow' : 'red'}
                        style={trade.status === 'cancelled' ? { textDecoration: 'line-through' } : undefined}>
                        {trade.status}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">{trade.createdAt ? new Date(trade.createdAt).toLocaleDateString() : ''}</Text>
                    <Text size="xs" c="dimmed">{yItems.length} yours · {tItems.length} theirs</Text>
                  </div>
                  <Text size="sm" c={yTotal > tTotal ? 'green' : 'red'}>
                    ${yTotal.toFixed(2)} vs ${tTotal.toFixed(2)}
                  </Text>
                </Group>
              </Paper>
            );
          })}
        </Box>
      ) : (
        <>
          <TextInput label="Trade Title (optional)" placeholder="e.g. Trade with Bob" value={activeTrade.title || ''}
            onChange={e => { const v = e.currentTarget.value; patchActiveTrade({ title: v }); }} mb="md" size="sm" />

          <Paper withBorder p="sm" radius="md" mb="md">
            <Text size="sm" fw={600} mb={4}>Received cards</Text>
            <Text size="xs" c="dimmed" mb="sm">
              Where incoming cards should go in your collection. You can override these per card.
            </Text>
            <Group gap="md">
              <Select label="Default location" placeholder="Select location" clearable
                data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                value={activeTrade.receivedLocationId ? String(activeTrade.receivedLocationId) : null}
                onChange={v => patchActiveTrade({ receivedLocationId: v ? Number(v) : null })}
                size="sm" w={220} />
              <Select label="Default destination (optional)" placeholder="No destination" clearable
                data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                value={activeTrade.receivedDestinationId ? String(activeTrade.receivedDestinationId) : null}
                onChange={v => patchActiveTrade({ receivedDestinationId: v ? Number(v) : null })}
                size="sm" w={240} />
            </Group>
          </Paper>

          <Group gap="md" align="flex-start" mb="md">
            <SidePanel side="yours" items={yourItems} onAdd={item => addItem('yours', item)}
              onRemove={removeItem} onUpdate={updateItem}
              cash={activeTrade.yourCash} onCashChange={v => patchActiveTrade({ yourCash: v })}
              sideLabel="Your Cards (from collection)"
              tradeQtyByCardId={tradeQtyByCardId}
              locations={locations} selectedLoc={selectedLoc} onLocChange={setSelectedLoc} />
            <SidePanel side="theirs" items={theirItems} onAdd={item => addItem('theirs', item)}
              onRemove={removeItem} onUpdate={updateItem}
              cash={activeTrade.theirCash} onCashChange={v => patchActiveTrade({ theirCash: v })}
              sideLabel="Their Cards (any card)"
              tradeQtyByCardId={new Map()}
              locations={locations} selectedLoc={null} onLocChange={() => {}} />
          </Group>

          <Paper withBorder p="md" radius="md" mb="md">
            <Group justify="space-around">
              <Box ta="center">
                <Text size="xs" c="dimmed">Your Value</Text>
                <Text fw={700} size="xl">${yourTotal.toFixed(2)}</Text>
              </Box>
              <Box ta="center">
                <Text size="xs" c="dimmed">Difference</Text>
                <Text fw={700} size="xl" c={diff > 0 ? 'green' : diff < 0 ? 'red' : undefined}>
                  {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                </Text>
              </Box>
              <Box ta="center">
                <Text size="xs" c="dimmed">Their Value</Text>
                <Text fw={700} size="xl">${theirTotal.toFixed(2)}</Text>
              </Box>
            </Group>
          </Paper>

          <Textarea label="Notes" placeholder="Trade notes..." value={activeTrade.notes || ''}
            onChange={e => { const v = e.currentTarget.value; patchActiveTrade({ notes: v }); }} mb="sm" size="sm" />
          <TextInput label="Contact Info (optional)" placeholder="Phone, email, etc." value={activeTrade.contactInfo || ''}
            onChange={e => { const v = e.currentTarget.value; patchActiveTrade({ contactInfo: v }); }} mb="md" size="sm" />

          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" color="gray" leftSection={<IconRotateClockwise size={16} />} onClick={openReset}>Reset</Button>
            <Button variant="default" onClick={handleDiscard}>Discard</Button>
            <Button variant="light" onClick={handleSave}>Save</Button>
            <Button variant="light" color="yellow" onClick={handlePending}>Mark Pending</Button>
            <Button color="green" onClick={handleComplete}>Mark Complete</Button>
          </Group>
        </>
      )}

      <Modal opened={resetOpen} onClose={closeReset} title="Reset this trade?" size="sm" centered>
        <Text size="sm" mb="md">
          This clears all cards, cash, title, notes and contact info from the current trade. It won't be saved to your
          trade history.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={closeReset}>Cancel</Button>
          <Button color="gray" onClick={() => { clearActiveTrade(); closeReset(); }}>Reset</Button>
        </Group>
      </Modal>
    </>
  );
}
