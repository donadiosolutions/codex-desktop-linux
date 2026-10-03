# Subagent Model Metadata

This opt-in feature preserves a child agent's configured model and reasoning
effort through summary caching. It repairs blank cached metadata from the
child's fields or a metadata-only read, and prevents an empty model inferred
from a historical turn from replacing a known model. It does not infer values
from the parent or a default. A null effort is valid. This configured metadata
is not per-turn execution telemetry.

## Enable

Append `subagent-model-metadata` to the existing `enabled` array in the
gitignored `linux-features/features.json`, preserving its other entries, then
rebuild and reinstall:

```bash
make install-native
```

The feature is disabled by default.

## Test

```bash
node --test linux-features/subagent-model-metadata/test.js
```
