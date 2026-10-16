# Linux performance workarounds

Disabled-by-default GUI workarounds for machines where feature synchronization,
sidebar scrolling, app-shell tab layout, or streaming Markdown animations regress.
Enable only after a measured problem on the official Linux runtime.

Feature synchronization remembers successfully applied flags per host connection
and serializes in-flight writes. Unchanged flags skip the server request, avoiding
its reload of every loaded thread. Failed sends remain retryable, changed flags
are applied in order, and reconnecting clears the cache. Upstream readiness checks,
completion notifications, and rollout compression remain in place.

The current tab workaround follows the redesigned app-shell owner: it disables
the collapsed mount animation and schedules the tab-label overflow read on the
next animation frame. Its semantic matcher requires exactly one coherent mount
and measurement contract and skips duplicate, mixed, partial, or drifted owners.

Enable it in `linux-features/features.json` only for a reproduced regression:

```json
{ "enabled": ["linux-performance-workarounds"] }
```

These are upstream-bundle patches, not baseline compatibility code. Retest the
measured regression and run:

```bash
node --test --test-concurrency=1 linux-features/linux-performance-workarounds/test.js
```
