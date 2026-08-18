import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Title, Text, Paper, Group, Badge, Button, PasswordInput, SegmentedControl, Alert,
  Box, LoadingOverlay, Stack, TextInput, Select, NumberInput, Collapse,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconLock, IconExternalLink, IconSearch, IconFilter } from '@tabler/icons-react';
import { api } from '../api/client';
import { CardThumb, SetSymbol, GhostThumb, CopyTags } from '../components/CardDisplay';
import type { ScryfallCard } from '../types';

type Scope = 'collection' | 'wantlist';

const accessKey = (token: string, scope: Scope) => `share-access-${token}-${scope}`;

export default function ShareViewPage() {
  const { token = '' } = useParams();
  const [meta, setMeta] = useState<{ displayName: string | null; avatar: string | null; collection: { shared: boolean; password: boolean }; wantlist: { shared: boolean; password: boolean } } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>('collection');
  const [pw, setPw] = useState('');
  const [gateScope, setGateScope] = useState<Scope | null>(null);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoadErr(null);
    setMeta(null);
    setScope('collection');
    api.share.status(token).then(setMeta).catch(() => setLoadErr('This share link is invalid or has been turned off.'));
  }, [token]);

  const fetchData = async (s: Scope) => {
    setLoading(true);
    try {
      const existing = sessionStorage.getItem(accessKey(token, s));
      let r;
      try {
        r = s === 'collection'
          ? await api.share.collection(token, existing || undefined)
          : await api.share.wantlist(token, existing || undefined);
      } catch {
        r = null;
      }
      if (r) {
        setItems(r.items);
        setGateScope(null);
        return;
      }
      // Password required
      setGateScope(s);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!meta) return;
    const target = meta[scope];
    if (!target.shared) setItems([]);
    else fetchData(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, meta]);

  const submitPassword = async () => {
    if (!gateScope) return;
    try {
      const r = await api.share.verify(token, gateScope, pw);
      if (!r.access) throw new Error('Could not unlock');
      sessionStorage.setItem(accessKey(token, gateScope), r.access);
      setPw('');
      setGateScope(null);
      setLoading(true);
      const res = gateScope === 'collection'
        ? await api.share.collection(token, r.access)
        : await api.share.wantlist(token, r.access);
      setItems(res.items);
    } catch (err: any) {
      notifications.show({ title: 'Incorrect password', message: err.message, color: 'red', autoClose: 12000 });
    } finally {
      setLoading(false);
    }
  };

  const isPrivate = (s: Scope) => meta ? !meta[s].shared : false;

  return (
    <Box p="lg" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <Group mb="md" justify="space-between">
        <Link to="/">
          <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={14} />}>Home</Button>
        </Link>
        <Badge size="sm" variant="light" color="gray" leftSection={<IconLock size={12} />}>Read-only</Badge>
      </Group>

      {loadErr && <Alert color="red" title="Share link unavailable">{loadErr}</Alert>}

      {meta && !loadErr && (
        <>
          <Group mb="lg">
            <Box w={40} h={40} style={{ borderRadius: 8, overflow: 'hidden', background: '#1a1a2e' }}>
              {meta.avatar && <img src={meta.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
            </Box>
            <div>
              <Title order={3}>{meta.displayName || 'Shared collection'}</Title>
              <Text size="xs" c="dimmed">Shared collection — view only</Text>
            </div>
          </Group>

          {(!meta.collection.shared && !meta.wantlist.shared) ? (
            <Alert title="Nothing shared">This user hasn't shared their collection or wantlist.</Alert>
          ) : (
            <>
              <SegmentedControl fullWidth mb="md" value={scope} onChange={v => setScope(v as Scope)}
                data={[
                  { value: 'collection', label: `Collection${meta.collection.password ? ' (locked)' : ''}`, disabled: !meta.collection.shared },
                  { value: 'wantlist', label: `Wantlist${meta.wantlist.password ? ' (locked)' : ''}`, disabled: !meta.wantlist.shared },
                ]} />

              <Box pos="relative">
                <LoadingOverlay visible={loading} />

                {gateScope && (
                  <Paper withBorder p="lg" style={{ maxWidth: 380, margin: '0 auto' }}>
                    <Title order={4} mb="sm">This {gateScope} is password protected</Title>
                    <Text size="sm" c="dimmed" mb="sm">Ask {meta.displayName || 'the owner'} for the password.</Text>
                    <PasswordInput placeholder="Password" value={pw} onChange={e => setPw(e.currentTarget.value)} mb="md" autoFocus />
                    <Button fullWidth onClick={submitPassword} leftSection={<IconLock size={16} />}>Unlock</Button>
                  </Paper>
                )}

                {!gateScope && isPrivate(scope) && (
                  <Alert title="Not shared" color="gray">This section isn't being shared.</Alert>
                )}

                {!gateScope && !isPrivate(scope) && scope === 'collection' && (
                  <SharedCollection items={items} />
                )}
                {!gateScope && !isPrivate(scope) && scope === 'wantlist' && (
                  <SharedWantlist items={items} />
                )}
              </Box>
            </>
          )}
        </>
      )}
    </Box>
  );
}

