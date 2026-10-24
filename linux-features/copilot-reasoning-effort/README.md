# Copilot Reasoning Effort Defaults

This optional Linux feature patches Codex webview bundles so Copilot-auth
sessions can persist and select reasoning effort defaults for new chats.

By default, upstream Copilot-auth paths save the model through the Copilot
preferences service, hardcode the loaded reasoning effort to `medium`, and
collapse Copilot model reasoning effort choices to one `medium` entry. This
feature keeps those changes local and opt-in instead of shipping them as a core
Linux compatibility patch.

Enable it by copying `linux-features/features.example.json` to
`linux-features/features.json` and adding the feature id:

```json
{
  "enabled": [
    "copilot-reasoning-effort"
  ]
}
```

Then rerun the install or package build so the ASAR patch step can apply the
feature to the generated app.

## What It Patches

- The official Linux `app-initial-*.js` bundle preserves the native Copilot
  model preferences service, retains the existing
  `copilot-default-reasoning-effort` global-state preference through an
  allowlisted bridge, and keeps the model's full `supportedReasoningEfforts` list.
- Separate semantic owners in `app-primary-*.js` and `composer-content-*.js`
  keep the reasoning effort controls and `/reasoning` command enabled when
  the normal model and effort prerequisites are present.

## Validation

Run the feature tests with:

```bash
node --test linux-features/copilot-reasoning-effort/test.js
```

Or run all feature tests with:

```bash
node --test linux-features/*/test.js
```

The patch is fail-soft. If the upstream minified bundle shape changes, the
build logs a warning and leaves the affected bundle unchanged.
