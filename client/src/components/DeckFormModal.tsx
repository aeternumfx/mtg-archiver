import { useState, useEffect, type ReactNode } from 'react';
import {
  Box, Text, Group, Button, Modal, Select, TextInput, Textarea, ScrollArea, SimpleGrid, Badge, Card as MCard, Image, HoverCard,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { api } from '../api/client';
import type { ScryfallCard } from '../types';
import { CardThumb, SetSymbol } from './CardDisplay';

export const DECK_TYPES = [
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

const CID_COLORS: Record<string, string> = {
  W: '#f8d558', U: '#2a6fbf', B: '#444444', R: '#d33f2d', G: '#3f9c47', C: '#666666',
};

export interface DeckFormValues {
  name: string;
  description: string;
  deckType: string;
  commanderCardId: string;
  partnerCardId: string;
  backgroundCardId: string;
  cardId: string;
}

const EMPTY_FORM: DeckFormValues = { name: '', description: '', deckType: 'custom', commanderCardId: '', partnerCardId: '', backgroundCardId: '', cardId: '' };

export function DeckArtwork({ cardId, size = 200 }: { cardId: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!cardId) return;
    setSrc(null); setLoaded(false);
    api.cards.get(cardId).then(card => {
      setSrc(card?.imageUris?.art_crop || card?.imageUris?.large || card?.imageUris?.normal
        || card?.cardFaces?.[0]?.image_uris?.art_crop || card?.cardFaces?.[0]?.image_uris?.large || null);
    }).catch(() => setSrc(null));
  }, [cardId]);
  return (
    <div style={{ width: '100%', height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', position: 'relative', overflow: 'hidden' }}>
      {src && <img src={src} onLoad={() => setLoaded(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: loaded ? 1 : 0, transition: 'opacity 0.2s' }} alt="" />}
      {!loaded && <span style={{ fontSize: 48, opacity: 0.15 }}>🃏</span>}
    </div>
  );
}

export function CommanderThumb({ card, size = 48 }: { card: ScryfallCard | null; size?: number }) {
  const src = card?.imageUris?.normal || card?.imageUris?.large || card?.imageUris?.small
    || card?.cardFaces?.[0]?.image_uris?.normal || card?.cardFaces?.[0]?.image_uris?.large || null;
  const largeSrc = card?.imageUris?.large || card?.imageUris?.normal
    || card?.cardFaces?.[0]?.image_uris?.large || card?.cardFaces?.[0]?.image_uris?.normal || null;
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

export function DeckFormModal({ opened, onClose, title, saveLabel, initial, saving, groups, groupId, onGroupChange, onSave, extraFields }: {
  opened: boolean;
  onClose: () => void;
  title: string;
  saveLabel: string;
  initial?: Partial<DeckFormValues>;
  saving?: boolean;
  groups?: { value: string; label: string }[];
  groupId?: string | null;
  onGroupChange?: (v: string | null) => void;
  onSave: (values: DeckFormValues) => void;
  extraFields?: ReactNode;
}) {
  const [form, setForm] = useState<DeckFormValues>(EMPTY_FORM);
  const [commanderPickOpened, { open: openCommanderPick, close: closeCommanderPick }] = useDisclosure(false);
  const [commanderPickMode, setCommanderPickMode] = useState<'commander' | 'partner' | 'background'>('commander');
  const [commanderSearch, setCommanderSearch] = useState('');
  const [commanderResults, setCommanderResults] = useState<ScryfallCard[]>([]);
  const [artworkOpened, { open: openArtwork, close: closeArtwork }] = useDisclosure(false);
  const [artworkSearch, setArtworkSearch] = useState('');
  const [artworkResults, setArtworkResults] = useState<ScryfallCard[]>([]);

  useEffect(() => {
    if (opened) setForm({ ...EMPTY_FORM, ...initial });
  }, [opened]);

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
      setForm(f => ({
        ...f,
        commanderCardId: card.id,
        partnerCardId: f.partnerCardId === card.id ? '' : f.partnerCardId,
        backgroundCardId: f.backgroundCardId === card.id ? '' : f.backgroundCardId,
      }));
    }
    closeCommanderPick();
    setCommanderSearch('');
    setCommanderResults([]);
  };

  const openArtworkDialog = () => {
    setArtworkSearch('');
    setArtworkResults([]);
    openArtwork();
  };

  return (
    <>
      <Modal opened={opened} onClose={onClose} title={title} size="md" centered>
        <TextInput label="Name" value={form.name} onChange={e => { const v = e.currentTarget.value; setForm(f => ({ ...f, name: v })); }} mb="sm" required />
        <Textarea label="Description" value={form.description} onChange={e => { const v = e.currentTarget.value; setForm(f => ({ ...f, description: v })); }} mb="sm" />
        <Select label="Deck Type" data={DECK_TYPES} value={form.deckType} onChange={v => setForm(f => ({ ...f, deckType: v || 'custom' }))} mb="sm" />
        {form.deckType === 'commander' && (
          <CommanderArea form={form} setForm={setForm} openPicker={openCommanderPickFor} />
        )}
        <Box mb="sm">
          <Text size="sm" fw={500} mb={4}>Artwork</Text>
          <Group gap="sm" align="center" wrap="nowrap">
            {form.cardId ? (
              <Box w={100} style={{ flexShrink: 0, borderRadius: 6, overflow: 'hidden' }}>
                <DeckArtwork cardId={form.cardId} size={60} />
              </Box>
            ) : (
              <Box w={100} h={60} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a2e', borderRadius: 6, fontSize: 24, opacity: 0.2 }}>🃏</Box>
            )}
            <Button variant="light" leftSection={<IconSearch size={14} />} onClick={openArtworkDialog}>Choose artwork</Button>
            {form.cardId && <Button size="compact-xs" variant="subtle" color="red" onClick={() => setForm(f => ({ ...f, cardId: '' }))}>Clear</Button>}
          </Group>
        </Box>
        {groups && onGroupChange && (
          <Select label="Group" placeholder="No group" clearable mb="sm"
            data={[{ value: '', label: 'No group' }, ...groups]}
            value={groupId ?? ''} onChange={v => onGroupChange(v ? v : null)} />
        )}
        {extraFields}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button loading={saving} disabled={!form.name.trim()} onClick={() => onSave(form)}>{saveLabel}</Button>
        </Group>
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
                <MCard key={c.id} withBorder padding={4} radius="sm" style={{ cursor: 'pointer' }} onClick={() => { setForm(f => ({ ...f, cardId: c.id })); closeArtwork(); }}>
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
    </>
  );
}
