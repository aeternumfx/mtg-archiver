import { useState, useEffect, useRef } from 'react';
import {
  Title, Group, Text, Badge, Card, Select, TextInput, Button, NumberInput,
  LoadingOverlay, Box, Paper, SimpleGrid, Modal, ScrollArea, Alert,
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
}

function isFoilOnly(card: ScryfallCard): boolean {
  const f = card.finishes;
  if (!f || f.length === 0) return false;
  return f.includes('foil') && !f.includes('nonfoil');
}

function getPrice(card: ScryfallCard, foil: boolean): number {
  return parseFloat(foil ? (card.prices?.usd_foil || '0') : (card.prices?.usd || '0')) || 0;
}

export default function BoosterPage() {
  const [sets, setSets] = useState<Array<{ setCode: string; setName: string; hasBoosters: number }>>([]);
  const [setCode, setSetCode] = useState<string | null>(null);
  const [boosterType, setBoosterType] = useState<string>('draft');
  const [customSlots, setCustomSlots] = useState<number>(15);
  const [useCustomSlots, setUseCustomSlots] = useState(false);
  const [boosterPrice, setBoosterPrice] = useState<number | ''>(4.99);
  const [allCards, setAllCards] = useState<ScryfallCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [activeSlotIdx, setActiveSlotIdx] = useState<number | null>(null);
  const [collectorInput, setCollectorInput] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewAllOpened, { open: openViewAll, close: closeViewAll }] = useDisclosure(false);
  const [viewAllSearch, setViewAllSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const slotCount = useCustomSlots ? customSlots : (BOOSTER_TYPES[boosterType]?.slots ?? 15);

  useEffect(() => {
    api.sets().then(setSets).catch(() => {});
    api.locations.list().then(setLocations).catch(() => {});
    loadHistory();
  }, []);

  useEffect(() => {
    if (activeSlotIdx !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeSlotIdx]);

  useEffect(() => {
    if (setCode) {
      setLoading(true);
      api.cards.setCards(setCode).then(cards => {
        setAllCards(cards);
        setSlots(Array.from({ length: slotCount }, () => ({ card: null, foil: false, locationId: null })));
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
        while (next.length < slotCount) next.push({ card: null, foil: false, locationId: null });
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
      next[activeSlotIdx] = {
        card,
        foil: foilOnly || (next[activeSlotIdx]?.foil ?? false),
        locationId: next[activeSlotIdx]?.locationId ?? null,
      };
      return next;
    });
    setCollectorInput('');
    setActiveSlotIdx(null);
  };

  const handleRemoveFromSlot = (idx: number) => {
    setSlots(prev => {
      const next = [...prev];
      next[idx] = { card: null, foil: false, locationId: null };
      return next;
    });
  };

  const toggleSlotFoil = (idx: number) => {
    setSlots(prev => {
      const next = [...prev];
      const card = next[idx].card;
      if (card && isFoilOnly(card)) return next;
      next[idx] = { ...next[idx], foil: !next[idx].foil };
      return next;
    });
  };

  const handleCardClick = (card: ScryfallCard) => {
    const foilOnly = isFoilOnly(card);
    const emptyIdx = slots.findIndex(s => s.card === null);
    if (emptyIdx === -1) {
      notifications.show({ title: 'Full', message: 'All slots are filled', color: 'yellow' });
      return;
    }
    setSlots(prev => {
      const next = [...prev];
      next[emptyIdx] = { card, foil: foilOnly, locationId: null };
      return next;
    });
    closeViewAll();
  };

  const filledSlots = slots.filter(s => s.card !== null);
  const totalValue = filledSlots.reduce((sum, s) => sum + getPrice(s.card!, s.foil), 0);
  const price = typeof boosterPrice === 'number' ? boosterPrice : 0;
  const result = totalValue - price;
  const resultColor = result > 0 ? 'green' : result < 0 ? 'red' : 'gray';

  const handleSave = async () => {
    if (!setCode || filledSlots.length === 0) return;
    setSaving(true);
    try {
      const pulls = filledSlots.map((s, i) => ({
        cardId: s.card!.id,
        foil: s.foil,
        slotIndex: i,
        locationId: s.locationId,
      }));
      await api.booster.finish({ setCode, boosterType, boosterPrice: price, pulls });
      notifications.show({ title: 'Saved', message: `Added ${filledSlots.length} cards to collection`, color: 'green' });
      setSlots(Array.from({ length: slotCount }, () => ({ card: null, foil: false, locationId: null })));
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

  return (
    <>
      <Alert icon={<IconAlertTriangle size={18} />} color="yellow" variant="filled" mb="md" px="lg" py="sm"
        styles={{ message: { fontSize: 15, fontWeight: 600, textAlign: 'center' } }}>
        This is a beta feature and may currently have some bugs. We do not recommend using these features yet.
      </Alert>
      <Group mb="md" justify="space-between">
        <Title order={2}>Booster Opener</Title>
        <Button variant="light" leftSection={<IconHistory size={16} />} onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? 'New Pack' : 'History'}
        </Button>
      </Group>

      {showHistory ? (
        <Box>
          {history.length === 0 && <Text c="dimmed" py="xl" ta="center">No booster history yet</Text>}
          {history.map((s: any) => {
            const t = BOOSTER_TYPES[s.boosterType] || { label: s.boosterType };
            const pullsWithDetails = s.pulls?.length || 0;
            return (
              <Paper key={s.id} withBorder p="sm" mb="sm" radius="md">
                <Group justify="space-between">
                  <div>
                    <Text fw={500} size="sm">{s.setCode.toUpperCase()} — {t.label}</Text>
                    <Text size="xs" c="dimmed">{new Date(s.createdAt).toLocaleDateString()} · {pullsWithDetails} cards</Text>
                  </div>
                  <Group gap="md">
                    <Text size="sm">${Number(s.boosterPrice).toFixed(2)}</Text>
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
        </Box>
      ) : (
        <>
          <Group mb="md" gap="sm" align="flex-end">
            <Select
              label="Set"
              placeholder="Select a set"
              data={visibleSets.map(s => ({ value: s.setCode, label: `${s.setCode.toUpperCase()} — ${s.setName}` }))}
              value={setCode}
              onChange={v => { setSetCode(v); setShowHistory(false); }}
              searchable w={350} size="sm"
              data-tour="booster-set"
            />
            <Select
              label="Booster Type"
              data={Object.entries(BOOSTER_TYPES).map(([k, v]) => ({ value: k, label: `${v.label} (${v.slots} cards)` }))}
              value={boosterType}
              onChange={v => setBoosterType(v!)}
              w={220} size="sm"
            />
            <NumberInput
              label={useCustomSlots ? 'Custom Slot Count' : 'Slot Count'}
              value={slotCount}
              onChange={v => setCustomSlots(typeof v === 'number' ? v : (v === '' ? 15 : parseInt(v) || 15))}
              min={1} max={60} w={100} size="sm"
              disabled={!useCustomSlots}
            />
            <Button size="compact-sm" variant={useCustomSlots ? 'filled' : 'outline'} color="gray"
              onClick={() => setUseCustomSlots(!useCustomSlots)}
              style={{ marginBottom: 2 }}
            >
              Custom
            </Button>
            <NumberInput
              label="Price Paid ($)"
              value={boosterPrice}
              onChange={v => setBoosterPrice(typeof v === 'number' ? v : (v === '' ? '' : parseFloat(v) || 0))}
              min={0} decimalScale={2} w={120} size="sm"
            />
          </Group>

          {loading && <LoadingOverlay visible />}

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
              <Group gap={6}>
                {chaseCards.map(c => (
                  <Card key={c.id} withBorder padding={4} radius="sm" w={100} style={{ cursor: 'pointer' }}
                    onClick={() => handleCardClick(c)}
                  >
                    <CardThumb card={c} />
                    <Text size="xs" fw={500} ta="center" lineClamp={1}>{c.name}</Text>
                    <Text size="xs" ta="center" c="green" fw={600}>
                      ${Math.max(getPrice(c, false), getPrice(c, true)).toFixed(2)}
                    </Text>
                  </Card>
                ))}
              </Group>
            </Paper>
          )}

          {setCode && allCards.length > 0 && (
            <>
              <Paper withBorder p="sm" mb="sm" radius="md">
                <Group justify="space-between" mb="sm">
                  <Text fw={600} size="sm">Pack Slots ({filledSlots.length}/{slots.length})</Text>
                  <Group gap="xs">
                    {activeSlotIdx !== null && (
                      <Text size="xs" c="dimmed">Type a collector number</Text>
                    )}
                    <Button size="compact-xs" variant="subtle" leftSection={<IconCards size={14} />} onClick={openViewAll}>
                      Browse All
                    </Button>
                  </Group>
                </Group>

                <SimpleGrid cols={{ base: 3, sm: 5, md: 5 }} spacing="sm">
                  {slots.map((slot, idx) => (
                    <Box key={idx}>
                      {slot.card ? (
                        <Card withBorder padding={4} radius="sm"
                          bg={slot.foil ? 'var(--mantine-color-yellow-0)' : undefined}
                          style={{ cursor: 'pointer' }}
                          onClick={() => handleSlotClick(idx)}
                        >
                          <CardThumb card={slot.card!} foil={slot.foil} />
                          <Text size="xs" fw={500} lineClamp={1} ta="center">{slot.card!.name}</Text>
                          <Group gap={2} justify="center" mt={2}>
                            <Text size="xs" c="dimmed">{slot.card!.collectorNumber}</Text>
                            {slot.foil && <Text size="xs" c="yellow" fw={700}>✦</Text>}
                          </Group>
                          <Group gap={4} justify="center" mt={2}>
                            <Badge size="xs" color="green" variant="light">
                              ${getPrice(slot.card!, slot.foil).toFixed(2)}
                            </Badge>
                            {!isFoilOnly(slot.card!) && (
                              <Button size="compact-xs" variant={slot.foil ? 'filled' : 'outline'} color="yellow"
                                onClick={e => { e.stopPropagation(); toggleSlotFoil(idx); }}
                                style={{ minWidth: 22, height: 18, padding: 0 }}
                              >✦</Button>
                            )}
                            {isFoilOnly(slot.card!) && (
                              <Badge size="xs" color="yellow" variant="light">Foil</Badge>
                            )}
                          </Group>
                          <Button size="compact-xs" variant="subtle" color="red" fullWidth mt={2}
                            onClick={e => { e.stopPropagation(); handleRemoveFromSlot(idx); }}
                            style={{ height: 20 }}
                          >Remove</Button>
                        </Card>
                      ) : (
                        <Card withBorder padding="md" radius="sm"
                          style={{ cursor: 'pointer', minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => handleSlotClick(idx)}
                          bg={activeSlotIdx === idx ? 'var(--mantine-color-blue-0)' : undefined}
                        >
                          <IconPlus size={24} opacity={0.3} />
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
                    Cards will be added with prorated cost of ${filledSlots.length > 0 ? (price / filledSlots.length).toFixed(2) : '0.00'} each.
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
                        clearable w={180} size="xs"
                      />
                    </Group>
                    );
                  })}
                  <Group justify="flex-end" mt="md">
                    <Button
                      leftSection={<IconCheck size={16} />}
                      onClick={handleSave}
                      loading={saving}
                      disabled={filledSlots.length === 0}
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
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="sm">
            {viewAllFiltered.map(c => {
              const foilOnly = isFoilOnly(c);
              const bestPrice = Math.max(getPrice(c, false), getPrice(c, true));
              return (
                <Card key={c.id} withBorder padding={4} radius="sm" style={{ cursor: 'pointer' }}
                  onClick={() => handleCardClick(c)}
                >
                  <CardThumb card={c} />
                  <Text size="xs" fw={500} lineClamp={1} ta="center">{c.name}</Text>
                  <Group gap={2} justify="center">
                    <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                    {foilOnly && <Badge size="xs" color="yellow" variant="light">Foil</Badge>}
                  </Group>
                  <Group gap={4} justify="center">
                    <Badge size="xs" variant="light">{c.rarity}</Badge>
                    {bestPrice > 0 && <Badge size="xs" color="green" variant="light">${bestPrice.toFixed(2)}</Badge>}
                  </Group>
                </Card>
              );
            })}
          </SimpleGrid>
        </ScrollArea>
      </Modal>
    </>
  );
}
