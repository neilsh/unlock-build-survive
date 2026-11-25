import { describe, expect, it, vi } from 'vitest';
import { createStore, shallowEqual } from './createStore';

describe('createStore', () => {
  it('merges patches and notifies subscribers', () => {
    const store = createStore({ a: 1, b: 'x' });
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    store.setState({ a: 2 });
    expect(store.getState()).toEqual({ a: 2, b: 'x' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores no-op patches (same state object, no notification)', () => {
    const store = createStore({ a: 1, list: [1] });
    const before = store.getState();
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    store.setState({ a: 1 });
    store.setState({});
    store.setState({ list: before.list });
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes', () => {
    const store = createStore({ a: 1 });
    const listener = vi.fn<() => void>();
    const off = store.subscribe(listener);
    off();
    store.setState({ a: 2 });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('shallowEqual', () => {
  it('compares one level deep', () => {
    const arr = [1];
    expect(shallowEqual({ a: 1, arr }, { a: 1, arr })).toBe(true);
    expect(shallowEqual({ a: 1, arr: [1] }, { a: 1, arr: [1] })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual(null, {})).toBe(false);
  });
});
