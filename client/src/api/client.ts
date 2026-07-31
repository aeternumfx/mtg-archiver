import type { PaginatedResponse, GroupedCard, ScryfallCard, CardResult, Location, LocationGroup, CollectionItem, SyncStatus } from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  syncStatus: () => request<SyncStatus>('/api/sync-status'),

  dashboard: {
    stats: () => request<{
      totalCards: number;
      purchaseValue: number;
      marketValue: number;
      byLocation: Array<{ id: number; name: string; count: number; value: number; marketValue: number }>;
      deckBreakdown: Array<{ id: number; name: string; count: number; value: number; marketValue: number }>;
      valueHistory: Array<{ date: string; totalCards: number; totalValue: number; purchaseValue: number | null }>;
      rarityBreakdown: Array<{ rarity: string; count: number; value: number }>;
      conditionBreakdown: Array<{ condition: string; count: number; value: number }>;
      topCards: Array<{ cardId: string; name: string; setName: string; setCode: string; totalQty: number; totalValue: number; marketPrice: number | null }>;
      recentAdditions: Array<{ cardId: string; name: string; quantity: number; purchasePrice: number | null; createdAt: string }>;
    }>('/api/dashboard/stats'),
  },

  sets: () => request<Array<{ setCode: string; setName: string; hasBoosters: number; setType: string }>>('/api/cards/sets'),

  cards: {
    find: (q: string) => request<CardResult[]>(`/api/cards/find?q=${encodeURIComponent(q)}`),
    grouped: (q: string, page = 1, filters?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('page', String(page));
      if (filters) for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      return request<PaginatedResponse<GroupedCard>>(`/api/cards/grouped?${params}`);
    },
    search: (q: string, page = 1) =>
      request<PaginatedResponse<ScryfallCard>>(`/api/cards/search?q=${encodeURIComponent(q)}&page=${page}`),
    setCards: (setCode: string) => request<ScryfallCard[]>(`/api/cards/set/${setCode}`),
    get: (id: string) => request<ScryfallCard>(`/api/cards/${id}`),
    printings: (name: string) => request<ScryfallCard[]>(`/api/cards/printings?name=${encodeURIComponent(name)}`),
  },

  locations: {
    list: () => request<Location[]>('/api/locations'),
    get: (id: number) => request<Location>(`/api/locations/${id}`),
    create: (data: Partial<Location>) =>
      request<Location>('/api/locations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Location>) =>
      request<Location>(`/api/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<void>(`/api/locations/${id}`, { method: 'DELETE' }),
    setGroup: (locationId: number, groupId: number | null) =>
      request<Location>(`/api/location-groups/${groupId ?? 0}/locations/${locationId}`, { method: 'PATCH' }),
  },

  locationGroups: {
    list: () => request<LocationGroup[]>('/api/location-groups'),
    create: (data: { name: string; description?: string }) =>
      request<LocationGroup>('/api/location-groups', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name?: string; description?: string }) =>
      request<LocationGroup>(`/api/location-groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<void>(`/api/location-groups/${id}`, { method: 'DELETE' }),
  },

  data: {
    export: () => request<{
      version: number;
      exportedAt: string;
      locationGroups: any[];
      locations: any[];
      collectionItems: any[];
      collectionHistory: any[];
    }>('/api/data/export'),
    import: (data: any, mode: 'merge' | 'replace') =>
      request<{ message: string }>('/api/data/import', {
        method: 'POST',
        body: JSON.stringify({ data, mode }),
      }),
    delete: (mode: 'wipe' | 'basic' | 'demo') =>
      request<{ message: string }>('/api/data/delete', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }),
  },

  wantlist: {
    list: () => request<Array<{ id: number; cardId: string | null; cardName: string; setCode: string | null; collectorNumber: string | null; foil: number; condition: string | null; quantity: number; notes: string | null; destinationId: number | null; collectionGoalId: number | null; persistent: number; createdAt: string }>>('/api/wantlist'),
    paged: (page: number, pageSize = 50, destinationId?: number) => request<{ data: Array<{ id: number; cardId: string | null; cardName: string; setCode: string | null; collectorNumber: string | null; foil: number; condition: string | null; quantity: number; notes: string | null; destinationId: number | null; collectionGoalId: number | null; persistent: number; createdAt: string }>; total: number; page: number; pageSize: number; totalPages: number }>(`/api/wantlist?page=${page}&pageSize=${pageSize}${destinationId ? `&destinationId=${destinationId}` : ''}`),
    add: (data: { cardId?: string; cardName: string; setCode?: string; collectorNumber?: string; foil?: boolean; condition?: string | null; quantity?: number; notes?: string; destinationId?: number | null; collectionGoalId?: number | null; persistent?: boolean }) =>
      request<any>('/api/wantlist', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/api/wantlist/${id}`, { method: 'DELETE' }),
    fulfil: (id: number, count?: number) =>
      request<{ removed: boolean; goal: { id: number; fulfilledCount: number; targetCount: number | null; complete: boolean } }>(`/api/wantlist/${id}/fulfil`, { method: 'POST', body: JSON.stringify({ count }) }),
  },

  collectionGoals: {
    list: () => request<Array<{ id: number; locationId: number; locationName: string; kind: string; cardId: string | null; cardName: string | null; setCodes: string | null; targetCount: number | null; fulfilledCount: number; status: string; createdAt: string; remaining: number; remainingCost: number; percent: number }>>('/api/collection-goals'),
    create: (data: { name: string; description?: string; kind: string; cardId?: string; cardName?: string; setCodes?: string[]; targetCount?: number | null; perpetual?: boolean }) =>
      request<any>('/api/collection-goals', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/api/collection-goals/${id}`, { method: 'DELETE' }),
  },

  organize: {
    pending: () => request<any[]>('/api/organize/pending'),
    resolve: (data: { itemIds?: number[]; all?: boolean }) =>
      request<{ message: string; undo?: Array<{ id: number; locId: number; destId: number | null }> }>('/api/organize/resolve', { method: 'POST', body: JSON.stringify(data) }),
    undoResolve: (data: { history: Array<{ id: number; locId: number; destId: number | null }> }) =>
      request<{ message: string }>('/api/organize/undo-resolve', { method: 'POST', body: JSON.stringify(data) }),
    history: (limit?: number) =>
      request<any[]>(`/api/organize/history${limit ? `?limit=${limit}` : ''}`),
    markHistoryUndone: (ids: number[]) =>
      request<{ message: string }>('/api/organize/history/undo', { method: 'POST', body: JSON.stringify({ ids }) }),
  },

  trades: {
    list: () => request<any[]>('/api/trades'),
    create: (data: any) => request<any>('/api/trades', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: any) => request<any>(`/api/trades/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/api/trades/${id}`, { method: 'DELETE' }),
  },

  booster: {
    history: () => request<any[]>('/api/booster/history'),
    finish: (data: {
      setCode: string; boosterType: string; boosterPrice: number;
      pulls: Array<{ cardId: string; foil: boolean; slotIndex: number; locationId: number | null }>;
    }) => request<{ session: any; totalValue: number }>('/api/booster/finish', {
      method: 'POST', body: JSON.stringify(data),
    }),
  },

  decks: {
    list: () => request<Array<{ id: number; name: string; description: string | null; cardId: string | null; deckType: string; commanderCardId: string | null; partnerCardId: string | null; backgroundCardId: string | null; groupId: number | null; createdAt: string; cardCount: number }>>('/api/decks'),
    create: (data: { name: string; description?: string | null; cardId?: string; deckType?: string; commanderCardId?: string | null; partnerCardId?: string | null; backgroundCardId?: string | null }) =>
      request<any>('/api/decks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name?: string; description?: string | null; cardId?: string | null; deckType?: string; commanderCardId?: string | null; partnerCardId?: string | null; backgroundCardId?: string | null }) =>
      request<any>(`/api/decks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<void>(`/api/decks/${id}`, { method: 'DELETE' }),
    legality: (id: number) => request<{
      format: string;
      legal: boolean;
      totalCards: number;
      issues: Array<{ type: string; cardName: string; detail: string }>;
      cardStatuses: Array<{ name: string; status: string }>;
    }>(`/api/decks/${id}/legality`),
    setArtwork: (id: number, cardId: string) =>
      request<any>(`/api/decks/${id}/artwork`, { method: 'POST', body: JSON.stringify({ cardId }) }),
    setGroup: (id: number, groupId: number | null) =>
      request<any>(`/api/decks/${id}/group`, { method: 'PATCH', body: JSON.stringify({ groupId }) }),
    cards: (id: number) => request<CollectionItem[]>(`/api/decks/${id}/cards`),
    addCard: (id: number, data: { cardId: string; locationId: number; quantity?: number; foil?: boolean; condition?: string | null }) =>
      request<any>(`/api/decks/${id}/cards`, { method: 'POST', body: JSON.stringify(data) }),
    removeCard: (id: number, itemId: number) =>
      request<void>(`/api/decks/${id}/cards/${itemId}`, { method: 'DELETE' }),
    linkFromCollection: (id: number, itemId: number) =>
      request<any>(`/api/decks/${id}/link`, { method: 'POST', body: JSON.stringify({ itemId }) }),
    required: (id: number) => request<any[]>(`/api/decks/${id}/required`),
    addRequired: (id: number, data: { cardId?: string; cardName: string; setCode?: string; collectorNumber?: string; quantity?: number }) =>
      request<any>(`/api/decks/${id}/required`, { method: 'POST', body: JSON.stringify(data) }),
    removeRequired: (id: number, reqId: number) =>
      request<void>(`/api/decks/${id}/required/${reqId}`, { method: 'DELETE' }),
    updateRequired: (id: number, reqId: number, data: { cardId?: string | null }) =>
      request<any>(`/api/decks/${id}/required/${reqId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    fillRequired: (id: number, reqId: number, itemId: number) =>
      request<any>(`/api/decks/${id}/required/${reqId}/fill`, { method: 'POST', body: JSON.stringify({ itemId }) }),
  },

  collection: {
    list: (locationId?: number, page = 1) => {
      const params = new URLSearchParams();
      if (locationId) params.set('location_id', String(locationId));
      params.set('page', String(page));
      return request<PaginatedResponse<CollectionItem>>(`/api/collection?${params}`);
    },
    add: (data: {
      cardId: string;
      locationId: number;
      quantity?: number;
      foil?: boolean;
      condition?: string | null;
      purchasePrice?: number | null;
      packOpened?: boolean;
      notes?: string;
      acquiredAt?: string;
      destinationId?: number | null;
      forceNew?: boolean;
    }) =>
      request<CollectionItem>('/api/collection', { method: 'POST', body: JSON.stringify(data) }),
    addDetailed: async (data: {
      cardId: string;
      locationId: number;
      quantity?: number;
      foil?: boolean;
      condition?: string | null;
      purchasePrice?: number | null;
      packOpened?: boolean;
      notes?: string;
      acquiredAt?: string;
      destinationId?: number | null;
      forceNew?: boolean;
    }): Promise<{ item: CollectionItem; created: boolean }> => {
      const res = await fetch('/api/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({ error: res.statusText }));
      if (!res.ok) throw new Error(json.error || res.statusText);
      return { item: json, created: res.status === 201 };
    },
    update: (id: number, data: Partial<CollectionItem>) =>
      request<CollectionItem>(`/api/collection/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number) =>
      request<void>(`/api/collection/${id}`, { method: 'DELETE' }),
    splitCopy: (id: number, destinationId: number | null) =>
      request<CollectionItem>(`/api/collection/${id}/split-copy`, { method: 'POST', body: JSON.stringify({ destinationId }) }),
    names: () => request<string[]>('/api/collection/names'),
    move: (items: Array<{ id: number; quantity?: number }>, destinationLocationId: number) =>
      request<{ moved: Array<{ id: number; cardId: string; quantity: number }> }>(
        '/api/collection/move',
        { method: 'POST', body: JSON.stringify({ items, destinationLocationId }) },
      ),
  },
};
