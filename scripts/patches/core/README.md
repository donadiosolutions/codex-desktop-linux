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

The current signed stable package, 26.1111.21308, requires no core patch.
Its quit coordinator consumes approval before prompting for pending Git review
comments, records confirmed approval, and marks accepted quits before draining.
`../runner.test.js` exercises the signed handler's approval, cancellation, and
privacy-request behavior. The obsolete `quit-confirmation-focus` repair has
been removed.

Upstream still owns shell-environment startup after awaited app readiness; no
core shell-startup patch is required.
