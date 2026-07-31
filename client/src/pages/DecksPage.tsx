import { useState, useEffect, Component, type ReactNode, type CSSProperties } from 'react';
import {
  Title, Group, Text, Card as MCard, SimpleGrid, Modal, Button, TextInput, Textarea,
  LoadingOverlay, Box, Paper, Badge, ActionIcon, Tooltip, ScrollArea, Select, Switch, NumberInput, SegmentedControl, Collapse,
  Image, HoverCard,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash, IconPencil, IconSearch, IconCards, IconArrowLeft, IconArchive, IconArrowRight, IconList, IconChevronDown, IconChevronRight, IconGhost, IconFlame } from '@tabler/icons-react';
import { api } from '../api/client';
import { CONDITIONS } from '../types';
import type { ScryfallCard, CollectionItem, Location, Condition, GroupedCard } from '../types';
import { CardThumb, SetSymbol, GhostThumb } from '../components/CardDisplay';
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
  createdAt: string;
  cardCount: number;
}

const DECK_TYPES = [
  { value: 'custom', label: 'Custom' },
  { value: 'standard', label: 'Standard' },
  { value: 'modern', label: 'Modern' },
  { value: 'pioneer', label: 'Pioneer' },
  { value: 'legacy', label: 'Legacy' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'pauper', label: 'Pauper' },
  { value: 'commander', label: 'Commander' },
  { value: 'brawl', label: 'Brawl' },
  { value: 'duel', label: 'Duel Commander' },
];

