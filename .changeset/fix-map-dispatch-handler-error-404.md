---
"nanoclaw-adminapi": patch
---

Fix dispatch error mapping against real NanoClaw hosts: drop the nonexistent `not-found` / `permission-denied` codes (which broke host `tsc` and left the 404 path dead), and map `handler-error` messages containing "not found" to HTTP 404 so group get/config miss paths work. `mapDispatchError` now lives in `adminapi-http.ts` with a mirrored `NclErrorCode` union so it is typechecked and unit-tested in this repo. Supersedes the earlier `fix-dispatch-error-code-compat` changeset.
