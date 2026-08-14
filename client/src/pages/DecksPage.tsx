import { useState, useEffect, Component, type ReactNode, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Title, Group, Text, Card as MCard, SimpleGrid, Modal, Button, TextInput,
  LoadingOverlay, Box, Paper, Badge, ActionIcon, Tooltip, ScrollArea, Select, Switch, NumberInput, SegmentedControl, Collapse,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash, IconPencil, IconSearch, IconCards, IconArrowLeft, IconArchive, IconArrowRight, IconList, IconChevronDown, IconChevronRight, IconGhost, IconFlame, IconCalendarClock, IconBolt } from '@tabler/icons-react';
import { api, authFetch } from '../api/client';
import { CONDITIONS } from '../types';
import type { ScryfallCard, CollectionItem, Location, Condition, GroupedCard } from '../types';
import { CardThumb, SetSymbol, GhostThumb } from '../components/CardDisplay';
import { DeckFormModal, DECK_TYPES, CommanderThumb, DeckArtwork, type DeckFormValues } from '../components/DeckFormModal';
import { CardGroup } from '../components/CardGroup';
import { useUndo } from '../components/UndoToasts';

interface Deck {
  id: number;
  name: string;
  description: string | null;
  cardId: string | null;
  deckType: string;
  commanderCardId: string | null;
  partnerCardId: string | null;
  backgroundCardId: string | null;
  commanderItemId: number | null;
  partnerItemId: number | null;
  backgroundItemId: number | null;
  locationId: number | null;
  createdAt: string;
  cardCount: number;
}

interface RequiredCard {
  id: number;
  deckId: number;
  cardId: string | null;
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
  quantity: number;
  fillItemId: number | null;
  fillSourceName: string | null;
}

type PickEntry = {
  key: string;
  name: string;
  typeLine: string | null;
  copyInfo?: string;
  cardId: string | null;
  itemId: number | null;
  reqId?: number;
  card: CollectionItem['card'] | null;
  thumb: ReactNode;
};

const CONDITION_COLORS: Record<string, string> = {
  M: '#2e7d32', NM: '#00897b', LP: '#1565c0',
  MP: '#f9a825', HP: '#e65100', Dmg: '#c62828',
};

const PRINTINGS_PAGE_SIZE = 50;

const CID_COLORS: Record<string, string> = {
  W: '#f8d558', U: '#2a6fbf', B: '#444444', R: '#d33f2d', G: '#3f9c47', C: '#666666',
};

const GAME_CHANGERS = new Set([
  'Ancient Tomb', 'Arcbound Ravager', "Bolas's Citadel", 'Carpet of Flowers', 'Chrome Mox',
  'Consecrated Sphinx', 'Cyclonic Rift', 'Demonic Consultation', 'Demonic Tutor', 'Dockside Extortionist',
  'Enlightened Tutor', 'Expropriate', 'Force of Will', "Gaea's Cradle", 'Grim Monolith',
  'Imperial Seal', 'Jeweled Lotus', 'Jin-Gitaxias, Core Augur', 'Kinnan, Bonder Prodigy', 'Library of Alexandria',
  "Lion's Eye Diamond", 'Mana Crypt', 'Mana Drain', 'Mana Vault', 'Mox Diamond',
  'Mox Opal', 'Mystical Tutor', 'Necropotence', 'Rhystic Study', "Serra's Sanctum",
  'Smothering Tithe', 'Sneak Attack', 'Timetwister', 'Vampiric Tutor', 'Wheel of Fortune',
  'Worldly Tutor',
]);

const isGameChanger = (name: string): boolean => GAME_CHANGERS.has(name);

const estimateBracket = (gcCount: number): number => {
  if (gcCount === 0) return 1;
  if (gcCount <= 3) return 2;
  return 3;
};

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return <Text c="red" p="md">Error: {this.state.error.message}</Text>;
    }
    return this.props.children;
  }
}