interface RequiredCard {
  id: number;
  deckId: number;
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
  const [form, setForm] = useState({ name: '', description: '', cardId: '', deckType: 'custom', commanderCardId: '' as string, partnerCardId: '' as string, backgroundCardId: '' as string });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [artworkDeckId, setArtworkDeckId] = useState<number | null>(null);
  const [artworkSearch, setArtworkSearch] = useState('');
  const [artworkResults, setArtworkResults] = useState<ScryfallCard[]>([]);
  const [addCardSearch, setAddCardSearch] = useState('');
  const [addCardResults, setAddCardResults] = useState<GroupedCard[]>([]);
  const [addPrintings, setAddPrintings] = useState<Record<string, ScryfallCard[]>>({});
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
  const [commanderSearch, setCommanderSearch] = useState('');
  const [commanderResults, setCommanderResults] = useState<ScryfallCard[]>([]);
  const [commanderPickOpened, { open: openCommanderPick, close: closeCommanderPick }] = useDisclosure(false);
  const [commanderPickMode, setCommanderPickMode] = useState<'commander' | 'partner' | 'background'>('commander');
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
  const [moveOpened, { open: openMove, close: closeMove }] = useDisclosure(false);
  const [fillReqId, setFillReqId] = useState<number | null>(null);
  const [fillCardName, setFillCardName] = useState('');
  const [fillCollectionItems, setFillCollectionItems] = useState<CollectionItem[]>([]);
  const [fillOpened, { open: openFill, close: closeFill }] = useDisclosure(false);

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
    if (q.length < 2) { setAddCardResults([]); setAddPrintings({}); return; }
    const timeout = setTimeout(async () => {
      const isSmart = /^[a-z]{2,4}\s*\d+/i.test(q) || /^s:\S+\s+cn:\S+$/i.test(q);
      try {
        if (isSmart) {
          const cards = await api.cards.find(q);
          const groups: Record<string, ScryfallCard[]> = {};
          for (const c of cards) {
            if (!groups[c.name]) groups[c.name] = [];
            groups[c.name].push(c as unknown as ScryfallCard);
          }
          const names = Object.keys(groups);
          setAddCardResults(names.map(n => ({
            id: groups[n][0]?.id ?? n,
            name: n,
            typeLine: groups[n][0]?.typeLine ?? null,
            manaCost: groups[n][0]?.manaCost ?? null,
            cmc: groups[n][0]?.cmc ?? null,
            colors: groups[n][0]?.colors ?? null,
            imageUris: groups[n][0]?.imageUris ?? null,
            printings: groups[n].length,
            firstPrinting: null,
            lastPrinting: null,
          })));
          setAddPrintings(groups as unknown as Record<string, ScryfallCard[]>);
          setAddExpanded(new Set());
        } else {
          const res = await api.cards.grouped(q, 1);
          setAddCardResults(res.data);
          setAddPrintings({});
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

  useEffect(() => {
    if (commanderSearch.trim().length < 2) { setCommanderResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await api.cards.find(commanderSearch);
        setCommanderResults(res.slice(0, 20) as unknown as ScryfallCard[]);
      } catch { setCommanderResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [commanderSearch]);

  const openDeck = (deck: Deck) => {
    setSelectedDeck(deck);
    setAddCardSearch('');
    setAddCardResults([]);
    loadDeckCards(deck.id);
  };

  const closeDeck = () => {
    setSelectedDeck(null);
    setDeckCards([]);
    setRequiredCards([]);
  };

  const toggleAddPrintings = async (name: string) => {
    if (addExpanded.has(name)) {
      setAddExpanded(prev => { const n = new Set(prev); n.delete(name); return n; });
      return;
    }
    setAddExpanded(prev => new Set(prev).add(name));
    if (!addPrintings[name]) {
      setAddLoadingPrintings(prev => new Set(prev).add(name));
      try {
        const cards = await api.cards.printings(name) as unknown as ScryfallCard[];
        setAddPrintings(prev => ({ ...prev, [name]: cards }));
      } catch {}
      setAddLoadingPrintings(prev => { const n = new Set(prev); n.delete(name); return n; });
    }
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
      const wl = await api.wantlist.add({ cardId: card.id, cardName: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber, notes: `Wanted for deck: ${selectedDeck.name}`, quantity: 1 }).catch(() => null);
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
      const wl = await api.wantlist.add({ cardName: name, quantity: 1, notes: `Wanted for deck: ${selectedDeck.name}` }).catch(() => null);
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
      const res = await fetch(`/api/collection/grouped?q=${encodeURIComponent(card.name)}`);
      const data = await res.json();
      const items = data.groups?.flatMap((g: any) => g.items) || [];
      setCollectionPickItems(items.filter((i: CollectionItem) => i.card && i.card.name.toLowerCase() === card.name.toLowerCase()));
    } catch {
      setCollectionPickItems([]);
    }
  };

  const handleLinkFromCollection = async (itemId: number) => {
    if (!selectedDeck) return;
    try {
      await api.decks.linkFromCollection(selectedDeck.id, itemId);
      pushUndo('Card added to deck from collection', async () => {
        await api.decks.removeCard(selectedDeck.id, itemId).catch(() => {});
        loadDeckCards(selectedDeck.id);
      }, 'Undo add');
      notifications.show({ title: 'Added', message: 'Card added to deck from collection', color: 'green' });
      closeCollectionPick();
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleRemoveCard = async (itemId: number) => {
    if (!selectedDeck) return;
    const item = deckCards.find(i => i.id === itemId);
    const restore: Record<string, string | null> = {};
    try {
      await api.decks.removeCard(selectedDeck.id, itemId);
      if (item) {
        if (selectedDeck.commanderCardId === item.card.id) restore.commanderCardId = selectedDeck.commanderCardId;
        if (selectedDeck.partnerCardId === item.card.id) restore.partnerCardId = selectedDeck.partnerCardId;
        if (selectedDeck.backgroundCardId === item.card.id) restore.backgroundCardId = selectedDeck.backgroundCardId;
        if (Object.keys(restore).length > 0) {
          const cleared = Object.fromEntries(Object.keys(restore).map(k => [k, null])) as Record<string, string | null>;
          const updated = await api.decks.update(selectedDeck.id, cleared);
          setSelectedDeck(prev => prev ? { ...prev, ...updated } : prev);
        }
        pushUndo(`${item.card.name} removed from deck`, async () => {
          await api.decks.linkFromCollection(selectedDeck.id, itemId).catch(() => {});
          if (Object.keys(restore).length > 0) {
            const restored = await api.decks.update(selectedDeck.id, restore).catch(() => null);
            if (restored) setSelectedDeck(prev => prev ? { ...prev, ...restored } : prev);
          }
          loadDeckCards(selectedDeck.id);
        }, 'Undo remove');
      }
      notifications.show({ title: 'Removed', message: 'Card removed from deck', color: 'green' });
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleRemoveCopy = async (item: CollectionItem) => {
    if (!selectedDeck) return;
    try {
      if (item.quantity > 1) {
        await api.collection.update(item.id, { quantity: item.quantity - 1 } as any);
        pushUndo(`Copy of ${item.card.name} removed from deck`, async () => {
          await api.collection.update(item.id, { quantity: item.quantity } as any).catch(() => {});
          loadDeckCards(selectedDeck.id);
        }, 'Undo remove');
        loadDeckCards(selectedDeck.id);
      } else {
        await handleRemoveCard(item.id);
      }
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
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
      const res = await fetch(`/api/collection/grouped?q=${encodeURIComponent(req.cardName)}`);
      const data = await res.json();
      const items = data.groups?.flatMap((g: any) => g.items) || [];
      setFillCollectionItems(items.filter((i: CollectionItem) => i.card && i.card.name.toLowerCase() === req.cardName.toLowerCase()));
    } catch { setFillCollectionItems([]); }
    openFill();
  };

  const handleFillCard = async (itemId: number) => {
    if (!selectedDeck || fillReqId === null) return;
    try {
      await api.decks.fillRequired(selectedDeck.id, fillReqId, itemId);
      notifications.show({ title: 'Filled', message: 'Card added to deck from collection', color: 'green' });
      closeFill();
      loadDeckCards(selectedDeck.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      const created = await api.decks.create({
        name: form.name.trim(), description: form.description.trim() || undefined,
        deckType: form.deckType, commanderCardId: form.commanderCardId || null,
        partnerCardId: form.partnerCardId || null, backgroundCardId: form.backgroundCardId || null,
      });
      notifications.show({ title: 'Created', message: 'Deck created', color: 'green' });
      closeCreate();
      setForm({ name: '', description: '', cardId: '', deckType: 'custom', commanderCardId: '', partnerCardId: '', backgroundCardId: '' });
      loadDecks();
      setSelectedDeck({ ...created, cardCount: 0 });
      loadDeckCards(created.id);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    }
  };

  const handleEdit = async () => {
    if (!editingId || !form.name.trim()) return;
    try {
      const updated = await api.decks.update(editingId, {
        name: form.name.trim(), description: form.description.trim() || null,
        deckType: form.deckType, commanderCardId: form.commanderCardId || null,
        partnerCardId: form.partnerCardId || null, backgroundCardId: form.backgroundCardId || null,
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

  const handleSetCommandFromDeck = async (cardId: string, mode: 'commander' | 'partner' | 'background') => {
    if (!selectedDeck) return;
    try {
      const updated = await api.decks.update(selectedDeck.id, mode === 'commander'
        ? { commanderCardId: cardId, partnerCardId: null, backgroundCardId: null }
        : mode === 'partner'
          ? { partnerCardId: cardId, backgroundCardId: null }
          : { partnerCardId: null, backgroundCardId: cardId });
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
    setForm({ name: deck.name, description: deck.description || '', cardId: deck.cardId || '', deckType: deck.deckType || 'custom', commanderCardId: deck.commanderCardId || '', partnerCardId: deck.partnerCardId || '', backgroundCardId: deck.backgroundCardId || '' });
    openEdit();
  };

  const openCreateDialog = () => {
    setForm({ name: '', description: '', cardId: '', deckType: 'custom', commanderCardId: '', partnerCardId: '', backgroundCardId: '' });
    openCreate();
  };

  const openCommanderPickFor = (mode: 'commander' | 'partner' | 'background') => {
    setCommanderPickMode(mode);
    setCommanderSearch('');
    setCommanderResults([]);
    openCommanderPick();
  };

  const handlePickCommander = (card: ScryfallCard) => {
    if (commanderPickMode === 'partner') {
      setForm(f => ({ ...f, partnerCardId: card.id }));
    } else if (commanderPickMode === 'background') {
      setForm(f => ({ ...f, backgroundCardId: card.id }));
    } else {
      setForm(f => ({ ...f, commanderCardId: card.id, partnerCardId: '', backgroundCardId: '' }));
    }
    closeCommanderPick();
    setCommanderSearch('');
    setCommanderResults([]);
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
            <Text size="sm" fw={600} mb="xs">Add Cards to Deck</Text>
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
                      </Group>
                      <Collapse in={isExpanded}>
                        {addLoadingPrintings.has(group.name) && <Text size="xs" c="dimmed" p="xs">Loading printings...</Text>}
                        {groupPrintings && groupPrintings.map(c => (
                          <Group key={c.id} p="xs" gap="sm" wrap="nowrap">
                            <Box w={24} h={34}><CardThumb card={c} /></Box>
                            <SetSymbol code={c.setCode} name={c.setName} size={12} />
                            <Text size="xs" c="dimmed">#{c.collectorNumber}</Text>
                            <Text size="xs" c="dimmed" style={{ flex: 1 }}>{c.setName}</Text>
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
                  <Group key={item.id} p="xs" gap="sm" wrap="nowrap">
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
                    </div>
                    <Button size="compact-xs" variant="light" color="green" leftSection={<IconPlus size={12} />}
                      onClick={() => handleLinkFromCollection(item.id)}>
                      Add to Deck
                    </Button>
                  </Group>
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
                const isCommander = rep.card.id === selectedDeck.commanderCardId;
                const isZoneSecond = rep.card.id === selectedDeck.partnerCardId || rep.card.id === selectedDeck.backgroundCardId;
                const illegal = !isCardLegal(rep.card);
                const style: CSSProperties | undefined = illegal
                  ? { border: '2px solid var(--mantine-color-red-7)' }
                  : isCommander
                    ? { border: '2px solid var(--mantine-color-yellow-6)', boxShadow: '0 0 10px rgba(230,180,0,0.25)' }
                    : isZoneSecond
                      ? { border: '2px solid var(--mantine-color-teal-6)' }
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
                const renderRow = (row: { key: string; item: CollectionItem }, idx: number, withBadges: boolean) => (
                  <Group key={row.key} p="sm" gap="sm" wrap="nowrap" bg={idx % 2 === 1 ? 'var(--mantine-color-default-hover)' : undefined}>
                    <CardThumb card={row.item.card} foil={!!row.item.foil} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={4} wrap="nowrap">
                        <Text size="sm" fw={500}>{row.item.card.name}</Text>
                        {withBadges && gc && (
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
                    {withBadges && isCommander && <Badge size="sm" color="yellow" variant="filled">Commander</Badge>}
                    {withBadges && isZoneSecond && <Badge size="sm" color="teal" variant="filled">Partner/Background</Badge>}
                    <Badge size="xs" variant="outline" color="gray">{row.item.condition || '-'}</Badge>
                    {row.item.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge> : null}
                    {row.item.purchasePrice ? <Text size="sm" c="dimmed">${row.item.purchasePrice.toFixed(2)}</Text> : null}
                    <ActionIcon variant="subtle" size="sm" onClick={() => openEditCardDialog(row.item)}><IconPencil size={14} /></ActionIcon>
                    <ActionIcon variant="subtle" size="sm" onClick={() => openMoveDialog([row.item])}><IconArrowRight size={14} /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => handleRemoveCopy(row.item)}><IconTrash size={14} /></ActionIcon>
                  </Group>
                );

                if (rows.length === 1) {
                  return (
                    <CardGroup key={name} card={rep.card} name={nameNode} manaCost={rep.card.manaCost} typeLine={rep.card.typeLine}
                      isSingle expanded={false} onToggle={() => {}} style={style}>
                      {renderRow(rows[0], 0, true)}
                    </CardGroup>
                  );
                }

                return (
                  <CardGroup key={name} card={rep.card} name={nameNode} manaCost={rep.card.manaCost} typeLine={rep.card.typeLine}
                    isSingle={false} expanded={deckGroupExpanded.has(name)} onToggle={() => toggleDeckGroup(name)} style={style}
                    rightSection={
                      <Group gap="sm" wrap="nowrap">
                        {isCommander && <Badge size="sm" color="yellow" variant="filled">Commander</Badge>}
                        {isZoneSecond && <Badge size="sm" color="teal" variant="filled">Partner/Background</Badge>}
                        <Badge size="sm" variant="light">{rows.length} card{rows.length !== 1 ? 's' : ''}</Badge>
                      </Group>
                    }>
                    <Box>
                      {rows.map((row, idx) => renderRow(row, idx, false))}
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
                  return (
                  <Paper key={req.id} withBorder mb={2} radius={0} opacity={0.55}
                    style={isCmdGhost
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
                      <Button size="compact-xs" variant="light" color="blue" onClick={() => openFillDialog(req)}>
                        Fill from Collection
                      </Button>
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
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
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

      <Modal opened={createOpened} onClose={closeCreate} title="New Deck" size="md" centered>
        <TextInput label="Name" value={form.name} onChange={e => { const v = e.currentTarget.value; setForm(f => ({ ...f, name: v })); }} mb="sm" required />
        <Textarea label="Description" value={form.description} onChange={e => { const v = e.currentTarget.value; setForm(f => ({ ...f, description: v })); }} mb="sm" />
        <Select label="Deck Type" data={DECK_TYPES} value={form.deckType} onChange={v => setForm(f => ({ ...f, deckType: v || 'custom' }))} mb="sm" />
        {form.deckType === 'commander' && (
          <CommanderArea form={form} setForm={setForm} openPicker={openCommanderPickFor} />
        )}
        <Group justify="flex-end"><Button variant="default" onClick={closeCreate}>Cancel</Button><Button onClick={handleCreate}>Create</Button></Group>
      </Modal>

      <Modal opened={editOpened} onClose={closeEdit} title="Edit Deck" size="md" centered>
        <TextInput label="Name" value={form.name} onChange={e => { const v = e.currentTarget.value; setForm(f => ({ ...f, name: v })); }} mb="sm" required />
        <Textarea label="Description" value={form.description} onChange={e => { const v = e.currentTarget.value; setForm(f => ({ ...f, description: v })); }} mb="sm" />
        <Select label="Deck Type" data={DECK_TYPES} value={form.deckType} onChange={v => setForm(f => ({ ...f, deckType: v || 'custom' }))} mb="sm" />
        {form.deckType === 'commander' && (
          <CommanderArea form={form} setForm={setForm} openPicker={openCommanderPickFor} />
        )}
        <Group justify="flex-end"><Button variant="default" onClick={closeEdit}>Cancel</Button><Button onClick={handleEdit}>Save</Button></Group>
      </Modal>

      <Modal opened={commanderPickOpened} onClose={closeCommanderPick}
        title={commanderPickMode === 'partner' ? 'Choose Partner Commander' : commanderPickMode === 'background' ? 'Choose Background' : 'Choose Commander'}
        size="md" centered>
        <TextInput placeholder="Search for a legendary creature..." value={commanderSearch} onChange={e => setCommanderSearch(e.currentTarget.value)} leftSection={<IconSearch size={14} />} mb="sm" autoFocus />
        <ScrollArea h={350}>
          {commanderResults.length > 0 ? (
            commanderResults.map(c => (
              <Group key={c.id} p="xs" gap="sm" wrap="nowrap" style={{ cursor: 'pointer', borderRadius: 4 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--mantine-color-default-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
                onClick={() => handlePickCommander(c)}
              >
                <Box w={32} h={45}><CardThumb card={c} /></Box>
                <div style={{ flex: 1 }}>
                  <Text size="sm" fw={500}>{c.name}</Text>
                  <Group gap={4}>
                    <SetSymbol code={c.setCode} name={c.setName} size={12} />
                    <Text size="xs" c="dimmed">{c.typeLine}</Text>
                  </Group>
                </div>
              </Group>
            ))
          ) : commanderSearch.trim().length >= 2 && <Text c="dimmed" ta="center" py="xl">No cards found</Text>}
        </ScrollArea>
      </Modal>

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

      <Modal opened={moveOpened} onClose={closeMove} title={`Move ${moveItems.length} item(s)`} size="sm" centered>
        <Select placeholder="Destination location" data={locations.map(l => ({ value: String(l.id), label: l.name }))}
          value={moveDestLoc} onChange={setMoveDestLoc} mb="md" />
        <Group justify="flex-end"><Button variant="default" onClick={closeMove}>Cancel</Button><Button onClick={handleMove}>Move</Button></Group>
      </Modal>

      <Modal opened={fillOpened} onClose={closeFill} title={`Fill "${fillCardName}" from Collection`} size="md" centered>
        {fillCollectionItems.length === 0 ? (
          <Text c="dimmed" py="md" ta="center">No copies of this card found in your collection.</Text>
        ) : (
          <ScrollArea h={300}>
            {fillCollectionItems.map(item => (
              <Paper key={item.id} withBorder mb={2} radius={0}>
                <Group p="sm" gap="sm" wrap="nowrap">
                  <CardThumb card={item.card} />
                  <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500}>{item.card.name}</Text>
                    <Group gap={4}>
                      <SetSymbol code={item.card.setCode} name={item.card.setName} size={12} />
                      <Text size="xs" c="dimmed">#{item.card.collectorNumber}</Text>
                    </Group>
                  </div>
                  <Badge size="sm" variant="light">{item.quantity}x</Badge>
                  <Badge size="xs" variant="outline" color="gray">{item.condition || '-'}</Badge>
                  {item.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge> : null}
                  <Button size="compact-xs" variant="light" color="blue" onClick={() => handleFillCard(item.id)}>
                    Use This
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

function CommanderThumb({ card, size = 48 }: { card: ScryfallCard | null; size?: number }) {
  const src = card?.imageUris?.normal || card?.imageUris?.large || card?.imageUris?.small || null;
  const largeSrc = card?.imageUris?.large || card?.imageUris?.normal || null;
  const w = Math.round(size * (63 / 88));
  const thumb = (
    <Group gap="sm" wrap="nowrap" align="center">
      <Box w={w} h={size} style={{ borderRadius: 6, overflow: 'hidden', background: '#1a1a2e', flexShrink: 0, position: 'relative', boxShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
        {src
          ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: Math.round(size * 0.5), opacity: 0.3 }}>?</span>}
      </Box>
      {card && <Text size="sm" fw={500} lh={1.2}>{card.name}</Text>}
    </Group>
  );
  if (!largeSrc) return thumb;
  return (
    <HoverCard width={320} shadow="md" withArrow openDelay={150}>
      <HoverCard.Target>
        <div style={{ display: 'inline-flex' }}>{thumb}</div>
      </HoverCard.Target>
      <HoverCard.Dropdown p={0} style={{ border: 'none', background: 'transparent', pointerEvents: 'none' }}>
        <Image src={largeSrc} w={320} h={448} fit="contain" radius="sm" />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

function DeckCommandZone({ deck, deckCards, requiredCards, onAssign }: {
  deck: Deck;
  deckCards: CollectionItem[];
  requiredCards: RequiredCard[];
  onAssign: (cardId: string, mode: 'commander' | 'partner' | 'background') => Promise<void>;
}) {
  const [commander, setCommander] = useState<ScryfallCard | null>(null);
  const [partner, setPartner] = useState<ScryfallCard | null>(null);
  const [background, setBackground] = useState<ScryfallCard | null>(null);
  const [pickMode, setPickMode] = useState<'commander' | 'second'>('commander');
  const [pickOpened, { open: openPick, close: closePick }] = useDisclosure(false);
  const [assigning, setAssigning] = useState(false);

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

  const uniqueCards = deckCards.filter((item, i, arr) => arr.findIndex(x => x.card.id === item.card.id) === i);

  const pickEntries: Array<{ key: string; name: string; typeLine: string | null; cardId: string | null; reqId?: number; thumb: ReactNode }> = [];
  for (const item of uniqueCards) {
    pickEntries.push({
      key: item.card.id,
      name: item.card.name,
      typeLine: item.card.typeLine,
      cardId: item.card.id,
      thumb: <CardThumb card={item.card} />,
    });
  }
  for (const req of requiredCards) {
    const key = req.cardId || `name:${req.cardName}`;
    if (pickEntries.some(e => e.key === key)) continue;
    pickEntries.push({
      key,
      name: req.cardName,
      typeLine: 'Ghost card',
      cardId: req.cardId || null,
      reqId: req.id,
      thumb: <GhostThumb name={req.cardName} cardId={req.cardId} />,
    });
  }

  const secondCard = partner || background;
  const secondLabel = partner ? 'Partner' : background ? 'Background' : null;

  const handleAssign = async (entry: { cardId: string | null; name: string; reqId?: number }, explicitMode?: 'commander' | 'partner' | 'background') => {
    const mode = explicitMode || (deck.backgroundCardId ? 'background' : 'partner');
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
      await onAssign(cardId, mode);
      closePick();
    } catch {} finally {
      setAssigning(false);
    }
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
        <ScrollArea h={420}>
          {pickEntries.length === 0 && <Text c="dimmed" ta="center" py="xl">Add cards or ghost cards to the deck first.</Text>}
          {pickEntries.map(entry => (
            <Group key={entry.key} p="xs" gap="sm" wrap="nowrap">
              <Box w={32} h={45} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{entry.thumb}</Box>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500}>{entry.name}</Text>
                <Text size="xs" c="dimmed">{entry.typeLine}</Text>
              </div>
              {pickMode === 'commander' ? (
                <Button size="compact-xs" variant="light" color="yellow" loading={assigning} onClick={() => handleAssign(entry, 'commander')}>
                  Set as Commander
                </Button>
              ) : (
                <Button size="compact-xs" variant="light" color="teal" loading={assigning} onClick={() => handleAssign(entry)}>
                  Set as Partner/Background
                </Button>
              )}
            </Group>
          ))}
        </ScrollArea>
      </Modal>
    </>
  );
}

function CommanderSlot({ label, card, hasCard, onChoose, onRemove }: {
  label: string; card: ScryfallCard | null; hasCard: boolean; onChoose: () => void; onRemove: () => void;
}) {
  return (
    <Group gap="xs" mb="xs" wrap="nowrap" align="center">
      <Text size="xs" c="dimmed" w={84} style={{ flexShrink: 0 }}>{label}</Text>
      {hasCard ? (
        card ? (
          <>
            <CommanderThumb card={card} size={40} />
            <Button size="compact-xs" variant="light" onClick={onChoose}>Change</Button>
            <Button size="compact-xs" variant="subtle" color="red" onClick={onRemove}>Remove</Button>
          </>
        ) : (
          <Text size="xs" c="dimmed">Loading...</Text>
        )
      ) : (
        <Button size="compact-xs" variant="outline" color="gray" leftSection={<IconPlus size={12} />} onClick={onChoose}>
          Add card
        </Button>
      )}
    </Group>
  );
}

function CommanderArea({ form, setForm, openPicker }: {
  form: { commanderCardId: string; partnerCardId: string; backgroundCardId: string };
  setForm: (f: (prev: any) => any) => void;
  openPicker: (mode: 'commander' | 'partner' | 'background') => void;
}) {
  const [commander, setCommander] = useState<ScryfallCard | null>(null);
  const [partner, setPartner] = useState<ScryfallCard | null>(null);
  const [background, setBackground] = useState<ScryfallCard | null>(null);
  useEffect(() => {
    if (form.commanderCardId) api.cards.get(form.commanderCardId).then(setCommander).catch(() => setCommander(null));
    else setCommander(null);
  }, [form.commanderCardId]);
  useEffect(() => {
    if (form.partnerCardId) api.cards.get(form.partnerCardId).then(setPartner).catch(() => setPartner(null));
    else setPartner(null);
  }, [form.partnerCardId]);
  useEffect(() => {
    if (form.backgroundCardId) api.cards.get(form.backgroundCardId).then(setBackground).catch(() => setBackground(null));
    else setBackground(null);
  }, [form.backgroundCardId]);

  const cmdText = commander?.oracleText || '';
  const showPartner = /(^|\n)\s*Partner/i.test(cmdText);
  const showBackground = /Choose a Background/i.test(cmdText);

  const identitySet = new Set<string>();
  [commander, partner, background].forEach(c => c?.colorIdentity?.forEach(x => identitySet.add(x)));
  const identity = [...identitySet].sort();

  return (
    <Box mb="md">
      <Text size="sm" fw={500} mb={4}>Command Zone</Text>
      <CommanderSlot label="Commander" card={commander} hasCard={!!form.commanderCardId}
        onChoose={() => openPicker('commander')}
        onRemove={() => setForm(f => ({ ...f, commanderCardId: '' }))} />
      {showPartner && (
        <CommanderSlot label="Partner" card={partner} hasCard={!!form.partnerCardId}
          onChoose={() => openPicker('partner')}
          onRemove={() => setForm(f => ({ ...f, partnerCardId: '' }))} />
      )}
      {showBackground && (
        <CommanderSlot label="Background" card={background} hasCard={!!form.backgroundCardId}
          onChoose={() => openPicker('background')}
          onRemove={() => setForm(f => ({ ...f, backgroundCardId: '' }))} />
      )}
      <Group gap={6} mt="xs">
        <Text size="xs" c="dimmed">Color identity:</Text>
        {identity.length === 0
          ? <Text size="xs" c="dimmed">—</Text>
          : identity.map(c => (
            <Badge key={c} size="sm" variant="light" styles={{ label: { color: '#fff' } }} style={{ background: CID_COLORS[c] || '#666' }}>{c}</Badge>
          ))}
      </Group>
    </Box>
  );
}

function DeckArtwork({ cardId, size = 200 }: { cardId: string; size?: number }) {  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!cardId) return;
    setSrc(null); setLoaded(false);
    api.cards.get(cardId).then(card => {
      setSrc(card?.imageUris?.art_crop || card?.imageUris?.large || card?.imageUris?.normal || null);
    }).catch(() => setSrc(null));
  }, [cardId]);
  return (
    <div style={{ width: '100%', height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', position: 'relative', overflow: 'hidden' }}>
      {src && <img src={src} onLoad={() => setLoaded(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: loaded ? 1 : 0, transition: 'opacity 0.2s' }} alt="" />}
      {!loaded && <span style={{ fontSize: 48, opacity: 0.15 }}>🃏</span>}
    </div>
  );
}
