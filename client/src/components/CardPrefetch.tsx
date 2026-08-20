import { useEffect } from 'react';
import { api } from '../api/client';
import { prefetchCardImage, resolveGhostImages, cacheGhostImagesByName, ghostImageCached, markGhostIdRequested, ghostIdRequested } from './CardDisplay';
import type { CardImageData } from './CardDisplay';

export function cardLargeUrls(card?: CardImageData | null): string[] {
  if (!card) return [];
  const urls: string[] = [];
  const push = (u?: string | null) => {
    if (u) urls.push(u);
  };
  push(card.imageUris?.large);
  push(card.imageUris?.normal);
  for (const f of card.cardFaces ?? []) {
    push(f.image_uris?.large);
    push(f.image_uris?.normal);
  }
  return urls;
}

export function cardSmallUrls(card?: CardImageData | null): string[] {
  if (!card) return [];
  const urls: string[] = [];
  const push = (u?: string | null) => {
    if (u) urls.push(u);
  };
  // Prefer the thumbnails actually rendered in lists.
  push(card.imageUris?.small);
  push(card.imageUris?.normal);
  for (const f of card.cardFaces ?? []) {
    push(f.image_uris?.small);
    push(f.image_uris?.normal);
  }
  return urls;
}

// Pre-fetches images for the currently-open deck: real deck cards plus generic
// ghost cards. Generic ghosts are resolved in a single batch request (rather
// than one round-trip each) and their art is cached so their thumbnails render
// instantly and hover previews load quickly.
export function CardPrefetch({ cards, ghosts }: {
  cards: Array<CardImageData | null | undefined>;
  ghosts: Array<{ cardId: string | null; cardName: string } | null | undefined>;
}) {
  useEffect(() => {
    for (const card of cards) {
      for (const url of cardLargeUrls(card)) prefetchCardImage(url);
      for (const url of cardSmallUrls(card)) prefetchCardImage(url);
    }

    const genericNames = Array.from(new Set(
      ghosts
        .filter((g): g is { cardId: string | null; cardName: string } => !!g && !g.cardId)
        .map(g => g.cardName)
        .filter(Boolean),
    )).filter(name => !ghostImageCached(name, null));

    if (genericNames.length > 0) {
      api.cards.byNames(genericNames)
        .then(map => {
          const urls = cacheGhostImagesByName(map);
          for (const u of urls) prefetchCardImage(u);
        })
        .catch(() => {});
    }

    for (const ghost of ghosts) {
      if (!ghost || !ghost.cardId) continue;
      if (ghostImageCached(ghost.cardName, ghost.cardId)) continue;
      if (ghostIdRequested(ghost.cardId)) continue;
      markGhostIdRequested(ghost.cardId);
      resolveGhostImages(ghost.cardName, ghost.cardId).then(img => {
        if (img?.small) prefetchCardImage(img.small);
        if (img?.large) prefetchCardImage(img.large);
      }).catch(() => {});
    }
  }, [cards, ghosts]);
  return null;
}
