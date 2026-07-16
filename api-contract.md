# API Contract — nanoclaw-adminapi

Normative REST contract for `nanoclaw-adminapi` v0.1.

## Auth

- Header: `Authorization: Bearer <token>`
- Env: `ADMINAPI_TOKEN` or `NANOCLAW_ADMINAPI_TOKEN`
- The token is compared in constant time (`crypto.timingSafeEqual`)
- Missing/wrong token → `401` with `{ "error": "unauthorized", "message": "..." }`
- When `ADMINAPI_ENABLED` is truthy and token is unset, the API **refuses to start**

All endpoints under the base path require a valid bearer token, except `GET /health` when `ADMINAPI_HEALTH_PUBLIC=true` (see below).

## Base path

Default: `/internal/admin`  
Override: `ADMINAPI_BASE_PATH`

Standalone listener defaults: bind `127.0.0.1`, port `3210` (`ADMINAPI_BIND`, `ADMINAPI_PORT`).

## Limits

- Request bodies larger than **1 MB** are rejected with `413 payload_too_large`.
- Idle/slow connections are dropped after a 30s request timeout.

## Error shape

```json
{ "error": "machine_code", "message": "human readable" }
```

Common statuses: `400`, `401`, `404`, `409`, `413`, `500`.

`500` responses always return a generic `{ "error": "internal_error", "message": "Internal server error" }`; the underlying detail is logged host-side and never sent to the caller.

## Endpoints

### `GET /health`

Liveness.

- Default: token required (same as every other route).
- With `ADMINAPI_HEALTH_PUBLIC=true`: served unauthenticated (200-only), so reverse-proxy/LB probes don't need the root-equivalent token.

```json
{ "ok": true }
```

### `GET /groups`

Maps to `ncl groups list`. Returns an array of group objects. Each item may include a `config` summary when available:

```json
[
  {
    "id": "ag-…",
    "name": "Support",
    "folder": "support",
    "created_at": "…",
    "config": {
      "provider": "claude",
      "model": "…",
      "effort": null,
      "image_tag": null,
      "assistant_name": null,
      "max_messages_per_prompt": null,
      "cli_scope": "group"
    },
    "warnings": []
  }
]
```

### `GET /groups/:id`

Maps to `ncl groups get`. `404` if missing.

### `POST /groups`

Maps to `ncl groups create`, with **folder idempotency** and filesystem init.

Request:

```json
{ "name": "Support", "folder": "support", "template": "optional-template-id" }
```

- `name` and `folder` required
- **`201 Created`** when a new group is created
- **`200 OK`** when a group with the same `folder` already exists (idempotent reuse) — the existing group is returned after ensuring filesystem/config init
- Always runs `initGroupFilesystem` after create/reuse
- `folder` is immutable after create

**Concurrency:** two simultaneous creates for the same new `folder` race between the existence check and the underlying create. The loser detects the winner's row and returns it as idempotent reuse (`200`) rather than erroring; callers may still retry safely.

**Recreate warning:** `DELETE` is DB-cascade only, so `groups/<folder>/` survives on disk. Creating a group on a folder whose directory still exists (e.g. after deleting the previous group) makes the new group inherit the old `CLAUDE.local.md` / memory. The response `warnings` array includes `folder_reused_with_existing_data` in that case. Remove the on-disk directory first if you want a clean group.

Response includes `warnings` (array; may be empty).

### `PATCH /groups/:id`

Maps to `ncl groups update`. Body: `{ "name": "…" }` only.  
Sending `folder` → `400` `immutable_folder`.

### `DELETE /groups/:id`

Maps to `ncl groups delete`.

**Caveat:** DB cascade only. Does **not** kill running containers or delete `groups/<folder>/` or session dirs on disk.

### `GET /groups/:id/config`

Maps to `ncl groups config get`.

### `PATCH /groups/:id/config`

Maps to `ncl groups config update`. Allowed scalars:

- `provider`
- `model`
- `effort`
- `image_tag`
- `assistant_name`
- `max_messages_per_prompt`
- `cli_scope`

Config changes typically require `POST .../restart` to take effect in running containers.

### `POST /groups/:id/restart`

Maps to `ncl groups restart`. Optional body: `{ "rebuild": true }`.

## Trust model

The HTTP admin API is a **host-trusted** surface (equivalent to running `ncl` on the host). Token-authenticated calls do **not** go through container approval cards. See [SECURITY.md](SECURITY.md).
