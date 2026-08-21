import { useState, useEffect, useRef } from 'react';
import {
  Title, Group, Text, Badge, Card, Select, TextInput, Button, NumberInput,
  Box, Paper, SimpleGrid, Modal, ScrollArea, Alert, Table, Image,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconPlus, IconCheck, IconFlame, IconHistory, IconPackages, IconCards, IconAlertTriangle } from '@tabler/icons-react';
import { api } from '../api/client';
import type { ScryfallCard, Location } from '../types';
import { CardThumb, SetSymbol } from '../components/CardDisplay';

const BOOSTER_TYPES: Record<string, { label: string; slots: number }> = {
  draft: { label: 'Draft Booster', slots: 15 },
  set: { label: 'Set Booster', slots: 12 },
  collector: { label: 'Collector Booster', slots: 15 },
  play: { label: 'Play Booster', slots: 14 },
  jumpstart: { label: 'Jumpstart', slots: 20 },
};

interface SlotState {
  card: ScryfallCard | null;
  foil: boolean;
  locationId: number | null;
  destinationId: number | null;
}

const emptySlot = (): SlotState => ({ card: null, foil: false, locationId: null, destinationId: null });

function isFoilOnly(card: ScryfallCard): boolean {
  const f = card.finishes;
  if (!f || f.length === 0) return false;
  return f.includes('foil') && !f.includes('nonfoil');
}

function canFoil(card: ScryfallCard): boolean {
  const f = card.finishes;
  if (!f || f.length === 0) return true;
  return f.includes('foil') || f.includes('etched');
}

function canNonfoil(card: ScryfallCard): boolean {
  const f = card.finishes;
  if (!f || f.length === 0) return true;
  return f.includes('nonfoil');
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={700} size="xl" c={color} style={{ lineHeight: 1.2 }}>{value}</Text>
    </Paper>
  );
}

function getPrice(card: ScryfallCard, foil: boolean): number {
  return parseFloat(foil ? (card.prices?.usd_foil || '0') : (card.prices?.usd || '0')) || 0;
}

