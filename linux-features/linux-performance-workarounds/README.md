# Linux performance workarounds

Disabled-by-default GUI workarounds for machines where feature synchronization,
sidebar scrolling, app-shell tab layout, or streaming Markdown animations regress.
Enable only after a measured problem on the official Linux runtime.

Chrome native-host CLI verification hashes files incrementally instead of loading
the complete executable into one Node Buffer. This preserves SHA-256 equality
checks and read failures while allowing provisioned CLI binaries larger than
2 GiB to pass reconciliation. The reproduced failure otherwise retries on focus
and prevents subsequent bundled-plugin configuration repair.

Feature synchronization remembers successfully applied flags per host connection
and serializes in-flight writes. Each uncached map first checks the server's
effective feature list, so a fresh connection also skips a write when every
requested flag is already present with the same boolean value. Missing flags,
partial listings, and discovery failures retain the original update path.
For mismatches, an additional config read recognizes explicit authoritative
feature origins that already override runtime assignments. Consistent protected
values also skip the ineffective write, preserving user preferences.
Unchanged flags skip the server write, avoiding
its reload of every loaded thread. Failed sends remain retryable, changed flags
are applied in order, and reconnecting clears the cache. Upstream readiness checks,
completion notifications, and rollout compression remain in place.

The current tab workaround follows the redesigned app-shell tab owner and
disables only its layout animation by replacing the owner's `animateLayout`
expression with `false`. Its semantic matcher requires exactly one coherent
owner correlating `animateLayout` and `animateExit` with the tab's
workspace-home state, `closeButtonTabIndex: -1`, its controller,
`dragActivator: "tab"`, and the same tab object. Missing, duplicate, mixed,
partial, or drifted owners fail closed and remain byte-identical.

Enable it in `linux-features/features.json` only for a reproduced regression:

```json
{ "enabled": ["linux-performance-workarounds"] }
```

These are upstream-bundle patches, not baseline compatibility code. Retest the
measured regression and run:

```bash
node --test --test-concurrency=1 linux-features/linux-performance-workarounds/test.js
```
