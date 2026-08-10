import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Title, Group, Text, Image, Badge, Table,
  TextInput, Select, NumberInput, Switch, SegmentedControl,
  Button, Checkbox, LoadingOverlay, Box, Paper, Collapse, Pagination, Modal,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconPlus } from '@tabler/icons-react';
import { api } from '../api/client';
import { CONDITIONS } from '../types';
import type { GroupedCard, ScryfallCard, CardResult, Location, Condition, CollectionItem } from '../types';
import { CardThumb, SetSymbol, Tags, GhostThumb } from '../components/CardDisplay';
import { CardGroup } from '../components/CardGroup';
import { useUndo } from '../components/UndoToasts';

interface PrintingForm {
  selected: boolean;
  quantity: number;
  foil: boolean;
  condition: Condition | '';
  purchasePrice: string;
  packOpened: boolean;
  notes: string;
}

interface WantEntry {
  wantId: number;
  cardId: string;
  cardName: string;
  kind: 'specific' | 'generic';
  destId: number | null;
  collectionGoalId: number | null;
  persistent: boolean;
}

const CONDITION_COLORS: Record<string, string> = {
  M: '#2e7d32', NM: '#00897b', LP: '#1565c0',
  MP: '#f9a825', HP: '#e65100', Dmg: '#c62828',
};

const PRINTINGS_PER_PAGE = 25;

const defaultForm = (): PrintingForm => ({
  selected: false, quantity: 1, foil: false, condition: 'NM' as Condition,
  purchasePrice: '', packOpened: false, notes: '',
});

function InvalidBubble() {
  return (
    <Box style={{
      position: 'absolute', top: '100%', left: 4, marginTop: 2, zIndex: 40,
      background: '#e03131', color: '#fff', fontSize: 12, fontWeight: 600,
      padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap',
      boxShadow: '0 2px 8px rgba(0,0,0,0.35)', pointerEvents: 'none',
    }}>
      Invalid
      <Box style={{ position: 'absolute', top: -6, left: 18, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '6px solid #e03131' }} />
    </Box>
  );
}

