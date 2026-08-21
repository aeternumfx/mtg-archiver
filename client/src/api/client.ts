import type { PaginatedResponse, GroupedCard, ScryfallCard, CardResult, Location, LocationGroup, CollectionItem, SyncStatus, ImportDiffReport, ImportOptions, DbSchemaHealth } from '../types';

export interface WantlistItemType {
  id: number;
  cardId: string | null;
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
  foil: number;
  condition: string | null;
  quantity: number;
  notes: string | null;
  destinationId: number | null;
  collectionGoalId: number | null;
  deckRequiredId: number | null;
  tradeId: number | null;
  persistent: number;
  createdAt: string;
  price: number | null;
  cheapestCard: ScryfallCard | null;
  cheapestPrice: number | null;
  card?: ScryfallCard | null;
}

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(fn: (() => void) | null) {
  onUnauthorized = fn;
}

function isAuthProbe(url: string): boolean {
  // Requests that legitimately return 401 without meaning "your session expired":
  // auth probes, and the public share endpoints (password prompts etc.).
  return url.includes('/api/auth/me')
    || url.includes('/api/auth/login')
    || url.includes('/api/share/');
}

function handleAuthError(status: number, url: string): boolean {
  if (status === 401) {
    if (!isAuthProbe(url)) onUnauthorized?.();
    return true;
  }
  return false;
}

async function parseError(res: Response, url: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  handleAuthError(res.status, url);
  const message = body?.error || res.statusText;
  const err = new Error(message) as Error & { status?: number; body?: unknown };
  err.status = res.status;
  err.body = body;
  return err;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw await parseError(res, url);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (res.status === 401 && !isAuthProbe(url)) onUnauthorized?.();
  return res;
}

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'moderator' | 'user';
  mustChangePassword: boolean;
  impersonating?: boolean;
  impersonatedBy?: string | null;
  isDemo?: boolean;
  displayName?: string | null;
  avatar?: string | null;
  paymentRef?: string | null;
  membershipTier?: string;
  paidUntil?: string | null;
  freeMonths?: number;
  paidMonths?: number;
  trialWeeks?: number;
  arrearsDays?: number;
  arrearsAction?: 'disable' | 'none';
}

export interface SystemSettings {
  scryfallStaleHours: number;
  setsRefreshHours: number;
  sessionTtlDays: number;
  instanceName: string;
  domain: string;
  adminContactName: string;
  adminContactEmail: string;
  basicPrice: string;
  proPrice: string;
  accountName: string;
  accountHolder: string;
  arrearsDays: number;
  arrearsAction: 'disable' | 'none';
}

export interface UpdateStatus {
  checkedAt: number;
  version: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  latestUrl: string | null;
  releaseNotes: string | null;
  autoUpdateAvailable: boolean;
}

export type RequestType = 'help' | 'feature' | 'bug' | 'feedback' | 'other';

export interface UserRequest {
  id: number;
  userId: number;
  username: string;
  type: RequestType;
  subject: string;
  message: string | null;
  urgent: number;
  status: 'open' | 'resolved';
  createdAt: string;
}

