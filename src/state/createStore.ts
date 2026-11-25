import { useRef, useSyncExternalStore } from 'react';

type Listener = () => void;

export interface Store<T extends object> {
  getState: () => T;
  /** Merges `patch`; does nothing (and notifies nobody) when every patched field is already equal. */
  setState: (patch: Partial<T>) => void;
  subscribe: (l: Listener) => () => void;
}

/** Tiny subscribable store with a no-op `setState` guard. */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState: (patch) => {
      let changed = false;
      for (const key in patch) {
        if (Object.hasOwn(patch, key) && !Object.is(state[key], patch[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

/** Shallow equality for primitives, arrays and plain objects (one level deep). */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k)) return false;
    if (!Object.is(Reflect.get(a, k), Reflect.get(b, k))) return false;
  }
  return true;
}

/**
 * Subscribes to `select(state)`; re-renders only when the selection changes shallowly, so selectors
 * may return fresh objects/arrays (e.g. `s => ({ a: s.a, b: s.b })`) without looping.
 */
export function useStoreSelector<T extends object, S>(store: Store<T>, select: (state: T) => S): S {
  const prev = useRef<{ value: S } | null>(null);
  const getSnapshot = (): S => {
    const next = select(store.getState());
    if (prev.current && shallowEqual(prev.current.value, next)) return prev.current.value;
    prev.current = { value: next };
    return next;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot);
}