export default function AddCardsPage() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [groupedResults, setGroupedResults] = useState<GroupedCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLoc, setSelectedLoc] = useState<string | null>(null);
  const [destLoc, setDestLoc] = useState<string | null>(null);
  const [defaultPrice, setDefaultPrice] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [printings, setPrintings] = useState<Record<string, ScryfallCard[]>>({});
  const [forms, setForms] = useState<Record<string, PrintingForm>>({});
  const [loadingPrintings, setLoadingPrintings] = useState<Set<string>>(new Set());
  const [printingPage, setPrintingPage] = useState<Record<string, number>>({});
  const [quickAddCard, setQuickAddCard] = useState<ScryfallCard | null>(null);
  const [quickForm, setQuickForm] = useState<PrintingForm>(defaultForm());
  const [quickLoc, setQuickLoc] = useState<string | null>(null);
  const [quickDest, setQuickDest] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<'location' | 'price' | null>(null);
  const [wantlist, setWantlist] = useState<Array<{ id: number; cardId: string | null; cardName: string; destinationId: number | null; collectionGoalId: number | null; persistent: number }>>([]);
  const [wantConfirm, setWantConfirm] = useState<{ toAdd: Array<[string, PrintingForm]>; entries: WantEntry[]; quick?: boolean } | null>(null);
  const [wantLoc, setWantLoc] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const quickModalRef = useRef<HTMLDivElement>(null);
  const locInputRef = useRef<HTMLInputElement>(null);
  const destInputRef = useRef<HTMLInputElement>(null);
  const notesInputRef = useRef<HTMLInputElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const locationsLoaded = useRef(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const { push: pushUndo } = useUndo();

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    api.wantlist.list().then(setWantlist).catch(() => {});
  }, []);

  const findWantEntries = (cards: Array<{ id: string; name: string }>): WantEntry[] => {
    const out: WantEntry[] = [];
    const seen = new Set<number>();
    for (const c of cards) {
      for (const w of wantlist) {
        const specific = w.cardId && w.cardId === c.id;
        const generic = !w.cardId && w.cardName.toLowerCase() === c.name.toLowerCase();
        if ((specific || generic) && !seen.has(w.id)) {
          seen.add(w.id);
          out.push({
            wantId: w.id,
            cardId: c.id,
            cardName: c.name,
            kind: specific ? 'specific' : 'generic',
            destId: w.destinationId,
            collectionGoalId: w.collectionGoalId ?? null,
            persistent: !!w.persistent,
          });
        }
      }
    }
    return out;
  };

  const doSearch = useCallback(async (raw: string) => {
    const q = raw.replace(/[.'"]+/g, '').trim();
    if (!q) { setGroupedResults([]); setExpanded(new Set()); setPrintings({}); setForms({}); return; }
    setLoading(true);
    try {
      const isSmart = /^[a-z]{2,4}\s*\d+/i.test(q) || /^s:\S+\s+cn:\S+$/i.test(q);
      if (isSmart) {
        const cards = await api.cards.find(q);
        const groups: Record<string, CardResult[]> = {};
        for (const c of cards) {
          if (!groups[c.name]) groups[c.name] = [];
          groups[c.name].push(c);
        }
        const names = Object.keys(groups);
        setGroupedResults(names.map(n => ({
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
        const pMap: Record<string, CardResult[]> = {};
        for (const n of names) pMap[n] = groups[n];
        setPrintings(pMap as unknown as Record<string, ScryfallCard[]>);
        const fMap: Record<string, PrintingForm> = {};
        for (const c of cards) {
          const fs = foilState(c as unknown as ScryfallCard);
          fMap[c.id] = { ...defaultForm(), foil: fs.foilOnly };
        }
        setForms(fMap);

        const singles = names.filter(n => groups[n].length === 1);
        setExpanded(new Set(singles));
      } else {
        const res = await api.cards.grouped(q, 1, filtersRef.current);
        setGroupedResults(res.data);
        setPrintings({});
        setForms({});

        const singles = res.data.filter(g => g.printings === 1);
        setExpanded(new Set(singles.map(g => g.name)));
        for (const g of singles) {
          api.cards.printings(g.name).then(cards => {
            setPrintings(prev => ({ ...prev, [g.name]: cards as unknown as ScryfallCard[] }));
            setForms(prev => {
              const next = { ...prev };
              for (const c of cards) {
                if (!next[c.id]) {
                  const fs = foilState(c as unknown as ScryfallCard);
                  next[c.id] = { ...defaultForm(), foil: fs.foilOnly };
                }
              }
              return next;
            });
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      notifications.show({ title: 'Search error', message: err.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setQuickAddCard(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }, [doSearch]);

  const formatPrice = () => {
    setQuickForm(f => {
      const v = f.purchasePrice.trim();
      if (!v) return f;
      const n = parseFloat(v);
      if (isNaN(n)) return f;
      return { ...f, purchasePrice: n.toFixed(2) };
    });
  };

  const validateQuick = (): 'location' | 'price' | null => {
    if (!(quickLoc ?? selectedLoc)) return 'location';
    const p = quickForm.purchasePrice.trim();
    if (p && isNaN(parseFloat(p))) return 'price';
    return null;
  };

  const handleQuickAdd = async () => {
    const bad = validateQuick();
    if (bad) {
      setInvalidField(bad);
      return;
    }
    setInvalidField(null);
    const loc = quickLoc ?? selectedLoc;
    if (!quickAddCard || !loc) return;
    const entries = findWantEntries([{ id: quickAddCard.id, name: quickAddCard.name }]);
    if (entries.length > 0) {
      setWantLoc(loc);
      setWantConfirm({ toAdd: [[quickAddCard.id, quickForm]], entries, quick: true });
      return;
    }
    await doQuickAdd();
  };

  const doQuickAdd = async (destOverride?: number | null, locOverride?: string | null) => {
    const loc = locOverride ?? quickLoc ?? selectedLoc;
    if (!quickAddCard || !loc) return;
    const prev = {
      card: quickAddCard,
      form: quickForm,
      loc: quickLoc,
      dest: quickDest,
      query,
      groupedResults,
      printings,
      forms,
      expanded,
    };
    setAdding(true);
    try {
      const customPrice = quickForm.purchasePrice.trim();
      const defaultP = defaultPrice.trim();
      const purchasePrice = customPrice ? parseFloat(customPrice) : (defaultP ? parseFloat(defaultP) : undefined);
      const priceAutofilled = (!customPrice && !defaultP) ? 1 : 0;
      const { item, created } = await api.collection.addDetailed({
        cardId: quickAddCard.id, locationId: Number(loc), quantity: quickForm.quantity || 1,
        foil: quickForm.foil, condition: quickForm.condition || null,
        purchasePrice: purchasePrice ?? (priceAutofilled ? undefined : null),
        packOpened: quickForm.packOpened, notes: quickForm.notes || undefined,
        destinationId: destOverride ?? (quickDest ? Number(quickDest) : undefined),
      });
      const locName = locations.find(l => l.id === Number(loc))?.name || 'collection';
      pushUndo(`${quickAddCard.name} added to ${locName}`, async () => {
        await undoAdds([{ item, created, qty: quickForm.quantity || 1 }]);
        setQuickAddCard(prev.card);
        setQuickForm(prev.form);
        setQuickLoc(prev.loc);
        setQuickDest(prev.dest);
        setGroupedResults(prev.groupedResults);
        setPrintings(prev.printings);
        setForms(prev.forms);
        setExpanded(prev.expanded);
        setQuery(prev.query);
      }, 'Undo add');
      setQuickAddCard(null);
      setGroupedResults([]); setPrintings({}); setForms({}); setExpanded(new Set());
      setQuery('');
      searchRef.current?.focus();
      notifications.show({ title: 'Added', message: `${quickAddCard.name} added`, color: 'green' });
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setAdding(false);
    }
  };

  const modalKeyRef = useRef(handleQuickAdd);
  modalKeyRef.current = handleQuickAdd;
  const wantConfirmRef = useRef(wantConfirm);
  wantConfirmRef.current = wantConfirm;
  const prevFieldRef = useRef<{
    price: string; qty: number; notes: string; loc: string | null; dest: string | null;
  }>({ price: '', qty: 1, notes: '', loc: null, dest: null });
  const latestRef = useRef({ quickLoc, quickDest, form: quickForm });
  latestRef.current = { quickLoc, quickDest, form: quickForm };

  const getEditingField = (): 'location' | 'destination' | 'notes' | 'price' | 'editing' | null => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !quickModalRef.current?.contains(el)) return null;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && !el.isContentEditable) return null;
    if (el === locInputRef.current) return 'location';
    if (el === destInputRef.current) return 'destination';
    if (el === notesInputRef.current) return 'notes';
    if (el === priceInputRef.current) return 'price';
    return 'editing';
  };

  useEffect(() => {
    if (!quickAddCard) return;
    const handler = (e: KeyboardEvent) => {
      const editing = getEditingField();

      if (e.key === 'Enter') {
        if (editing === 'notes' || editing === 'editing') {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur();
          return;
        }
        if (editing === 'price') {
          e.preventDefault();
          e.stopPropagation();
          const v = quickForm.purchasePrice.trim();
          if (v && isNaN(parseFloat(v))) {
            setInvalidField('price');
            return;
          }
          setInvalidField(prev => prev === 'price' ? null : prev);
          (document.activeElement as HTMLElement | null)?.blur();
          return;
        }
        if (editing === 'location' || editing === 'destination') {
          const input = editing === 'location' ? locInputRef.current : destInputRef.current;
          if (input?.hasAttribute('data-expanded')) {
            setTimeout(() => input.blur(), 0);
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        modalKeyRef.current();
        return;
      }

      if (e.key === 'Escape') {
        if (editing) {
          e.preventDefault();
          e.stopPropagation();
          const prev = prevFieldRef.current;
          if (editing === 'location') setQuickLoc(prev.loc);
          else if (editing === 'destination') setQuickDest(prev.dest);
          else if (editing === 'price') setQuickForm(f => ({ ...f, purchasePrice: prev.price }));
          else if (editing === 'notes') setQuickForm(f => ({ ...f, notes: prev.notes }));
          else setQuickForm(f => ({ ...f, quantity: prev.qty }));
          setInvalidField(null);
          (document.activeElement as HTMLElement | null)?.blur();
          return;
        }
        if (wantConfirmRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        setQuickAddCard(null);
        return;
      }

      if (editing) return;

      if (e.key === 'f' || e.key === 'F') {
        const fs = foilState(quickAddCard);
        if (fs.canFoil && !fs.foilOnly) {
          e.preventDefault();
          setQuickForm(f => ({ ...f, foil: !f.foil }));
        }
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setInvalidField(prev => prev === 'location' ? null : prev);
        locInputRef.current?.focus();
        locInputRef.current?.select();
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        destInputRef.current?.focus();
        destInputRef.current?.select();
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setInvalidField(prev => prev === 'price' ? null : prev);
        priceInputRef.current?.focus();
        priceInputRef.current?.select();
        return;
      }
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        qtyInputRef.current?.focus();
        qtyInputRef.current?.select();
        return;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        notesInputRef.current?.focus();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setQuickForm(f => {
          const idx = CONDITIONS.indexOf(f.condition as typeof CONDITIONS[number]);
          if (idx === -1) return f;
          const next = e.key === 'ArrowRight'
            ? Math.min(idx + 1, CONDITIONS.length - 1)
            : Math.max(idx - 1, 0);
          return { ...f, condition: CONDITIONS[next] };
        });
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setQuickForm(f => ({
          ...f,
          quantity: Math.max(1, Math.min(999, f.quantity + (e.key === 'ArrowUp' ? 1 : -1))),
        }));
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [quickAddCard]);

  useEffect(() => {
    if (!quickAddCard) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t === locInputRef.current) prevFieldRef.current.loc = latestRef.current.quickLoc;
      else if (t === destInputRef.current) prevFieldRef.current.dest = latestRef.current.quickDest;
      else if (t === priceInputRef.current) prevFieldRef.current.price = latestRef.current.form.purchasePrice;
      else if (t === notesInputRef.current) prevFieldRef.current.notes = latestRef.current.form.notes;
      else if (t === qtyInputRef.current) prevFieldRef.current.qty = latestRef.current.form.quantity;
    };
    const el = quickModalRef.current;
    if (!el) return;
    el.addEventListener('focusin', onFocusIn);
    return () => el.removeEventListener('focusin', onFocusIn);
  }, [quickAddCard]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (quickAddCard || groupedResults.length !== 1) return;
    const g = groupedResults[0];
    if (g.printings !== 1) return;
    let cards = printings[g.name];
    if (!cards || cards.length === 0) {
      try {
        cards = await api.cards.printings(g.name) as unknown as ScryfallCard[];
        setPrintings(prev => ({ ...prev, [g.name]: cards }));
      } catch { return; }
    }
    const card = cards[0];
    setQuickAddCard(card);
    setQuickLoc(selectedLoc);
    setQuickDest(destLoc);
    const fs = foilState(card);
    setQuickForm({ ...defaultForm(), foil: fs.foilOnly });
  }, [quickAddCard, groupedResults, printings]);

  useEffect(() => {
    if (!locationsLoaded.current) {
      locationsLoaded.current = true;
      api.locations.list().then(locs => {
        setLocations(locs);
        if (locs.length > 0 && !selectedLoc) {
          const inbox = locs.find(l => l.name === 'Inbox' || l.builtIn);
          setSelectedLoc(String(inbox?.id ?? locs[0].id));
        }
      }).catch(() => {});
    }
  }, [selectedLoc]);

  const toggleExpand = async (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) {
      next.delete(name);
      setExpanded(next);
      return;
    }
    next.add(name);
    setExpanded(next);

    if (!printings[name]) {
      setLoadingPrintings(prev => new Set(prev).add(name));
      setPrintingPage(prev => ({ ...prev, [name]: 0 }));
      try {
        const cards = await api.cards.printings(name);
        setPrintings(prev => ({ ...prev, [name]: cards }));
        setForms(prev => {
          const next = { ...prev };
          for (const c of cards) {
            if (!next[c.id]) {
              const f = foilState(c);
              next[c.id] = { ...defaultForm(), foil: f.foilOnly };
            }
          }
          return next;
        });
      } catch {
        notifications.show({ title: 'Error', message: `Failed to load printings for ${name}`, color: 'red' });
      } finally {
        setLoadingPrintings(prev => { const n = new Set(prev); n.delete(name); return n; });
      }
    }
  };

  const updateAndSelect = (cardId: string, updates: Partial<PrintingForm>) => {
    setForms(prev => ({ ...prev, [cardId]: { ...prev[cardId], ...updates, selected: true } }));
  };

  const toggleSelect = (cardId: string) => {
    setForms(prev => ({ ...prev, [cardId]: { ...prev[cardId], selected: !prev[cardId]?.selected } }));
  };

  const getAutoPrice = (card: ScryfallCard): string => {
    if (card.prices?.usd) return card.prices.usd;
    if (card.prices?.usd_foil) return card.prices.usd_foil;
    return '';
  };

  const foilState = (card: ScryfallCard): { canFoil: boolean; foilOnly: boolean } => {
    const f = card.finishes ?? [];
    const has = f.includes('foil') || f.includes('etched');
    const only = has && !f.includes('nonfoil');
    return { canFoil: has, foilOnly: only };
  };

  const isSelected = (cardId: string) => forms[cardId]?.selected ?? false;

  const selectedCount = () => Object.values(forms).filter(f => f.selected).length;

  const handleAddAll = async () => {
    const toAdd = Object.entries(forms).filter(([_, f]) => f.selected);
    if (toAdd.length === 0) {
      notifications.show({ title: 'Nothing selected', message: 'Select at least one card', color: 'yellow' });
      return;
    }
    if (!selectedLoc) {
      notifications.show({ title: 'No location', message: 'Select a destination location', color: 'yellow' });
      return;
    }

    const cardNameById: Record<string, string> = {};
    for (const group of Object.values(printings)) {
      for (const c of group) cardNameById[c.id] = c.name;
    }
    const entries = findWantEntries(toAdd.map(([id]) => ({ id, name: cardNameById[id] || id })));
    if (entries.length > 0) {
      setWantLoc(selectedLoc);
      setWantConfirm({ toAdd, entries });
      return;
    }

    await doAddAll(toAdd);
  };

  const undoAdds = async (adds: Array<{ item: CollectionItem; created: boolean; qty: number }>) => {
    for (const a of adds) {
      try {
        if (a.created) {
          await api.collection.remove(a.item.id);
        } else {
          const remaining = a.item.quantity - a.qty;
          if (remaining <= 0) await api.collection.remove(a.item.id);
          else await api.collection.update(a.item.id, { quantity: remaining } as any);
        }
      } catch {}
    }
  };

  const doAddAll = async (toAdd: Array<[string, PrintingForm]>, destOverrides?: Record<string, number | null>, locOverride?: string | null) => {
    if (toAdd.length === 0) return;
    setAdding(true);
    let added = 0;
    let errors = 0;
    const adds: Array<{ item: CollectionItem; created: boolean; qty: number }> = [];

    for (const [cardId, f] of toAdd) {
      const customPrice = f.purchasePrice.trim();
      const defaultP = defaultPrice.trim();
      const purchasePrice = customPrice ? parseFloat(customPrice) : (defaultP ? parseFloat(defaultP) : undefined);
      const priceAutofilled = (!customPrice && !defaultP) ? 1 : 0;
      try {
        const { item, created } = await api.collection.addDetailed({
          cardId, locationId: Number(locOverride ?? selectedLoc), quantity: f.quantity || 1,
          foil: f.foil, condition: f.condition || null,
          purchasePrice: purchasePrice ?? (priceAutofilled ? undefined : null),
          packOpened: f.packOpened, notes: f.notes || undefined,
          destinationId: destOverrides?.[cardId] ?? (destLoc ? Number(destLoc) : undefined),
        });
        adds.push({ item, created, qty: f.quantity || 1 });
        added++;
      } catch {
        errors++;
      }
    }

    setAdding(false);

    if (errors === 0 && added > 0) {
      const locName = locations.find(l => l.id === Number(locOverride ?? selectedLoc))?.name || 'collection';
      pushUndo(`${added} card${added !== 1 ? 's' : ''} added to ${locName}`, () => undoAdds(adds), 'Undo add');
      setGroupedResults([]); setPrintings({}); setForms({}); setExpanded(new Set());
      setQuery('');
    } else if (errors > 0) {
      notifications.show({ title: 'Added with errors', message: `${added} added, ${errors} failed`, color: 'yellow' });
    }
  };

  const fulfilEntry = async (entry: WantEntry) => {
    const c = wantConfirm;
    const loc = wantLoc;
    setWantConfirm(null);
    if (!c) return;
    setAdding(true);
    try {
      const form = c.toAdd.find(([id]) => id === entry.cardId)?.[1];
      const res = await api.wantlist.fulfil(entry.wantId, form?.quantity || 1).catch(() => ({ removed: true, goal: null }));
      api.wantlist.list().then(setWantlist).catch(() => {});
      const customPrice = form?.purchasePrice?.trim();
      const defaultP = defaultPrice.trim();
      const purchasePrice = customPrice ? parseFloat(customPrice) : (defaultP ? parseFloat(defaultP) : undefined);
      const priceAutofilled = (!customPrice && !defaultP) ? 1 : 0;
      await api.collection.addDetailed({
        cardId: entry.cardId,
        locationId: Number(loc),
        quantity: form?.quantity || 1,
        foil: form?.foil ?? false,
        condition: form?.condition || null,
        purchasePrice: purchasePrice ?? (priceAutofilled ? undefined : null),
        packOpened: form?.packOpened ?? false,
        notes: form?.notes || undefined,
        destinationId: entry.destId ?? (destLoc ? Number(destLoc) : undefined),
        forceNew: true,
      }).then(({ item }) => {
        const removed = res.removed;
        pushUndo(`${entry.cardName} fulfilled${removed ? '' : ' (collection)'}`, async () => {
          await api.collection.remove(item.id).catch(() => {});
          await api.wantlist.add({
            cardId: entry.kind === 'specific' ? entry.cardId : undefined,
            cardName: entry.cardName,
            destinationId: entry.destId ?? undefined,
            collectionGoalId: entry.collectionGoalId ?? undefined,
            persistent: entry.persistent,
          }).catch(() => {});
        }, 'Undo fulfil');
      });
      notifications.show({ title: 'Fulfilled', message: `${entry.cardName} added`, color: 'green' });
      if (c.quick) {
        setQuickAddCard(null);
        setGroupedResults([]); setPrintings({}); setForms({}); setExpanded(new Set());
        setQuery('');
        searchRef.current?.focus();
      }
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setAdding(false);
    }
  };

  const addWithoutFulfil = () => {
    const c = wantConfirm;
    const loc = wantLoc;
    setWantConfirm(null);
    if (!c) return;
    if (c.quick) doQuickAdd(undefined, loc);
    else doAddAll(c.toAdd, undefined, loc);
  };

  const groupIsAllSelected = (name: string) =>
    printings[name]?.length > 0 && printings[name].every(c => forms[c.id]?.selected);

  const groupHasSomeSelected = (name: string) =>
    printings[name]?.some(c => forms[c.id]?.selected);

  return (
    <>
      <Group mb="md" justify="space-between">
        <Title order={2}>Add Cards</Title>
        <Group>
          <Select
            placeholder="Location"
            label="Location"
            data={locations.map(l => ({ value: String(l.id), label: l.name }))}
            value={selectedLoc}
            onChange={v => { setSelectedLoc(v); }}
            w={180} size="sm"
          />
          <Select
            placeholder="No destination"
            label="Destination (optional)"
            clearable
            data={locations.map(l => ({ value: String(l.id), label: l.name }))}
            value={destLoc}
            onChange={setDestLoc}
            w={180} size="sm"
          />
          <TextInput
            placeholder="Auto"
            label="Default Price ($)"
            value={defaultPrice}
            onChange={e => setDefaultPrice(e.currentTarget.value)}
            w={100} size="sm"
          />
        </Group>
      </Group>

      <TextInput
        mb="md"
        placeholder='Name, set+number (e.g. blb0239), or Scryfall syntax (e.g. s:blb cn:0239)'
        value={query}
        onChange={e => handleQueryChange(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        leftSection={<IconSearch size={16} />}
        ref={searchRef}
      />

      <Group mb="sm" gap="xs">
        <Button size="compact-sm" variant={showFilters ? 'filled' : 'light'} onClick={() => setShowFilters(!showFilters)}>
          Filters {Object.keys(filters).length > 0 ? `(${Object.keys(filters).length})` : ''}
        </Button>
        {Object.keys(filters).length > 0 && (
          <Button size="compact-sm" variant="subtle" color="gray" onClick={() => { setFilters({}); doSearch(query); }}>
            Clear
          </Button>
        )}
      </Group>

      <Collapse in={showFilters}>
        <Paper withBorder p="sm" mb="sm" radius="md">
          <Box h={26} mb="xs">
            {Object.keys(filters).length > 0 && (
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => { setFilters({}); doSearch(query); }}>
                Clear all filters
              </Button>
            )}
          </Box>
          <Text size="xs" fw={600} mb={4}>Colors</Text>
          <Group gap={4} mb="sm">
            {['W','U','B','R','G','C'].map(c => {
              const key = `c_${c}`;
              const val = filters[key];
              const isInc = val === 'include';
              const isExc = val === 'exclude';
              const border = isExc ? '3px solid #cc0000' : isInc ? '2px solid var(--mantine-color-blue-5)' : '2px solid transparent';
              const opacity = isExc ? 0.3 : isInc ? 1 : 0.5;
              return (
                <Box
                  key={c}
                  onClick={() => {
                    const next = isInc ? 'exclude' : isExc ? undefined : 'include';
                    setFilters(f => { const n = { ...f }; if (next) n[key] = next; else delete n[key]; return n; });
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    debounceRef.current = setTimeout(() => doSearch(query), 300);
                  }}
                  style={{ cursor: 'pointer', lineHeight: 0, borderRadius: '50%', border, opacity }}
                >
                  <Image
                    src={`https://svgs.scryfall.io/card-symbols/${c}.svg`}
                    w={32} h={32} fit="contain"
                    fallbackSrc={`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect fill='%23ccc' width='32' height='32' rx='16'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-size='18' font-weight='bold' fill='%23666'%3E${encodeURIComponent(c)}%3C/text%3E%3C/svg%3E`}
                  />
                </Box>
              );
            })}
          </Group>
          <Group mb="sm">
            <Button size="compact-xs" variant={filters.colorMode === 'and' ? 'filled' : 'outline'} color="blue"
              onClick={() => {
                setFilters(f => ({ ...f, colorMode: f.colorMode === 'and' ? 'or' : 'and' }));
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => doSearch(query), 300);
              }}
            >{filters.colorMode === 'and' ? 'AND (all colors)' : 'OR (any color)'}</Button>
          </Group>

          <Text size="xs" fw={600} mb={4}>Tags</Text>
          <Group gap={4} mb="sm">
            {[['promo','PROMO'],['serial','SERIAL'],['fullArt','FULL ART'],['textless','TEXTLESS']].map(([k,label]) => {
              const active = filters[k] === '1';
              return (
                <Badge
                  key={k} size="sm" variant={active ? 'filled' : 'outline'} color="gray"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setFilters(f => { const n = { ...f }; if (active) delete n[k]; else n[k] = '1'; return n; });
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    debounceRef.current = setTimeout(() => doSearch(query), 300);
                  }}
                >{label}</Badge>
              );
            })}
          </Group>

          <Group gap="sm" mb="sm" align="flex-end">
            <div>
              <Text size="xs" fw={600} mb={2}>CMC Min</Text>
              <NumberInput value={filters.cmcMin ?? ''} onChange={v => {
                setFilters(f => { const n = { ...f }; if (v !== '' && v !== null) n.cmcMin = String(v); else delete n.cmcMin; return n; });
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => doSearch(query), 300);
              }} min={0} max={20} w={70} size="xs" />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2}>CMC Max</Text>
              <NumberInput value={filters.cmcMax ?? ''} onChange={v => {
                setFilters(f => { const n = { ...f }; if (v !== '' && v !== null) n.cmcMax = String(v); else delete n.cmcMax; return n; });
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => doSearch(query), 300);
              }} min={0} max={20} w={70} size="xs" />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2}>Rarity</Text>
              <Group gap={4}>
                {[['common','Common'],['uncommon','Uncommon'],['rare','Rare'],['mythic','Mythic'],['special','Special']].map(([k,label]) => {
                  const active = (filters.rarity || '').split(',').includes(k);
                  return (
                    <Badge key={k} size="sm" variant={active ? 'filled' : 'outline'} color={active ? 'blue' : 'gray'}
                      style={{ cursor: 'pointer', textTransform: 'none' }}
                      onClick={() => {
                        setFilters(f => {
                          const n = { ...f };
                          const current = (n.rarity || '').split(',').filter(Boolean);
                          if (current.includes(k)) {
                            const next = current.filter(x => x !== k);
                            if (next.length) n.rarity = next.join(','); else delete n.rarity;
                          } else {
                            current.push(k);
                            n.rarity = current.join(',');
                          }
                          return n;
                        });
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        debounceRef.current = setTimeout(() => doSearch(query), 300);
                      }}
                    >{label}</Badge>
                  );
                })}
              </Group>
            </div>
          </Group>

          <Text size="xs" fw={600} mb={4}>Type</Text>
          <Group gap={4}>
            {['Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Land','Battle','Kindred'].map(t => {
              const active = (filters.type || '').split(',').includes(t);
              return (
                <Badge key={t} size="sm" variant={active ? 'filled' : 'outline'} color={active ? 'blue' : 'gray'}
                  style={{ cursor: 'pointer', textTransform: 'none' }}
                  onClick={() => {
                    setFilters(f => {
                      const n = { ...f };
                      const current = (n.type || '').split(',').filter(Boolean);
                      if (current.includes(t)) {
                        const next = current.filter(x => x !== t);
                        if (next.length) n.type = next.join(','); else delete n.type;
                      } else {
                        current.push(t);
                        n.type = current.join(',');
                      }
                      return n;
                    });
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                    debounceRef.current = setTimeout(() => doSearch(query), 300);
                  }}
                >{t}</Badge>
              );
            })}
          </Group>
        </Paper>
      </Collapse>

      <Box pos="relative">
        <LoadingOverlay visible={loading} />

        {groupedResults.length > 0 && (
          <>
            <Group mb="sm" justify="space-between">
              <Text size="sm" c="dimmed">{groupedResults.length} card{groupedResults.length !== 1 ? 's' : ''} found</Text>
              <Button onClick={handleAddAll} loading={adding} leftSection={<IconPlus size={16} />}>
                Add Selected ({selectedCount()})
              </Button>
            </Group>

            {groupedResults.map(group => {
              const isSingle = group.printings === 1 && printings[group.name]?.length === 1;
              const isExpanded = expanded.has(group.name);

              const singleRow = () => {
                const card = printings[group.name][0] as unknown as ScryfallCard;
                const sel = isSelected(card.id);
                const f = forms[card.id];
                const hasCustomPrice = f?.purchasePrice && f.purchasePrice.trim().length > 0;
                const hasNotes = f?.notes && f.notes.trim().length > 0;
                return (
                  <Table>
                    <Table.Thead>
                      <Table.Tr style={{ height: 0, visibility: 'collapse' }}>
                        <Table.Th w={36} /><Table.Th /><Table.Th w={90} /><Table.Th w={55} />
                        <Table.Th w={50} /><Table.Th w={46} /><Table.Th w={130} />
                        <Table.Th w={80} /><Table.Th w={62} /><Table.Th w={100} />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      <Table.Tr key={card.id} bg={sel ? 'var(--mantine-color-blue-0)' : undefined}>
                        <Table.Td onClick={() => toggleSelect(card.id)} style={{ cursor: 'pointer' }}>
                          <Checkbox size="xs" checked={sel} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(card.id)} />
                        </Table.Td>
                        <Table.Td onClick={() => toggleSelect(card.id)} style={{ cursor: 'pointer' }}>
                          <Group gap="sm" wrap="nowrap">
                            <CardThumb card={card} />
                            <div>
                              <Text size="xs" fw={500}>{card.name}</Text>
                              <Tags card={card} />
                            </div>
                          </Group>
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}><SetSymbol code={card.setCode} name={card.setName} /></Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}><Text size="xs">{card.collectorNumber}</Text></Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <NumberInput value={f?.quantity ?? 1} onChange={v => updateAndSelect(card.id, { quantity: Number(v) || 1 })} min={1} max={999} w={50} size="xs" />
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <Switch checked={f?.foil ?? false} onChange={e => updateAndSelect(card.id, { foil: e.currentTarget.checked })}
                            disabled={!foilState(card).canFoil || foilState(card).foilOnly} size="xs" onLabel="F" offLabel="N"
                            color={f?.foil ? 'yellow' : undefined}
                            styles={{ track: !foilState(card).canFoil ? { cursor: 'not-allowed', opacity: 0.4 } : foilState(card).foilOnly ? { cursor: 'not-allowed', borderColor: 'var(--mantine-color-yellow-5)' } : {}, thumb: !foilState(card).canFoil || foilState(card).foilOnly ? { cursor: 'not-allowed' } : {} }} />
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <SegmentedControl value={f?.condition ?? 'NM'} onChange={v => updateAndSelect(card.id, { condition: v as Condition })}
                            data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs" fullWidth={false}
                            styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[f?.condition ?? 'NM'] || '#00897b' } }} />
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <TextInput value={f?.purchasePrice ?? ''} onChange={e => updateAndSelect(card.id, { purchasePrice: e.currentTarget.value })}
                            placeholder={getAutoPrice(card) || '0.00'} size="xs" w={76}
                            leftSection={<Text size="xs" c="dimmed">$</Text>}
                            styles={{ input: hasCustomPrice ? { borderColor: 'var(--mantine-color-teal-5)', borderWidth: 2 } : undefined }} />
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <Switch checked={f?.packOpened ?? false} onChange={e => updateAndSelect(card.id, { packOpened: e.currentTarget.checked })} size="xs" />
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <TextInput value={f?.notes ?? ''} onChange={e => updateAndSelect(card.id, { notes: e.currentTarget.value })}
                            placeholder="notes" size="xs" w={100}
                            styles={{ input: hasNotes ? { borderColor: 'var(--mantine-color-teal-5)', borderWidth: 2 } : undefined }} />
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                );
              };

              if (isSingle) {
                return <CardGroup key={group.name} card={group} name={group.name} manaCost={group.manaCost} typeLine={group.typeLine} isSingle expanded={false} onToggle={() => {}}>{singleRow()}</CardGroup>;
              }

              const allSel = groupIsAllSelected(group.name);
              const someSel = groupHasSomeSelected(group.name);
              const expandedContent = loadingPrintings.has(group.name) ? (
                <Text size="sm" c="dimmed" p="sm">Loading printings...</Text>
              ) : printings[group.name] ? (
                (() => {
                  const allCards = printings[group.name];
                  const pageIdx = printingPage[group.name] ?? 0;
                  const totalPg = Math.ceil(allCards.length / PRINTINGS_PER_PAGE);
                  const visible = allCards.slice(pageIdx * PRINTINGS_PER_PAGE, (pageIdx + 1) * PRINTINGS_PER_PAGE);
                  const selectedCount = allCards.filter(c => forms[c.id]?.selected).length;
                  return (
                  <>
                    <Box px="sm" pb="xs">
                      <Checkbox checked={allSel} indeterminate={someSel && !allSel}
                        onChange={() => {
                          const ids = allCards.map(c => c.id);
                          const anySelected = allSel || someSel;
                          setForms(prev => { const updated = { ...prev }; for (const id of ids) if (updated[id]) updated[id] = { ...updated[id], selected: !anySelected }; return updated; });
                        }}
                        label={allSel || someSel ? `Deselect all (${selectedCount} selected)` : `Select all (${allCards.length})`}
                        color={allSel || someSel ? 'red' : undefined} size="xs" />
                    </Box>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th w={36}></Table.Th><Table.Th>Card</Table.Th><Table.Th w={90}>Set</Table.Th>
                          <Table.Th w={55}>#</Table.Th><Table.Th w={50}>Qty</Table.Th><Table.Th w={46}>Foil</Table.Th>
                          <Table.Th w={130}>Condition</Table.Th><Table.Th w={80}>Price $</Table.Th>
                          <Table.Th w={62}>Pack</Table.Th><Table.Th w={100}>Notes</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {visible.map(card => {
                          const sel = isSelected(card.id);
                          const f = forms[card.id];
                          const hasCustomPrice = f?.purchasePrice && f.purchasePrice.trim().length > 0;
                          const hasNotes = f?.notes && f.notes.trim().length > 0;
                          return (
                          <Table.Tr key={card.id} bg={sel ? 'var(--mantine-color-blue-0)' : undefined}>
                            <Table.Td onClick={() => toggleSelect(card.id)} style={{ cursor: 'pointer' }}>
                              <Checkbox size="xs" checked={sel} onClick={e => e.stopPropagation()} onChange={() => toggleSelect(card.id)} />
                            </Table.Td>
                            <Table.Td onClick={() => toggleSelect(card.id)} style={{ cursor: 'pointer' }}>
                              <Group gap="sm" wrap="nowrap">
                                <CardThumb card={card} />
                                <div><Text size="xs" fw={500}>{card.name}</Text><Tags card={card} /></div>
                              </Group>
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}><SetSymbol code={card.setCode} name={card.setName} /></Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}><Text size="xs">{card.collectorNumber}</Text></Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <NumberInput value={f?.quantity ?? 1} onChange={v => updateAndSelect(card.id, { quantity: Number(v) || 1 })} min={1} max={999} w={50} size="xs" />
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <Switch checked={f?.foil ?? false} onChange={e => updateAndSelect(card.id, { foil: e.currentTarget.checked })}
                                disabled={!foilState(card).canFoil || foilState(card).foilOnly} size="xs" onLabel="F" offLabel="N"
                                color={f?.foil ? 'yellow' : undefined}
                                styles={{ track: !foilState(card).canFoil ? { cursor: 'not-allowed', opacity: 0.4 } : foilState(card).foilOnly ? { cursor: 'not-allowed', borderColor: 'var(--mantine-color-yellow-5)' } : {}, thumb: !foilState(card).canFoil || foilState(card).foilOnly ? { cursor: 'not-allowed' } : {} }} />
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <SegmentedControl value={f?.condition ?? 'NM'} onChange={v => updateAndSelect(card.id, { condition: v as Condition })}
                                data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs" fullWidth={false}
                                styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[f?.condition ?? 'NM'] || '#00897b' } }} />
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <TextInput value={f?.purchasePrice ?? ''} onChange={e => updateAndSelect(card.id, { purchasePrice: e.currentTarget.value })}
                                placeholder={getAutoPrice(card) || '0.00'} size="xs" w={76}
                                leftSection={<Text size="xs" c="dimmed">$</Text>}
                                styles={{ input: hasCustomPrice ? { borderColor: 'var(--mantine-color-teal-5)', borderWidth: 2 } : undefined }} />
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <Switch checked={f?.packOpened ?? false} onChange={e => updateAndSelect(card.id, { packOpened: e.currentTarget.checked })} size="xs" />
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <TextInput value={f?.notes ?? ''} onChange={e => updateAndSelect(card.id, { notes: e.currentTarget.value })}
                                placeholder="notes" size="xs" w={100}
                                styles={{ input: hasNotes ? { borderColor: 'var(--mantine-color-teal-5)', borderWidth: 2 } : undefined }} />
                            </Table.Td>
                          </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                    {totalPg > 1 && (
                      <Group justify="center" py="xs">
                        <Pagination total={totalPg} value={pageIdx + 1} onChange={v => setPrintingPage(prev => ({ ...prev, [group.name]: v - 1 }))} size="sm" />
                      </Group>
                    )}
                  </>
                  );
                })()
              ) : null;

              return (
                <CardGroup key={group.name} card={group} name={group.name} manaCost={group.manaCost} typeLine={group.typeLine}
                  isSingle={false} expanded={isExpanded} onToggle={() => toggleExpand(group.name)}
                  rightSection={<Badge size="sm" variant="light" color="gray">{group.printings} printing{group.printings !== 1 ? 's' : ''}</Badge>}
                >
                  {expandedContent}
                </CardGroup>
              );
            })}
          </>
        )}

        {query && !loading && groupedResults.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">No cards found</Text>
        )}
      </Box>

      <Modal opened={!!quickAddCard} onClose={() => setQuickAddCard(null)} title="Quick Add" size="md" centered closeOnEscape={false}>
        {quickAddCard && (
          <Box ref={quickModalRef}>
            <Group gap="lg" mb="md" wrap="nowrap" align="flex-start">
              <Box w={265} h={370} style={{ overflow: 'hidden', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', position: 'relative' }}>
                <img
                  src={quickAddCard.imageUris?.large || quickAddCard.imageUris?.normal || quickAddCard.imageUris?.small || ''}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  alt={quickAddCard.name}
                />
                {quickForm.foil && (
                  <Box style={{
                    position: 'absolute', inset: 0, borderRadius: 8,
                    background: 'linear-gradient(135deg, transparent 30%, rgba(255,215,0,0.15) 40%, rgba(255,255,255,0.25) 44%, rgba(100,200,255,0.15) 48%, rgba(255,100,200,0.15) 52%, rgba(255,215,0,0.15) 56%, transparent 66%)',
                    backgroundSize: '200% 100%',
                    pointerEvents: 'none',
                    mixBlendMode: 'overlay',
                  }} />
                )}
              </Box>
              <div style={{ flex: 1 }}>
                <Text fw={600} size="lg">{quickAddCard.name}</Text>
                <Group gap={4} mt={4}>
                  <SetSymbol code={quickAddCard.setCode} name={quickAddCard.setName} />
                  <Text size="sm" c="dimmed">#{quickAddCard.collectorNumber}</Text>
                </Group>
                <Text size="xs" c="dimmed" mt={2}>{quickAddCard.typeLine}</Text>
                <Tags card={quickAddCard} />
                <Text size="xs" mt="sm">
                  Market: <b>${parseFloat(quickForm.foil ? (quickAddCard.prices?.usd_foil || '0') : (quickAddCard.prices?.usd || '0')).toFixed(2)}</b>
                  {quickAddCard.prices?.usd && !quickForm.foil && quickAddCard.prices?.usd_foil ? ` / Foil: $${parseFloat(quickAddCard.prices.usd_foil).toFixed(2)}` : ''}
                  {quickAddCard.prices?.usd && quickForm.foil ? ` / Nonfoil: $${parseFloat(quickAddCard.prices.usd).toFixed(2)}` : ''}
                </Text>
              </div>
            </Group>
            <Group gap="sm" mb="sm">
              <NumberInput label="Qty" value={quickForm.quantity} onChange={v => setQuickForm(f => ({ ...f, quantity: Number(v) || 1 }))} min={1} max={999} w={70} size="sm" ref={qtyInputRef} />
              <Switch label="Foil" checked={quickForm.foil} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, foil: v })); }}
                disabled={!foilState(quickAddCard).canFoil || foilState(quickAddCard).foilOnly} size="sm" onLabel="F" offLabel="N" mt={24} />
            </Group>
            <Box mb="sm">
              <Text size="sm" fw={500} mb={4}>Condition</Text>
              <SegmentedControl value={quickForm.condition} onChange={v => setQuickForm(f => ({ ...f, condition: v as Condition }))}
                data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs"
                styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[quickForm.condition] || '#00897b' } }} />
            </Box>
            <Group gap="sm" mb="sm">
              <Box style={{ position: 'relative' }}>
                <TextInput label="Price ($)" value={quickForm.purchasePrice} onChange={e => { const v = e.currentTarget.value; setQuickForm(f => ({ ...f, purchasePrice: v })); setInvalidField(prev => prev === 'price' ? null : prev); }}
                  placeholder={quickForm.foil ? (quickAddCard.prices?.usd_foil || '0.00') : (quickAddCard.prices?.usd || '0.00')} size="sm" w={120}
                  leftSection={<Text size="xs" c="dimmed">$</Text>} ref={priceInputRef} onBlur={formatPrice} />
                {invalidField === 'price' && <InvalidBubble />}
              </Box>
              <Switch label="Pack opened" checked={quickForm.packOpened} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, packOpened: v })); }} size="sm" mt={24} />
            </Group>
            <Box style={{ position: 'relative' }}>
              <Select label="Location" placeholder="Select location" searchable selectFirstOptionOnChange
                data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                value={quickLoc} onChange={v => { setQuickLoc(v); setInvalidField(prev => prev === 'location' ? null : prev); }} mb="sm" size="sm" ref={locInputRef} />
              {invalidField === 'location' && <InvalidBubble />}
            </Box>
            <Select label="Destination (optional)" placeholder="No destination" clearable searchable selectFirstOptionOnChange
              data={locations.map(l => ({ value: String(l.id), label: l.name }))}
              value={quickDest} onChange={setQuickDest} mb="sm" size="sm" ref={destInputRef} />
            <TextInput label="Notes" value={quickForm.notes} onChange={e => { const v = e.currentTarget.value; setQuickForm(f => ({ ...f, notes: v })); }} placeholder="notes" size="sm" mb="md" ref={notesInputRef} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setQuickAddCard(null)}>Cancel</Button>
              <Button onClick={handleQuickAdd} loading={adding} leftSection={<IconPlus size={16} />}>Add to Collection</Button>
            </Group>
            <Group gap="xs" mt="md" justify="center">
              <Badge size="xs" variant="light" color="gray">Enter</Badge>
              <Text size="xs" c="dimmed">Add</Text>
              <Badge size="xs" variant="light" color="gray">L</Badge>
              <Text size="xs" c="dimmed">Location</Text>
              <Badge size="xs" variant="light" color="gray">D</Badge>
              <Text size="xs" c="dimmed">Destination</Text>
              <Badge size="xs" variant="light" color="gray">P</Badge>
              <Text size="xs" c="dimmed">Price</Text>
              <Badge size="xs" variant="light" color="gray">Q</Badge>
              <Text size="xs" c="dimmed">Qty</Text>
              <Badge size="xs" variant="light" color="gray">N</Badge>
              <Text size="xs" c="dimmed">Notes</Text>
              <Badge size="xs" variant="light" color="gray">← →</Badge>
              <Text size="xs" c="dimmed">Condition</Text>
              <Badge size="xs" variant="light" color="gray">↑ ↓</Badge>
              <Text size="xs" c="dimmed">Qty</Text>
              <Badge size="xs" variant="light" color="gray">F</Badge>
              <Text size="xs" c="dimmed">Foil</Text>
            </Group>
          </Box>
        )}
      </Modal>

      <Modal opened={wantConfirm !== null} onClose={() => setWantConfirm(null)} title="Card in Wantlist" size="md" centered>
        {wantConfirm && (
          <>
            <Text size="sm" mb="sm">
              {wantConfirm.entries.length === 1
                ? <><b>{wantConfirm.entries[0].cardName}</b> is in your wantlist.</>
                : `This card has ${wantConfirm.entries.length} entries in your wantlist.`}
            </Text>
            <Box mb="md">
              {wantConfirm.entries.map(e => (
                <Group key={e.wantId} p="xs" gap="sm" wrap="nowrap">
                  <Box w={24} h={34}><GhostThumb name={e.cardName} cardId={e.kind === 'specific' ? e.cardId : null} /></Box>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500}>{e.cardName}</Text>
                    <Group gap={6}>
                      <Badge size="xs" color={e.kind === 'specific' ? 'blue' : 'gray'} variant="light">
                        {e.kind === 'specific' ? 'Specific printing' : 'Generic'}
                      </Badge>
                      {e.destId && (
                        <Badge size="xs" variant="light" color="green">
                          → {locations.find(l => l.id === e.destId)?.name || `#${e.destId}`}
                        </Badge>
                      )}
                    </Group>
                  </div>
                  <Button size="compact-xs" variant="light" color="green" loading={adding} onClick={() => fulfilEntry(e)}>
                    Fulfil
                  </Button>
                </Group>
              ))}
            </Box>
            <Group gap={5} align="center" wrap="wrap">
              <Text size="sm">Or add to</Text>
              <Select data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                value={wantLoc} onChange={setWantLoc} size="xs" w={120} searchable allowDeselect={false}
                styles={{ input: { minHeight: 26, height: 26, fontSize: 13, fontWeight: 600, borderRadius: 6, paddingLeft: 8, paddingRight: 8, textAlign: 'center' }, dropdown: { width: 'max-content', minWidth: 140 } }} />
              <Text size="sm">without fulfilling anything</Text>
            </Group>
            <Group justify="flex-end" mt="md">
              <Button variant="default" size="compact-sm" onClick={() => setWantConfirm(null)}>Cancel</Button>
              <Button size="compact-sm" onClick={addWithoutFulfil}>Add without Fulfilling</Button>
            </Group>
          </>
        )}
      </Modal>
    </>
  );
}
