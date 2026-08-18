import { useState, useEffect } from 'react';
import { Group, Text, Image, Badge, HoverCard, Box } from '@mantine/core';
import { api } from '../api/client';

const FALLBACK_32 = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='45'%3E%3Crect fill='%23e0e0e0' width='32' height='45'/%3E%3C/svg%3E";
const FALLBACK_240 = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='335'%3E%3Crect fill='%23e0e0e0' width='240' height='335'/%3E%3C/svg%3E";

export interface CardImageData {
  imageUris?: Record<string, string> | null;
  cardFaces?: Array<{ image_uris?: Record<string, string> }> | null;
  layout?: string | null;
}

export interface CardTagData {
  promo?: number | boolean | null;
  seriealized?: number | boolean | null;
  fullArt?: number | boolean | null;
  textless?: number | boolean | null;
  layout?: string | null;
}

const DOUBLE_FACED_LAYOUTS = new Set([
  'transform',
  'modal_dfc',
  'art_series',
  'reversible_card',
  'double_faced_token',
]);

function isDoubleFaced(card: CardImageData): boolean {
  return DOUBLE_FACED_LAYOUTS.has(card.layout ?? '');
}

const FOIL_OVERLAY =
  'linear-gradient(155deg, transparent 25%, rgba(255,215,0,0.35) 35%, rgba(255,255,255,0.5) 40%, rgba(150,220,255,0.4) 45%, rgba(255,150,220,0.4) 50%, rgba(255,215,0,0.35) 55%, transparent 65%)';

function FoilOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: FOIL_OVERLAY,
      backgroundSize: '300% 100%',
      backgroundPosition: '40% 0%',
      pointerEvents: 'none',
      mixBlendMode: 'overlay',
      opacity: 0.9,
      zIndex: 2,
    }} />
  );
}