function SharedCollection({ items }: { items: any[] }) {
  const [query, setQuery] = useState('');
  const [locFilter, setLocFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [priceMin, setPriceMin] = useState<string | number>('');
  const [priceMax, setPriceMax] = useState<string | number>('');

  // Market value of a copy (public data; we never expose the owner's purchase price).
  const valueOf = (it: any): number | null => {
    const p = it.card?.prices;
    if (!p) return null;
    const v = it.foil ? p.usd_foil : p.usd;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const locations = useMemo(
    () => Array.from(new Set(items.filter(it => it.locationName).map(it => it.locationName))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lo = priceMin === '' || priceMin === null ? null : Number(priceMin);
    const hi = priceMax === '' || priceMax === null ? null : Number(priceMax);
    return items.filter(it => {
      const c = it.card;
      const name = c?.name || it.cardId || '';
      if (q && !name.toLowerCase().includes(q)) return false;
      if (locFilter && it.locationName !== locFilter) return false;
      const tl = c?.typeLine || '';
      if (types.size > 0 && !CARD_TYPES.some(t => types.has(t) && tl.toLowerCase().includes(t.toLowerCase()))) return false;
      const cid: string[] = c?.colorIdentity || [];
      if (colors.size > 0 && !colors.has('C') && !Array.from(colors).some(x => cid.includes(x))) return false;
      const p = valueOf(it);
      if (lo !== null && (p === null || p < lo)) return false;
      if (hi !== null && (p === null || p > hi)) return false;
      return true;
    });
  }, [items, query, locFilter, types, colors, priceMin, priceMax]);

  const toggleSet = (set: Set<string>, setState: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setState(next);
  };

  const hasFilters = !!query || !!locFilter || types.size > 0 || colors.size > 0 || priceMin !== '' || priceMax !== '';
  const grouped = (() => {
    const byLoc: Record<string, any[]> = {};
    for (const it of filtered) {
      const k = it.locationName || 'Unknown location';
      if (!byLoc[k]) byLoc[k] = [];
      byLoc[k].push(it);
    }
    return Object.entries(byLoc).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  if (items.length === 0) return <Text c="dimmed" ta="center" py="xl">No cards in the collection.</Text>;

  return (
    <>
      <TextInput placeholder="Search collection..." value={query} onChange={e => setQuery(e.currentTarget.value)}
        leftSection={<IconSearch size={16} />} mb="sm" size="sm" />

      <Group mb="sm" gap="xs">
        <Select size="xs" w={180} placeholder="Location" clearable value={locFilter} onChange={setLocFilter}
          data={locations.map(d => ({ value: d, label: d }))} />
        <Button size="compact-sm" variant={showFilters ? 'filled' : 'light'} onClick={() => setShowFilters(!showFilters)}
          leftSection={<IconFilter size={14} />}>
          Filters {types.size + colors.size + (priceMin !== '' ? 1 : 0) + (priceMax !== '' ? 1 : 0) > 0 ? `(${types.size + colors.size + (priceMin !== '' ? 1 : 0) + (priceMax !== '' ? 1 : 0)})` : ''}
        </Button>
        {hasFilters && (
          <Button size="compact-sm" variant="subtle" color="gray" onClick={() => { setQuery(''); setLocFilter(null); setTypes(new Set()); setColors(new Set()); setPriceMin(''); setPriceMax(''); }}>
            Clear
          </Button>
        )}
        <Text size="xs" c="dimmed">{filtered.length} of {items.length} cards</Text>
      </Group>

      <Collapse in={showFilters}>
        <Paper withBorder p="sm" mb="sm" radius="md">
          <Text size="xs" fw={600} mb={4}>Colors</Text>
          <Group gap={4} mb="sm">
            {['W', 'U', 'B', 'R', 'G', 'C'].map(c => {
              const active = colors.has(c);
              return (
                <Badge key={c} size="sm" variant={active ? 'filled' : 'light'} styles={{ label: { color: '#fff' } }}
                  style={{ background: active ? CID_COLORS[c] : `${CID_COLORS[c] || '#666'}66`, cursor: 'pointer' }}
                  onClick={() => toggleSet(colors, setColors, c)}>{c}</Badge>
              );
            })}
          </Group>
          <Group gap="lg" mb="sm" align="flex-start" wrap="wrap">
            <div>
              <Text size="xs" fw={600} mb={2}>Type</Text>
              <Group gap={4}>
                {CARD_TYPES.map(t => {
                  const active = types.has(t);
                  return (
                    <Badge key={t} size="sm" variant={active ? 'filled' : 'outline'} color={active ? 'blue' : 'gray'}
                      style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => toggleSet(types, setTypes, t)}>{t}</Badge>
                  );
                })}
              </Group>
            </div>
            <Group gap="sm" align="flex-end">
              <NumberInput size="xs" w={90} min={0} label="Value min ($)" value={priceMin} onChange={setPriceMin} decimalScale={2} />
              <NumberInput size="xs" w={90} min={0} label="Value max ($)" value={priceMax} onChange={setPriceMax} decimalScale={2} />
            </Group>
          </Group>
        </Paper>
      </Collapse>

      {filtered.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">No cards match your filters.</Text>
      ) : (
        <Stack gap="md">
          {grouped.map(([loc, rows]) => (
            <Paper key={loc} withBorder radius="md" p="sm">
              <Text size="sm" fw={600} mb="xs">{loc} · {rows.reduce((s, r) => s + r.quantity, 0)} cards</Text>
              <Stack gap={2}>
                {rows.map(it => {
                  const c: ScryfallCard | null = it.card;
                  const v = valueOf(it);
                  return (
                    <Group key={it.id} p={4} gap="sm" wrap="nowrap" style={{ borderRadius: 4 }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--mantine-color-default-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <Box w={24} h={34}>{c ? <CardThumb card={c} /> : null}</Box>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm">{c?.name || it.cardId}</Text>
                          <CopyTags item={it} />
                        </Group>
                        <Group gap={6}>
                          <SetSymbol code={c?.setCode} name={c?.setName || ''} size={12} />
                          <Text size="xs" c="dimmed">#{c?.collectorNumber}</Text>
                          {it.foil ? <Badge size="xs" color="yellow" variant="light">Foil</Badge> : null}
                          {it.condition ? <Badge size="xs" variant="outline" color="gray">{it.condition}</Badge> : null}
                        </Group>
                      </div>
                      {v !== null && <Text size="xs" c="dimmed" w={60} ta="right">${v.toFixed(2)}</Text>}
                      <Badge size="sm" variant="light">{it.quantity}x</Badge>
                    </Group>
                  );
                })}
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}

const CARD_TYPES = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land', 'Planeswalker', 'Battle', 'Kindred'];
const CID_COLORS: Record<string, string> = {
  W: '#f8d558', U: '#2a6fbf', B: '#444444', R: '#d33f2d', G: '#3f9c47', C: '#666666',
};

function SharedWantlist({ items }: { items: any[] }) {
  const [query, setQuery] = useState('');
  const [destFilter, setDestFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [priceMin, setPriceMin] = useState<string | number>('');
  const [priceMax, setPriceMax] = useState<string | number>('');

  const cardOf = (it: any): any => (it.setCode || it.card ? it.card : it.cheapestCard) || null;
  const priceOf = (it: any): number | null => {
    if (it.setCode || it.card) return it.price ?? null;
    return it.cheapestPrice ?? null;
  };

  const destinations = useMemo(
    () => Array.from(new Set(items.filter(it => it.destinationName).map(it => it.destinationName))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lo = priceMin === '' || priceMin === null ? null : Number(priceMin);
    const hi = priceMax === '' || priceMax === null ? null : Number(priceMax);
    return items.filter(it => {
      if (q && !(it.cardName || '').toLowerCase().includes(q)) return false;
      if (destFilter && it.destinationName !== destFilter) return false;
      const card = cardOf(it);
      const tl = card?.typeLine || '';
      if (types.size > 0 && !CARD_TYPES.some(t => types.has(t) && tl.toLowerCase().includes(t.toLowerCase()))) return false;
      const cid: string[] = card?.colorIdentity || [];
      if (colors.size > 0 && !colors.has('C') && !Array.from(colors).some(c => cid.includes(c))) return false;
      const p = priceOf(it);
      if (lo !== null && (p === null || p < lo)) return false;
      if (hi !== null && (p === null || p > hi)) return false;
      return true;
    });
  }, [items, query, destFilter, types, colors, priceMin, priceMax]);

  const toggleSet = (set: Set<string>, setState: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    setState(next);
  };

  if (items.length === 0) return <Text c="dimmed" ta="center" py="xl">Wantlist is empty.</Text>;

  const thumb = (it: any) => {
    const card = cardOf(it);
    const hasImg = card && (card.imageUris?.small || card.imageUris?.normal || card.cardFaces?.[0]?.image_uris?.small);
    return hasImg ? <CardThumb card={card} /> : <GhostThumb name={it.cardName || 'Unknown card'} />;
  };

  const hasFilters = !!query || !!destFilter || types.size > 0 || colors.size > 0 || priceMin !== '' || priceMax !== '';

  return (
    <>
      <TextInput placeholder="Search wantlist..." value={query} onChange={e => setQuery(e.currentTarget.value)}
        leftSection={<IconSearch size={16} />} mb="sm" size="sm" />

      <Group mb="sm" gap="xs">
        <Select size="xs" w={180} placeholder="Destination" clearable value={destFilter} onChange={setDestFilter}
          data={destinations.map(d => ({ value: d, label: d }))} />
        <Button size="compact-sm" variant={showFilters ? 'filled' : 'light'} onClick={() => setShowFilters(!showFilters)}
          leftSection={<IconFilter size={14} />}>
          Filters {types.size + colors.size + (priceMin !== '' ? 1 : 0) + (priceMax !== '' ? 1 : 0) > 0 ? `(${types.size + colors.size + (priceMin !== '' ? 1 : 0) + (priceMax !== '' ? 1 : 0)})` : ''}
        </Button>
        {hasFilters && (
          <Button size="compact-sm" variant="subtle" color="gray" onClick={() => { setQuery(''); setDestFilter(null); setTypes(new Set()); setColors(new Set()); setPriceMin(''); setPriceMax(''); }}>
            Clear
          </Button>
        )}
        <Text size="xs" c="dimmed">{filtered.length} of {items.length}</Text>
      </Group>

      <Collapse in={showFilters}>
        <Paper withBorder p="sm" mb="sm" radius="md">
          <Text size="xs" fw={600} mb={4}>Colors</Text>
          <Group gap={4} mb="sm">
            {['W', 'U', 'B', 'R', 'G', 'C'].map(c => {
              const active = colors.has(c);
              return (
                <Badge key={c} size="sm" variant={active ? 'filled' : 'light'} styles={{ label: { color: '#fff' } }}
                  style={{ background: active ? CID_COLORS[c] : `${CID_COLORS[c] || '#666'}66`, cursor: 'pointer' }}
                  onClick={() => toggleSet(colors, setColors, c)}>{c}</Badge>
              );
            })}
          </Group>
          <Group gap="lg" mb="sm" align="flex-start" wrap="wrap">
            <div>
              <Text size="xs" fw={600} mb={2}>Type</Text>
              <Group gap={4}>
                {CARD_TYPES.map(t => {
                  const active = types.has(t);
                  return (
                    <Badge key={t} size="sm" variant={active ? 'filled' : 'outline'} color={active ? 'blue' : 'gray'}
                      style={{ cursor: 'pointer', textTransform: 'none' }} onClick={() => toggleSet(types, setTypes, t)}>{t}</Badge>
                  );
                })}
              </Group>
            </div>
            <Group gap="sm" align="flex-end">
              <NumberInput size="xs" w={90} min={0} label="Price min ($)" value={priceMin} onChange={setPriceMin} decimalScale={2} />
              <NumberInput size="xs" w={90} min={0} label="Price max ($)" value={priceMax} onChange={setPriceMax} decimalScale={2} />
            </Group>
          </Group>
        </Paper>
      </Collapse>

      {filtered.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">No cards match your filters.</Text>
      ) : (
        <Stack gap={2}>
          {filtered.map(it => (
            <Paper key={it.id} withBorder mb={2} radius={0}>
              <Group p="sm" gap="sm" wrap="nowrap">
                <Box w={32} h={45} style={{ flexShrink: 0 }}>
                  {thumb(it)}
                </Box>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" fw={500}>{it.cardName || 'Unknown card'}</Text>
                    {it.setCode ? (
                      <Badge size="xs" variant="light" color="blue">Specific printing</Badge>
                    ) : (
                      <Badge size="xs" variant="light" color="gray">Any printing</Badge>
                    )}
                  </Group>
                  <Group gap={6}>
                    {it.setCode ? (
                      <Group gap={4}>
                        <SetSymbol code={it.setCode} name={it.card?.setName || it.setCode.toUpperCase()} size={12} />
                        <Text size="xs" c="dimmed">{it.setCode.toUpperCase()} #{it.collectorNumber}</Text>
                      </Group>
                    ) : null}
                    {(() => {
                      const p = priceOf(it);
                      return p !== null ? <Text size="xs" c="dimmed">${p.toFixed(2)}</Text> : null;
                    })()}
                  </Group>
                </div>
                <Badge size="sm" variant="light">{it.quantity}x</Badge>
                {it.destinationName && <Badge size="xs" variant="light" color="green">→ {it.destinationName}</Badge>}
                {it.cardName && (
                  <a href={`https://mtgsingles.co.nz/card/${encodeURIComponent(it.cardName.toLowerCase())}`}
                    target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                    <Button size="compact-xs" variant="light" color="green" leftSection={<IconExternalLink size={12} />}>
                      Buy
                    </Button>
                  </a>
                )}
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}