# Changelog

## 0.1.2

### Patch Changes

- [#4](https://github.com/Artificer-Innovations/nanoclaw-adminapi/pull/4) [`224818b`](https://github.com/Artificer-Innovations/nanoclaw-adminapi/commit/224818b88e96318d46d37dc4c73662cb7315dac7) Thanks [@ZappoMan](https://github.com/ZappoMan)! - Fix dispatch error mapping against real NanoClaw hosts: drop the nonexistent `not-found` / `permission-denied` codes (which broke host `tsc` and left the 404 path dead), and map `handler-error` messages containing "not found" to HTTP 404 so group get/config miss paths work. `mapDispatchError` now lives in `adminapi-http.ts` with a mirrored `NclErrorCode` union so it is typechecked and unit-tested in this repo. Supersedes the earlier `fix-dispatch-error-code-compat` changeset.

## 0.1.1

### Patch Changes

- Add GitHub Releases parity with nanoclaw-webchat: release workflow now tags `vX.Y.Z` and creates a GitHub Release from CHANGELOG after npm publish.

## 0.1.0

### Minor Changes

- Initial release: token-authenticated HTTP façade over `ncl groups` with CLI install skill (`install` / `upgrade` / `sync-skill` / `verify` / `uninstall`).
