import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimAssetRecovery, watchContextLoss } from '../src/lib/runtimeRecovery';

test('stale deployment chunk recovery is limited to one reload per cooldown', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  assert.equal(claimAssetRecovery(storage, 1000), true);
  assert.equal(claimAssetRecovery(storage, 2000), false);
  assert.equal(claimAssetRecovery(storage, 122000), true);
});

test('blocked storage disables automatic reload rather than creating a loop', () => {
  const storage = {
    getItem: () => {
      throw Error('Storage blocked');
    },
    setItem: () => {},
  };
  assert.equal(claimAssetRecovery(storage), false);
});

test('WebGL context loss is contained and its listener cleans up', () => {
  const canvas = new EventTarget();
  let losses = 0;
  const dispose = watchContextLoss(canvas, () => losses++);
  const event = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(losses, 1);
  dispose();
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert.equal(losses, 1);
});
