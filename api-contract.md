# API Contract — nanoclaw-adminapi

Normative REST contract for `nanoclaw-adminapi` v0.1.

## Auth

- Header: `Authorization: Bearer <token>`
- Env: `ADMINAPI_TOKEN` or `NANOCLAW_ADMINAPI_TOKEN`
- Missing/wrong token → `401` with `{ "error": "unauthorized", "message": "..." }`
- When `ADMINAPI_ENABLED` is truthy and token is unset, the API **refuses to start**

All endpoints under the base path (including `/health`) require a valid bearer token.

## Base path

Default: `/internal/admin`  
Override: `ADMINAPI_BASE_PATH`

Standalone listener defaults: bind `127.0.0.1`, port `3210` (`ADMINAPI_BIND`, `ADMINAPI_PORT`).

## Error shape

```json
{ "error": "machine_code", "message": "human readable" }
```

Common statuses: `400`, `401`, `404`, `409`, `500`.

## Endpoints

### `GET /health`

Liveness. Token required.

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
- If a group with the same `folder` already exists, returns that group (after ensuring filesystem/config init) with `200`/`201` semantics as implemented (`201` on create path)
- Always runs `initGroupFilesystem` after create/reuse
- `folder` is immutable after create

Response includes `warnings` (array; may be empty). v1 may include `wiring_sync_skipped` when webchat sync is not available.

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
