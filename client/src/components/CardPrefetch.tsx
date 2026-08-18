import { useEffect } from 'react';
import { prefetchCardImage, resolveGhostImages } from './CardDisplay';
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

export function CardPrefetch({ cards, ghosts }: {
  cards: Array<CardImageData | null | undefined>;
  ghosts: Array<{ cardId: string | null; cardName: string } | null | undefined>;
}) {
  useEffect(() => {
    for (const card of cards) {
      for (const url of cardLargeUrls(card)) prefetchCardImage(url);
    }
    for (const ghost of ghosts) {
      if (!ghost) continue;
      resolveGhostImages(ghost.cardName, ghost.cardId).then(img => {
        if (img?.large) prefetchCardImage(img.large);
      }).catch(() => {});
    }
  }, [cards, ghosts]);
  return null;
}