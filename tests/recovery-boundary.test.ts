import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { RecoveryBoundary } from '../src/components/RecoveryBoundary';

test('a page render error keeps navigation present and Retry remounts a working view', () => {
  const log = mock.method(console, 'error', () => {});
  let failed = true;
  function Page() {
    if (failed) throw Error('Temporary rendering fault');
    return createElement('p', null, 'Telemetry restored');
  }
  let root: ReturnType<typeof create> | undefined;
  try {
    act(() => {
      root = create(
        createElement(
          'div',
          null,
          createElement('nav', null, 'Navigation stays available'),
          createElement(RecoveryBoundary, { children: createElement(Page) }),
        ),
      );
    });
    assert.equal(root!.root.findByType('nav').children[0], 'Navigation stays available');
    assert.equal(root!.root.findByProps({ role: 'alert' }).type, 'section');
    failed = false;
    act(() => root!.root.findAllByType('button')[0].props.onClick());
    assert.equal(root!.root.findByType('p').children[0], 'Telemetry restored');
  } finally {
    act(() => root?.unmount());
    log.mock.restore();
  }
});
