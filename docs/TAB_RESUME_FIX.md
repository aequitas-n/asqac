# Tab-resume recovery and rendering stability

Updated 3 November 2026 IST. This change affects the frontend; the firmware, Supabase URL, telemetry cadence and clinical alert policy are unchanged.

## Failure paths found in the code

The auth handler queried the staff profile for every auth event, including repeated `SIGNED_IN` notifications for the same user on tab focus. Each result created a new profile object. The workspace depended on that object's identity, set loading again and recreated its Realtime subscription. Returning to a tab could therefore replace the loaded page with a loading view and start overlapping requests.

Profile and workspace requests had no complete deadline. A stalled SDK/session/network promise could leave loading pending. The installed Supabase auth implementation also explicitly warns about session queries inside subscriber callbacks; profile work now starts in a separate task after the callback returns.

There was no application or page error boundary. An uncaught render error or rejected lazy page import could remove the entire React tree. An already-open tab can request an older hashed page asset after a new deployment, providing a second failure path. No runtime exception trace was captured from the user's browser, so these are code-confirmed defects and failure paths rather than a claim that a specific exception was observed there.

## Changes

- Same-user focus/token events reuse the verified profile and preserve stable user/profile references. Explicit user changes, profile retry and sign-out still update access. Confirmed missing profiles clear the cached role; all operations remain protected by database RLS and role-checked RPCs.
- Initial session/profile work has a 10-second deadline. Workspace snapshots have a 12-second deadline. Selected-capsule polling has a 5-second deadline. Cancellation discards late responses from previous users; errors offer retry without clearing an already-loaded workspace.
- Focus, visibility and reconnect events share a pending refresh. Quick tab returns reuse a workspace snapshot younger than 15 seconds. Realtime reconnect and restored network access still reconcile immediately. Explicit refresh after a mutation waits for older work and requests a fresh snapshot.
- Workspace effects depend on account ID and role, rather than changing object references. Realtime subscriptions stay mounted across ordinary token refreshes and tab focus.
- Reading bursts are merged in a 40 ms window. Hidden-tab reading events are buffered, capped at 2,048 pending rows, and merged into the bounded per-capsule history on return. Other important Realtime events continue arriving. Clocks and the selected-capsule fast poll pause while hidden and resume immediately when visible; the foreground polling delay remains 500 ms after completion.
- Page-level Suspense and recovery boundaries keep navigation present while pages load or fail. A root boundary provides an actionable fallback for failures above the page. Failed deployment assets trigger at most one automatic reload within two minutes, only when online and the loop guard can be stored. Otherwise the recovery view offers manual retry/reload.
- A lost WebGL context falls back to the live 2D orientation widget, with a Restore 3D view action. The decorative contact shadow uses one low-resolution render instead of repeated shadow passes during movement.
- Realtime row updates merge with the existing record, preserving unchanged fields when an update payload is partial. Existing alert/readings reconciliation and offline-value expiry remain in place.

## Verification

All **55 tests passed**, including new React renderer tests for the actual auth and workspace providers. They verify repeated auth/focus events use one profile lookup, quick tab switching does not issue another workspace snapshot, stalled refreshes preserve the loaded page, Realtime channels are not recreated, buffered readings flush on resume, account-switch responses are discarded, confirmed profile removal revokes the cached role, and hidden clocks update immediately on return.

Additional tests cover request deduplication, timeout/retry, recovery-boundary containment and retry, asset reload-loop prevention and WebGL loss-listener cleanup. The existing database, RLS, workflow, alert, barometry and firmware-protocol tests remain passing. Strict TypeScript, the production build and the browser-bundle secret check pass.

These are non-browser tests and source/build checks. No browser inspection or physical capsule changes were performed. The changes remove the identified session/refresh churn and contain rendering failures; they do not guarantee zero Wi-Fi/cloud latency or rule out every browser-specific fault. Refresh the website once after deployment to load this version; subsequent tab returns use the recovery path above.
