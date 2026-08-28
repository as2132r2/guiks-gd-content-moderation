// Tiny in-process pub/sub used to fan SSE events out to every connected console.
import type { StreamEventName } from '../types.js';

export interface StreamMessage {
  name: StreamEventName;
  data: unknown;
}

type Listener = (msg: StreamMessage) => void;

const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function publish(name: StreamEventName, data: unknown): void {
  const msg: StreamMessage = { name, data };
  for (const fn of listeners) {
    try {
      fn(msg);
    } catch {
      // a dead client must never break the publisher
    }
  }
}
