import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Title, Group, Text, Image, Badge, Table,
  TextInput, Select, NumberInput, Switch, SegmentedControl,
  Button, Checkbox, LoadingOverlay, Box, Paper, Collapse, Pagination, Modal, Textarea, Stack, Code, SimpleGrid, Divider,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch, IconPlus, IconUpload } from '@tabler/icons-react';
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
  foreignLanguage: boolean;
  condition: Condition | '';
  purchasePrice: string;
  packOpened: boolean;
  proxy: boolean;
  misprint: boolean;
  altered: boolean;
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
  selected: false, quantity: 1, foil: false, foreignLanguage: false, condition: 'NM' as Condition,
  purchasePrice: '', packOpened: false, proxy: false, misprint: false, altered: false, notes: '',
});

interface BulkRow {
  key: string;
  line: string;
  amount: number;
  query: string;
  foil: boolean;
  ok: boolean;
  card: ScryfallCard | null;
}

// Parses one bulk-add line: optional quantity (with or without "x"), the set +
// collector number token, and an optional *F* foil marker. e.g.
//   "1 x vow33 *F*", "1 vow33 *F*", "4 vow42", "1x 2x2 123"
function parseBulkLine(line: string): { amount: number; query: string; foil: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const foil = /\*\s*f\s*\*/i.test(trimmed);
  const tokens = trimmed.replace(/\*\s*f\s*\*/ig, '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let amount = 1;
  let rest = tokens.join(' ');
  const first = tokens[0] ?? '';
  const xMatch = first.match(/^(\d+)x$/i);
  if (xMatch) {
    amount = parseInt(xMatch[1], 10) || 1;
    rest = tokens.slice(1).join(' ');
  } else if (/^x$/i.test(first)) {
    rest = tokens.slice(1).join(' ');
  } else if (/^\d+$/.test(first) && tokens.length > 1) {
    if (tokens[1].toLowerCase() === 'x') {
      amount = parseInt(first, 10) || 1;
      rest = tokens.slice(2).join(' ');
    } else {
      amount = parseInt(first, 10) || 1;
      rest = tokens.slice(1).join(' ');
    }
  }

  rest = rest.trim();
  if (!rest) return null;
  if (!/^[a-z0-9 ]+$/i.test(rest)) return null;
  return { amount: Math.max(1, amount), query: rest, foil };
}

// Market price used when the user doesn't enter a total price (auto-fill).
function cardAutoPrice(card: ScryfallCard | null, foil: boolean): number | null {
  if (!card?.prices) return null;
  const raw = foil ? card.prices.usd_foil : card.prices.usd;
  const n = parseFloat(raw || '');
  return isNaN(n) ? null : n;
}

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
  const [constEnabled, setConstEnabled] = useState(false);
  const [constSet, setConstSet] = useState('');
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
  const [quickWantlist, setQuickWantlist] = useState(false);
  const [invalidField, setInvalidField] = useState<'location' | 'price' | 'destination' | null>(null);
  const [wantlist, setWantlist] = useState<Array<{ id: number; cardId: string | null; cardName: string; destinationId: number | null; collectionGoalId: number | null; persistent: number }>>([]);
  const [wantConfirm, setWantConfirm] = useState<{ toAdd: Array<[string, PrintingForm]>; entries: WantEntry[]; quick?: boolean } | null>(null);
  const [wantLoc, setWantLoc] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<'collection' | 'wantlist'>('collection');
  const [bulkText, setBulkText] = useState('');
  const [bulkLoc, setBulkLoc] = useState<string | null>(null);
  const [bulkDest, setBulkDest] = useState<string | null>(null);
  const [bulkCondition, setBulkCondition] = useState<Condition>('NM');
  const [bulkTotal, setBulkTotal] = useState('');
  const [bulkRows, setBulkRows] = useState<BulkRow[] | null>(null);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkInvalid, setBulkInvalid] = useState<'location' | 'total' | 'destination' | null>(null);
  const [bulkPage, setBulkPage] = useState(1);
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
  const constEnabledRef = useRef(constEnabled);
  constEnabledRef.current = constEnabled;
  const constSetRef = useRef(constSet);
  constSetRef.current = constSet;
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
    // With a pinned set code, a bare collector number (digits, optional
    // trailing letter) is prepended with the set so "42" searches "vow42".
    let q = raw.replace(/[.'"]+/g, '').trim();
    const set = constSetRef.current.trim().toLowerCase();
    if (constEnabledRef.current && set && /^\d+[a-z]?$/i.test(q)) {
      q = `${set}${q}`;
      setQuery(raw);
    } else {
      setQuery(q);
    }
    if (!q) { setGroupedResults([]); setExpanded(new Set()); setPrintings({}); setForms({}); return; }
    setLoading(true);
    try {
      const compact = q.replace(/\s+/g, '');
      const isSmart = (
        /^[a-z0-9]+\d+$/i.test(compact) && /[a-z]/i.test(compact)
      ) || /^s:\S+\s+cn:\S+$/i.test(q);
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
          cardFaces: groups[n][0]?.cardFaces ?? null,
          layout: groups[n][0]?.layout ?? null,
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
        const setFilter = constEnabledRef.current ? constSetRef.current.trim().toLowerCase() : '';
        const res = await api.cards.grouped(
          q, 1,
          setFilter ? { ...filtersRef.current, set: setFilter } : filtersRef.current,
        );
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

  // CMC filter helper: 0 is a legitimate value (lands, 0-cmc spells); only an
  // actually-empty field removes the filter. Values are bound to the inputs as
  // numbers — passing the string "0" would be collapsed to empty by Mantine's
  // leading-zero trim on blur.
  const cmcVal = (s: string | undefined): number | string => {
    if (s === undefined || s === null || s === '') return '';
    return Number(s);
  };
  const setCmcFilter = (key: 'cmcMin' | 'cmcMax', v: number | string | null) => {
    setFilters(f => {
      const n = { ...f };
      if (v === '' || v === null || v === undefined) delete n[key];
      else n[key] = String(v);
      return n;
    });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
  };

  const wantlistToggleRef = useRef<(on: boolean) => void>(() => {});
  const quickWantlistRef = useRef(quickWantlist);
  quickWantlistRef.current = quickWantlist;

  const validateQuick = (): 'location' | 'price' | 'destination' | null => {
    if (quickWantlist) {
      return quickDest ? null : 'destination';
    }
    if (!(quickLoc ?? selectedLoc)) return 'location';
    const p = quickForm.purchasePrice.trim();
    if (p && isNaN(parseFloat(p))) return 'price';
    return null;
  };

  // Wantlist mode: a destination is required. Switching on defaults it to the
  // current location; switching off clears it if it equals the location.
  const setWantlistMode = (on: boolean) => {
    setQuickWantlist(on);
    const loc = quickLoc ?? selectedLoc;
    setQuickDest(prev => on
      ? (prev ?? loc)
      : (prev === loc ? null : prev));
  };
  wantlistToggleRef.current = setWantlistMode;

  const handleQuickAdd = async () => {
    const bad = validateQuick();
    if (bad) {
      setInvalidField(bad);
      return;
    }
    setInvalidField(null);
    const loc = quickLoc ?? selectedLoc;
    if (!quickAddCard) return;
    if (quickWantlist) {
      await doQuickWantlist();
      return;
    }
    if (!loc) return;
    const entries = findWantEntries([{ id: quickAddCard.id, name: quickAddCard.name }]);
    if (entries.length > 0) {
      setWantLoc(loc);
      setWantConfirm({ toAdd: [[quickAddCard.id, quickForm]], entries, quick: true });
      return;
    }
    await doQuickAdd();
  };

  const doQuickWantlist = async () => {
    if (!quickAddCard) return;
    const dest = quickDest;
    if (!dest) { setInvalidField('destination'); return; }
    setAdding(true);
    try {
      await api.wantlist.add({
        cardId: quickAddCard.id,
        cardName: quickAddCard.name,
        setCode: quickAddCard.setCode,
        collectorNumber: quickAddCard.collectorNumber,
        foil: quickForm.foil || undefined,
        condition: quickForm.condition || null,
        quantity: quickForm.quantity || 1,
        notes: quickForm.notes.trim() || undefined,
        destinationId: Number(dest),
      });
      const destName = locations.find(l => l.id === Number(dest))?.name || 'destination';
      notifications.show({ title: 'Added to wantlist', message: `${quickAddCard.name} added to ${destName}`, color: 'green' });
      setQuickAddCard(null);
      setGroupedResults([]); setPrintings({}); setForms({}); setExpanded(new Set());
      setQuery('');
      searchRef.current?.focus();
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setAdding(false);
    }
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
        foil: quickForm.foil, foreignLanguage: quickForm.foreignLanguage, condition: quickForm.condition || null,
        purchasePrice: purchasePrice ?? (priceAutofilled ? undefined : null),
        packOpened: quickForm.packOpened, notes: quickForm.notes || undefined,
        proxy: quickForm.proxy, misprint: quickForm.misprint, altered: quickForm.altered,
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

      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        wantlistToggleRef.current(!quickWantlistRef.current);
        return;
      }
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
    setQuickWantlist(false);
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

  // Wantlist entries must have a destination; default it to Inbox.
  useEffect(() => {
    if (bulkMode === 'wantlist' && !bulkDest) {
      const inbox = locations.find(l => l.name === 'Inbox' || l.builtIn);
      if (inbox) setBulkDest(String(inbox.id));
    }
  }, [bulkMode, bulkDest, locations]);

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

  const getAutoPrice = (card: ScryfallCard, foil: boolean): string => {
    const p = card.prices;
    if (!p) return '';
    if (foil && p.usd_foil) return p.usd_foil;
    if (!foil && p.usd) return p.usd;
    if (p.usd) return p.usd;
    if (p.usd_foil) return p.usd_foil;
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
          foil: f.foil, foreignLanguage: f.foreignLanguage, condition: f.condition || null,
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
      searchRef.current?.focus();
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
        foreignLanguage: form?.foreignLanguage ?? false,
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

  const openBulk = () => {
    setBulkText('');
    setBulkRows(null);
    setBulkTotal('');
    setBulkCondition('NM');
    setBulkMode('collection');
    setBulkLoc(selectedLoc);
    setBulkDest(destLoc);
    setBulkInvalid(null);
    setBulkOpen(true);
  };

  const runBulkParse = async () => {
    setBulkInvalid(null);
    const entries = bulkText.split('\n')
      .map((ln, i) => {
        const p = parseBulkLine(ln);
        if (!p) return null;
        return { key: `${i}-${p.query}-${p.foil}`, line: ln.trim(), amount: p.amount, query: p.query, foil: p.foil };
      })
      .filter(Boolean) as Array<Omit<BulkRow, 'ok' | 'card'>>;

    if (entries.length === 0) {
      notifications.show({ title: 'Nothing to import', message: 'Enter at least one card line, e.g. 4 vow42', color: 'yellow' });
      setBulkRows([]);
      return;
    }

    setBulkResolving(true);
    try {
      const queries = Array.from(new Set(entries.map(e => e.query)));
      const map = await api.cards.resolveBulk(queries);
      const rows: BulkRow[] = entries.map(e => {
        const cards = map[String(e.query).toLowerCase()] ?? [];
        const card = cards[0] ?? null;
        return { ...e, ok: !!card, card };
      });
      setBulkRows(rows);
      setBulkPage(1);
    } catch (err: any) {
      notifications.show({ title: 'Error', message: err.message, color: 'red' });
    } finally {
      setBulkResolving(false);
    }
  };

  const doBulkAdd = async () => {
    if (!bulkRows) return;
    const rows = bulkRows.filter(r => r.ok);
    if (rows.length === 0) {
      notifications.show({ title: 'Nothing to add', message: 'No valid card lines to add.', color: 'yellow' });
      return;
    }
    const failed = bulkRows.filter(r => !r.ok);

    if (bulkMode === 'wantlist') {
      const dest = bulkDest;
      if (!dest) { setBulkInvalid('destination'); return; }
      setBulkAdding(true);
      let wantAdded = 0;
      let wantErrors = 0;
      for (const r of rows) {
        if (!r.card) continue;
        try {
          await api.wantlist.add({
            cardId: r.card.id,
            cardName: r.card.name,
            setCode: r.card.setCode,
            collectorNumber: r.card.collectorNumber,
            foil: r.foil || undefined,
            condition: bulkCondition,
            quantity: r.amount,
            destinationId: Number(dest),
          });
          wantAdded++;
        } catch {
          wantErrors++;
        }
      }
      setBulkAdding(false);
      if (wantErrors === 0 && wantAdded > 0) {
        notifications.show({ title: 'Added to wantlist', message: `${wantAdded} card${wantAdded !== 1 ? 's' : ''} added to your wantlist`, color: 'green' });
        setBulkOpen(false);
      } else if (wantErrors > 0) {
        notifications.show({
          title: 'Added with errors',
          message: failed.length > 0
            ? `${wantAdded} added, ${wantErrors} failed, ${failed.length} line(s) unresolved`
            : `${wantAdded} added, ${wantErrors} failed`,
          color: 'yellow',
        });
      }
      return;
    }

    const loc = bulkLoc ?? selectedLoc;
    if (!loc) { setBulkInvalid('location'); return; }

    const totalRaw = bulkTotal.trim();
    const totalPrice = totalRaw ? parseFloat(totalRaw) : NaN;
    if (totalRaw && isNaN(totalPrice)) { setBulkInvalid('total'); return; }
    setBulkInvalid(null);

    const totalQty = rows.reduce((sum, r) => sum + r.amount, 0);
    const perCard = (!isNaN(totalPrice) && totalPrice > 0)
      ? parseFloat((totalPrice / totalQty).toFixed(2))
      : undefined;

    setBulkAdding(true);
    const adds: Array<{ item: CollectionItem; created: boolean; qty: number }> = [];
    let added = 0;
    let errors = 0;
    for (const r of rows) {
      if (!r.card) continue;
      try {
        const { item, created } = await api.collection.addDetailed({
          cardId: r.card.id,
          locationId: Number(loc),
          quantity: r.amount,
          foil: r.foil,
          condition: bulkCondition,
          purchasePrice: perCard ?? undefined,
          destinationId: bulkDest ? Number(bulkDest) : undefined,
        });
        adds.push({ item, created, qty: r.amount });
        added++;
      } catch {
        errors++;
      }
    }
    setBulkAdding(false);

    if (errors === 0 && added > 0) {
      const locName = locations.find(l => l.id === Number(loc))?.name || 'collection';
      pushUndo(`${added} card${added !== 1 ? 's' : ''} added to ${locName}`, () => undoAdds(adds), 'Undo add');
      notifications.show({
        title: 'Added',
        message: perCard !== undefined
          ? `${added} card${added !== 1 ? 's' : ''} added at $${perCard.toFixed(2)} each (total $${totalPrice.toFixed(2)})`
          : `${added} card${added !== 1 ? 's' : ''} added (prices auto-filled)`,
        color: 'green',
      });
      setBulkOpen(false);
      setGroupedResults([]); setPrintings({}); setForms({}); setExpanded(new Set());
      setQuery('');
      searchRef.current?.focus();
    } else if (errors > 0) {
      notifications.show({
        title: 'Added with errors',
        message: failed.length > 0
          ? `${added} added, ${errors} failed, ${failed.length} line(s) unresolved`
          : `${added} added, ${errors} failed`,
        color: 'yellow',
      });
    }
  };

  const bulkOkRows = bulkRows?.filter(r => r.ok) ?? [];
  const bulkTotalQty = bulkOkRows.reduce((s, r) => s + r.amount, 0);
  const bulkDividedPrice = (() => {
    const t = bulkTotal.trim();
    if (bulkMode === 'collection' && t && !isNaN(parseFloat(t)) && bulkTotalQty > 0) {
      return parseFloat((parseFloat(t) / bulkTotalQty).toFixed(2));
    }
    return null;
  })();

  const BULK_PER_PAGE = 25;
  const bulkPages = bulkRows ? Math.max(1, Math.ceil(bulkRows.length / BULK_PER_PAGE)) : 1;
  const bulkPageSafe = Math.min(bulkPage, bulkPages);
  const bulkPageRows = bulkRows
    ? bulkRows.slice((bulkPageSafe - 1) * BULK_PER_PAGE, bulkPageSafe * BULK_PER_PAGE)
    : [];

  const groupIsAllSelected = (name: string) =>
    printings[name]?.length > 0 && printings[name].every(c => forms[c.id]?.selected);

  const groupHasSomeSelected = (name: string) =>
    printings[name]?.some(c => forms[c.id]?.selected);

  return (
    <>
      <Group mb="md" justify="space-between">
        <Group>
          <Title order={2}>Add Cards</Title>
          <Button variant="light" leftSection={<IconUpload size={16} />} onClick={openBulk} data-tour="bulk-add">
            Bulk add
          </Button>
        </Group>
        <Group wrap="nowrap">
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
            w={140} size="sm"
          />
        </Group>
      </Group>

      <Box mb="md">
        {constEnabled ? (
          <Group gap="xs" mb="sm" align="flex-end">
            <TextInput
              label="Set"
              placeholder="e.g. vow"
              value={constSet}
              onChange={e => {
                const v = e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
                setConstSet(v);
                constSetRef.current = v;
                if (query.trim()) handleQueryChange(query);
              }}
              leftSection={<IconSearch size={16} />}
              w={130} size="sm"
            />
            <TextInput
              label="Collector number / card name"
              placeholder='e.g. 33, 42a, or card name'
              value={query}
              onChange={e => handleQueryChange(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              leftSection={<Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{constSet ? `${constSet} ` : ''}</Text>}
              style={{ flex: 1 }}
              ref={searchRef}
              data-tour="add-search"
            />
          </Group>
        ) : (
          <TextInput
            mb="sm"
            label="Search"
            placeholder='Name, set+number (e.g. blb0239), or Scryfall syntax (e.g. s:blb cn:0239)'
            value={query}
            onChange={e => handleQueryChange(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            leftSection={<IconSearch size={16} />}
            ref={searchRef}
            data-tour="add-search"
          />
        )}
        <Group gap="xs">
          <Switch
            size="xs"
            label="Constant set code"
            checked={constEnabled}
            onChange={e => {
              const on = e.currentTarget.checked;
              setConstEnabled(on);
              constEnabledRef.current = on;
              handleQueryChange(query);
            }}
          />
        </Group>
      </Box>

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
              const border = isExc ? '2px solid #cc0000' : isInc ? '2px solid var(--mantine-color-blue-5)' : '2px solid transparent';
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
              <NumberInput value={cmcVal(filters.cmcMin)} onChange={v => setCmcFilter('cmcMin', v)}
                min={0} max={20} w={70} size="xs" />
            </div>
            <div>
              <Text size="xs" fw={600} mb={2}>CMC Max</Text>
              <NumberInput value={cmcVal(filters.cmcMax)} onChange={v => setCmcFilter('cmcMax', v)}
                min={0} max={20} w={70} size="xs" />
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
                        <Table.Th w={50} /><Table.Th w={46} /><Table.Th w={46} /><Table.Th w={130} />
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
                          <Switch checked={f?.foreignLanguage ?? false} onChange={e => updateAndSelect(card.id, { foreignLanguage: e.currentTarget.checked })}
                            size="xs" onLabel="FL" offLabel="EN"
                            color={f?.foreignLanguage ? 'teal' : undefined} />
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <SegmentedControl value={f?.condition ?? 'NM'} onChange={v => updateAndSelect(card.id, { condition: v as Condition })}
                            data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs" fullWidth={false}
                            styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[f?.condition ?? 'NM'] || '#00897b' } }} />
                        </Table.Td>
                        <Table.Td onClick={e => e.stopPropagation()}>
                          <TextInput value={f?.purchasePrice ?? ''} onChange={e => updateAndSelect(card.id, { purchasePrice: e.currentTarget.value })}
                            placeholder={getAutoPrice(card, f?.foil ?? false) || '0.00'} size="xs" w={76}
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
                          <Table.Th w={46}>Lang</Table.Th><Table.Th w={130}>Condition</Table.Th><Table.Th w={80}>Price $</Table.Th>
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
                              <Switch checked={f?.foreignLanguage ?? false} onChange={e => updateAndSelect(card.id, { foreignLanguage: e.currentTarget.checked })}
                                size="xs" onLabel="FL" offLabel="EN"
                                color={f?.foreignLanguage ? 'teal' : undefined} />
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <SegmentedControl value={f?.condition ?? 'NM'} onChange={v => updateAndSelect(card.id, { condition: v as Condition })}
                                data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs" fullWidth={false}
                                styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[f?.condition ?? 'NM'] || '#00897b' } }} />
                            </Table.Td>
                            <Table.Td onClick={e => e.stopPropagation()}>
                              <TextInput value={f?.purchasePrice ?? ''} onChange={e => updateAndSelect(card.id, { purchasePrice: e.currentTarget.value })}
                                placeholder={getAutoPrice(card, f?.foil ?? false) || '0.00'} size="xs" w={76}
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

      <Modal opened={!!quickAddCard} onClose={() => setQuickAddCard(null)} title="Quick Add" size="lg" centered closeOnEscape={false}>
        {quickAddCard && (
          <Box ref={quickModalRef}>
            <Group gap="lg" align="flex-start" wrap="nowrap">
              <Box w={250} h={349} style={{ overflow: 'hidden', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', position: 'relative', flexShrink: 0 }}>
                <img
                  src={quickAddCard.imageUris?.large || quickAddCard.imageUris?.normal || quickAddCard.imageUris?.small
                    || quickAddCard.cardFaces?.[0]?.image_uris?.large || quickAddCard.cardFaces?.[0]?.image_uris?.normal || ''}
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

              <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
                <div>
                  <Group gap={6} wrap="nowrap" mb={2}>
                    <SetSymbol code={quickAddCard.setCode} name={quickAddCard.setName} />
                    <Text fw={600} size="lg" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {quickAddCard.name}
                    </Text>
                  </Group>
                  <Group gap={6}>
                    <Text size="sm" c="dimmed">#{quickAddCard.collectorNumber}</Text>
                    {quickAddCard.typeLine && <Text size="xs" c="dimmed">· {quickAddCard.typeLine}</Text>}
                  </Group>
                  <Group gap={4} mt={4}><Tags card={quickAddCard} /></Group>
                  <Text size="xs" mt="sm">
                    Market: <b>${parseFloat(quickForm.foil ? (quickAddCard.prices?.usd_foil || '0') : (quickAddCard.prices?.usd || '0')).toFixed(2)}</b>
                    {quickAddCard.prices?.usd && !quickForm.foil && quickAddCard.prices?.usd_foil ? ` / Foil: $${parseFloat(quickAddCard.prices.usd_foil).toFixed(2)}` : ''}
                    {quickAddCard.prices?.usd && quickForm.foil ? ` / Nonfoil: $${parseFloat(quickAddCard.prices.usd).toFixed(2)}` : ''}
                  </Text>
                </div>

                <Divider my={2} />

                <Group gap="lg" wrap="wrap">
                  <Switch label="Add to wantlist" checked={quickWantlist} onChange={e => setWantlistMode(e.currentTarget.checked)} size="sm" color="teal" />
                </Group>

                <SimpleGrid cols={2} spacing="sm">
                  <NumberInput label="Qty" value={quickForm.quantity} onChange={v => setQuickForm(f => ({ ...f, quantity: Number(v) || 1 }))} min={1} max={999} size="sm" ref={qtyInputRef} />
                  <Box style={{ position: 'relative' }}>
                    <TextInput label="Price ($)" value={quickForm.purchasePrice} onChange={e => { const v = e.currentTarget.value; setQuickForm(f => ({ ...f, purchasePrice: v })); setInvalidField(prev => prev === 'price' ? null : prev); }}
                      placeholder={quickForm.foil ? (quickAddCard.prices?.usd_foil || '0.00') : (quickAddCard.prices?.usd || '0.00')} size="sm"
                      leftSection={<Text size="xs" c="dimmed">$</Text>} ref={priceInputRef} onBlur={formatPrice} />
                    {invalidField === 'price' && <InvalidBubble />}
                  </Box>
                </SimpleGrid>

                <Group gap="md" wrap="wrap">
                  <Switch label="Foil" checked={quickForm.foil} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, foil: v })); }}
                    disabled={!foilState(quickAddCard).canFoil || foilState(quickAddCard).foilOnly} size="sm" onLabel="F" offLabel="N" />
                  <Switch label="Pack opened" checked={quickForm.packOpened} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, packOpened: v })); }}
                    disabled={quickWantlist} size="sm" />
                </Group>

                <Box>
                  <Text size="sm" fw={500} mb={4}>Condition</Text>
                  <SegmentedControl value={quickForm.condition} onChange={v => setQuickForm(f => ({ ...f, condition: v as Condition }))}
                    data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs" fullWidth
                    styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[quickForm.condition] || '#00897b' } }} />
                </Box>

                <Group gap="md" wrap="wrap">
                  <Switch label="Proxy" checked={quickForm.proxy} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, proxy: v })); }} disabled={quickWantlist} size="sm" />
                  <Switch label="Misprint" checked={quickForm.misprint} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, misprint: v })); }} disabled={quickWantlist} size="sm" />
                  <Switch label="Altered" checked={quickForm.altered} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, altered: v })); }} disabled={quickWantlist} size="sm" />
                  <Switch label="Foreign language" checked={quickForm.foreignLanguage} onChange={e => { const v = e.currentTarget.checked; setQuickForm(f => ({ ...f, foreignLanguage: v })); }} disabled={quickWantlist} size="sm" color="teal" />
                </Group>

                <SimpleGrid cols={2} spacing="sm">
                  <Box style={{ position: 'relative' }}>
                    <Select label="Location" placeholder="Select location" searchable selectFirstOptionOnChange
                      data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                      value={quickLoc} onChange={v => { setQuickLoc(v); setInvalidField(prev => prev === 'location' ? null : prev); }} size="sm" ref={locInputRef} disabled={quickWantlist} />
                    {invalidField === 'location' && <InvalidBubble />}
                  </Box>
                  <Box style={{ position: 'relative' }}>
                    <Select label={quickWantlist ? 'Destination' : 'Destination (optional)'} placeholder={quickWantlist ? 'Select destination' : 'No destination'}
                      searchable selectFirstOptionOnChange
                      data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                      value={quickDest} onChange={v => { setQuickDest(v); setInvalidField(prev => prev === 'destination' ? null : prev); }}
                      clearable={!quickWantlist} allowDeselect={!quickWantlist}
                      size="sm" ref={destInputRef} />
                    {invalidField === 'destination' && <InvalidBubble />}
                  </Box>
                </SimpleGrid>

                <TextInput label="Notes" value={quickForm.notes} onChange={e => { const v = e.currentTarget.value; setQuickForm(f => ({ ...f, notes: v })); }} placeholder="notes" size="sm" ref={notesInputRef} disabled={quickWantlist} />

                <Group justify="flex-end" mt={4}>
                  <Button variant="default" onClick={() => setQuickAddCard(null)}>Cancel</Button>
                  <Button onClick={handleQuickAdd} loading={adding} leftSection={<IconPlus size={16} />}>
                    Add to {quickWantlist ? 'Wantlist' : 'Collection'}
                  </Button>
                </Group>
              </Stack>
            </Group>

            <Group gap="xs" mt="md" justify="center" wrap="wrap">
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
              <Badge size="xs" variant="light" color="gray">W</Badge>
              <Text size="xs" c="dimmed">Wantlist</Text>
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

      <Modal opened={bulkOpen} onClose={() => setBulkOpen(false)} title="Bulk add cards" size="lg" centered>
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            One card per line. Format: <Badge size="xs" variant="light">[qty] set + collector number [*F*]</Badge> — e.g.{' '}
            <Code>4 vow42</Code>, <Code>1 vow33 *F*</Code>, <Code>1 x vow33 *F*</Code>. The <b>*F*</b> marker imports foil.
          </Text>
          <Box style={{ position: 'relative' }}>
            <Textarea
              placeholder={'4 vow42\n1 vow33 *F*\n1 x vow33 *F*\n2 blb0342'}
              value={bulkText}
              onChange={e => setBulkText(e.currentTarget.value)}
              autosize minRows={5} maxRows={14}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
            />
          </Box>

          <div>
            <Text size="sm" fw={500} mb={6}>Import as</Text>
            <SegmentedControl
              value={bulkMode}
              onChange={v => setBulkMode(v as 'collection' | 'wantlist')}
              data={[
                { label: 'Collection cards', value: 'collection' },
                { label: 'Wantlist items', value: 'wantlist' },
              ]}
              size="sm"
            />
          </div>

          <SimpleGrid cols={{ base: 1, sm: bulkMode === 'wantlist' ? 1 : 2 }} spacing="md">
            {bulkMode === 'collection' && (
              <Box style={{ position: 'relative' }}>
                <Select
                  label="Location"
                  placeholder="Select location"
                  searchable selectFirstOptionOnChange
                  data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                  value={bulkLoc}
                  onChange={v => { setBulkLoc(v); setBulkInvalid(prev => prev === 'location' ? null : prev); }}
                  size="sm"
                />
                {bulkInvalid === 'location' && <InvalidBubble />}
              </Box>
            )}
            <Box style={{ position: 'relative' }}>
              <Select
                label={bulkMode === 'wantlist' ? 'Destination' : 'Destination (optional)'}
                placeholder={bulkMode === 'wantlist' ? 'Select destination' : 'No destination'}
                searchable selectFirstOptionOnChange
                data={locations.map(l => ({ value: String(l.id), label: l.name }))}
                value={bulkDest}
                onChange={v => { setBulkDest(v); setBulkInvalid(prev => prev === 'destination' ? null : prev); }}
                clearable={bulkMode !== 'wantlist'}
                allowDeselect={bulkMode !== 'wantlist'}
                description={bulkMode === 'wantlist' ? 'Wantlist entries must live in a location. Defaults to Inbox.' : undefined}
                size="sm"
              />
              {bulkInvalid === 'destination' && <InvalidBubble />}
            </Box>
            <div>
              <Text size="sm" fw={500} mb={6}>Condition</Text>
              <SegmentedControl value={bulkCondition} onChange={v => setBulkCondition(v as Condition)}
                data={CONDITIONS.map(c => ({ value: c, label: c }))} size="xs"
                styles={{ root: { gap: 2 }, label: { fontWeight: 600, fontSize: 11, padding: '2px 6px' }, indicator: { backgroundColor: CONDITION_COLORS[bulkCondition] || '#00897b' } }} />
            </div>
            {bulkMode === 'collection' && (
              <Box style={{ position: 'relative' }}>
                <TextInput label="Total price ($)" placeholder="Optional" value={bulkTotal}
                  onChange={e => { const v = e.currentTarget.value; setBulkTotal(v); setBulkInvalid(prev => prev === 'total' ? null : prev); }}
                  description="Divided evenly across all cards as their purchase price. Leave empty to auto-fill each card from its market price."
                  size="sm"
                  leftSection={<Text size="xs" c="dimmed">$</Text>}
                />
                {bulkInvalid === 'total' && <InvalidBubble />}
              </Box>
            )}
          </SimpleGrid>

          {bulkRows === null ? (
            <Button variant="default" onClick={runBulkParse} loading={bulkResolving} leftSection={<IconSearch size={16} />}>
              Preview lines
            </Button>
          ) : (
            <>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" c="dimmed">
                  <b>{bulkOkRows.length}</b> resolved of {bulkRows.length} · {bulkTotalQty} card{bulkTotalQty !== 1 ? 's' : ''}
                  {bulkMode === 'collection' && (bulkDividedPrice !== null
                    ? <> · <b>${bulkDividedPrice.toFixed(2)}</b>/card shared</>
                    : <> · prices auto-filled from market</>)}
                </Text>
                <Button variant="subtle" size="compact-sm" color="gray" onClick={runBulkParse} loading={bulkResolving}>
                  Re-preview
                </Button>
              </Group>

              <Table striped highlightOnHover withTableBorder styles={{ table: { fontSize: 13 } }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Card</Table.Th>
                    <Table.Th w={190}>Set</Table.Th>
                    <Table.Th w={56}>#</Table.Th>
                    <Table.Th w={56}>Qty</Table.Th>
                    <Table.Th w={60}>Foil</Table.Th>
                    <Table.Th w={90}>Condition</Table.Th>
                    {bulkMode === 'collection' && <Table.Th w={110}>Price</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {bulkPageRows.map(r => {
                    const price = bulkMode === 'collection'
                      ? (bulkDividedPrice !== null ? bulkDividedPrice : cardAutoPrice(r.card, r.foil))
                      : null;
                    return (
                      <Table.Tr key={r.key} opacity={r.ok ? 1 : 0.5}>
                        {r.ok && r.card ? (
                          <>
                            <Table.Td>
                              <Group gap="sm" wrap="nowrap">
                                <CardThumb card={r.card} />
                                <Text size="xs" fw={500}>{r.card.name}</Text>
                              </Group>
                            </Table.Td>
                            <Table.Td><SetSymbol code={r.card.setCode} name={r.card.setName} /></Table.Td>
                            <Table.Td><Text size="xs">{r.card.collectorNumber}</Text></Table.Td>
                          </>
                        ) : (
                          <Table.Td colSpan={bulkMode === 'collection' ? 6 : 5}>
                            <Text size="xs" c="red">Not found: {r.line}</Text>
                          </Table.Td>
                        )}
                        <Table.Td><Text size="sm" fw={600}>{r.amount}</Text></Table.Td>
                        <Table.Td>
                          {r.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge>
                            : <Text size="xs" c="dimmed">—</Text>}
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" style={{ backgroundColor: CONDITION_COLORS[bulkCondition] || '#00897b', color: '#fff' }}>
                            {bulkCondition}
                          </Badge>
                        </Table.Td>
                        {bulkMode === 'collection' && (
                          <Table.Td>
                            {price !== null ? (
                              <Group gap={4} wrap="nowrap">
                                <Text size="xs" fw={600}>${price.toFixed(2)}</Text>
                                {bulkDividedPrice === null && <Text size="xs" c="dimmed">auto</Text>}
                              </Group>
                            ) : (
                              <Text size="xs" c="dimmed">—</Text>
                            )}
                          </Table.Td>
                        )}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
              {bulkPages > 1 && (
                <Group justify="center" py="xs">
                  <Pagination total={bulkPages} value={bulkPageSafe} onChange={setBulkPage} size="sm" />
                </Group>
              )}
            </>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button onClick={doBulkAdd} loading={bulkAdding} disabled={!bulkRows || bulkRows.filter(r => r.ok).length === 0}
              leftSection={<IconPlus size={16} />}>
              Add to {bulkMode === 'collection' ? 'Collection' : 'Wantlist'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
