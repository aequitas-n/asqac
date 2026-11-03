import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { setTimeout as pause } from 'node:timers/promises';
import { useClock } from '../src/hooks/useClock';

test('hidden clocks stop rendering and refresh their time immediately on return', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  let now = 1000,
    displayed = 0;
  const clock = mock.method(Date, 'now', () => now);
  function Probe() {
    displayed = useClock(5);
    return null;
  }
  let root: ReturnType<typeof create> | undefined;
  try {
    act(() => {
      root = create(createElement(Probe));
    });
    act(() => {
      document.visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    now = 10_000;
    await act(async () => {
      await pause(20);
    });
    assert.equal(displayed, 1000);
    act(() => {
      document.visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(displayed, 10_000);
  } finally {
    act(() => root?.unmount());
    clock.mock.restore();
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
