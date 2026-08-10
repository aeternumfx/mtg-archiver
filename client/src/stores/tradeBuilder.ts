import { useSyncExternalStore } from 'react';

export interface TradeItem {
  tempId: string;
  side?: string;
  cardId?: string;
  cardName: string;
  setCode?: string;
  collectorNumber?: string;
  foil?: number;
  condition?: string | null;
  quantity: number;
  price: number | null;
  imageUris?: Record<string, string> | null;
  prices?: Record<string, string | null> | null;
  locationId?: number | null;
  destinationId?: number | null;
}

export interface Trade {
  id?: number;
  title?: string;
  status: string;
  yourCash: number;
  theirCash: number;
  contactInfo?: string;
  notes?: string;
  createdAt?: string;
  receivedLocationId?: number | null;
  receivedDestinationId?: number | null;
  items: TradeItem[];
}

export interface TradeBuilderState {
  activeTrade: Trade;
  showHistory: boolean;
  selectedLoc: string | null;
}

const EMPTY_TRADE: Trade = { status: 'active', yourCash: 0, theirCash: 0, items: [] };

let state: TradeBuilderState = {
  activeTrade: EMPTY_TRADE,
  showHistory: false,
  selectedLoc: null,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function useTradeBuilder(): TradeBuilderState {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    () => state,
    () => state,
  );
  return state;
}

export function getBuilder(): TradeBuilderState {
  return state;
}

export function patchActiveTrade(partial: Partial<Trade>) {
  state = { ...state, activeTrade: { ...state.activeTrade, ...partial } };
  emit();
}

export function clearActiveTrade() {
  state = { ...state, activeTrade: { ...EMPTY_TRADE, items: [] } };
  emit();
}

export function setShowHistory(v: boolean) {
  state = { ...state, showHistory: v };
  emit();
}

export function setSelectedLoc(v: string | null) {
  state = { ...state, selectedLoc: v };
  emit();
}

export function resetTradeBuilder() {
  state = { activeTrade: { ...EMPTY_TRADE, items: [] }, showHistory: false, selectedLoc: null };
  emit();
}