const SLOT_FALLBACK = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='178'%3E%3Crect fill='%231a1a2e' width='128' height='178' rx='6'/%3E%3C/svg%3E`;

function slotArtUrl(card: ScryfallCard): string {
  return card.imageUris?.small || card.imageUris?.normal || card.imageUris?.large
    || card.cardFaces?.[0]?.image_uris?.small || card.cardFaces?.[0]?.image_uris?.normal || '';
}

export default function BoosterPage() {
  const [sets, setSets] = useState<Array<{ setCode: string; setName: string; hasBoosters: number }>>([]);
  const [setCode, setSetCode] = useState<string | null>(null);
  const [boosterType, setBoosterType] = useState<string>('draft');
  const [boosterPrice, setBoosterPrice] = useState<number | ''>(4.99);
  const [defaultLoc, setDefaultLoc] = useState<string | null>(null);
  const [defaultDest, setDefaultDest] = useState<string | null>(null);
  const [allCards, setAllCards] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [activeSlotIdx, setActiveSlotIdx] = useState<number | null>(null);
  const [collectorInput, setCollectorInput] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [viewAllOpened, { open: openViewAll, close: closeViewAll }] = useDisclosure(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewAllSearch, setViewAllSearch] = useState('');
  const [pickTarget, setPickTarget] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const setInputRef = useRef<HTMLInputElement>(null);

  const slotCount = BOOSTER_TYPES[boosterType]?.slots ?? 15;

  // Pressing Enter in the top fields should just defocus the box (and for the
  // selects, commit any highlighted option first).
  const blurOnEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    setTimeout(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur();
    }, 0);
  };

  // After picking an option from the Set / Booster Type dropdowns, step focus
  // away from the field so a subsequent Enter opens the slot picker instead.
  const blurAfterSelect = () => {
    setTimeout(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) el.blur();
    }, 0);
  };

  useEffect(() => {
    api.sets().then(setSets).catch(() => {});
    api.locations.list().then(setLocations).catch(() => {});
    loadHistory();
  }, []);

  // Location default always starts as Inbox; destination stays empty.
  useEffect(() => {
    if (defaultLoc !== null) return;
    const inbox = locations.find(l => l.name === 'Inbox' || l.builtIn);
    if (inbox) setDefaultLoc(String(inbox.id));
  }, [locations, defaultLoc]);

  useEffect(() => {
    if (activeSlotIdx !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeSlotIdx]);

  useEffect(() => {
    if (!searchOpen) return;
    // Mantine's focus trap grabs the close button on open, so retry until the
    // search input actually has focus.
    let cancelled = false;
    let attempts = 0;
    const tryFocus = () => {
      if (cancelled) return;
      const el = searchInputRef.current;
      if (el) el.focus();
      if (document.activeElement !== el) {
        attempts++;
        if (attempts < 30) requestAnimationFrame(tryFocus);
      }
    };
    const t = setTimeout(tryFocus, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [searchOpen]);

  useEffect(() => {
    if (setCode) {
      setLoading(true);
      api.cards.setCards(setCode).then(cards => {
        setAllCards(cards);
        setSlots(Array.from({ length: slotCount }, () => emptySlot()));
        setActiveSlotIdx(null);
        setCollectorInput('');
      }).catch(() => {
        notifications.show({ title: 'Error', message: 'Failed to load set cards', color: 'red' });
      }).finally(() => setLoading(false));
    } else {
      setAllCards([]);
      setSlots([]);
    }
  }, [setCode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (allCards.length > 0 && setCode) {
      setSlots(prev => {
        if (prev.length === slotCount) return prev;
        const next = [...prev];
        while (next.length < slotCount) next.push(emptySlot());
        return next.slice(0, slotCount);
      });
    }
  }, [slotCount, allCards.length, setCode]);

  const loadHistory = async () => {
    try {
      const h = await api.booster.history();
      setHistory(h);
    } catch {}
  };

  const visibleSets = sets.filter(s => s.hasBoosters);

  const chaseCards = allCards
    .filter(c => getPrice(c, true) > 0 || getPrice(c, false) > 0)
    .sort((a, b) => Math.max(getPrice(b, true), getPrice(b, false)) - Math.max(getPrice(a, true), getPrice(a, false)))
    .slice(0, 10);

  const suggestions = collectorInput.trim()
    ? allCards.filter(c => {
        const num = c.collectorNumber.toLowerCase();
        return num.startsWith(collectorInput.toLowerCase());
      }).slice(0, 20)
    : [];

  const handleSlotClick = (idx: number) => {
    setActiveSlotIdx(idx);
    setCollectorInput(slots[idx]?.card ? slots[idx].card!.collectorNumber : '');
  };

  const handleSelectSuggestion = (card: ScryfallCard) => {
    if (activeSlotIdx === null) return;
    const foilOnly = isFoilOnly(card);
    setSlots(prev => {
      const next = [...prev];
      const existing = next[activeSlotIdx] ?? emptySlot();
      next[activeSlotIdx] = {
        card,
        foil: foilOnly || existing.foil,
        locationId: existing.locationId ?? (defaultLoc ? Number(defaultLoc) : null),
        destinationId: existing.destinationId ?? (defaultDest ? Number(defaultDest) : null),
      };
      return next;
    });
    setCollectorInput('');
    setActiveSlotIdx(null);
  };

  const handleRemoveFromSlot = (idx: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[idx] = emptySlot();
      return next;
    });
  };

  const handleChaseClick = (card: ScryfallCard) => {
    const idx = pickTarget ?? nextEmptyIdx;
    setPickTarget(null);
    if (idx === -1 || idx >= slots.length) {
      notifications.show({ title: 'Full', message: 'All slots are filled', color: 'yellow' });
      return;
    }
    const foilDesired = !isFoilOnly(card)
      && parseFloat(card.prices?.usd_foil || '0') > parseFloat(card.prices?.usd || '0');
    fillSlot(idx, card, isFoilOnly(card) || foilDesired);
    setSearchOpen(false);
    setSearchQuery('');
  };

  const fillSlot = (idx: number, card: ScryfallCard, foil = false) => {
    setSlots(prev => {
      const next = [...prev];
      const existing = prev[idx] ?? emptySlot();
      next[idx] = {
        card,
        foil: foil || existing.foil,
        locationId: existing.locationId ?? (defaultLoc ? Number(defaultLoc) : null),
        destinationId: existing.destinationId ?? (defaultDest ? Number(defaultDest) : null),
      };
      return next;
    });
  };

  // Puts a picked card into the hover-picked slot (or the first empty one).
  const assignCard = (card: ScryfallCard, foil: boolean) => {
    const idx = pickTarget ?? slots.findIndex(s => s.card === null);
    setPickTarget(null);
    if (idx === null || idx === -1 || idx >= slots.length) {
      notifications.show({ title: 'Full', message: 'All slots are filled', color: 'yellow' });
      return;
    }
    fillSlot(idx, card, foil);
    closeViewAll();
    setSearchOpen(false);
    setSearchQuery('');
  };

  const openSlotSearch = (idx: number) => {
    setPickTarget(idx);
    setSearchQuery('');
    setSearchOpen(true);
  };

  // Pressing Enter (when not typing in a field) opens the add-card search for
  // the next empty slot.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (el && el.closest('.mantine-Modal-root')) return;
      const idx = slots.findIndex(s => s.card === null);
      if (idx === -1) return;
      e.preventDefault();
      e.stopPropagation();
      setPickTarget(idx);
      setSearchQuery('');
      setSearchOpen(true);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [slots]);

  const searchResults = searchQuery.trim()
    ? allCards.filter(c => {
        const q = searchQuery.trim().toLowerCase();
        return c.name.toLowerCase().includes(q)
          || c.collectorNumber.toLowerCase().includes(q);
      }).slice(0, 60)
    : allCards.slice(0, 60);

  const filledSlots = slots.filter(s => s.card !== null);
  const nextEmptyIdx = slots.findIndex(s => s.card === null);
  const totalValue = filledSlots.reduce((sum, s) => sum + getPrice(s.card!, s.foil), 0);
  const price = typeof boosterPrice === 'number' ? boosterPrice : 0;
  const result = totalValue - price;
  const resultColor = result > 0 ? 'green' : result < 0 ? 'red' : 'gray';

  const handleSave = async () => {
    if (!setCode || slots.length === 0 || filledSlots.length !== slots.length) return;
    setSaving(true);
    try {
      const pulls = filledSlots.map((s, i) => ({
        cardId: s.card!.id,
        foil: s.foil,
        slotIndex: i,
        locationId: s.locationId,
        destinationId: s.destinationId,
      }));
      await api.booster.finish({ setCode, boosterType, boosterPrice: price, pulls });
      notifications.show({ title: 'Saved', message: `Added ${filledSlots.length} cards to collection`, color: 'green' });
      setSlots(Array.from({ length: slotCount }, () => emptySlot()));
      loadHistory();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const viewAllFiltered = viewAllSearch.trim()
    ? allCards.filter(c => {
        const q = viewAllSearch.toLowerCase();
        return c.name.toLowerCase().includes(q)
          || c.collectorNumber.toLowerCase().includes(q)
          || c.rarity?.toLowerCase().includes(q);
      })
    : allCards;

  const histPulls = history.reduce((s, h: any) => s + (h.pulls?.length || 0), 0);
  const histSpent = history.reduce((s, h: any) => s + (Number(h.boosterPrice) || 0), 0);
  const histValue = history.reduce((s, h: any) => s + (Number(h.totalValue) || 0), 0);
  const histNet = histValue - histSpent;

  const setBreakdown = (() => {
    const map = new Map<string, { set: string; count: number; pulls: number; spent: number; value: number; net: number }>();
    for (const h of history as any[]) {
      const set = String(h.setCode || '').toUpperCase();
      if (!set) continue;
      const cur = map.get(set) ?? { set, count: 0, pulls: 0, spent: 0, value: 0, net: 0 };
      cur.count++;
      cur.pulls += h.pulls?.length || 0;
      cur.spent += Number(h.boosterPrice) || 0;
      cur.value += Number(h.totalValue) || 0;
      cur.net = cur.value - cur.spent;
      map.set(set, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  })();

  // Highest-value cards pulled across all history, by unique printing.
  const bestCards = (() => {
    const map = new Map<string, { name: string; count: number; bestValue: number; pulledValue: number; foil: boolean; imageUris: any; cardFaces: any }>();
    for (const h of history as any[]) {
      for (const p of h.pulls ?? []) {
        const c = p.card;
        if (!c) continue;
        const nonfoil = parseFloat(c.prices?.usd || '0') || 0;
        const foilPrice = parseFloat(c.prices?.usd_foil || '0') || 0;
        const pulled = p.foil ? foilPrice : nonfoil;
        const key = p.cardId || c.name;
        const cur = map.get(key) ?? { name: c.name, count: 0, bestValue: 0, pulledValue: 0, foil: false, imageUris: c.imageUris ?? null, cardFaces: c.cardFaces ?? null };
        cur.count += 1;
        cur.pulledValue += pulled;
        const best = Math.max(nonfoil, foilPrice);
        if (best > cur.bestValue) { cur.bestValue = best; cur.foil = foilPrice > nonfoil; }
        map.set(key, cur);
      }
    }
    return [...map.values()].filter(x => x.pulledValue > 0).sort((a, b) => b.pulledValue - a.pulledValue).slice(0, 10);
  })();

  return (
    <>
      <Alert icon={<IconAlertTriangle size={18} />} color="yellow" variant="filled" mb="md" px="lg" py="sm"
        styles={{ message: { fontSize: 15, fontWeight: 600, textAlign: 'center' } }}>
        This is a beta feature and may currently have some bugs. We do not recommend using these features yet.
      </Alert>
      <Group mb="md" justify="space-between">
        <Title order={2}>Booster Opener</Title>
        <Button variant="light" leftSection={<IconHistory size={16} />} onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'Open Booster' : 'History'}
        </Button>
      </Group>

      {showHistory ? (
        <Box>
          {history.length === 0 ? (
            <Text c="dimmed" py="xl" ta="center">No booster history yet</Text>
          ) : (
            <>
              <Box mb="md" style={{ textAlign: 'center' }}>
                <Title order={3}>Booster History</Title>
                <Button size="md" mt="sm" leftSection={<IconPlus size={18} />} onClick={() => setShowHistory(false)}>
                  Open booster
                </Button>
              </Box>

              <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="md" mb="md">
                <StatCard label="Boosters opened" value={String(history.length)} />
                <StatCard label="Cards pulled" value={String(histPulls)} />
                <StatCard label="Money spent" value={`$${histSpent.toFixed(2)}`} />
                <StatCard label="Value pulled" value={`$${histValue.toFixed(2)}`} />
                <StatCard label="Net result" value={`${histNet >= 0 ? '+' : ''}${histNet.toFixed(2)}`}
                  color={histNet > 0 ? 'var(--mantine-color-green-6)' : histNet < 0 ? 'var(--mantine-color-red-6)' : undefined} />
              </SimpleGrid>

              <Paper withBorder p="md" mb="md" radius="md">
                <Text fw={600} size="sm" mb="sm">Breakdown by set</Text>
                <Table striped highlightOnHover styles={{ table: { fontSize: 13 } }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Set</Table.Th>
                      <Table.Th ta="right">Opened</Table.Th>
                      <Table.Th ta="right">Cards</Table.Th>
                      <Table.Th ta="right">Spent</Table.Th>
                      <Table.Th ta="right">Value</Table.Th>
                      <Table.Th ta="right">Net</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {setBreakdown.map(b => (
                      <Table.Tr key={b.set}>
                        <Table.Td><Text fw={500} tt="uppercase">{b.set}</Text></Table.Td>
                        <Table.Td ta="right">{b.count}</Table.Td>
                        <Table.Td ta="right">{b.pulls}</Table.Td>
                        <Table.Td ta="right">${b.spent.toFixed(2)}</Table.Td>
                        <Table.Td ta="right">${b.value.toFixed(2)}</Table.Td>
                        <Table.Td ta="right" c={b.net > 0 ? 'green' : b.net < 0 ? 'red' : undefined}>
                          {b.net >= 0 ? '+' : ''}{b.net.toFixed(2)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Paper>

              {bestCards.length > 0 && (
                <Paper withBorder p="md" mb="md" radius="md">
                  <Text fw={600} size="sm" mb="sm">Best cards pulled</Text>
                  <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="md">
                    {bestCards.map(b => (
                      <Card key={b.name} withBorder padding={6} radius="sm">
                        <Box ta="center"><CardThumb card={b as any} /></Box>
                        <Text size="xs" fw={500} lineClamp={1} ta="center" mt={2}>{b.name}</Text>
                        <Text size="xs" ta="center" c="green" fw={600}>
                          ${b.bestValue.toFixed(2)} {b.foil && <Text span c="yellow" size="xs" inline>✦</Text>}
                        </Text>
                        <Text size="xs" ta="center" c="dimmed">pulled ×{b.count}</Text>
                      </Card>
                    ))}
                  </SimpleGrid>
                </Paper>
              )}

              <Paper withBorder p="md" radius="md">
                {history.map((s: any) => {
                  const t = BOOSTER_TYPES[s.boosterType] || { label: s.boosterType };
                  const pullsWithDetails = s.pulls?.length || 0;
                  return (
                    <Paper key={s.id} withBorder p="sm" mb="sm" radius="md" style={{ background: 'transparent' }}>
                      <Group justify="space-between">
                        <div>
                          <Text fw={500} size="sm">{s.setCode.toUpperCase()} — {t.label}</Text>
                          <Text size="xs" c="dimmed">{new Date(s.createdAt).toLocaleDateString()} · {pullsWithDetails} cards</Text>
                        </div>
                        <Group gap="md">
                          <Text size="sm">$${Number(s.boosterPrice).toFixed(2)}</Text>
                          <Text size="sm" c={s.totalValue >= s.boosterPrice ? 'green' : 'red'}>
                            ${Number(s.totalValue).toFixed(2)}
                          </Text>
                          <Badge color={s.completed ? 'green' : 'yellow'} size="sm">
                            {s.completed ? 'Added' : 'Pending'}
                          </Badge>
                        </Group>
                      </Group>
                    </Paper>
                  );
                })}
              </Paper>
            </>
          )}
        </Box>
      ) : (
        <>
          <Group mb="md" gap="sm" align="flex-end">
            <Select
              label="Set"
              placeholder="Select a set"
              data={visibleSets.map(s => ({ value: s.setCode, label: `${s.setCode.toUpperCase()} — ${s.setName}` }))}
              value={setCode}
              onChange={v => { setSetCode(v); setShowHistory(false); blurAfterSelect(); }}
              searchable w={350} size="sm"
              onDropdownOpen={() => setInputRef.current?.select()}
              onKeyDown={blurOnEnter}
              ref={setInputRef}
              data-tour="booster-set"
            />
            <Select
              label="Booster Type"
              data={Object.entries(BOOSTER_TYPES).map(([k, v]) => ({ value: k, label: `${v.label} (${v.slots} cards)` }))}
              value={boosterType}
              onChange={v => { setBoosterType(v!); blurAfterSelect(); }}
              allowDeselect={false}
              w={220} size="sm"
              onKeyDown={blurOnEnter}
            />
            <NumberInput
              label="Price Paid ($USD)"
              value={boosterPrice}
              onChange={v => setBoosterPrice(typeof v === 'number' ? v : (v === '' ? '' : parseFloat(v) || 0))}
              min={0} decimalScale={2} w={120} size="sm"
              onKeyDown={blurOnEnter}
            />
            <Select
              label="Location default"
              placeholder="Default location"
              clearable={defaultLoc === null || !locations.some(l => String(l.id) === defaultLoc && (l.name === 'Inbox' || l.builtIn))}
              searchable
              data={locations.map(l => ({ value: String(l.id), label: l.name }))}
              value={defaultLoc}
              onChange={setDefaultLoc}
              w={200} size="sm"
            />
            <Select
              label="Destination default"
              placeholder="Default destination"
              clearable searchable
              data={locations.map(l => ({ value: String(l.id), label: l.name }))}
              value={defaultDest}
              onChange={setDefaultDest}
              w={210} size="sm"
            />
          </Group>

          {allCards.length > 0 && chaseCards.length > 0 && (
            <Paper withBorder p="sm" mb="md" radius="md">
              <Group mb="xs" justify="space-between">
                <Group>
                  <IconFlame size={16} color="var(--mantine-color-orange-5)" />
                  <Text fw={600} size="sm">Chase Cards</Text>
                </Group>
                <Button size="compact-xs" variant="light" leftSection={<IconCards size={14} />} onClick={openViewAll}>
                  View All ({allCards.length})
                </Button>
              </Group>
              <Group gap={8}>
                {chaseCards.map(c => {
                  const foilWorthMore = !isFoilOnly(c)
                    && parseFloat(c.prices?.usd_foil || '0') > parseFloat(c.prices?.usd || '0');
                  return (
                    <Card key={c.id} withBorder padding={6} radius="sm" w={140} style={{ cursor: 'pointer' }}
                      onClick={() => handleChaseClick(c)}
                    >
                      <Box ta="center"><CardThumb card={c} /></Box>
                      <Text size="xs" fw={500} ta="center" lineClamp={1} mt={2}>{c.name}</Text>
                      <Text size="xs" ta="center" c="green" fw={600}>
                        ${Math.max(getPrice(c, false), getPrice(c, true)).toFixed(2)} {foilWorthMore && <Text component="span" c="yellow" size="xs" inline>✦</Text>}
                      </Text>
                    </Card>
                  );
                })}
              </Group>
            </Paper>
          )}

          {setCode && allCards.length > 0 && (
            <>
              <Paper withBorder p="sm" mb="sm" radius="md">
                <Group gap="sm" mb="sm">
                  <Text fw={600} size="sm">Pack Slots ({filledSlots.length}/{slots.length})</Text>
                  <Button size="compact-xs" variant="subtle" leftSection={<IconCards size={14} />} onClick={openViewAll}>
                    Browse All
                  </Button>
                </Group>

                <SimpleGrid cols={{ base: 3, sm: 5, md: 5 }} spacing="sm">
                  {slots.map((slot, idx) => (
                    <Box key={idx}>
                      {slot.card ? (
                        <Card withBorder padding={4} radius="sm"
                          bg={slot.foil ? 'var(--mantine-color-yellow-0)' : undefined}
                          style={{ cursor: 'pointer', minHeight: 270 }}
                          onClick={() => handleSlotClick(idx)}
                        >
                          <Box ta="center">
                            <Image src={slotArtUrl(slot.card!)} w={128} h={178} fit="contain" radius="xs" fallbackSrc={SLOT_FALLBACK} />
                          </Box>
                          <Text size="xs" fw={500} lineClamp={1} ta="center">{slot.card!.name}</Text>
                          <Group gap={2} justify="center" mt={2}>
                            <Text size="xs" c="dimmed">{slot.card!.collectorNumber}</Text>
                            {slot.foil && <Text size="xs" c="yellow" fw={700}>✦</Text>}
                          </Group>
                          <Group gap={4} justify="center" mt={2}>
                            <Badge size="xs" color="green" variant="light">
                              ${getPrice(slot.card!, slot.foil).toFixed(2)}
                            </Badge>
                            {slot.foil && <Badge size="xs" color="yellow" variant="light">Foil</Badge>}
                          </Group>
                          <Button size="compact-xs" variant="subtle" color="red" fullWidth mt={2}
                            onClick={e => { e.stopPropagation(); handleRemoveFromSlot(idx); }}
                            style={{ height: 20 }}
                          >Remove</Button>
                        </Card>
                      ) : (
                        <Card
                          key={`empty-${idx}`}
                          withBorder padding="md" radius="sm"
                          style={{
                            cursor: 'pointer', minHeight: 270, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backgroundColor: nextEmptyIdx === idx ? 'var(--mantine-color-blue-0)' : undefined,
                            borderColor: nextEmptyIdx === idx ? 'var(--mantine-color-blue-7)' : undefined,
                            borderWidth: nextEmptyIdx === idx ? 2 : undefined,
                          }}
                          onClick={() => openSlotSearch(idx)}
                        >
                          <IconPlus size={24} opacity={nextEmptyIdx === idx ? 0.8 : 0.3}
                            color={nextEmptyIdx === idx ? 'var(--mantine-color-blue-7)' : undefined}
                          />
                        </Card>
                      )}
                    </Box>
                  ))}
                </SimpleGrid>

                {activeSlotIdx !== null && (
                  <Box mt="sm" pos="relative">
                    <TextInput
                      placeholder="Type collector number..."
                      value={collectorInput}
                      onChange={e => setCollectorInput(e.currentTarget.value)}
                      leftSection={<IconSearch size={14} />}
                      ref={inputRef as any}
                      size="sm"
                      rightSection={
                        <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setActiveSlotIdx(null)}>
                          Cancel
                        </Button>
                      }
                    />
                    {suggestions.length > 0 && (
                      <Paper withBorder shadow="md" radius="sm" mt={2} pos="absolute" w="100%" style={{ zIndex: 100, maxHeight: 300, overflowY: 'auto' }}>
                        {suggestions.map(c => (
                          <Group key={c.id} p="xs" gap="sm" wrap="nowrap"
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleSelectSuggestion(c)}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--mantine-color-default-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                          >
                            <Box w={24} h={34}>
                              <CardThumb card={c} />
                            </Box>
                            <div style={{ flex: 1 }}>
                              <Text size="sm" fw={500}>{c.name}</Text>
                              <Group gap={4}>
                                <SetSymbol code={c.setCode} name={c.setName} size={12} />
                                <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                                <Text size="xs" c="dimmed">{c.rarity}</Text>
                                {isFoilOnly(c) && <Badge size="xs" color="yellow" variant="light">Foil</Badge>}
                              </Group>
                            </div>
                            <Text size="sm" c="green" fw={600}>
                              ${Math.max(getPrice(c, false), getPrice(c, true)).toFixed(2)}
                            </Text>
                          </Group>
                        ))}
                      </Paper>
                    )}
                  </Box>
                )}
              </Paper>

              <Paper withBorder p="md" mb="md" radius="md">
                <Group justify="space-around">
                  <Box ta="center">
                    <Text size="xs" c="dimmed">Cards Pulled</Text>
                    <Text fw={700} size="xl">{filledSlots.length}</Text>
                  </Box>
                  <Box ta="center">
                    <Text size="xs" c="dimmed">Total Value</Text>
                    <Text fw={700} size="xl">${totalValue.toFixed(2)}</Text>
                  </Box>
                  <Box ta="center">
                    <Text size="xs" c="dimmed">Pack Cost</Text>
                    <Text fw={700} size="xl">${price.toFixed(2)}</Text>
                  </Box>
                  <Box ta="center">
                    <Text size="xs" c="dimmed">Result</Text>
                    <Text fw={700} size="xl" c={resultColor}>
                      {result > 0 ? '+' : ''}{result.toFixed(2)}
                    </Text>
                    {result > 0 && <IconFlame size={20} color="orange" />}
                  </Box>
                  <Box ta="center">
                    <Text size="xs" c="dimmed">Avg Pull</Text>
                    <Text fw={700} size="xl">${filledSlots.length > 0 ? (totalValue / filledSlots.length).toFixed(2) : '0.00'}</Text>
                  </Box>
                </Group>
              </Paper>

              {filledSlots.length > 0 && (
                <Paper withBorder p="sm" mb="md" radius="md">
                  <Group mb="sm">
                    <IconPackages size={16} />
                    <Text fw={600} size="sm">Location Assignment</Text>
                  </Group>
                  <Text size="xs" c="dimmed" mb="sm">
                    Cards will be added with prorated cost of ${slots.length > 0 ? (price / slots.length).toFixed(2) : '0.00'} each.
                  </Text>
                  {filledSlots.map((s, i) => {
                    const slotGlobalIdx = slots.indexOf(s);
                    return (
                    <Group key={i} gap="sm" mb="xs" wrap="nowrap">
                      <Box w={24} h={34}><CardThumb card={s.card!} /></Box>
                      <Text size="sm" style={{ flex: 1, minWidth: 0 }} lineClamp={1}>{s.card!.name}</Text>
                      {s.foil && <Badge size="xs" color="yellow" variant="light">Foil</Badge>}
                      <Text size="sm" c="dimmed" w={50}>${getPrice(s.card!, s.foil).toFixed(2)}</Text>
                      <Select
                        placeholder="No location"
                        data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                        value={s.locationId !== null ? String(s.locationId) : null}
                        onChange={v => setSlots(prev => { const n = [...prev]; if (slotGlobalIdx >= 0) n[slotGlobalIdx] = { ...n[slotGlobalIdx], locationId: v ? Number(v) : null }; return n; })}
                        clearable w={170} size="xs"
                      />
                      <Select
                        placeholder="No destination"
                        data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                        value={s.destinationId !== null ? String(s.destinationId) : null}
                        onChange={v => setSlots(prev => { const n = [...prev]; if (slotGlobalIdx >= 0) n[slotGlobalIdx] = { ...n[slotGlobalIdx], destinationId: v ? Number(v) : null }; return n; })}
                        clearable w={170} size="xs"
                      />
                    </Group>
                    );
                  })}
                  {filledSlots.length < slots.length && (
                    <Text size="xs" c="dimmed" ta="right" mt="xs">
                      Fill all {slots.length} slots ({filledSlots.length}/{slots.length}) to add this pack.
                    </Text>
                  )}
                  <Group justify="flex-end" mt="md">
                    <Button
                      leftSection={<IconCheck size={16} />}
                      onClick={handleSave}
                      loading={saving}
                      disabled={filledSlots.length !== slots.length}
                    >
                      Save & Add to Collection
                    </Button>
                  </Group>
                </Paper>
              )}
            </>
          )}

          {setCode && !loading && allCards.length === 0 && (
            <Text c="dimmed" ta="center" py="xl">No cards found for this set</Text>
          )}
        </>
      )}

      <Modal opened={viewAllOpened} onClose={closeViewAll} title={`All Cards in ${setCode?.toUpperCase() || ''}`} size="xl" centered>
        <TextInput
          placeholder="Search by name, collector #, or rarity..."
          value={viewAllSearch}
          onChange={e => setViewAllSearch(e.currentTarget.value)}
          leftSection={<IconSearch size={14} />}
          mb="sm"
          size="sm"
        />
        <ScrollArea h={500}>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 3 }} spacing="md">
            {viewAllFiltered.map(c => {
              const foilOnly = isFoilOnly(c);
              const bestPrice = Math.max(getPrice(c, false), getPrice(c, true));
              return (
                <Card key={c.id} withBorder padding={6} radius="sm">
                  <Box ta="center"><CardThumb card={c} /></Box>
                  <Text size="xs" fw={500} lineClamp={1} ta="center" mt={2}>{c.name}</Text>
                  <Group gap={2} justify="center">
                    <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                    {foilOnly && <Badge size="xs" color="yellow" variant="light">Foil</Badge>}
                  </Group>
                  <Group gap={4} justify="center">
                    <Badge size="xs" variant="light">{c.rarity}</Badge>
                    {bestPrice > 0 && <Badge size="xs" color="green" variant="light">${bestPrice.toFixed(2)}</Badge>}
                  </Group>
                  <Group gap={4} mt={4}>
                    <Button size="compact-xs" fullWidth variant="light" disabled={!canNonfoil(c)}
                      onClick={() => assignCard(c, false)}>
                      Add
                    </Button>
                    <Button size="compact-xs" fullWidth variant="light" color="yellow" disabled={!canFoil(c)}
                      onClick={() => assignCard(c, true)}>
                      Add Foil
                    </Button>
                  </Group>
                </Card>
              );
            })}
          </SimpleGrid>
        </ScrollArea>
      </Modal>

      <Modal opened={searchOpen} onClose={() => setSearchOpen(false)} title="Enter card name or number" size="lg" centered>
        <TextInput
          placeholder="Type a card name or collector number..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.currentTarget.value)}
          leftSection={<IconSearch size={14} />}
          mb="sm"
          size="sm"
          ref={searchInputRef}
        />
        {searchResults.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">No cards match "{searchQuery}"</Text>
        ) : (
          <ScrollArea h={480}>
            <SimpleGrid cols={{ base: 2, sm: 3, md: 3 }} spacing="md">
              {searchResults.map(c => {
                const foilOnly = isFoilOnly(c);
                const bestPrice = Math.max(getPrice(c, false), getPrice(c, true));
                return (
                  <Card key={c.id} withBorder padding={6} radius="sm">
                    <Box ta="center"><CardThumb card={c} /></Box>
                    <Text size="xs" fw={500} lineClamp={1} ta="center" mt={2}>{c.name}</Text>
                    <Group gap={2} justify="center">
                      <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                      {foilOnly && <Badge size="xs" color="yellow" variant="light">Foil</Badge>}
                    </Group>
                    <Group gap={4} justify="center">
                      <Badge size="xs" variant="light">{c.rarity}</Badge>
                      {bestPrice > 0 && <Badge size="xs" color="green" variant="light">${bestPrice.toFixed(2)}</Badge>}
                    </Group>
                    <Group gap={4} mt={4}>
                      <Button size="compact-xs" fullWidth variant="light" disabled={!canNonfoil(c)}
                        onClick={() => assignCard(c, false)}>
                        Add
                      </Button>
                      <Button size="compact-xs" fullWidth variant="light" color="yellow" disabled={!canFoil(c)}
                        onClick={() => assignCard(c, true)}>
                        Add Foil
                      </Button>
                    </Group>
                  </Card>
                );
              })}
            </SimpleGrid>
          </ScrollArea>
        )}
      </Modal>
    </>
  );
}
