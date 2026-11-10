# Provider outage recovery

Automatically continue a conversation after a confirmed temporary provider
outage. This feature is enabled by default in a build without a local feature
configuration. An explicit `enabled` array is authoritative: add
`provider-outage-recovery` to keep it enabled, or omit it to disable it.
Rebuild after changing the selection. The native feature selector also exposes
this feature.

```json
{ "enabled": ["provider-outage-recovery"] }
```

Only structured `httpConnectionFailed` errors with HTTP status `503` qualify.
Authentication, validation, safety, other statuses and unclassified connection
or stream failures remain terminal. The upstream capacity error path and its
feature flag are unchanged.

The countdown offers Retry and Cancel automatic retry. Delays are 10, 30, 60,
120, 180, 180 and 180 seconds: at most seven continuations and 15 minutes per
outage sequence in the current GUI session. Retry counts are reconstructed from
loaded history; the elapsed timer is not persisted across a full app restart.
User activity outside the recovery controls, cancellation,
thread changes and window teardown cancel the pending countdown. Ownership,
readiness and latest failed turn are checked again before continuation.

Recovery uses the upstream follow-up context and `startEmptyTurn` path on the
same host and thread. It continues persisted conversation history with empty
input; it does not replay the failed user message, HTTP request or tool call.
An accepted continuation can still resume work, including tool execution.
A GUI submission error stops automatic recovery because its outcome may be
unknown. Native unconfirmed-submission reconciliation remains authoritative;
no continuation bypasses that guard.

The feature changes GUI JavaScript only. It does not change the built-in
`openai` provider identity, authentication, model discovery, native runtime,
provider routing, HTTP/stream/WebSocket retry policy or app-server reconnect
timers. Disabling it and rebuilding restores the upstream GUI behavior.

## Validation

```sh
node --test linux-features/provider-outage-recovery/*.test.js linux-features/provider-outage-recovery/test.js
```

The shared ASAR pipeline carries this feature into deb, RPM, pacman, AppImage
and Nix outputs. Build acceptance requires matching the semantic contracts in
all applicable renderer and manager variants. Missing or changed contracts
reject an enabled-feature build. Deterministic unit tests cover the controller,
manager dispatch guard and current bundle patching. Validated with signed official Linux `26.1103.60933` on `amd64`: a feature-only
ASAR build and execution of patched signed-source contracts with deterministic
manager/renderer state. Both renderer variants, eleven follow-up variants, and
both manager copies match and parse. Nix defaults evaluate on both supported
architectures. Interactive desktop behavior, the `arm64` bundle, and individual
distributable builds have not been exercised for this feature.
