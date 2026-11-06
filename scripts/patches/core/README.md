# Core patch registry

OpenAI's official Linux package is the compatibility baseline. The registry
contains only required compatibility patches for reproduced mandatory failures
in the current signed stable package.

Product extensions and measured workarounds belong in disabled-by-default
`linux-features/<id>/` directories. A new core descriptor is allowed only when
the current signed official package cannot pass a mandatory launch/work smoke
test without it. Every descriptor needs reproduction evidence and a required
regression test. Remove the patch, its tests, and this record when upstream
resolves the blocker.

The current signed stable package, 26.1103.31037, needs no core patches.
The registry is empty.

Its Linux quit handler proceeds directly to window cleanup without displaying
an unparented confirmation dialog. Shell environment loading starts after the
awaited Electron `app.whenReady()` checkpoint, avoiding the earlier startup
ordering that required a Linux event-loop deferral. The signed-bundle tests in
`upstream/test.js` verify both upstream behaviors without launching Electron.
