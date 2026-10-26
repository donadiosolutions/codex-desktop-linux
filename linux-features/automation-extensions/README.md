# Automation extensions

Disabled-by-default product extensions for automation schedules. This feature
adds multi-time RRULE handling, eagerly exposes the `automation_update` tool,
returns machine-readable status and absence results from `mode=view`, and
enables its bundled MCP transport in each local Desktop thread. The
thread-level enablement keeps scheduled-task tools available when Desktop
adopts an already-running app server that did not receive launch-time plugin
overrides. The generated plugin configuration forwards Desktop's native app
tools pipe explicitly so an adopted app server does not depend on inheriting
the environment from the later-started GUI process. Before starting or resuming
a local thread, Desktop refreshes the installed bundled plugin transport even
when the app server supports native plugin configuration. This updates the
current socket and plugin runtime after a Desktop restart or plugin update;
unchanged transport does not trigger another configuration reload. No per-project
socket path or plugin-version override is needed.

Enable it in `linux-features/features.json` only when both product extensions
are wanted:

```json
{ "enabled": ["automation-extensions"] }
```

The feature patches current upstream webview assets and therefore may require
an update when those private bundle shapes change. Validate it with:

```bash
node --test linux-features/automation-extensions/test.js
```