export const api = {
  meta: () => request<{ instanceName: string; adminContactName: string; adminContactEmail: string; version: string; instanceSetupDone: boolean }>('/api/meta'),

  requests: {
    submit: (data: { type: RequestType; subject: string; message?: string; urgent?: boolean }) =>
      request<UserRequest>('/api/requests', { method: 'POST', body: JSON.stringify(data) }),
  },

  moderator: {
    summary: () => request<Record<string, number>>('/api/requests/summary'),
  },
  auth: {
    me: () => request<{ user: AuthUser }>('/api/auth/me'),    login: (username: string, password: string) =>
      request<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    demoLogin: () =>
      request<{ user: AuthUser }>('/api/auth/demo-login', { method: 'POST' }),
    setupLogin: (token: string) =>
      request<{ user: AuthUser }>('/api/auth/setup-login', { method: 'POST', body: JSON.stringify({ token }) }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    exitImpersonation: () => request<{ ok: boolean }>('/api/auth/exit-impersonation', { method: 'POST' }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: boolean; user: AuthUser }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    profile: (data: { displayName?: string | null; avatarCardId?: string | null; avatarFace?: number | null }) =>
      request<{ user: AuthUser }>('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },

  privacy: {
    get: () => request<{
      collectionPrivacy: string;
      wantlistPrivacy: string;
      shareToken: string | null;
      username: string;
      displayName: string | null;
    }>('/api/profile/privacy'),
    update: (data: {
      collectionPrivacy?: 'public' | 'password' | 'private';
      wantlistPrivacy?: 'public' | 'password' | 'private';
      collectionPassword?: string | null;
      wantlistPassword?: string | null;
    }) =>
      request<{
        collectionPrivacy: string;
        wantlistPrivacy: string;
        shareToken: string | null;
        username: string;
      }>('/api/profile/privacy', { method: 'PUT', body: JSON.stringify(data) }),
  },

  share: {
    status: (token: string) =>
      request<{
        displayName: string | null;
        avatar: string | null;
        collection: { shared: boolean; password: boolean };
        wantlist: { shared: boolean; password: boolean };
      }>(`/api/share/${token}/status`),
    verify: (token: string, scope: 'collection' | 'wantlist', password?: string) =>
      request<{ scope: string; access: string | null }>(`/api/share/${token}/verify`, {
        method: 'POST',
        body: JSON.stringify({ scope, password }),
      }),
    collection: (token: string, access?: string | null) =>
      request<{
        displayName: string | null;
        items: Array<{
          id: number;
          cardId: string;
          locationId: number;
          foil: number;
          foreignLanguage: number;
          condition: string | null;
          quantity: number;
          proxy: number;
          misprint: number;
          altered: number;
          notes: string | null;
          locationName: string | null;
          card: any;
        }>;
      }>(`/api/share/${token}/collection${access ? `?access=${encodeURIComponent(access)}` : ''}`),
    wantlist: (token: string, access?: string | null) =>
      request<{
        displayName: string | null;
        items: Array<{
          id: number;
          cardId: string | null;
          cardName: string;
          setCode: string | null;
          collectorNumber: string | null;
          foil: number;
          quantity: number;
          notes: string | null;
          destinationName: string | null;
          card: any;
          price: number | null;
          cheapestCard: any;
          cheapestPrice: number | null;
        }>;
      }>(`/api/share/${token}/wantlist${access ? `?access=${encodeURIComponent(access)}` : ''}`),
  },

  admin: {
    users: () => request<Array<{ id: number; username: string; displayName: string | null; avatar: string | null; role: string; disabled: number; mustChangePassword: number; createdAt: string; lastLoginAt: string | null; activeSessions: number; pendingTour: boolean; demo: boolean; storageBytes: number; membershipTier: string; paidUntil: string | null; paidOn: string | null; freeMonths: number; paidMonths: number; trialWeeks: number; billingNotes: string | null; paymentRef: string | null }>>('/api/admin/users'),
    setupStatus: () => request<{ done: boolean; adminUsername: string }>('/api/admin/setup-status'),
    completeSetup: (data: { domain: string; adminContactName: string; adminContactEmail: string; demoEnabled: boolean; currentPassword?: string; newPassword?: string }) =>
      request<{ ok: boolean; settings: SystemSettings }>('/api/admin/complete-setup', { method: 'POST', body: JSON.stringify(data) }),
    demoStatus: () => request<{ exists: boolean; enabled: boolean; username: string }>('/api/admin/demo'),
    setDemo: (enabled: boolean) =>
      request<{ enabled: boolean; message: string }>('/api/admin/demo', { method: 'POST', body: JSON.stringify({ enabled }) }),
    updateStatus: () => request<UpdateStatus>('/api/admin/update/status'),
    updateCheck: () => request<UpdateStatus>('/api/admin/update/check', { method: 'POST' }),
    updateNow: () =>
      request<{ message: string; backupFile: string; version: string }>('/api/admin/update', { method: 'POST' }),
    restore: async (file: File): Promise<{ message: string }> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/restore', { method: 'POST', credentials: 'include', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Restore failed' }));
        throw new Error(err.error || 'Restore failed');
      }
      return res.json();
    },
    backupDownload: async (): Promise<void> => {
      const res = await fetch('/api/admin/backup', { credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Backup failed' }));
        throw new Error(err.error || 'Backup failed');
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const m = disposition.match(/filename="?([^";]+)"?/);
      const filename = m?.[1] || `mtg-archiver-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    overview: () => request<{ users: number; admins: number; disabled: number; userDbs: number }>('/api/admin/overview'),
    dbSchema: () => request<DbSchemaHealth>('/api/admin/db-schema'),
    pruneDbSchema: (userId: number) =>
      request<{ message: string; removed: string[]; errors: string[] }>('/api/admin/db-schema/prune', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
    stats: () => request<{
      users: { total: number; admins: number; disabled: number; active7d: number; active30d: number; activeSessions: number };
      storage: {
        systemDbBytes: number;
        usersBytes: number;
        perUser: Array<{ userId: number; username: string; bytes: number }>;
        images: { files: number; bytes: number };
        dataDirFree: number;
      };
      catalog: { cards: number; sets: number; syncing: boolean; lastSync: string | null; stage: string | null; nextSyncDue: string | null; jobs: string[] };
      calls: { scryfall: number; images: number };
    }>('/api/admin/stats'),
    feed: (limit = 100) => request<Array<{ id: number; ts: string; username: string | null; method: string; path: string; status: number }>>(`/api/admin/feed?limit=${limit}`),
    settings: () => request<SystemSettings>('/api/admin/settings'),
    updateSettings: (partial: Partial<SystemSettings>) =>
      request<SystemSettings>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(partial) }),
    requests: (type?: RequestType | 'all', status?: 'open' | 'resolved' | 'all') => {
      const p = new URLSearchParams();
      if (type) p.set('type', type);
      if (status) p.set('status', status);
      return request<{ data: UserRequest[]; counts: Record<string, number> }>(`/api/admin/requests${p.toString() ? `?${p}` : ''}`);
    },
    updateRequest: (id: number, status: 'open' | 'resolved') =>
      request<UserRequest>(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    deleteRequest: (id: number) =>
      request<void>(`/api/admin/requests/${id}`, { method: 'DELETE' }),
    restoreRequest: (req: UserRequest) =>
      request<UserRequest>(`/api/admin/requests/${req.id}/restore`, { method: 'POST', body: JSON.stringify({ request: req }) }),
    clearRequests: () => request<{ message: string }>('/api/admin/clear-requests', { method: 'POST' }),
    clearActivity: () => request<{ message: string }>('/api/admin/clear-activity', { method: 'POST' }),
    clearImages: () => request<{ message: string }>('/api/admin/clear-images', { method: 'POST' }),
    resetSettings: () => request<{ settings: SystemSettings; message: string }>('/api/admin/reset-settings', { method: 'POST' }),
    resetInstance: () => request<{ message: string }>('/api/admin/reset-instance', { method: 'POST' }),
    createUser: (username: string, role?: string) =>
      request<{ user: { id: number; username: string; role: string; mustChangePassword: boolean }; tempPassword: string }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, role }),
      }),
    resetPassword: (id: number, password?: string) =>
      request<{ tempPassword: string; mustChangePassword: boolean }>(`/api/admin/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    updateUser: (id: number, data: { disabled?: boolean; role?: 'admin' | 'moderator' | 'user'; mustChangePassword?: boolean; username?: string }) =>
      request<any>(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    revokeSessions: (id: number) =>
      request<{ message: string }>(`/api/admin/users/${id}/revoke-sessions`, { method: 'POST' }),
    impersonate: (id: number) =>
      request<{ user: AuthUser }>(`/api/admin/users/${id}/impersonate`, { method: 'POST' }),
    resetTour: (id: number) =>
      request<{ message: string }>(`/api/admin/users/${id}/reset-tour`, { method: 'POST' }),
    deleteUser: (id: number, permanent?: boolean) =>
      request<{ message: string }>(`/api/admin/users/${id}`, { method: 'DELETE', body: JSON.stringify({ permanent }) }),
    updateBilling: (id: number, data: { membershipTier?: 'trial' | 'complimentary' | 'basic' | 'pro'; paidUntil?: string | null; paidOn?: string | null; freeMonths?: number; paidMonths?: number; trialWeeks?: number; billingNotes?: string | null }) =>
      request<any>(`/api/admin/users/${id}/billing`, { method: 'POST', body: JSON.stringify(data) }),
  },

  syncStatus: () => request<SyncStatus>('/api/sync-status'),

  dashboard: {
    stats: () => request<{
      totalCards: number;
      purchaseValue: number;
      marketValue: number;
      trueMarketValue: number;
      bulkCards: number;
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
    find: (q: string, opts?: { counts?: boolean }) =>
      request<CardResult[]>(`/api/cards/find?q=${encodeURIComponent(q)}${opts?.counts ? '&counts=1' : ''}`),
    resolveBulk: (queries: string[]) =>
      request<Record<string, ScryfallCard[]>>('/api/cards/resolve-bulk', { method: 'POST', body: JSON.stringify({ queries }) }),
    grouped: (q: string, page = 1, filters?: Record<string, string>, opts?: { counts?: boolean }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('page', String(page));
      if (opts?.counts) params.set('counts', '1');
      if (filters) for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      return request<PaginatedResponse<GroupedCard>>(`/api/cards/grouped?${params}`);
    },
    search: (q: string, page = 1) =>
      request<PaginatedResponse<ScryfallCard>>(`/api/cards/search?q=${encodeURIComponent(q)}&page=${page}`),
    setCards: (setCode: string) => request<ScryfallCard[]>(`/api/cards/set/${setCode}`),
    get: (id: string) => request<ScryfallCard>(`/api/cards/${id}`),
    printings: (name: string) => request<ScryfallCard[]>(`/api/cards/printings?name=${encodeURIComponent(name)}`),
    printingsPaged: (name: string, page = 1, pageSize = 50, opts?: { counts?: boolean }) =>
      request<PaginatedResponse<ScryfallCard>>(`/api/cards/printings?name=${encodeURIComponent(name)}&page=${page}&pageSize=${pageSize}${opts?.counts ? '&counts=1' : ''}`),
    byName: (name: string) =>
      request<ScryfallCard | null>(`/api/cards/by-name?name=${encodeURIComponent(name)}`),
    byNames: (names: string[]) =>
      request<Record<string, ScryfallCard>>(`/api/cards/by-names?names=${encodeURIComponent(names.join(','))}`),
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
    billing: () => request<{ basicPrice: string; proPrice: string; accountName: string; accountHolder: string }>('/api/data/billing'),
    export: () => request<{
      version: number;
      exportedAt: string;
      locationGroups: any[];
      locations: any[];
      collectionItems: any[];
      collectionHistory: any[];
    }>('/api/data/export'),
    importPreview: (data: any) =>
      request<ImportDiffReport>('/api/data/import/preview', {
        method: 'POST',
        body: JSON.stringify({ data }),
      }),
    import: (data: any, mode: 'merge' | 'replace', options?: ImportOptions) =>
      request<{ message: string }>('/api/data/import', {
        method: 'POST',
        body: JSON.stringify({ data, mode, options }),
      }),
    delete: () =>
      request<{ message: string }>('/api/data/delete', {
        method: 'POST',
      }),
  },

  wantlist: {
    list: () => request<WantlistItemType[]>('/api/wantlist'),
    paged: (page: number, pageSize = 50, params?: { destinationId?: number; q?: string; sort?: string; order?: string; filters?: Record<string, string>; tradeGhosts?: string }) => {
      const p = new URLSearchParams();
      p.set('page', String(page));
      p.set('pageSize', String(pageSize));
      if (params?.destinationId) p.set('destinationId', String(params.destinationId));
      if (params?.q) p.set('q', params.q);
      if (params?.sort) p.set('sort', params.sort);
      if (params?.order) p.set('order', params.order);
      if (params?.tradeGhosts) p.set('tradeGhosts', params.tradeGhosts);
      if (params?.filters) for (const [k, v] of Object.entries(params.filters)) if (v) p.set(k, v);
      return request<{ data: WantlistItemType[]; total: number; page: number; pageSize: number; totalPages: number }>(`/api/wantlist?${p}`);
    },
    add: (data: { cardId?: string; cardName: string; setCode?: string; collectorNumber?: string; foil?: boolean; condition?: string | null; quantity?: number; notes?: string; destinationId?: number | null; collectionGoalId?: number | null; persistent?: boolean; deckRequiredId?: number | null }) =>
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

  setup: {
    get: () => request<{ mode: string | null; done: boolean }>('/api/setup'),
    configure: (data: { mode?: string; done?: boolean }) =>
      request<{ ok: boolean; mode: string | null; done: boolean }>('/api/setup', { method: 'POST', body: JSON.stringify(data) }),
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
      pulls: Array<{ cardId: string; foil: boolean; slotIndex: number; locationId: number | null; destinationId?: number | null }>;
    }) => request<{ session: any; totalValue: number }>('/api/booster/finish', {
      method: 'POST', body: JSON.stringify(data),
    }),
  },

  decks: {
    list: () => request<Array<{ id: number; name: string; description: string | null; cardId: string | null; deckType: string; commanderCardId: string | null; partnerCardId: string | null; backgroundCardId: string | null; commanderItemId: number | null; partnerItemId: number | null; backgroundItemId: number | null; groupId: number | null; locationId: number | null; createdAt: string; cardCount: number }>>('/api/decks'),
    create: (data: { name: string; description?: string | null; cardId?: string; deckType?: string; commanderCardId?: string | null; partnerCardId?: string | null; backgroundCardId?: string | null; commanderItemId?: number | null; partnerItemId?: number | null; backgroundItemId?: number | null }) =>
      request<any>('/api/decks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { name?: string; description?: string | null; cardId?: string | null; deckType?: string; commanderCardId?: string | null; partnerCardId?: string | null; backgroundCardId?: string | null; commanderItemId?: number | null; partnerItemId?: number | null; backgroundItemId?: number | null }) =>
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
    linkFromCollection: (id: number, itemId: number, schedule?: boolean) =>
      request<any>(`/api/decks/${id}/link`, { method: 'POST', body: JSON.stringify({ itemId, schedule: !!schedule }) }),
    required: (id: number) => request<any[]>(`/api/decks/${id}/required`),
    addRequired: (id: number, data: { cardId?: string; cardName: string; setCode?: string; collectorNumber?: string; quantity?: number }) =>
      request<any>(`/api/decks/${id}/required`, { method: 'POST', body: JSON.stringify(data) }),
    removeRequired: (id: number, reqId: number) =>
      request<void>(`/api/decks/${id}/required/${reqId}`, { method: 'DELETE' }),
    updateRequired: (id: number, reqId: number, data: { cardId?: string | null; quantity?: number }) =>
      request<any>(`/api/decks/${id}/required/${reqId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    fillRequired: (id: number, reqId: number, itemId: number, schedule?: boolean) =>
      request<any>(`/api/decks/${id}/required/${reqId}/fill`, { method: 'POST', body: JSON.stringify({ itemId, schedule: !!schedule }) }),
    fillRequiredExternal: (id: number, reqId: number, data: {
      cardId: string;
      locationId?: number;
      quantity?: number;
      foil?: boolean;
      condition?: string | null;
      purchasePrice?: string | number | null;
      packOpened?: boolean;
      notes?: string;
      destinationId?: number | null;
    }) =>
      request<{ item: { id: number; quantity: number }; remainingGhost: { id: number; deckId: number; cardId: string | null; cardName: string; setCode: string | null; collectorNumber: string | null; quantity: number } | null }>(`/api/decks/${id}/required/${reqId}/fill-external`, { method: 'POST', body: JSON.stringify(data) }),
    fillRequiredExternalBulk: (id: number, reqIds: number[]) =>
      request<{ results: Array<{ reqId: number; itemId: number; quantity: number; remainingGhost: { id: number; quantity: number } | null; ghost: { cardId: string | null; cardName: string; setCode: string | null; collectorNumber: string | null; quantity: number } }> }>(`/api/decks/${id}/required/fill-external-bulk`, { method: 'POST', body: JSON.stringify({ reqIds }) }),
    undoFillExternalBulk: (id: number, results: Array<{ itemId: number; ghost: { cardId: string | null; cardName: string; setCode: string | null; collectorNumber: string | null; quantity: number } }>) =>
      request<{ ok: boolean; message: string }>(`/api/decks/${id}/required/undo-fill-bulk`, { method: 'POST', body: JSON.stringify({ results }) }),
    moveRequired: (id: number, reqId: number, data: { destinationType: 'location' | 'deck'; destinationId: number }) =>
      request<any>(`/api/decks/${id}/required/${reqId}/move`, { method: 'POST', body: JSON.stringify(data) }),
    importDeck: (data: { name: string; description?: string; deckType?: string; content: string; format?: 'auto' | 'csv' | 'text' }) =>
      request<any>('/api/decks/import', { method: 'POST', body: JSON.stringify(data) }),
    importFromUrl: (data: { name: string; description?: string; deckType?: string; url: string; specificPrintings?: boolean }) =>
      request<any>('/api/decks/import-url', { method: 'POST', body: JSON.stringify(data) }),
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
      foreignLanguage?: boolean;
      condition?: string | null;
      purchasePrice?: number | null;
      packOpened?: boolean;
      proxy?: boolean;
      misprint?: boolean;
      altered?: boolean;
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
      foreignLanguage?: boolean;
      condition?: string | null;
      purchasePrice?: number | null;
      packOpened?: boolean;
      proxy?: boolean;
      misprint?: boolean;
      altered?: boolean;
      notes?: string;
      acquiredAt?: string;
      destinationId?: number | null;
      forceNew?: boolean;
    }): Promise<{ item: CollectionItem; created: boolean }> => {
      const res = await authFetch('/api/collection', {
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
    counts: (names: string[]) =>
      request<Record<string, number>>(`/api/collection/counts?names=${encodeURIComponent(JSON.stringify(names))}`),
    move: (items: Array<{ id: number; quantity?: number }>, destinationLocationId: number) =>
      request<{ moved: Array<{ id: number; cardId: string; quantity: number }> }>(
        '/api/collection/move',
        { method: 'POST', body: JSON.stringify({ items, destinationLocationId }) },
      ),
  },
};