export function CardThumb({ card, foil }: { card: CardImageData; foil?: boolean }) {  const uris = card.imageUris;
  const faces = card.cardFaces;
  const faceImages = faces && faces.length > 1
    ? faces.map(f => ({
        small: f.image_uris?.small || f.image_uris?.art_crop || null,
        large: f.image_uris?.large || f.image_uris?.normal || null,
      }))
    : [];
  const showFaces = faceImages.length > 1 && isDoubleFaced(card);
  const frontFace = faceImages[0] ?? null;
  const srcSmall = uris?.small || uris?.art_crop || (!showFaces ? frontFace?.small : null) || null;
  const srcLarge = uris?.large || uris?.normal || (!showFaces ? frontFace?.large : null) || null;

  if (!srcSmall && !srcLarge && !showFaces) return null;

  const thumbFaces = showFaces ? faceImages.slice(0, 2) : [];

  const thumb = (
    <Group gap={2} wrap="nowrap" style={{ position: 'relative', display: 'inline-flex' }}>
      {showFaces ? thumbFaces.map((fi, i) => (
        <Image key={i} src={fi.small || fi.large} w={15} h={21} fit="cover" radius="xs" fallbackSrc={FALLBACK_32} />
      )) : (
        <Image src={srcSmall || srcLarge} w={32} h={45} fit="cover" radius="xs" style={{ cursor: 'default' }} fallbackSrc={FALLBACK_32} />
      )}
      {foil && <FoilOverlay />}
    </Group>
  );

  const large = (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {showFaces ? (
        <Group gap={4} wrap="nowrap">
          {faceImages.map((fi, i) => (
            <Image key={i} src={fi.large || fi.small} w={240} h={335}
              fit={(card.layout ?? '') === 'art_series' ? 'cover' : 'contain'}
              radius="sm" fallbackSrc={FALLBACK_240} />
          ))}
        </Group>
      ) : (
        <Image src={srcLarge || srcSmall} w={320} h={448} fit="contain" radius="sm" />
      )}
      {foil && <FoilOverlay />}
    </div>
  );

  return (
    <HoverCard width={0} shadow="md" withArrow>
      <HoverCard.Target>{thumb}</HoverCard.Target>
      <HoverCard.Dropdown p={0} style={{ border: 'none', background: 'transparent', pointerEvents: 'none' }}>
        {large}
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

const ghostCache = new Map<string, { small: string | null; large: string | null } | null>();

function ghostImageFrom(card: any): { small: string | null; large: string | null } | null {
  const uris = card?.imageUris;
  if (uris) {
    return {
      small: uris.small || uris.art_crop || null,
      large: uris.large || uris.normal || null,
    };
  }
  const face0 = card?.cardFaces?.[0]?.image_uris;
  if (face0) {
    return {
      small: face0.small || face0.art_crop || null,
      large: face0.large || face0.normal || null,
    };
  }
  return null;
}

export function resolveGhostImages(
  name?: string | null,
  cardId?: string | null,
): Promise<{ small: string | null; large: string | null } | null> {
  const key = cardId ? `id:${cardId}` : (name ? `name:${name.toLowerCase()}` : null);
  if (!key) return Promise.resolve(null);
  const cached = ghostCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const loader = cardId
    ? api.cards.get(cardId).then(c => ghostImageFrom(c)).catch(() => null)
    : api.cards.grouped(name || '', 1).then(r => ghostImageFrom(r.data?.[0])).catch(() => null);
  return loader.then(img => {
    ghostCache.set(key, img);
    return img;
  });
}

// Low-priority, concurrency-limited prefetch so hover previews render instantly.
const MAX_PREFETCH = 3;
let prefetchActive = 0;
const prefetchQueue: string[] = [];
const prefetchedUrls = new Set<string>();

function pumpPrefetch() {
  while (prefetchActive < MAX_PREFETCH && prefetchQueue.length > 0) {
    const url = prefetchQueue.shift()!;
    prefetchActive++;
    const img = new window.Image();
    img.decoding = 'async';
    const done = () => { prefetchActive--; pumpPrefetch(); };
    img.onload = done;
    img.onerror = done;
    img.src = url;
  }
}

export function prefetchCardImage(url?: string | null) {
  if (!url || prefetchedUrls.has(url)) return;
  prefetchedUrls.add(url);
  prefetchQueue.push(url);
  pumpPrefetch();
}

export function GhostThumb({ name, cardId, card }: {
  name?: string | null;
  cardId?: string | null;
  card?: CardImageData | null;
}) {
  const [image, setImage] = useState<{ small: string | null; large: string | null } | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const direct = ghostImageFrom(card);
    if (direct) { setImage(direct); setResolved(true); return; }

    setImage(null); setResolved(false);
    resolveGhostImages(name, cardId).then(img => {
      if (cancelled) return;
      setImage(img);
      setResolved(true);
    });
    return () => { cancelled = true; };
  }, [name, cardId, card]);

  const srcSmall = image?.small || null;
  const srcLarge = image?.large || null;

  const thumb = (
    <Box w={32} h={45} style={{ position: 'relative', borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: '#1a1a2e' }}>
      {srcSmall && resolved ? (
        <img src={srcSmall} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : null}
      <Box style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: resolved && srcSmall ? 'rgba(15,15,25,0.5)' : 'transparent' }}>
        <Text c="white" fw={700} style={{ fontSize: 20, textShadow: '0 1px 3px rgba(0,0,0,0.9)', lineHeight: 1 }}>?</Text>
      </Box>
    </Box>
  );

  if (!srcLarge || !resolved) return thumb;
  return (
    <HoverCard width={0} shadow="md" withArrow openDelay={150}>
      <HoverCard.Target>
        <Box style={{ display: 'inline-flex', cursor: 'pointer' }}>{thumb}</Box>
      </HoverCard.Target>
      <HoverCard.Dropdown p={0} style={{ border: 'none', background: 'transparent', pointerEvents: 'none' }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Image src={srcLarge} w={320} h={448} fit="contain" radius="sm" />
          <Box style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,15,25,0.3)' }}>
            <Text c="white" fw={700} style={{ fontSize: 120, textShadow: '0 3px 8px rgba(0,0,0,0.9)', lineHeight: 1, opacity: 0.9 }}>?</Text>
          </Box>
        </div>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export function SetSymbol({ code, name, size = 18 }: { code?: string | null; name: string; size?: number }) {
  if (!code) return <Badge size="sm" variant="light">?</Badge>;
  const baseSet = code.replace(/^p/i, '').toLowerCase();
  const svgUrl = `https://svgs.scryfall.io/sets/${baseSet}.svg`;
  const fallback = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ctext x='8' y='14' text-anchor='middle' font-size='14' fill='%23999'%3E%3F%3C/text%3E%3C/svg%3E`;
  const fallbackBig = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ctext x='20' y='34' text-anchor='middle' font-size='32' fill='%23999'%3E%3F%3C/text%3E%3C/svg%3E`;

  return (
    <HoverCard shadow="md" openDelay={200}>
      <HoverCard.Target>
        <Group gap={3} wrap="nowrap" style={{ cursor: 'default' }}>
          <Image
            src={svgUrl}
            w={size} h={size} fit="contain"
            fallbackSrc={fallback}
          />
          <Badge size="sm" variant="light">{code}</Badge>
        </Group>
      </HoverCard.Target>
      <HoverCard.Dropdown p="sm" style={{ pointerEvents: 'none', backgroundColor: 'var(--mantine-color-body)' }}>
        <Group gap="sm" wrap="nowrap">
          <Image src={svgUrl} w={40} h={40} fit="contain" fallbackSrc={fallbackBig} />
          <Text size="sm" fw={500}>{name}</Text>
        </Group>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export function Tags({ card }: { card: Record<string, any> }) {
  return (
    <Group gap={4}>
      {card.promo ? <Badge size="xs" color="violet" variant="light">PROMO</Badge> : null}
      {card.seriealized ? <Badge size="xs" color="orange" variant="light">SERIAL</Badge> : null}
      {card.fullArt ? <Badge size="xs" color="cyan" variant="light">FULL ART</Badge> : null}
      {card.textless ? <Badge size="xs" color="gray" variant="light">TEXTLESS</Badge> : null}
      {card.layout === 'art_series' ? <Badge size="xs" color="pink" variant="light">ART CARD</Badge> : null}
      {card.proxy ? <Badge size="xs" color="orange" variant="light">PROXY</Badge> : null}
      {card.misprint ? <Badge size="xs" color="red" variant="light">MISPRINT</Badge> : null}
      {card.altered ? <Badge size="xs" color="grape" variant="light">ALTERED</Badge> : null}
    </Group>
  );
}

export function CopyTags({ item }: { item: { proxy?: number | boolean | null; misprint?: number | boolean | null; altered?: number | boolean | null } }) {
  return (
    <Group gap={4}>
      {item.proxy ? <Badge size="xs" color="orange" variant="light">PROXY</Badge> : null}
      {item.misprint ? <Badge size="xs" color="red" variant="light">MISPRINT</Badge> : null}
      {item.altered ? <Badge size="xs" color="grape" variant="light">ALTERED</Badge> : null}
    </Group>
  );
}

export function ManaCost({ manaCost, size = 'xs' }: { manaCost: string | null; size?: 'xs' | 'sm' }) {
  if (!manaCost) return null;
  const short = manaCost.replace(/\{(\w+)\}/g, (_, s) => s);
  return <Text size={size} c="dimmed" style={{ fontFamily: 'monospace' }}>{short}</Text>;
}
