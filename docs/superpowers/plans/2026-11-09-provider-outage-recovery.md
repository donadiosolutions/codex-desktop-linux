# Provider outage recovery implementation plan

**Goal:** Continue confirmed HTTP 503 failed turns through the existing GUI
empty-turn path, with finite budgets and cancellation.

**Architecture:** Keep the existing capacity path unchanged. Add a structured
503 renderer controller and plain-data cancellation leases in the actual GUI
manager. Recheck authoritative history and unknown outcomes at native dispatch.
The built-in provider and native retry policies remain unchanged.

**Constraints:** Seven attempts, fifteen minutes, one outstanding submission;
no user-input replay or unknown-outcome bypass. Enabled by default as explicitly
requested; explicit local feature selections remain authoritative. No new
dependencies or package installation.

- [x] Verify signed official stable payload and structured error contracts.
- [x] Add deterministic controller and renderer tests before implementation.
- [x] Guard owner, host, expected failed turn, idle state and unknown submissions.
- [x] Propagate activity/lifecycle cancellation through existing GUI manager RPC.
- [x] Preserve capacity semantics and reject missing/ambiguous patch anchors.
- [x] Expose default selection and opt-out through native and Nix conventions.
- [x] Run focused/framework checks and feature-only signed-bundle build.
- [x] Address independent review findings; deliver through a signed/DCO pull request.

Review focuses on optimistic insertion, cancellation during asynchronous
preparation, duplicate renderer variants, expiry/count persistence, and explicit
empty-config behavior across package entrypoints.
