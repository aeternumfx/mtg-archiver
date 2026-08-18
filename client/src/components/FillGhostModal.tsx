import { useState, useEffect } from 'react';
import {
  Modal, Text, Group, Button, ScrollArea, Box, Paper, Badge, NumberInput, Switch,
  SegmentedControl, TextInput, Select, Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { api } from '../api/client';
import type { ScryfallCard, Condition, Location } from '../types';
import { CONDITIONS } from '../types';
import { CardThumb, SetSymbol } from './CardDisplay';

export interface FillGhostRequest {
  id: number;
  cardId: string | null;
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
  quantity: number;
}

const CONDITION_COLORS: Record<string, string> = {
  M: '#2e7d32', NM: '#00897b', LP: '#1565c0',
  MP: '#f9a825', HP: '#e65100', Dmg: '#c62828',
};

export function FillGhostModal({ opened, onClose, deck, locations, req, onFilled }: {
  opened: boolean;
  onClose: () => void;
  deck: { id: number; name: string; locationId: number | null } | null;
  locations: Location[];
  req: FillGhostRequest | null;
  onFilled: (result: { item: { id: number } }) => void;
}) {
  const [printings, setPrintings] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [foil, setFoil] = useState(false);
  const [condition, setCondition] = useState<string>('NM');
  const [price, setPrice] = useState('');
  const [packOpened, setPackOpened] = useState(false);
  const [loc, setLoc] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [filling, setFilling] = useState(false);

  useEffect(() => {
    if (!opened || !req) return;
    setPrintings([]);
    setSelectedId(null);
    setSearch('');
    setQuantity(req.quantity || 1);
    setFoil(false);
    setCondition('NM');
    setPrice('');
    setPackOpened(false);
    setNotes('');
    setDest(null);
    setLoc(deck?.locationId != null ? String(deck.locationId) : null);
    setLoading(true);
    api.cards.printings(req.cardName)
      .then(cards => {
        setPrintings(cards);
        const match = cards.find(c =>
          (req.cardId && c.id === req.cardId) ||
          (!!req.setCode && !!req.collectorNumber
            && c.setCode.toLowerCase() === req.setCode.toLowerCase()
            && c.collectorNumber === req.collectorNumber)
        );
        if (match) selectPrinting(match.id, cards);
      })
      .catch(() => notifications.show({ title: 'Error', message: 'Failed to load printings', color: 'red', autoClose: 15000 }))
      .finally(() => setLoading(false));
  }, [opened, req]);

  const foilStateOf = (card?: ScryfallCard | null) => {
    const finishes = card?.finishes || [];
    const canFoil = finishes.includes('foil') || finishes.includes('etched');
    const only = canFoil && !finishes.includes('nonfoil');
    return { canFoil, foilOnly: only };
  };

  const selectPrinting = (id: string, cards = printings) => {
    setSelectedId(id);
    const card = cards.find(c => c.id === id);
    if (card) setFoil(foilStateOf(card).foilOnly);
    else setFoil(false);
  };

  const selected: ScryfallCard | null = printings.find(p => p.id === selectedId) ?? null;
  const fs = foilStateOf(selected);
  const autofillPrice = selected?.prices?.[foil ? 'usd_foil' : 'usd'] || selected?.prices?.usd || selected?.prices?.usd_foil || '';

  const searchTerm = search.trim().toLowerCase();
  const filteredPrintings = searchTerm
    ? printings.filter(c => `${c.setCode} ${c.collectorNumber} ${c.setName} ${c.name}`.toLowerCase().includes(searchTerm))
    : printings;

  const handleFill = async () => {
    if (!req || !deck || !selectedId) {
      if (!selectedId) notifications.show({ title: 'No printing', message: 'Choose a printing first', color: 'yellow', autoClose: 8000 });
      return;
    }
    if (!loc) {
      notifications.show({ title: 'No location', message: 'Pick where to add the card', color: 'yellow', autoClose: 8000 });
      return;
    }
    setFilling(true);
    try {
      const customPrice = price.trim();
      const purchasePrice = customPrice ? parseFloat(customPrice) : undefined;
      if (customPrice && isNaN(purchasePrice as number)) {
        notifications.show({ title: 'Invalid price', message: 'Enter a valid price or leave it blank to autofill', color: 'yellow', autoClose: 8000 });
        return;
      }
      const result = await api.decks.fillRequiredExternal(deck.id, req.id, {
        cardId: selectedId,
        locationId: Number(loc),
        quantity,
        foil,
        condition: condition as Condition,
        purchasePrice: customPrice ? purchasePrice : undefined,
        packOpened,
        notes: notes || undefined,
        destinationId: dest ? Number(dest) : undefined,
      });
      onFilled(result);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red', autoClose: 20000 });
    } finally {
      setFilling(false);
    }
  };

  const locOptions = locations.map(l => ({ value: String(l.id), label: l.name }));

  return (
    <Modal opened={opened} onClose={onClose} title={`Fill Externally — ${req?.cardName || ''}`} size="md" centered>
      {req && (
        <>
          <Text size="sm" fw={500} mb={4}>Printing</Text>
          {loading ? (
            <Text c="dimmed" ta="center" py="xl">Loading printings...</Text>
          ) : printings.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">No printings found for {req.cardName}.</Text>
          ) : (
            <>
              <TextInput placeholder="Search by set, collector #, or set name" value={search}
                onChange={e => setSearch(e.currentTarget.value)} leftSection={<IconSearch size={14} />}
                size="xs" mb="xs" />
              {filteredPrintings.length === 0 ? (
                <Text c="dimmed" ta="center" py="md">No printings match your search.</Text>
              ) : (
                <ScrollArea h={180}>
                  {filteredPrintings.map(c => {
                    const isSel = c.id === selectedId;
                    const priceOut = Number(c.prices?.usd || 0) || undefined;
                    return (
                      <Paper key={c.id} withBorder mb={2} radius={0}
                        style={isSel
                          ? { border: '2px solid var(--mantine-color-blue-6)', background: 'var(--mantine-color-blue-0)' }
                          : undefined}>
                        <Group p="xs" gap="sm" wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => selectPrinting(c.id)}>
                          <Box w={24} h={34}><CardThumb card={c} /></Box>
                          <SetSymbol code={c.setCode} name={c.setName} size={12} />
                          <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                          <Text size="xs" c="dimmed" style={{ flex: 1 }}>{c.setName}</Text>
                          {priceOut !== undefined && <Text size="xs" c="dimmed">${priceOut.toFixed(2)}</Text>}
                          {foilStateOf(c).foilOnly && <Badge size="xs" variant="light" color="yellow">Foil only</Badge>}
                        </Group>
                      </Paper>
                    );
                  })}
                </ScrollArea>
              )}
            </>
          )}

          {selected && (
            <>
              <Divider my="md" />
              <Box>
                <Group gap="lg" mb="md" wrap="nowrap" align="flex-start">
                  <Box w={215} h={300} style={{ overflow: 'hidden', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', position: 'relative', flexShrink: 0 }}>
                    <img
                      src={selected.imageUris?.large || selected.imageUris?.normal || selected.imageUris?.small
                        || selected.cardFaces?.[0]?.image_uris?.large || selected.cardFaces?.[0]?.image_uris?.normal || ''}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      alt={selected.name}
                    />
                    {foil && (
                      <Box style={{
                        position: 'absolute', inset: 0, borderRadius: 8,
                        background: 'linear-gradient(135deg, transparent 30%, rgba(255,215,0,0.15) 40%, rgba(255,255,255,0.25) 44%, rgba(100,200,255,0.15) 48%, rgba(255,100,200,0.15) 52%, rgba(255,215,0,0.15) 56%, transparent 66%)',
                        backgroundSize: '200% 100%',
                        pointerEvents: 'none',
                        mixBlendMode: 'overlay',
                      }} />
                    )}
                  </Box>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} size="lg">{selected.name}</Text>
                    <Group gap={4} mt={4}>
                      <SetSymbol code={selected.setCode} name={selected.setName} size={14} />
                      <Text size="sm" c="dimmed">#{selected.collectorNumber}</Text>
                    </Group>
                    <Text size="xs" c="dimmed" mt={2}>{selected.typeLine}</Text>
                    <Text size="xs" mt="sm">
                      Market: <b>${parseFloat(foil ? (selected.prices?.usd_foil || '0') : (selected.prices?.usd || '0')).toFixed(2)}</b>
                      {selected.prices?.usd && !foil && selected.prices?.usd_foil ? ` / Foil: $${parseFloat(selected.prices.usd_foil).toFixed(2)}` : ''}
                      {selected.prices?.usd && foil ? ` / Nonfoil: $${parseFloat(selected.prices.usd).toFixed(2)}` : ''}
                    </Text>
                  </div>
                </Group>

                <Group gap="sm" mb="sm">
                  <NumberInput label="Qty" value={quantity}
                    onChange={v => setQuantity(Number(v) || 1)} min={1} max={999} w={80} size="sm" />
                  <Switch label="Foil" checked={foil} disabled={!fs.canFoil} size="sm" onLabel="F" offLabel="N" mt={24}
                    color="yellow" onChange={e => setFoil(e.currentTarget.checked)} />
                </Group>

                <Box mb="sm">
                  <Text size="sm" fw={500} mb={4}>Condition</Text>
                  <SegmentedControl value={condition} onChange={v => setCondition(v)} size="xs"
                    data={CONDITIONS.map(c => ({ value: c, label: c }))}
                    styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[condition] || '#00897b' } }} />
                </Box>

                <Group gap="sm" mb="sm">
                  <Box style={{ flex: 1 }}>
                    <TextInput label="Price ($)" value={price} onChange={e => setPrice(e.currentTarget.value)}
                      placeholder={autofillPrice || '0.00'} size="sm"
                      leftSection={<Text size="xs" c="dimmed">$</Text>} />
                    <Text size="10px" c="dimmed" mt={2}>Leave blank to autofill market price.</Text>
                  </Box>
                  <Switch label="Pack opened" checked={packOpened} onChange={e => setPackOpened(e.currentTarget.checked)} size="sm" mt={24} />
                </Group>

                <Select label="Location" placeholder="Select location" searchable data={locOptions}
                  value={loc} onChange={setLoc} mb="sm" size="sm" />
                <Select label="Destination (optional)" placeholder="No destination" clearable searchable data={locOptions}
                  value={dest} onChange={setDest} mb="sm" size="sm" />
                <TextInput label="Notes" value={notes} onChange={e => setNotes(e.currentTarget.value)} placeholder="notes" size="sm" mb="md" />

                <Group justify="flex-end">
                  <Button variant="default" onClick={onClose} disabled={filling}>Cancel</Button>
                  <Button loading={filling} disabled={!selectedId || !loc} onClick={handleFill} leftSection={<IconPlus size={16} />}>
                    Add & Fill
                  </Button>
                </Group>
              </Box>
            </>
          )}
        </>
      )}
    </Modal>
  );
}