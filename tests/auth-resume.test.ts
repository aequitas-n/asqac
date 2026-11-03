import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setTimeout as pause } from 'node:timers/promises';
import { AuthProvider, useAuth } from '../src/hooks/useAuth';

function clientStub() {
  let listener: (event: string, session: unknown) => void = () => {};
  let inCallback = false;
  let queries = 0;
  let fail = false;
  let current = 'tech';
  let load: (id: string) => Promise<unknown> = async (id) => ({
    id,
    role: 'technician',
    email: `${id}@test`,
    full_name: id,
  });
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: current } } }, error: null }),
      onAuthStateChange: (callback: typeof listener) => {
        listener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
    from: () => {
      assert.equal(inCallback, false, 'Profile query must run outside the auth callback');
      queries++;
      let id = '';
      const query = {
        select: () => query,
        eq: (_key: string, value: string) => {
          id = value;
          return query;
        },
        abortSignal: () => query,
        maybeSingle: async () => ({
          data: fail ? null : await load(id),
          error: fail ? { message: 'Network unavailable' } : null,
        }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return {
    client,
    count: () => queries,
    fail: (value: boolean) => {
      fail = value;
    },
    load: (fn: typeof load) => {
      load = fn;
    },
    emit(event: string, id: string | null = current) {
      if (id) current = id;
      inCallback = true;
      try {
        listener(event, id ? { user: { id } } : null);
      } finally {
        inCallback = false;
      }
    },
  };
}

test('returning to a tab does not reload profiles or replace an established session', async () => {
  const stub = clientStub();
  let value!: ReturnType<typeof useAuth>;
  const seen: boolean[] = [];
  function Probe() {
    value = useAuth();
    seen.push(value.loading);
    return null;
  }
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(
        createElement(AuthProvider, { client: stub.client, children: createElement(Probe) }),
      );
      await pause(15);
    });
    await act(async () => {
      await pause(15);
    });
    assert.equal(value.profile?.id, 'tech');
    assert.equal(stub.count(), 1);
    const profile = value.profile,
      user = value.user;
    seen.length = 0;
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        stub.emit('SIGNED_IN');
        stub.emit('TOKEN_REFRESHED');
      }
      await pause(15);
    });
    assert.equal(stub.count(), 1);
    assert.equal(value.profile, profile);
    assert.equal(value.user, user);
    assert.equal(value.loading, false);
    assert.ok(!seen.includes(true));
  } finally {
    act(() => root?.unmount());
  }
});

test('a transient profile failure leaves a retryable state and recovers without reloading', async () => {
  const stub = clientStub();
  stub.fail(true);
  let value!: ReturnType<typeof useAuth>;
  function Probe() {
    value = useAuth();
    return null;
  }
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(
        createElement(AuthProvider, { client: stub.client, children: createElement(Probe) }),
      );
      await pause(15);
    });
    await act(async () => {
      await pause(15);
    });
    assert.equal(value.loading, false);
    assert.match(value.error!, /connection|retry/);
    stub.fail(false);
    await act(async () => {
      value.retryProfile();
      await pause(15);
    });
    assert.equal(value.profile?.id, 'tech');
    assert.equal(value.error, null);
    assert.equal(value.loading, false);
  } finally {
    act(() => root?.unmount());
  }
});

test('changing accounts discards a late profile response from the previous user', async () => {
  const stub = clientStub();
  let oldResolve: (value: unknown) => void = () => {};
  const old = new Promise((resolve) => {
    oldResolve = resolve;
  });
  stub.load(async (id) =>
    id === 'tech' ? old : { id, role: 'doctor', email: 'doctor@test', full_name: 'Doctor' },
  );
  let value!: ReturnType<typeof useAuth>;
  function Probe() {
    value = useAuth();
    return null;
  }
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(
        createElement(AuthProvider, { client: stub.client, children: createElement(Probe) }),
      );
      await pause(15);
    });
    await act(async () => {
      stub.emit('SIGNED_IN', 'doctor');
      await pause(15);
    });
    oldResolve({ id: 'tech', role: 'technician', email: 'tech@test', full_name: 'Old' });
    await act(async () => {
      await pause(15);
    });
    assert.equal(value.user?.id, 'doctor');
    assert.equal(value.profile?.role, 'doctor');
    assert.equal(value.loading, false);
  } finally {
    act(() => root?.unmount());
  }
});

test('confirmed staff-profile removal clears the cached role instead of retaining access', async () => {
  const stub = clientStub();
  let value!: ReturnType<typeof useAuth>;
  function Probe() {
    value = useAuth();
    return null;
  }
  let root!: ReactTestRenderer;
  try {
    await act(async () => {
      root = create(
        createElement(AuthProvider, { client: stub.client, children: createElement(Probe) }),
      );
      await pause(15);
    });
    await act(async () => {
      await pause(15);
    });
    assert.equal(value.profile?.role, 'technician');
    stub.load(async () => null);
    await act(async () => {
      stub.emit('USER_UPDATED');
      await pause(15);
    });
    assert.equal(value.profile, null);
    assert.equal(value.loading, false);
    assert.match(value.error!, /no staff profile/);
  } finally {
    act(() => root?.unmount());
  }
});
