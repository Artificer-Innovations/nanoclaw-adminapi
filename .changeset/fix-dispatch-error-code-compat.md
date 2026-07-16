---
"nanoclaw-adminapi": patch
---

Fix `adminapi-groups` dispatch error mapping to accept runtime ncl error codes (`not-found`, `permission-denied`) without importing host `ErrorCode` literals that do not exist on current NanoClaw.
