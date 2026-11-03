import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setTimeout as pause } from 'node:timers/promises';
import { AuthProvider } from '../src/hooks/useAuth';
import { DataProvider, useData } from '../src/hooks/useData';

function fixture() {
  let authEvent: (event: string, session: unknown) => void = () => {};
  let queries = 0,
    channels = 0,
    removals = 0,
    stalled = false;
  const events = new Map<string, (payload: unknown) => void>();
  const profile = { id: 'tech', role: 'technician', email: 'tech@test', full_name: 'Tech' };
  const capsule = { id: 'cap1', code: 'CAP0001', status: 'idle' };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'tech' } } }, error: null }),
      onAuthStateChange: (fn: typeof authEvent) => {
        authEvent = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from(table: string) {
      if (table !== 'profiles') queries++;
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: () => query,
        neq: () => query,
        in: () => query,
        abortSignal: () => query,
        maybeSingle: async () => ({ data: profile, error: null }),
        then: (yes: (value: unknown) => unknown, no: (error: unknown) => unknown) =>
          (stalled
            ? new Promise(() => {})
            : Promise.resolve({ data: table === 'capsules' ? [capsule] : [], error: null })
          ).then(yes, no),
      };
      return query;
    },
    rpc() {
      return client.from('readings');
    },
    channel() {
      channels++;
      const channel = {
        on: (_type: string, filter: { table: string }, fn: (payload: unknown) => void) => {
          events.set(filter.table, fn);
          return channel;
        },
        subscribe: (fn: (status: string) => void) => {
          fn('SUBSCRIBED');
          return channel;
        },
      };
      return channel;
    },
    removeChannel: async () => {
      removals++;
    },
  };
  return {
    client: client as unknown as SupabaseClient,
    counts: () => ({ queries, channels, removals }),
    stall: () => {
      stalled = true;
    },
    auth: () => authEvent('SIGNED_IN', { user: { id: 'tech' } }),
    reading: (id: number) =>
      events.get('readings')?.({
        new: { id, capsule_id: 'cap1', recorded_at: new Date(Date.now() + id).toISOString() },
      }),
  };
}
function page() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  return {
    window,
    document,
    restore() {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    },
  };
}

test('tab resume keeps the loaded workspace visible and coalesces stalled refresh signals', async () => {
  const env = page(),
    stub = fixture();
  let data!: ReturnType<typeof useData>, root: ReactTestRenderer | undefined;
  const loading: boolean[] = [];
  function Probe() {
    data = useData();
    loading.push(data.loading);
    return null;
  }
  try {
    await act(async () => {
      root = create(
        createElement(AuthProvider, {
          client: stub.client,
          children: createElement(DataProvider, {
            backend: stub.client,
            children: createElement(Probe),
          }),
        }),
      );
      await pause(20);
    });
    await act(async () => {
      await pause(20);
    });
    assert.equal(data.capsules[0]?.code, 'CAP0001');
    assert.equal(data.loading, false);
    const before = stub.counts(),
      cached = data.capsules;
    await act(async () => {
      env.document.dispatchEvent(new Event('visibilitychange'));
      env.window.dispatchEvent(new Event('focus'));
      await pause(10);
    });
    assert.equal(
      stub.counts().queries,
      before.queries,
      'Quick tab switches reuse the recent snapshot',
    );
    stub.stall();
    loading.length = 0;
    await act(async () => {
      env.document.dispatchEvent(new Event('visibilitychange'));
      env.window.dispatchEvent(new Event('focus'));
      env.window.dispatchEvent(new Event('online'));
      for (let i = 0; i < 20; i++) stub.auth();
      await pause(20);
    });
    assert.equal(
      stub.counts().queries - before.queries,
      9,
      'Only one workspace snapshot should be pending',
    );
    assert.equal(stub.counts().channels, before.channels);
    assert.equal(stub.counts().removals, before.removals);
    assert.equal(data.capsules, cached);
    assert.equal(data.loading, false);
    assert.ok(!loading.includes(true));
  } finally {
    act(() => root?.unmount());
    env.restore();
  }
});

test('hidden-tab readings stay buffered and are merged immediately on resume', async () => {
  const env = page(),
    stub = fixture();
  let data!: ReturnType<typeof useData>, root: ReactTestRenderer | undefined;
  function Probe() {
    data = useData();
    return null;
  }
  try {
    await act(async () => {
      root = create(
        createElement(AuthProvider, {
          client: stub.client,
          children: createElement(DataProvider, {
            backend: stub.client,
            children: createElement(Probe),
          }),
        }),
      );
      await pause(20);
    });
    await act(async () => {
      await pause(20);
    });
    env.document.visibilityState = 'hidden';
    await act(async () => {
      stub.reading(1);
      stub.reading(2);
      await pause(60);
    });
    assert.equal(data.readings.length, 0);
    await act(async () => {
      env.document.visibilityState = 'visible';
      env.document.dispatchEvent(new Event('visibilitychange'));
      await pause(10);
    });
    assert.deepEqual(
      data.readings.map((r) => r.id),
      [1, 2],
    );
    assert.equal(data.loading, false);
  } finally {
    act(() => root?.unmount());
    env.restore();
  }
});
