export interface ActivityEvent {
  id: number;
  ts: string;
  username: string | null;
  method: string;
  path: string;
  status: number;
}

const events: ActivityEvent[] = [];
const MAX_EVENTS = 500;
let nextId = 1;

export function logActivity(ev: Omit<ActivityEvent, 'id' | 'ts'>) {
  events.push({ ...ev, id: nextId++, ts: new Date().toISOString() });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

export function getActivity(limit = 100): ActivityEvent[] {
  return events.slice(-limit).reverse();
}

export function clearActivity() {
  events.length = 0;
}