export default function DecksPage() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [deckCards, setDeckCards] = useState<CollectionItem[]>([]);
  const [requiredCards, setRequiredCards] = useState<RequiredCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);
  const [artworkOpened, { open: openArtwork, close: closeArtwork }] = useDisclosure(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [artworkDeckId, setArtworkDeckId] = useState<number | null>(null);
  const [artworkSearch, setArtworkSearch] = useState('');
  const [artworkResults, setArtworkResults] = useState<ScryfallCard[]>([]);
  const [addCardSearch, setAddCardSearch] = useState('');
  const [addCardResults, setAddCardResults] = useState<GroupedCard[]>([]);
  const [addPrintings, setAddPrintings] = useState<Record<string, ScryfallCard[]>>({});
  const [addPrintingsTotal, setAddPrintingsTotal] = useState<Record<string, number>>({});
  const [addExpanded, setAddExpanded] = useState<Set<string>>(new Set());
  const [addLoadingPrintings, setAddLoadingPrintings] = useState<Set<string>>(new Set());
  const [locations, setLocations] = useState<Location[]>([]);
  const [addingCardId, setAddingCardId] = useState<string | null>(null);
  const [externalCard, setExternalCard] = useState<ScryfallCard | null>(null);
  const [externalQty, setExternalQty] = useState(1);
  const [externalLoc, setExternalLoc] = useState<string | null>(null);
  const [externalOpened, { open: openExternal, close: closeExternal }] = useDisclosure(false);
  const [collectionPickCard, setCollectionPickCard] = useState<ScryfallCard | null>(null);
  const [collectionPickItems, setCollectionPickItems] = useState<CollectionItem[]>([]);
  const [collectionPickOpened, { open: openCollectionPick, close: closeCollectionPick }] = useDisclosure(false);
  const [legality, setLegality] = useState<{ format: string; legal: boolean; totalCards: number; issues: Array<{ type: string; cardName: string; detail: string }>; cardStatuses: Array<{ name: string; status: string }> } | null>(null);
  const [zoneNames, setZoneNames] = useState<{ commander: string | null; second: string | null }>({ commander: null, second: null });
  const [legalityModalOpened, setLegalityModalOpened] = useState(false);
  const [deckSearch, setDeckSearch] = useState('');
  const [deckTypeFilter, setDeckTypeFilter] = useState<string | null>(null);
  const [deckColorFilter, setDeckColorFilter] = useState<string | null>(null);
  const [deckGroupExpanded, setDeckGroupExpanded] = useState<Set<string>>(new Set());
  const { push: pushUndo } = useUndo();
  const [editItem, setEditItem] = useState<CollectionItem | null>(null);
  const [editForm, setEditForm] = useState({ quantity: 1, foil: false, condition: '' as Condition | '', purchasePrice: '', notes: '' });
  const [editCardOpened, { open: openEditCard, close: closeEditCard }] = useDisclosure(false);
  const [moveItems, setMoveItems] = useState<CollectionItem[]>([]);
  const [moveDestLoc, setMoveDestLoc] = useState<string | null>(null);
  const [moveMode, setMoveMode] = useState<'move' | 'schedule'>('move');
  const [moveOpened, { open: openMove, close: closeMove }] = useDisclosure(false);
  const [ghostMoveReq, setGhostMoveReq] = useState<RequiredCard | null>(null);
  const [ghostMoveDestType, setGhostMoveDestType] = useState<'location' | 'deck'>('location');
  const [ghostMoveDestId, setGhostMoveDestId] = useState<string | null>(null);
  const [fillReqId, setFillReqId] = useState<number | null>(null);
  const [fillCardName, setFillCardName] = useState('');
  const [fillCollectionItems, setFillCollectionItems] = useState<CollectionItem[]>([]);
  const [fillOpened, { open: openFill, close: closeFill }] = useDisclosure(false);
  const [pickAddingId, setPickAddingId] = useState<number | null>(null);
  const [schedConfirm, setSchedConfirm] = useState<{ item: CollectionItem; mode: 'now' | 'schedule'; source: 'link' | 'fill' } | null>(null);
  const [schedOverwrite, setSchedOverwrite] = useState<{ items: CollectionItem[]; destId: number } | null>(null);

  const loadDecks = async () => {
    setLoading(true);
    try {
      const d = await api.decks.list();
      setDecks(d);
    } catch {
      notifications.show({ title: 'Error', message: 'Failed to load decks', color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  const loadDeckCards = async (deckId: number) => {
    setCardsLoading(true);
    try {
      const [cards, req, leg] = await Promise.all([
        api.decks.cards(deckId),
        api.decks.required(deckId),
        api.decks.legality(deckId).catch(() => null),
      ]);
      setDeckCards(cards);
      setRequiredCards(req);
      setLegality(leg);
    } catch {
      notifications.show({ title: 'Error', message: 'Failed to load deck cards', color: 'red' });
    } finally {
      setCardsLoading(false);
    }
  };

  useEffect(() => { loadDecks(); api.locations.list().then(setLocations).catch(() => {}); }, []);

  useEffect(() => {
    const d = selectedDeck;
    if (!d) { setZoneNames({ commander: null, second: null }); return; }
    const entries = [
      { id: d.commanderCardId, key: 'commander' as const },
      { id: d.partnerCardId, key: 'second' as const },
      { id: d.backgroundCardId, key: 'second' as const },
    ].filter(e => e.id);
    if (entries.length === 0) { setZoneNames({ commander: null, second: null }); return; }
    Promise.all(entries.map(e => api.cards.get(e.id!).catch(() => null)))
      .then(cards => {
        const names: { commander: string | null; second: string | null } = { commander: null, second: null };
        entries.forEach((e, i) => { names[e.key] = cards[i]?.name ?? null; });
        setZoneNames(names);
      })
      .catch(() => {});
  }, [selectedDeck?.commanderCardId, selectedDeck?.partnerCardId, selectedDeck?.backgroundCardId]);

  useEffect(() => {
    const q = addCardSearch.trim();
    if (q.length < 2) { setAddCardResults([]); setAddPrintings({}); setAddPrintingsTotal({}); return; }
    const timeout = setTimeout(async () => {
      const isSmart = /^[a-z]{2,4}\s*\d+/i.test(q) || /^s:\S+\s+cn:\S+$/i.test(q);
      try {
        if (isSmart) {
          const cards = await api.cards.find(q, { counts: true });
          const groups: Record<string, ScryfallCard[]> = {};
          for (const c of cards) {
            if (!groups[c.name]) groups[c.name] = [];
            groups[c.name].push(c as unknown as ScryfallCard);
          }
          const names = Object.keys(groups);
          const result = names.map(n => ({
            id: groups[n][0]?.id ?? n,
            name: n,
            typeLine: groups[n][0]?.typeLine ?? null,
            manaCost: groups[n][0]?.manaCost ?? null,
            cmc: groups[n][0]?.cmc ?? null,
            colors: groups[n][0]?.colors ?? null,
            imageUris: groups[n][0]?.imageUris ?? null,
            cardFaces: groups[n][0]?.cardFaces ?? null,
            layout: groups[n][0]?.layout ?? null,
            printings: groups[n].length,
            firstPrinting: null,
            lastPrinting: null,
          }));
          const counts = await api.collection.counts(names).catch(() => ({})) as Record<string, number>;
          result.forEach(r => { (r as any).collectionCount = counts[r.name] || 0; });
          setAddCardResults(result);
          setAddPrintings(groups as unknown as Record<string, ScryfallCard[]>);
          setAddPrintingsTotal({});
          setAddExpanded(new Set());
        } else {
          const res = await api.cards.grouped(q, 1, undefined, { counts: true });
          setAddCardResults(res.data);
          setAddPrintings({});
          setAddPrintingsTotal({});
          setAddExpanded(new Set());
        }
      } catch { setAddCardResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [addCardSearch]);

  useEffect(() => {
    if (artworkSearch.trim().length < 2) { setArtworkResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await api.cards.find(artworkSearch);
        setArtworkResults(res.slice(0, 30) as unknown as ScryfallCard[]);
      } catch { setArtworkResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [artworkSearch]);

  const [searchParams, setSearchParams] = useSearchParams();

  const openDeck = (deck: Deck) => {
    setSelectedDeck(deck);
    setAddCardSearch('');
    setAddCardResults([]);
    loadDeckCards(deck.id);
  };

  useEffect(() => {
    const deckId = searchParams.get('deck');
    if (!deckId || selectedDeck) return;
    const d = decks.find(x => String(x.id) === deckId);
    if (d) openDeck(d);
  }, [decks, searchParams, selectedDeck]);

  const closeDeck = () => {
    setSelectedDeck(null);
    setDeckCards([]);
    setRequiredCards([]);
    setSearchParams({}, { replace: true });
  };

  const loadPrintings = async (name: string, page: number) => {
    setAddLoadingPrintings(prev => new Set(prev).add(name));
    try {
      const res = await api.cards.printingsPaged(name, page, PRINTINGS_PAGE_SIZE, { counts: true });
      setAddPrintings(prev => {
        const existing = prev[name] || [];
        const merged = page === 1 ? res.data : [...existing, ...res.data];
        return { ...prev, [name]: merged };
      });
      setAddPrintingsTotal(prev => ({ ...prev, [name]: res.total }));
    } catch {}
    setAddLoadingPrintings(prev => { const n = new Set(prev); n.delete(name); return n; });
  };

  const toggleAddPrintings = (name: string) => {
    if (addExpanded.has(name)) {
      setAddExpanded(prev => { const n = new Set(prev); n.delete(name); return n; });
      return;
    }
    setAddExpanded(prev => new Set(prev).add(name));
    if (!addPrintings[name] || addPrintings[name].length === 0) {
      loadPrintings(name, 1);
    }
  };

  const loadMorePrintings = (name: string) => {
    const loaded = addPrintings[name]?.length || 0;
    const total = addPrintingsTotal[name] ?? loaded;
    if (loaded >= total) return;
    const nextPage = Math.floor(loaded / PRINTINGS_PAGE_SIZE) + 1;
    loadPrintings(name, nextPage);
  };

  const handleAddExternal = (card: ScryfallCard) => {
    setExternalCard(card);
    setExternalQty(1);
    const inbox = locations.find(l => l.name === 'Inbox' || (l as any).builtIn);
    setExternalLoc(locations.length > 0 ? String(inbox?.id ?? locations[0].id) : null);
    openExternal();
  };

  const handleConfirmExternal = async () => {
    if (!selectedDeck || !externalCard || !externalLoc) {
      notifications.show({ title: 'Error', message: 'Choose a location first', color: 'red' });
      return;
    }
    setAddingCardId(externalCard.id);
    try {
      await api.decks.addCard(selectedDeck.id, { cardId: externalCard.id, locationId: Number(externalLoc), quantity: externalQty });
      notifications.show({ title: 'Added', message: `${externalCard.name} added to deck`, color: 'green' });
      closeExternal();
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setAddingCardId(null);
    }
  };

  const handleAddGhost = async (card: ScryfallCard) => {
    if (!selectedDeck) return;
    setAddingCardId(card.id);
    try {
      const created = await api.decks.addRequired(selectedDeck.id, {
        cardId: card.id, cardName: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber, quantity: 1,
      });
      const wl = await api.wantlist.add({ cardId: card.id, cardName: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber, notes: `Wanted for deck: ${selectedDeck.name}`, quantity: 1, deckRequiredId: created.id, destinationId: selectedDeck.locationId }).catch(() => null);
      pushUndo(`${card.name} added as ghost card`, async () => {
        await api.decks.removeRequired(selectedDeck.id, created.id).catch(() => {});
        if (wl?.id) await api.wantlist.remove(wl.id).catch(() => {});
        loadDeckCards(selectedDeck.id);
      }, 'Undo ghost');
      notifications.show({ title: 'Ghost added', message: `${card.name} added as ghost card`, color: 'green' });
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setAddingCardId(null);
    }
  };

  const handleAddGhostByName = async (name: string) => {
    if (!selectedDeck) return;
    try {
      const created = await api.decks.addRequired(selectedDeck.id, { cardName: name, quantity: 1 });
      const wl = await api.wantlist.add({ cardName: name, quantity: 1, notes: `Wanted for deck: ${selectedDeck.name}`, deckRequiredId: created.id, destinationId: selectedDeck.locationId }).catch(() => null);
      pushUndo(`${name} added as ghost card`, async () => {
        await api.decks.removeRequired(selectedDeck.id, created.id).catch(() => {});
        if (wl?.id) await api.wantlist.remove(wl.id).catch(() => {});
        loadDeckCards(selectedDeck.id);
      }, 'Undo ghost');
      notifications.show({ title: 'Ghost added', message: `${name} added as ghost card`, color: 'green' });
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleOpenCollectionPick = async (card: ScryfallCard) => {
    setCollectionPickCard(card);
    setCollectionPickItems([]);
    openCollectionPick();
    try {
      const res = await authFetch(`/api/collection/grouped?q=${encodeURIComponent(card.name)}`);
      const data = await res.json();
      const items = data.groups?.flatMap((g: any) => g.items) || [];
      setCollectionPickItems(items.filter((i: CollectionItem) => i.card && i.card.name.toLowerCase() === card.name.toLowerCase()));
    } catch {
      setCollectionPickItems([]);
    }
  };

  const doDeckAdd = async (item: CollectionItem, mode: 'now' | 'schedule') => {
    if (!selectedDeck) return;
    const schedule = mode === 'schedule';
    if (schedule && !selectedDeck.locationId) {
      notifications.show({ title: 'Deck has no location', message: 'This deck is missing its location. Recreate it or contact support.', color: 'yellow' });
      return;
    }
    setPickAddingId(item.id);
    try {
      await api.decks.linkFromCollection(selectedDeck.id, item.id, schedule);
      pushUndo(`${item.card.name} added to deck`, async () => {
        await api.decks.removeCard(selectedDeck.id, item.id).catch(() => {});
        await api.collection.update(item.id, { destinationId: item.destinationId } as any).catch(() => {});
        loadDeckCards(selectedDeck.id);
      }, 'Undo add');
      notifications.show({
        title: mode === 'now' ? 'Moved' : 'Scheduled',
        message: mode === 'now' ? `${item.card.name} added to deck` : `${item.card.name} added to deck, move scheduled`,
        color: 'green',
      });
      closeCollectionPick();
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setPickAddingId(null);
    }
  };

  const handleDeckPickAction = (item: CollectionItem, mode: 'now' | 'schedule', source: 'link' | 'fill') => {
    if (item.destinationId) {
      setSchedConfirm({ item, mode, source });
    } else if (source === 'link') {
      doDeckAdd(item, mode);
    } else {
      doFillCard(item, mode);
    }
  };

  const confirmSchedAction = () => {
    if (!schedConfirm) return;
    const { item, mode, source } = schedConfirm;
    setSchedConfirm(null);
    if (source === 'link') doDeckAdd(item, mode);
    else doFillCard(item, mode);
  };

  const handleRemoveRequired = async (reqId: number) => {
    if (!selectedDeck) return;
    const req = requiredCards.find(r => r.id === reqId);
    try {
      await api.decks.removeRequired(selectedDeck.id, reqId);
      if (req) {
        pushUndo(`${req.cardName} ghost removed from deck`, async () => {
          await api.decks.addRequired(selectedDeck.id, {
            cardId: req.cardId ?? undefined,
            cardName: req.cardName,
            setCode: req.setCode ?? undefined,
            collectorNumber: req.collectorNumber ?? undefined,
            quantity: req.quantity,
          }).catch(() => {});
          loadDeckCards(selectedDeck.id);
        }, 'Undo remove');
      }
      notifications.show({ title: 'Removed', message: 'Wishlist card removed', color: 'green' });
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openFillDialog = async (req: RequiredCard) => {
    setFillReqId(req.id);
    setFillCardName(req.cardName);
    try {
      const res = await authFetch(`/api/collection/grouped?q=${encodeURIComponent(req.cardName)}`);
      const data = await res.json();
      const items = data.groups?.flatMap((g: any) => g.items) || [];
      setFillCollectionItems(items.filter((i: CollectionItem) => i.card && i.card.name.toLowerCase() === req.cardName.toLowerCase()));
    } catch { setFillCollectionItems([]); }
    openFill();
  };

  const doFillCard = async (item: CollectionItem, mode: 'now' | 'schedule') => {
    if (!selectedDeck || fillReqId === null) return;
    const schedule = mode === 'schedule';
    if (schedule && !selectedDeck.locationId) {
      notifications.show({ title: 'Deck has no location', message: 'This deck is missing its location. Recreate it or contact support.', color: 'yellow' });
      return;
    }
    setPickAddingId(item.id);
    try {
      await api.decks.fillRequired(selectedDeck.id, fillReqId, item.id, schedule);
      notifications.show({
        title: mode === 'now' ? 'Filled' : 'Scheduled',
        message: mode === 'now' ? 'Card added to deck from collection' : 'Card added to deck, move scheduled',
        color: 'green',
      });
      closeFill();
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setPickAddingId(null);
    }
  };

  const handleCreate = async (values: DeckFormValues) => {
    if (!values.name.trim()) return;
    try {
      const created = await api.decks.create({
        name: values.name.trim(), description: values.description.trim() || undefined,
        deckType: values.deckType, commanderCardId: values.commanderCardId || null,
        partnerCardId: values.partnerCardId || null, backgroundCardId: values.backgroundCardId || null,
        cardId: values.cardId || values.commanderCardId || undefined,
      });
      notifications.show({ title: 'Created', message: 'Deck created', color: 'green' });
      closeCreate();
      loadDecks();
      setSelectedDeck({ ...created, cardCount: 0 });
      loadDeckCards(created.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleEdit = async (values: DeckFormValues) => {
    if (!editingId || !values.name.trim()) return;
    try {
      const updated = await api.decks.update(editingId, {
        name: values.name.trim(), description: values.description.trim() || null,
        deckType: values.deckType, commanderCardId: values.commanderCardId || null,
        partnerCardId: values.partnerCardId || null, backgroundCardId: values.backgroundCardId || null,
        cardId: values.cardId || undefined,
      });
      notifications.show({ title: 'Updated', message: 'Deck updated', color: 'green' });
      closeEdit();
      loadDecks();
      if (selectedDeck && selectedDeck.id === editingId) {
        setSelectedDeck(prev => prev ? { ...prev, ...updated } : null);
        loadDeckCards(editingId);
      }
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleSetCommandFromDeck = async (cardId: string, itemId: number | null, mode: 'commander' | 'partner' | 'background') => {
    if (!selectedDeck) return;
    try {
      const updated = await api.decks.update(selectedDeck.id, mode === 'commander'
        ? {
            commanderCardId: cardId,
            commanderItemId: itemId,
            partnerCardId: selectedDeck.partnerCardId === cardId ? null : selectedDeck.partnerCardId,
            backgroundCardId: selectedDeck.backgroundCardId === cardId ? null : selectedDeck.backgroundCardId,
            partnerItemId: selectedDeck.partnerCardId === cardId ? null : selectedDeck.partnerItemId,
            backgroundItemId: selectedDeck.backgroundCardId === cardId ? null : selectedDeck.backgroundItemId,
            cardId: selectedDeck.cardId ?? cardId,
          }
        : mode === 'partner'
          ? {
              partnerCardId: cardId,
              partnerItemId: itemId,
              backgroundCardId: null,
              backgroundItemId: null,
              commanderCardId: selectedDeck.commanderCardId === cardId ? null : selectedDeck.commanderCardId,
              commanderItemId: selectedDeck.commanderCardId === cardId ? null : selectedDeck.commanderItemId,
            }
          : {
              partnerCardId: null,
              partnerItemId: null,
              backgroundCardId: cardId,
              backgroundItemId: itemId,
              commanderCardId: selectedDeck.commanderCardId === cardId ? null : selectedDeck.commanderCardId,
              commanderItemId: selectedDeck.commanderCardId === cardId ? null : selectedDeck.commanderItemId,
            });
      setSelectedDeck(prev => prev ? { ...prev, ...updated } : prev);
      loadDeckCards(selectedDeck.id);
      notifications.show({ title: 'Updated', message: `${mode[0].toUpperCase() + mode.slice(1)} set`, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.decks.delete(id);
      notifications.show({ title: 'Deleted', message: 'Deck deleted', color: 'green' });
      if (selectedDeck?.id === id) closeDeck();
      loadDecks();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleSetArtwork = async (cardId: string) => {
    if (!artworkDeckId) return;
    try {
      await api.decks.setArtwork(artworkDeckId, cardId);
      notifications.show({ title: 'Artwork updated', message: 'Deck artwork changed', color: 'green' });
      closeArtwork();
      loadDecks();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openEditDialog = (deck: Deck) => {
    setEditingId(deck.id);
    setEditingDeck(deck);
    openEdit();
  };

  const openCreateDialog = () => {
    setEditingId(null);
    setEditingDeck(null);
    openCreate();
  };

  const openArtworkDialog = (deckId: number) => {
    setArtworkDeckId(deckId);
    setArtworkSearch('');
    setArtworkResults([]);
    openArtwork();
  };

  const openEditCardDialog = (item: CollectionItem) => {
    setEditItem(item);
    setEditForm({
      quantity: item.quantity, foil: !!item.foil,
      condition: (item.condition || '') as Condition | '',
      purchasePrice: item.purchasePrice ? String(item.purchasePrice) : '',
      notes: item.notes || '',
    });
    openEditCard();
  };

  const handleSaveEditCard = async () => {
    if (!editItem) return;
    try {
      await api.collection.update(editItem.id, {
        quantity: editForm.quantity, foil: editForm.foil ? 1 : 0, condition: editForm.condition || null,
        purchasePrice: editForm.purchasePrice ? parseFloat(editForm.purchasePrice) : null, notes: editForm.notes || null,
      } as any);
      notifications.show({ title: 'Updated', message: 'Item updated', color: 'green' });
      closeEditCard();
      if (selectedDeck) loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openMoveDialog = (items: CollectionItem[]) => {
    setMoveItems(items);
    setMoveMode('move');
    const inbox = locations.find(l => l.name === 'Inbox' || (l as any).builtIn);
    setMoveDestLoc(locations.length > 0 ? String(inbox?.id ?? locations[0].id) : null);
    openMove();
  };

  const openScheduleDialog = (items: CollectionItem[]) => {
    setMoveItems(items);
    setMoveMode('schedule');
    const inbox = locations.find(l => l.name === 'Inbox' || (l as any).builtIn);
    setMoveDestLoc(locations.length > 0 ? String(inbox?.id ?? locations[0].id) : null);
    openMove();
  };

  const handleMove = async () => {
    if (!moveDestLoc || moveItems.length === 0) return;
    try {
      await api.collection.move(moveItems.map(i => ({ id: i.id })), Number(moveDestLoc));
      notifications.show({ title: 'Moved', message: `${moveItems.length} card(s) moved`, color: 'green' });
      closeMove();
      if (selectedDeck) loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleScheduleMove = async () => {
    if (!moveDestLoc || moveItems.length === 0) return;
    const destId = Number(moveDestLoc);
    if (moveItems.some(i => i.destinationId != null)) {
      setSchedOverwrite({ items: moveItems, destId });
      return;
    }
    await doScheduleMove(moveItems, destId);
  };

  const doScheduleMove = async (items: CollectionItem[], destId: number) => {
    try {
      for (const item of items) {
        await api.collection.update(item.id, { destinationId: destId } as any);
      }
      notifications.show({ title: 'Scheduled', message: `${items.length} card(s) scheduled for move`, color: 'green' });
      closeMove();
      setSchedOverwrite(null);
      if (selectedDeck) loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const openGhostMove = (req: RequiredCard) => {
    setGhostMoveReq(req);
    setGhostMoveDestType('location');
    setGhostMoveDestId(null);
  };

  const handleConfirmGhostMove = async () => {
    if (!selectedDeck || !ghostMoveReq || !ghostMoveDestId) return;
    try {
      await api.decks.moveRequired(selectedDeck.id, ghostMoveReq.id, {
        destinationType: ghostMoveDestType,
        destinationId: Number(ghostMoveDestId),
      });
      notifications.show({ title: 'Moved', message: 'Ghost destination updated', color: 'green' });
      setGhostMoveReq(null);
      loadDeckCards(selectedDeck.id);
      loadDecks();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const totalQty = deckCards.reduce((s, i) => s + i.quantity, 0);
  const uniqueCards = deckCards.length;

  const deckStats = (() => {
    const manaCurve: Record<number, number> = {};
    const types: Record<string, number> = {};
    const colors: Record<string, number> = {};
    let avgCmc = 0;
    let cmcCount = 0;

    for (const item of deckCards) {
      const qty = item.quantity || 1;
      const tl = item.card.typeLine || '';
      const primary = ['Land', 'Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Battle', 'Kindred']
        .find(t => tl.includes(t)) || 'Other';
      types[primary] = (types[primary] || 0) + qty;

      const cmc = item.card.cmc ?? 0;
      const bucket = Math.min(7, Math.floor(cmc));
      manaCurve[bucket] = (manaCurve[bucket] || 0) + qty;
      avgCmc += cmc * qty;
      cmcCount += qty;

      if (!tl.includes('Land')) {
        const cid = item.card.colorIdentity || [];
        if (cid.length === 0) colors['C'] = (colors['C'] || 0) + qty;
        else cid.forEach(c => { colors[c] = (colors[c] || 0) + qty; });
      }
    }

    return {
      manaCurve: Array.from({ length: 8 }, (_, i) => ({ cmc: i === 7 ? '7+' : String(i), count: manaCurve[i] || 0 })),
      types,
      colors,
      avgCmc: cmcCount > 0 ? avgCmc / cmcCount : 0,
      landCount: types['Land'] || 0,
    };
  })();

  const filteredDeckCards = deckCards.filter(item => {
    if (deckSearch && !item.card.name.toLowerCase().includes(deckSearch.toLowerCase())) return false;
    if (deckTypeFilter) {
      const tl = item.card.typeLine || '';
      if (!tl.includes(deckTypeFilter)) return false;
    }
    if (deckColorFilter) {
      const cid = item.card.colorIdentity || [];
      if (!cid.includes(deckColorFilter)) return false;
    }
    return true;
  });

  const formatKey = selectedDeck?.deckType === 'commander' ? 'commander' : (selectedDeck?.deckType || '');
  const isCardLegal = (card: { legalities?: Record<string, string> | null }): boolean => {
    const st = card.legalities?.[formatKey];
    if (!st) return true;
    return st !== 'banned' && st !== 'not_legal';
  };

  const gcCount = deckCards.reduce((s, i) => s + (isGameChanger(i.card.name) ? (i.quantity || 1) : 0), 0)
    + requiredCards.filter(r => isGameChanger(r.cardName)).reduce((s, r) => s + r.quantity, 0)
    + (zoneNames.commander && isGameChanger(zoneNames.commander) ? 1 : 0)
    + (zoneNames.second && isGameChanger(zoneNames.second) ? 1 : 0);

  return (
    <ErrorBoundary>
      {selectedDeck ? (
        <>
          <Group mb="md">
            <ActionIcon variant="subtle" onClick={closeDeck}><IconArrowLeft size={20} /></ActionIcon>
            <div style={{ flex: 1 }}>
              <Group gap="xs">
                <Title order={3}>{selectedDeck.name}</Title>
                <ActionIcon variant="subtle" size="sm" onClick={() => openEditDialog(selectedDeck)}><IconPencil size={14} /></ActionIcon>
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => handleDelete(selectedDeck.id)}><IconTrash size={14} /></ActionIcon>
              </Group>
              {selectedDeck.description && <Text size="xs" c="dimmed">{selectedDeck.description}</Text>}
            </div>
            <Group gap="sm">
              <Badge size="sm" variant="light" color="gray">{DECK_TYPES.find(t => t.value === selectedDeck.deckType)?.label || selectedDeck.deckType}</Badge>
              {selectedDeck.deckType === 'commander' && (
                <DeckCommandZone deck={selectedDeck} deckCards={deckCards} requiredCards={requiredCards} onAssign={handleSetCommandFromDeck} />
              )}
              {legality && (
                <Button size="compact-sm" variant={legality.legal ? 'light' : 'filled'}
                  color={legality.legal ? 'green' : 'red'}
                  onClick={() => setLegalityModalOpened(true)}
                >
                  {legality.legal ? 'Legal' : `${legality.issues.length} issue${legality.issues.length !== 1 ? 's' : ''}`}
                </Button>
              )}
            </Group>
          </Group>

          <Paper withBorder p="sm" mb="md" radius="md">
            <Group mb="xs" justify="space-between" align="end" wrap="nowrap">
              <Text size="sm" fw={600}>Add Cards to Deck</Text>
              <Tooltip label="The deck's own location. Scheduled moves send cards here.">
                <Badge size="sm" variant="light" color="teal" leftSection={<IconArchive size={12} />}>
                  {locations.find(l => l.id === selectedDeck.locationId)?.name || 'No location'}
                </Badge>
              </Tooltip>
            </Group>
            <TextInput placeholder="Search cards to add..." value={addCardSearch}
              onChange={e => setAddCardSearch(e.currentTarget.value)} leftSection={<IconSearch size={14} />}
              size="sm" />
            {addCardResults.length > 0 && (
              <Box mt="sm" style={{ maxHeight: 360, overflowY: 'auto' }}>
                {addCardResults.map(group => {
                  const isExpanded = addExpanded.has(group.name);
                  const groupPrintings = addPrintings[group.name];
                  return (
                    <Paper key={group.name} withBorder mb={2} radius={0}>
                      <Group p="xs" gap="sm" wrap="nowrap" style={{ cursor: 'pointer' }}
                        bg="var(--mantine-color-default-hover)"
                        onClick={() => toggleAddPrintings(group.name)}
                      >
                        {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                        <Box w={24} h={34}><CardThumb card={group} /></Box>
                        <div style={{ flex: 1 }}>
                          <Text size="sm" fw={500}>{group.name}</Text>
                          <Text size="xs" c="dimmed">{group.printings || 1} printing{(group.printings || 1) !== 1 ? 's' : ''}</Text>
                        </div>
                        {typeof (group as any).collectionCount === 'number' && (group as any).collectionCount > 0 && (
                          <Badge size="sm" variant="light" color="blue" leftSection={<IconArchive size={12} />}>
                            {(group as any).collectionCount} in collection
                          </Badge>
                        )}
                      </Group>
                      <Collapse in={isExpanded}>
                        {addLoadingPrintings.has(group.name) && <Text size="xs" c="dimmed" p="xs">Loading printings...</Text>}
                        {groupPrintings && groupPrintings.map(c => (
                          <Group key={c.id} p="xs" gap="sm" wrap="nowrap">
                            <Box w={24} h={34}><CardThumb card={c} /></Box>
                            <SetSymbol code={c.setCode} name={c.setName} size={12} />
                            <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                            <Text size="xs" c="dimmed" style={{ flex: 1 }}>{c.setName}</Text>
                            {typeof (c as any).collectionCount === 'number' && (c as any).collectionCount > 0 && (
                              <Badge size="xs" variant="light" color="blue">{`${(c as any).collectionCount} in collection`}</Badge>
                            )}
                            <Button size="compact-xs" variant="light" color="green" leftSection={<IconArchive size={12} />}
                              onClick={() => handleOpenCollectionPick(c)} loading={addingCardId === c.id}>
                              Collection
                            </Button>
                            <Button size="compact-xs" variant="light" leftSection={<IconPlus size={12} />}
                              onClick={() => handleAddExternal(c)} loading={addingCardId === c.id}>
                              External
                            </Button>
                            <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconGhost size={12} />}
                              onClick={() => handleAddGhost(c)} loading={addingCardId === c.id}>
                              Ghost
                            </Button>
                          </Group>
                        ))}
                        {groupPrintings && addPrintingsTotal[group.name] != null && groupPrintings.length < addPrintingsTotal[group.name] && (
                          <Group justify="center" py="xs">
                            <Button size="compact-xs" variant="subtle" color="gray"
                              loading={addLoadingPrintings.has(group.name)}
                              onClick={() => loadMorePrintings(group.name)}>
                              Show more ({addPrintingsTotal[group.name] - groupPrintings.length} more)
                            </Button>
                          </Group>
                        )}
                        <Group p="xs" gap="sm" wrap="nowrap" style={{ opacity: 0.85 }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--mantine-color-default-hover)')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}
                        >
                          <GhostThumb card={group} />
                          <Text size="sm" c="dimmed" fs="italic" style={{ flex: 1 }}>Generic — any printing</Text>
                          <Button size="compact-xs" variant="subtle" color="gray" leftSection={<IconGhost size={12} />}
                            onClick={() => handleAddGhostByName(group.name)}>
                            Ghost
                          </Button>
                        </Group>
                      </Collapse>
                    </Paper>
                  );
                })}
              </Box>
            )}
          </Paper>

          <Modal opened={collectionPickOpened} onClose={closeCollectionPick}
            title={`Add from Collection — ${collectionPickCard?.name || ''}`} size="md" centered>
            {collectionPickItems.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">No copies of this card in your collection.</Text>
            ) : (
              <ScrollArea h={320}>
                {collectionPickItems.map(item => (
                  <Paper key={item.id} withBorder mb={2} radius={0}
                    style={item.destinationId ? { border: '2px solid var(--mantine-color-yellow-6)', background: 'var(--mantine-color-yellow-0)' } : undefined}>
                    <Group p="xs" gap="sm" wrap="nowrap">
                      <Box w={24} h={34}><CardThumb card={item.card} /></Box>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={4}>
                          <SetSymbol code={item.card.setCode} name={item.card.setName} size={12} />
                          <Text size="xs" c="dimmed">#{item.card.collectorNumber}</Text>
                          {item.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge> : null}
                        </Group>
                        <Group gap={6} mt={2}>
                          <Badge size="xs" variant="outline" color="gray">{item.condition || '-'}</Badge>
                          <Badge size="xs" variant="light">{item.quantity}x</Badge>
                          <Text size="xs" c="dimmed">@ {locations.find(l => l.id === item.locationId)?.name || `#${item.locationId}`}</Text>
                        </Group>
                        {item.destinationId && (
                          <Group gap={6} mt={2}>
                            <Badge size="xs" variant="light" color="yellow">
                              {locations.find(l => l.id === item.locationId)?.name || `#${item.locationId}`} → {locations.find(l => l.id === item.destinationId)?.name || `#${item.destinationId}`}
                            </Badge>
                          </Group>
                        )}
                      </div>
                      <Button size="compact-xs" variant="light" color="blue" leftSection={<IconBolt size={12} />}
                        loading={pickAddingId === item.id} onClick={() => handleDeckPickAction(item, 'now', 'link')}>
                        Move now
                      </Button>
                      <Button size="compact-xs" variant="light" color="teal" leftSection={<IconCalendarClock size={12} />}
                        loading={pickAddingId === item.id} onClick={() => handleDeckPickAction(item, 'schedule', 'link')}>
                        Schedule move
                      </Button>
                    </Group>
                  </Paper>
                ))}
              </ScrollArea>
            )}
          </Modal>

          <Modal opened={externalOpened} onClose={closeExternal}
            title={`Add from External — ${externalCard?.name || ''}`} size="sm" centered>
            {externalCard && (
              <Box>
                <Group gap="md" mb="md" wrap="nowrap" align="flex-start">
                  <Box w={100}><CardThumb card={externalCard} /></Box>
                  <div style={{ flex: 1 }}>
                    <Text fw={600} size="sm">{externalCard.name}</Text>
                    <Group gap={4} mt={2}>
                      <SetSymbol code={externalCard.setCode} name={externalCard.setName} size={12} />
                      <Text size="xs" c="dimmed">#{externalCard.collectorNumber}</Text>
                    </Group>
                  </div>
                </Group>
                <Select label="Location" placeholder="Select location" data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                  value={externalLoc} onChange={setExternalLoc} mb="sm" />
                <NumberInput label="Quantity" value={externalQty} onChange={v => setExternalQty(Number(v) || 1)} min={1} max={99} mb="md" />
                <Button onClick={handleConfirmExternal} fullWidth loading={addingCardId === externalCard.id}>Add to Deck</Button>
              </Box>
            )}
          </Modal>

          <Box pos="relative">
            <LoadingOverlay visible={cardsLoading} />
            <Group mb="sm">
              <Group>
                <IconArchive size={16} />
                <Text size="sm" c="dimmed">{uniqueCards} unique cards · {totalQty} total</Text>
              </Group>
            </Group>

            <Paper withBorder p="sm" radius="md" mb="md">
              <Group gap="lg" wrap="wrap" align="flex-start">
                <Box>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Mana Curve</Text>
                  <Group gap={6} align="flex-end">
                    {deckStats.manaCurve.map(b => (
                      <Box key={b.cmc} style={{ textAlign: 'center' }}>
                        <Box style={{
                          width: 26, height: 2 + b.count * 8, minHeight: 2, background: '#1971c2',
                          borderRadius: 3, transition: 'height 200ms ease',
                        }} />
                        <Text size="10px" c="dimmed" mt={2}>{b.cmc}</Text>
                      </Box>
                    ))}
                  </Group>
                </Box>
                <Box>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Types</Text>
                  <Group gap={6}>
                    {Object.entries(deckStats.types).sort((a, b) => b[1] - a[1]).map(([t, n]) => {
                      const active = deckTypeFilter === t;
                      return (
                        <Badge key={t} size="sm" variant={active ? 'filled' : 'light'} color={active ? 'blue' : undefined}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setDeckTypeFilter(active ? null : t)}>
                          {t} <b style={{ marginLeft: 3 }}>{n}</b>
                        </Badge>
                      );
                    })}
                    {Object.keys(deckStats.types).length === 0 && <Text size="xs" c="dimmed">—</Text>}
                  </Group>
                </Box>
                <Box>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Colors</Text>
                  <Group gap={6}>
                    {Object.entries(deckStats.colors).sort((a, b) => b[1] - a[1]).map(([c, n]) => {
                      const active = deckColorFilter === c;
                      return (
                        <Badge key={c} size="sm" variant="light" styles={{ label: { color: '#fff' } }}
                          style={{ background: CID_COLORS[c] || '#666', cursor: 'pointer', boxShadow: active ? `0 0 0 2px var(--mantine-color-body), 0 0 0 4px ${CID_COLORS[c] || '#666'}` : undefined }}
                          onClick={() => setDeckColorFilter(active ? null : c)}>
                          {c} <b style={{ marginLeft: 3 }}>{n}</b>
                        </Badge>
                      );
                    })}
                    {Object.keys(deckStats.colors).length === 0 && <Text size="xs" c="dimmed">—</Text>}
                  </Group>
                </Box>
                <Box>
                  <Text size="xs" fw={600} c="dimmed" mb={4}>Stats</Text>
                  <Group gap="lg">
                    <Box>
                      <Text fw={700} size="md">{deckStats.avgCmc ? deckStats.avgCmc.toFixed(1) : '—'}</Text>
                      <Text size="10px" c="dimmed">Avg CMC</Text>
                    </Box>
                    <Box>
                      <Text fw={700} size="md">{deckStats.landCount}</Text>
                      <Text size="10px" c="dimmed">Lands</Text>
                    </Box>
                    <Box>
                      <Text fw={700} size="md">{totalQty - deckStats.landCount}</Text>
                      <Text size="10px" c="dimmed">Spells</Text>
                    </Box>
                    {selectedDeck.deckType === 'commander' && (
                      <Tooltip label={`${gcCount} game changer${gcCount !== 1 ? 's' : ''}`}>
                        <Box>
                          <Text fw={700} size="md" c={gcCount > 3 ? 'red' : gcCount > 0 ? 'yellow' : 'teal'}>B{estimateBracket(gcCount)}</Text>
                          <Text size="10px" c="dimmed">Est. Bracket</Text>
                        </Box>
                      </Tooltip>
                    )}
                  </Group>
                </Box>
              </Group>
            </Paper>

            <Group mb="sm">
              <TextInput placeholder="Search deck..." value={deckSearch} size="xs"
                onChange={e => setDeckSearch(e.currentTarget.value)} leftSection={<IconSearch size={14} />}
                style={{ flex: 1 }} />
              {(deckSearch || deckTypeFilter || deckColorFilter) && (
                <Button size="compact-xs" variant="subtle" color="gray"
                  onClick={() => { setDeckSearch(''); setDeckTypeFilter(null); setDeckColorFilter(null); }}>
                  Clear
                </Button>
              )}
            </Group>

            {(() => {
              const grouped: Record<string, CollectionItem[]> = {};
              for (const item of filteredDeckCards) {
                if (!grouped[item.card.name]) grouped[item.card.name] = [];
                grouped[item.card.name].push(item);
              }
              const toggleDeckGroup = (name: string) => setDeckGroupExpanded(prev => {
                const n = new Set(prev);
                if (n.has(name)) n.delete(name); else n.add(name);
                return n;
              });

              return Object.entries(grouped).map(([name, items]) => {
                const rep = items[0];
                const illegal = !isCardLegal(rep.card);
                const style: CSSProperties | undefined = illegal
                  ? { border: '2px solid var(--mantine-color-red-7)' }
                  : undefined;
                const rows = items.flatMap(item => Array.from({ length: item.quantity }, (_, i) => ({ key: `${item.id}-${i}`, item })));
                const gc = isGameChanger(name);
                const nameNode = (
                  <Group gap={4} wrap="nowrap">
                    <span>{name}</span>
                    {gc && (
                      <Tooltip label="Game Changer">
                        <IconFlame size={14} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0 }} />
                      </Tooltip>
                    )}
                  </Group>
                );
                const renderRow = (row: { key: string; item: CollectionItem }, idx: number) => {
                  const rowIsCommander = selectedDeck.commanderItemId != null
                    ? row.item.id === selectedDeck.commanderItemId
                    : row.item.card.id === selectedDeck.commanderCardId;
                  const rowIsSecond = (selectedDeck.partnerItemId != null || selectedDeck.backgroundItemId != null)
                    ? row.item.id === selectedDeck.partnerItemId || row.item.id === selectedDeck.backgroundItemId
                    : row.item.card.id === selectedDeck.partnerCardId || row.item.card.id === selectedDeck.backgroundCardId;
                  const rowBg = rowIsCommander
                    ? 'var(--mantine-color-yellow-0)'
                    : rowIsSecond
                      ? 'var(--mantine-color-teal-0)'
                      : idx % 2 === 1 ? 'var(--mantine-color-default-hover)' : undefined;
                  const rowShadow = rowIsCommander
                    ? 'inset 3px 0 0 0 var(--mantine-color-yellow-6)'
                    : rowIsSecond
                      ? 'inset 3px 0 0 0 var(--mantine-color-teal-6)'
                      : undefined;
                  return (
                    <Group key={row.key} p="sm" gap="sm" wrap="nowrap" bg={rowBg} style={{ boxShadow: rowShadow }}>
                      <CardThumb card={row.item.card} foil={!!row.item.foil} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={4} wrap="nowrap">
                          <Text size="sm" fw={500}>{row.item.card.name}</Text>
                          {gc && (
                            <Tooltip label="Game Changer">
                              <IconFlame size={14} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0 }} />
                            </Tooltip>
                          )}
                        </Group>
                        <Group gap={4}>
                          <SetSymbol code={row.item.card.setCode} name={row.item.card.setName} size={12} />
                          <Text size="xs" c="dimmed">#{row.item.card.collectorNumber}</Text>
                        </Group>
                      </div>
                      {rowIsCommander && <Badge size="sm" color="yellow" variant="filled">Commander</Badge>}
                      {rowIsSecond && <Badge size="sm" color="teal" variant="filled">Partner/Background</Badge>}
                      <Badge size="xs" variant="outline" color="gray">{row.item.condition || '-'}</Badge>
                      {row.item.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge> : null}
                      {row.item.purchasePrice ? <Text size="sm" c="dimmed">${row.item.purchasePrice.toFixed(2)}</Text> : null}
                      <ActionIcon variant="subtle" size="sm" onClick={() => openEditCardDialog(row.item)}><IconPencil size={14} /></ActionIcon>
                      <ActionIcon variant="subtle" size="sm" onClick={() => openMoveDialog([row.item])}><IconArrowRight size={14} /></ActionIcon>
                      <ActionIcon variant="subtle" size="sm" onClick={() => openScheduleDialog([row.item])}><IconCalendarClock size={14} /></ActionIcon>
                    </Group>
                  );
                };

                if (rows.length === 1) {
                  return (
                    <CardGroup key={name} card={rep.card} name={nameNode} manaCost={rep.card.manaCost} typeLine={rep.card.typeLine}
                      isSingle expanded={false} onToggle={() => {}} style={style}>
                      {renderRow(rows[0], 0)}
                    </CardGroup>
                  );
                }

                return (
                  <CardGroup key={name} card={rep.card} name={nameNode} manaCost={rep.card.manaCost} typeLine={rep.card.typeLine}
                    isSingle={false} expanded={deckGroupExpanded.has(name)} onToggle={() => toggleDeckGroup(name)} style={style}
                    rightSection={<Badge size="sm" variant="light">{rows.length} card{rows.length !== 1 ? 's' : ''}</Badge>}>
                    <Box>
                      {rows.map((row, idx) => renderRow(row, idx))}
                    </Box>
                  </CardGroup>
                );
              });
            })()}

            {requiredCards.length > 0 && (
              <>
                <Group mt="lg" mb="sm">
                  <IconList size={16} opacity={0.5} />
                  <Text size="sm" c="dimmed">Required Cards ({requiredCards.length})</Text>
                </Group>
                {requiredCards.map(req => {
                  const nameL = req.cardName.toLowerCase();
                  const isCmdGhost = req.cardId
                    ? req.cardId === selectedDeck.commanderCardId
                    : (!!zoneNames.commander && nameL === zoneNames.commander.toLowerCase());
                  const isSecondGhost = req.cardId
                    ? req.cardId === selectedDeck.partnerCardId || req.cardId === selectedDeck.backgroundCardId
                    : (!!zoneNames.second && nameL === zoneNames.second.toLowerCase());
                  const pendingFill = req.fillItemId != null;
                  return (
                  <Paper key={req.id} withBorder mb={2} radius={0} opacity={pendingFill ? 0.7 : 0.55}
                    style={pendingFill
                      ? { border: '2px solid var(--mantine-color-violet-6)', filter: 'grayscale(0.4)' }
                      : isCmdGhost
                        ? { border: '2px solid var(--mantine-color-yellow-6)', boxShadow: '0 0 10px rgba(230,180,0,0.25)', filter: 'grayscale(0.4)' }
                        : isSecondGhost
                          ? { border: '2px solid var(--mantine-color-teal-6)', filter: 'grayscale(0.4)' }
                          : { filter: 'grayscale(0.6)' }}>
                    <Group p="sm" gap="sm" wrap="nowrap">
                      <GhostThumb name={req.cardName} cardId={req.cardId} />
                      <div style={{ flex: 1 }}>
                        <Group gap={4} wrap="nowrap">
                          <Text size="sm" fw={500}>{req.cardName}</Text>
                          {isGameChanger(req.cardName) && (
                            <Tooltip label="Game Changer">
                              <IconFlame size={14} color="var(--mantine-color-orange-6)" style={{ flexShrink: 0 }} />
                            </Tooltip>
                          )}
                        </Group>
                        {req.setCode && <Text size="xs" c="dimmed">{req.setCode?.toUpperCase()} #{req.collectorNumber}</Text>}
                      </div>
                      {isCmdGhost && <Badge size="sm" color="yellow" variant="filled">Commander</Badge>}
                      {isSecondGhost && <Badge size="sm" color="teal" variant="filled">Partner/Background</Badge>}
                      <Badge size="sm" variant="light">{req.quantity}x</Badge>
                      {pendingFill ? (
                        <Badge size="sm" variant="light" color="violet">Move scheduled{req.fillSourceName ? ` from ${req.fillSourceName}` : ''}</Badge>
                      ) : (
                        <Button size="compact-xs" variant="light" color="blue" onClick={() => openFillDialog(req)}>
                          Fill from Collection
                        </Button>
                      )}
                      <ActionIcon variant="subtle" size="sm" onClick={() => openGhostMove(req)}><IconArrowRight size={14} /></ActionIcon>
                      <ActionIcon variant="subtle" color="red" size="sm" onClick={() => handleRemoveRequired(req.id)}><IconTrash size={14} /></ActionIcon>
                    </Group>
                  </Paper>
                  );
                })}
              </>
            )}

            {!cardsLoading && deckCards.length === 0 && requiredCards.length === 0 && (
              <Text c="dimmed" ta="center" py="xl">No cards in this deck yet. Search above to add cards.</Text>
            )}
            {!cardsLoading && deckCards.length > 0 && filteredDeckCards.length === 0 && (
              <Text c="dimmed" ta="center" py="xl">No cards match your search/filter.</Text>
            )}
          </Box>
        </>
      ) : (
        <>
          <Group mb="md" justify="space-between">
            <Title order={2}>Decks</Title>
            <Button leftSection={<IconPlus size={16} />} onClick={openCreateDialog}>New Deck</Button>
          </Group>
          <Box pos="relative">
            <LoadingOverlay visible={loading} />
            {decks.length === 0 && !loading && <Text c="dimmed" ta="center" py="xl">No decks yet. Create your first deck!</Text>}
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md" data-tour="decks-list">
              {decks.map(deck => (
                <Paper key={deck.id} withBorder radius="md" style={{ overflow: 'hidden', cursor: 'pointer' }}
                  onClick={() => openDeck(deck)}>
                  <Box style={{ height: 200, position: 'relative', background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {deck.cardId ? <DeckArtwork cardId={deck.cardId} /> : <IconCards size={64} style={{ opacity: 0.15 }} />}
                    <Box style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', padding: '20px 12px 12px' }}>
                      <Text fw={600} size="md" c="white">{deck.name}</Text>
                      {deck.description && <Text size="xs" c="gray.3" lineClamp={1}>{deck.description}</Text>}
                    </Box>
                    <Badge size="sm" style={{ position: 'absolute', top: 8, right: 8 }}>{deck.cardCount} cards</Badge>
                    <Tooltip label="Change artwork">
                      <Badge size="xs" variant="light" color="gray" style={{ position: 'absolute', top: 8, left: 8, cursor: 'pointer' }}
                        onClick={e => { e.stopPropagation(); openArtworkDialog(deck.id); }}>🖼</Badge>
                    </Tooltip>
                  </Box>
                </Paper>
              ))}
            </SimpleGrid>
          </Box>
        </>
      )}

      <DeckFormModal opened={createOpened} onClose={closeCreate} title="New Deck" saveLabel="Create"
        onSave={handleCreate} />

      <DeckFormModal opened={editOpened} onClose={closeEdit} title="Edit Deck" saveLabel="Save"
        initial={editingDeck ? {
          name: editingDeck.name, description: editingDeck.description || '', cardId: editingDeck.cardId || '',
          deckType: editingDeck.deckType || 'custom', commanderCardId: editingDeck.commanderCardId || '',
          partnerCardId: editingDeck.partnerCardId || '', backgroundCardId: editingDeck.backgroundCardId || '',
        } : undefined}
        onSave={handleEdit} />

      <Modal opened={artworkOpened} onClose={closeArtwork} title="Choose Deck Artwork" size="lg" centered>
        <TextInput placeholder="Search for a card..." value={artworkSearch} onChange={e => setArtworkSearch(e.currentTarget.value)} leftSection={<IconSearch size={14} />} mb="sm" />
        <ScrollArea h={400}>
          {artworkResults.length > 0 ? (
            <SimpleGrid cols={{ base: 3, sm: 4, md: 5 }} spacing="sm">
              {artworkResults.map(c => (
                <MCard key={c.id} withBorder padding={4} radius="sm" style={{ cursor: 'pointer' }} onClick={() => handleSetArtwork(c.id)}>
                  <Box w="100%" h={140} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', borderRadius: 4, overflow: 'hidden' }}>
                    <DeckArtwork cardId={c.id} size={100} />
                  </Box>
                  <Text size="xs" ta="center" lineClamp={1} mt={2}>{c.name}</Text>
                </MCard>
              ))}
            </SimpleGrid>
          ) : artworkSearch.trim().length >= 2 && <Text c="dimmed" ta="center" py="xl">No cards found</Text>}
        </ScrollArea>
      </Modal>

      <Modal opened={editCardOpened} onClose={closeEditCard} title={`Edit ${editItem?.card.name || ''}`} size="sm" centered>
        {editItem && (
          <Box>
            <NumberInput label="Quantity" value={editForm.quantity} onChange={v => setEditForm(f => ({ ...f, quantity: Number(v) || 1 }))} min={1} max={999} mb="sm" />
            <Switch label="Foil" checked={editForm.foil} onChange={e => { const v = e.currentTarget.checked; setEditForm(f => ({ ...f, foil: v })); }} mb="sm" />
            <Box mb="sm">
              <Text size="sm" fw={500} mb={4}>Condition</Text>
              <SegmentedControl value={editForm.condition} onChange={v => setEditForm(f => ({ ...f, condition: v as Condition }))}
                data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs"
                styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[editForm.condition] || '#00897b' } }} />
            </Box>
            <TextInput label="Purchase Price ($)" value={editForm.purchasePrice} onChange={e => { const v = e.currentTarget.value; setEditForm(f => ({ ...f, purchasePrice: v })); }} mb="sm" />
            <TextInput label="Notes" value={editForm.notes} onChange={e => { const v = e.currentTarget.value; setEditForm(f => ({ ...f, notes: v })); }} mb="md" />
            <Group justify="flex-end"><Button variant="default" onClick={closeEditCard}>Cancel</Button><Button onClick={handleSaveEditCard}>Save</Button></Group>
          </Box>
        )}
      </Modal>

      <Modal opened={moveOpened} onClose={closeMove}
        title={moveMode === 'schedule' ? `Schedule Move — ${moveItems.length} item(s)` : `Move — ${moveItems.length} item(s)`} size="sm" centered>
        <Select placeholder="Destination location" data={locations.map(l => ({ value: String(l.id), label: l.name }))}
          value={moveDestLoc} onChange={setMoveDestLoc} mb="md" />
        <Group justify="flex-end">
          <Button variant="default" onClick={closeMove}>Cancel</Button>
          {moveMode === 'schedule' ? (
            <Button color="teal" leftSection={<IconCalendarClock size={14} />} onClick={handleScheduleMove}>Schedule</Button>
          ) : (
            <Button leftSection={<IconBolt size={14} />} onClick={handleMove}>Move Now</Button>
          )}
        </Group>
      </Modal>

      <Modal opened={schedOverwrite !== null} onClose={() => setSchedOverwrite(null)} title="Pending Move Detected" size="sm" centered>
        <Text size="sm" mb="md">
          {schedOverwrite?.items.length} card(s) already have a scheduled move. Overwrite them with the new destination?
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setSchedOverwrite(null)}>Cancel</Button>
          <Button color="red" onClick={() => { if (schedOverwrite) doScheduleMove(schedOverwrite.items, schedOverwrite.destId); }}>Overwrite</Button>
        </Group>
      </Modal>

      <Modal opened={ghostMoveReq !== null} onClose={() => setGhostMoveReq(null)} title={`Move Ghost — ${ghostMoveReq?.cardName || ''}`} size="sm" centered>
        <Text size="xs" c="dimmed" mb="sm">Choose where this card should go when filled.</Text>
        <SegmentedControl fullWidth mb="sm" value={ghostMoveDestType}
          onChange={v => { setGhostMoveDestType(v as 'location' | 'deck'); setGhostMoveDestId(null); }}
          data={[{ value: 'location', label: 'Location' }, { value: 'deck', label: 'Deck' }]} />
        {ghostMoveDestType === 'location' ? (
          <Select placeholder="Destination location" data={locations.map(l => ({ value: String(l.id), label: l.name }))}
            value={ghostMoveDestId} onChange={setGhostMoveDestId} mb="md" searchable />
        ) : (
          <Select placeholder="Destination deck" data={decks.filter(d => d.id !== selectedDeck?.id).map(d => ({ value: String(d.id), label: d.name }))}
            value={ghostMoveDestId} onChange={setGhostMoveDestId} mb="md" searchable />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setGhostMoveReq(null)}>Cancel</Button>
          <Button disabled={!ghostMoveDestId} onClick={handleConfirmGhostMove}>Move Ghost</Button>
        </Group>
      </Modal>

      <Modal opened={fillOpened} onClose={closeFill} title={`Fill "${fillCardName}" from Collection`} size="md" centered>
        {fillCollectionItems.length === 0 ? (
          <Text c="dimmed" py="md" ta="center">No copies of this card found in your collection.</Text>
        ) : (
          <ScrollArea h={300}>
            {fillCollectionItems.map(item => (
              <Paper key={item.id} withBorder mb={2} radius={0}
                style={item.destinationId ? { border: '2px solid var(--mantine-color-yellow-6)', background: 'var(--mantine-color-yellow-0)' } : undefined}>
                <Group p="sm" gap="sm" wrap="nowrap">
                  <CardThumb card={item.card} />
                  <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500}>{item.card.name}</Text>
                    <Group gap={4}>
                      <SetSymbol code={item.card.setCode} name={item.card.setName} size={12} />
                      <Text size="xs" c="dimmed">#{item.card.collectorNumber}</Text>
                    </Group>
                    {item.destinationId && (
                      <Group gap={6} mt={2}>
                        <Badge size="xs" variant="light" color="yellow">
                          {locations.find(l => l.id === item.locationId)?.name || `#${item.locationId}`} → {locations.find(l => l.id === item.destinationId)?.name || `#${item.destinationId}`}
                        </Badge>
                      </Group>
                    )}
                  </div>
                  <Badge size="sm" variant="light">{item.quantity}x</Badge>
                  <Badge size="xs" variant="outline" color="gray">{item.condition || '-'}</Badge>
                  {item.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge> : null}
                  <Button size="compact-xs" variant="light" color="blue" leftSection={<IconBolt size={12} />}
                    loading={pickAddingId === item.id} onClick={() => handleDeckPickAction(item, 'now', 'fill')}>
                    Move now
                  </Button>
                  <Button size="compact-xs" variant="light" color="teal" leftSection={<IconCalendarClock size={12} />}
                    loading={pickAddingId === item.id} onClick={() => handleDeckPickAction(item, 'schedule', 'fill')}>
                    Schedule move
                  </Button>
                </Group>
              </Paper>
            ))}
          </ScrollArea>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={closeFill}>Cancel</Button>
        </Group>
      </Modal>

      <Modal opened={schedConfirm !== null} onClose={() => setSchedConfirm(null)} title="Cancel Scheduled Move" size="sm" centered>
        <Text mb="md">
          {schedConfirm?.item.card.name} currently has a scheduled move from{' '}
          <b>{locations.find(l => l.id === schedConfirm?.item.locationId)?.name || `#${schedConfirm?.item.locationId}`}</b> to{' '}
          <b>{locations.find(l => l.id === schedConfirm?.item.destinationId)?.name || `#${schedConfirm?.item.destinationId}`}</b>.
        </Text>
        <Text mb="md">
          Are you sure you want to cancel the current scheduled move and {schedConfirm?.mode === 'now' ? 'move' : 'schedule'}{' '}
          {schedConfirm?.item.card.name} to {selectedDeck?.name}?
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setSchedConfirm(null)}>Keep Schedule</Button>
          <Button color="orange" onClick={confirmSchedAction}>Cancel Schedule & Continue</Button>
        </Group>
      </Modal>

      <Modal opened={legalityModalOpened} onClose={() => setLegalityModalOpened(false)} title={`Legality Check — ${DECK_TYPES.find(t => t.value === legality?.format)?.label || legality?.format || ''}`} size="md" centered>
        {legality && (
          <Box>
            <Group mb="md">
              <Text>Total cards: <b>{legality.totalCards}</b></Text>
              <Badge color={legality.legal ? 'green' : 'red'} size="sm">{legality.legal ? 'Legal' : 'Not Legal'}</Badge>
            </Group>
            {legality.issues.length > 0 ? (
              <ScrollArea h={250} mb="md">
                {legality.issues.map((issue, i) => (
                  <Paper key={i} withBorder p="xs" mb={2} radius={0}>
                    <Text size="sm" fw={500} c="red">{issue.cardName}</Text>
                    <Text size="xs" c="dimmed">{issue.detail}</Text>
                  </Paper>
                ))}
              </ScrollArea>
            ) : (
              <Text c="green" mb="md">No issues found. This deck is legal!</Text>
            )}
            {legality.cardStatuses.length > 0 && (
              <>
                <Text size="xs" fw={600} mb={4}>Card Statuses</Text>
                <ScrollArea h={200}>
                  {legality.cardStatuses.map((c, i) => (
                    <Group key={i} gap="sm" p={2} wrap="nowrap">
                      <Badge size="xs" color={c.status === 'legal' ? 'green' : c.status === 'restricted' ? 'yellow' : 'red'} variant="light">{c.status}</Badge>
                      <Text size="xs">{c.name}</Text>
                    </Group>
                  ))}
                </ScrollArea>
              </>
            )}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setLegalityModalOpened(false)}>Close</Button>
            </Group>
          </Box>
        )}
      </Modal>
    </ErrorBoundary>
  );
}
function DeckCommandZone({ deck, deckCards, requiredCards, onAssign }: {
  deck: Deck;
  deckCards: CollectionItem[];
  requiredCards: RequiredCard[];
  onAssign: (cardId: string, itemId: number | null, mode: 'commander' | 'partner' | 'background') => Promise<void>;
}) {
  const [commander, setCommander] = useState<ScryfallCard | null>(null);
  const [partner, setPartner] = useState<ScryfallCard | null>(null);
  const [background, setBackground] = useState<ScryfallCard | null>(null);
  const [pickMode, setPickMode] = useState<'commander' | 'second'>('commander');
  const [pickOpened, { open: openPick, close: closePick }] = useDisclosure(false);
  const [assigning, setAssigning] = useState(false);
  const [pickerExpanded, setPickerExpanded] = useState<Set<string>>(new Set());
  const [blockedConfirm, setBlockedConfirm] = useState<{ entry: PickEntry; fromRole: string; toRole: string; mode: 'commander' | 'partner' | 'background' } | null>(null);

  useEffect(() => {
    if (deck.commanderCardId) api.cards.get(deck.commanderCardId).then(setCommander).catch(() => setCommander(null));
    else setCommander(null);
  }, [deck.commanderCardId]);
  useEffect(() => {
    if (deck.partnerCardId) api.cards.get(deck.partnerCardId).then(setPartner).catch(() => setPartner(null));
    else setPartner(null);
  }, [deck.partnerCardId]);
  useEffect(() => {
    if (deck.backgroundCardId) api.cards.get(deck.backgroundCardId).then(setBackground).catch(() => setBackground(null));
    else setBackground(null);
  }, [deck.backgroundCardId]);

  const pickEntries: PickEntry[] = [];
  for (const item of deckCards) {
    pickEntries.push({
      key: `item:${item.id}`,
      name: item.card.name,
      typeLine: item.card.typeLine,
      copyInfo: `${item.card.setCode.toUpperCase()} #${item.card.collectorNumber}${item.foil ? ' · Foil' : ''}${item.condition ? ` · ${item.condition}` : ''}`,
      cardId: item.card.id,
      itemId: item.id,
      card: item.card,
      thumb: <CardThumb card={item.card} foil={!!item.foil} />,
    });
  }
  for (const req of requiredCards) {
    if (pickEntries.some(e => e.reqId === req.id)) continue;
    pickEntries.push({
      key: req.cardId ? `card:${req.cardId}` : `name:${req.cardName}`,
      name: req.cardName,
      typeLine: 'Ghost card',
      cardId: req.cardId || null,
      itemId: null,
      reqId: req.id,
      card: null,
      thumb: <GhostThumb name={req.cardName} cardId={req.cardId} />,
    });
  }

  const secondCard = partner || background;
  const secondLabel = partner ? 'Partner' : background ? 'Background' : null;
  const secondAssignMode: 'partner' | 'background' = deck.backgroundCardId ? 'background' : 'partner';

  const isCurrentEntry = (entry: PickEntry): boolean => {
    if (pickMode === 'commander') {
      if (deck.commanderItemId != null) return deck.commanderItemId === entry.itemId;
      return !!entry.cardId && entry.cardId === deck.commanderCardId;
    }
    if (deck.partnerItemId != null || deck.backgroundItemId != null) {
      return entry.itemId === deck.partnerItemId || entry.itemId === deck.backgroundItemId;
    }
    return !!entry.cardId && (entry.cardId === deck.partnerCardId || entry.cardId === deck.backgroundCardId);
  };

  const isBlockedEntry = (entry: PickEntry): boolean => {
    if (pickMode === 'commander') {
      if (deck.partnerItemId != null || deck.backgroundItemId != null) {
        return entry.itemId === deck.partnerItemId || entry.itemId === deck.backgroundItemId;
      }
      const otherCardId = deck.partnerCardId || deck.backgroundCardId;
      return !!entry.cardId && !!otherCardId && entry.cardId === otherCardId;
    }
    if (deck.commanderItemId != null) {
      return entry.itemId === deck.commanderItemId;
    }
    const otherCardId = deck.commanderCardId;
    return !!entry.cardId && !!otherCardId && entry.cardId === otherCardId;
  };

  const requestBlockedReassign = (entry: PickEntry) => {
    if (pickMode === 'commander') {
      setBlockedConfirm({
        entry,
        fromRole: deck.partnerCardId ? 'Partner' : 'Background',
        toRole: 'Commander',
        mode: 'commander',
      });
    } else {
      setBlockedConfirm({
        entry,
        fromRole: 'Commander',
        toRole: deck.backgroundCardId ? 'Background' : 'Partner',
        mode: secondAssignMode,
      });
    }
  };

  const handleAssign = async (entry: PickEntry, explicitMode?: 'commander' | 'partner' | 'background') => {
    const mode = explicitMode || secondAssignMode;
    setAssigning(true);
    try {
      let cardId = entry.cardId;
      if (!cardId) {
        const res = await api.cards.grouped(entry.name, 1);
        cardId = res.data[0]?.id ?? null;
      }
      if (!cardId) {
        notifications.show({ title: 'Error', message: `Could not resolve "${entry.name}" to a card`, color: 'red' });
        return;
      }
      if (entry.reqId && !entry.cardId) {
        await api.decks.updateRequired(deck.id, entry.reqId, { cardId }).catch(() => {});
      }
      await onAssign(cardId, entry.itemId, mode);
      closePick();
    } catch {} finally {
      setAssigning(false);
    }
  };

  const confirmBlocked = () => {
    if (!blockedConfirm) return;
    const { entry, mode } = blockedConfirm;
    setBlockedConfirm(null);
    handleAssign(entry, mode);
  };

  const commanderSlot = (
    <Tooltip label={deck.commanderCardId ? 'Change Commander' : 'Set Commander'}>
      <Paper withBorder px={deck.commanderCardId ? 6 : 8} py={deck.commanderCardId ? 4 : 6} radius="md"
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', borderStyle: deck.commanderCardId ? 'solid' : 'dashed', borderColor: deck.commanderCardId ? undefined : 'var(--mantine-color-default-border)', background: deck.commanderCardId ? undefined : 'var(--mantine-color-default-hover)' }}
        onClick={() => { setPickMode('commander'); openPick(); }}>
        {deck.commanderCardId
          ? <CommanderThumb card={commander} size={44} />
          : <Group gap={6} wrap="nowrap"><IconPlus size={16} opacity={0.5} /><Text size="xs" c="dimmed">Commander</Text></Group>}
      </Paper>
    </Tooltip>
  );

  const secondSlot = (
    <Tooltip label={secondLabel ? `Change ${secondLabel}` : 'Set Partner/Background'}>
      <Paper withBorder px={secondCard ? 6 : 8} py={secondCard ? 4 : 6} radius="md"
        style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', borderStyle: secondCard ? 'solid' : 'dashed', borderColor: secondCard ? undefined : 'var(--mantine-color-default-border)', background: secondCard ? undefined : 'var(--mantine-color-default-hover)' }}
        onClick={() => { setPickMode('second'); openPick(); }}>
        {secondCard
          ? <CommanderThumb card={secondCard} size={44} />
          : <Group gap={6} wrap="nowrap"><IconPlus size={16} opacity={0.5} /><Text size="xs" c="dimmed">Partner/Background</Text></Group>}
      </Paper>
    </Tooltip>
  );

  return (
    <>
      <Group gap="xs" wrap="wrap">
        {commanderSlot}
        {secondSlot}
      </Group>

      <Modal opened={pickOpened} onClose={closePick}
        title={pickMode === 'commander' ? 'Set Commander from Deck' : 'Set Partner/Background from Deck'}
        size="md" centered>
        <ScrollArea h={440}>
          {pickEntries.length === 0 && <Text c="dimmed" ta="center" py="xl">Add cards or ghost cards to the deck first.</Text>}
          {(() => {
            const grouped: Record<string, PickEntry[]> = {};
            for (const e of pickEntries) {
              if (!grouped[e.name]) grouped[e.name] = [];
              grouped[e.name].push(e);
            }
            return Object.entries(grouped).map(([name, entries]) => {
              const rep = entries[0];
              const isGhost = rep.reqId != null;
              const expanded = pickerExpanded.has(name) || entries.some(isCurrentEntry);
              const toggleGroup = () => setPickerExpanded(prev => {
                const n = new Set(prev);
                if (n.has(name)) n.delete(name); else n.add(name);
                return n;
              });
              const groupCard = isGhost
                ? { imageUris: null as Record<string, string> | null }
                : { imageUris: rep.card?.imageUris ?? null, cardFaces: rep.card?.cardFaces ?? null };
              return (
                <CardGroup key={name} card={groupCard} thumb={rep.thumb} name={name}
                  manaCost={isGhost ? null : (rep.card?.manaCost ?? null)} typeLine={rep.typeLine}
                  isSingle={entries.length === 1} expanded={expanded} onToggle={toggleGroup}
                  rightSection={entries.length > 1 ? <Badge size="sm" variant="light">{entries.length}</Badge> : undefined}>
                  {entries.map(entry => {
                    const current = isCurrentEntry(entry);
                    const blocked = isBlockedEntry(entry);
                    return (
                      <Group key={entry.key} p="xs" gap="sm" wrap="nowrap"
                        bg={current ? 'var(--mantine-color-yellow-0)' : undefined}
                        style={{
                          ...(current ? { boxShadow: 'inset 3px 0 0 0 var(--mantine-color-yellow-6)' } : {}),
                          ...(blocked ? { opacity: 0.45, cursor: 'pointer' } : {}),
                        }}
                        onClick={blocked ? () => requestBlockedReassign(entry) : undefined}
                      >
                        <Box w={32} h={45} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{entry.thumb}</Box>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Group gap={6} wrap="nowrap">
                            <Text size="sm" fw={500}>{entry.name}</Text>
                            {current && <Badge size="xs" color="yellow" variant="filled">Current</Badge>}
                            {blocked && <Badge size="xs" color="red" variant="light">Currently {pickMode === 'commander' ? (deck.partnerCardId ? 'Partner' : 'Background') : 'Commander'}</Badge>}
                          </Group>
                          <Text size="xs" c="dimmed">{entry.typeLine}</Text>
                          {entry.copyInfo && <Text size="xs" c="dimmed">{entry.copyInfo}</Text>}
                        </div>
                        {blocked ? (
                          <Button size="compact-xs" variant="subtle" color="orange"
                            onClick={e => { e.stopPropagation(); requestBlockedReassign(entry); }}>
                            Reassign
                          </Button>
                        ) : pickMode === 'commander' ? (
                          <Button size="compact-xs" variant="light" color="yellow" loading={assigning} onClick={() => handleAssign(entry, 'commander')}>
                            Set as Commander
                          </Button>
                        ) : (
                          <Button size="compact-xs" variant="light" color="teal" loading={assigning} onClick={() => handleAssign(entry)}>
                            Set as Partner/Background
                          </Button>
                        )}
                      </Group>
                    );
                  })}
                </CardGroup>
              );
            });
          })()}
        </ScrollArea>
      </Modal>

      <Modal opened={blockedConfirm !== null} onClose={() => setBlockedConfirm(null)}
        title="Change role" size="sm" centered>
        <Text mb="md">
          <b>{blockedConfirm?.entry.name}</b> is currently set as the {blockedConfirm?.fromRole}. Do you wish to set it as the {blockedConfirm?.toRole} instead? This will remove it from the {blockedConfirm?.fromRole} slot.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setBlockedConfirm(null)}>Keep Current</Button>
          <Button color="orange" onClick={confirmBlocked}>Set as {blockedConfirm?.toRole}</Button>
        </Group>
      </Modal>
    </>
  );
}
