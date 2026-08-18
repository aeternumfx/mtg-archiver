import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Title, Text, Paper, Group, Badge, Button, PasswordInput, SegmentedControl, Alert,
  Box, LoadingOverlay, Stack,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconLock } from '@tabler/icons-react';
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
  if (items.length === 0) return <Text c="dimmed" ta="center" py="xl">No cards in the collection.</Text>;
  const byLoc: Record<string, any[]> = {};
  for (const it of items) {
    const k = it.locationName || 'Unknown location';
    if (!byLoc[k]) byLoc[k] = [];
    byLoc[k].push(it);
  }
  return (
    <Stack gap="md">
      {Object.entries(byLoc).map(([loc, rows]) => (
        <Paper key={loc} withBorder radius="md" p="sm">
          <Text size="sm" fw={600} mb="xs">{loc} · {rows.reduce((s, r) => s + r.quantity, 0)} cards</Text>
          <Stack gap={2}>
            {rows.map(it => {
              const c: ScryfallCard | null = it.card;
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
                  <Badge size="sm" variant="light">{it.quantity}x</Badge>
                </Group>
              );
            })}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function SharedWantlist({ items }: { items: any[] }) {
  if (items.length === 0) return <Text c="dimmed" ta="center" py="xl">Wantlist is empty.</Text>;
  return (
    <Stack gap={2}>
      {items.map(it => (
        <Paper key={it.id} withBorder mb={2} radius={0}>
          <Group p="sm" gap="sm" wrap="nowrap">
            <Box w={32} h={45} style={{ flexShrink: 0 }}>
              {it.card ? <CardThumb card={it.card} /> : <GhostThumb name={it.cardName} />}
            </Box>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={500}>{it.cardName}</Text>
              <Group gap={6}>
                {it.setCode ? (
                  <Group gap={4}>
                    <SetSymbol code={it.setCode} name={it.card?.setName || it.setCode.toUpperCase()} size={12} />
                    <Text size="xs" c="dimmed">{it.setCode.toUpperCase()} #{it.collectorNumber}</Text>
                  </Group>
                ) : (
                  <Text size="xs" c="dimmed">Generic</Text>
                )}
              </Group>
            </div>
            <Badge size="sm" variant="light">{it.quantity}x</Badge>
            {it.destinationName && <Badge size="xs" variant="light" color="green">→ {it.destinationName}</Badge>}
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}