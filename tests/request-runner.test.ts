import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { createRequestRunner } from '../src/lib/requestRunner';

test('focus/visibility/reconnect bursts share one pending request', async () => {
  let calls = 0;
  const committed: number[] = [];
  const runner = createRequestRunner(
    async () => {
      calls++;
      await pause(5);
      return calls;
    },
    {
      success: (value) => committed.push(value),
      failure: (error) => {
        throw error;
      },
    },
  );
  const first = runner.run();
  assert.equal(runner.run(), first);
  assert.equal(runner.run(), first);
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(committed, [1]);
});

test('a stalled SDK promise times out and can recover on the next request', async () => {
  let stalled = true;
  let failures = 0,
    settled = 0;
  const committed: string[] = [];
  const runner = createRequestRunner(
    () => (stalled ? new Promise<string>(() => {}) : Promise.resolve('recovered')),
    {
      success: (value) => committed.push(value),
      failure: () => failures++,
      settled: () => settled++,
    },
    20,
  );
  await runner.run();
  assert.equal(failures, 1);
  assert.equal(settled, 1);
  assert.equal(runner.pending, false);
  stalled = false;
  await runner.run();
  assert.deepEqual(committed, ['recovered']);
  assert.equal(settled, 2);
});

test('a cancelled account response cannot overwrite a newer account', async () => {
  let resolveOld: (value: string) => void = () => {};
  const old = new Promise<string>((resolve) => {
    resolveOld = resolve;
  });
  let first = true;
  const committed: string[] = [];
  const runner = createRequestRunner(() => (first ? old : Promise.resolve('new user')), {
    success: (value) => committed.push(value),
    failure: (error) => {
      throw error;
    },
  });
  const previous = runner.run();
  await pause(0);
  runner.cancel();
  first = false;
  await runner.run();
  resolveOld('old user');
  await previous;
  assert.deepEqual(committed, ['new user']);
});
