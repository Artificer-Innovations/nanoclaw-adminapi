# Security — nanoclaw-adminapi

## Threat model (v1)

`nanoclaw-adminapi` exposes agent-group lifecycle operations over HTTP. A valid bearer token is **root-equivalent** for creating, renaming, reconfiguring, restarting, and deleting agent groups on that host.

## Defaults (fail closed)

| Control | Default |
|---------|---------|
| Master switch | `ADMINAPI_ENABLED` unset/`false` → API does not listen |
| Install default | `install` scaffolds `ADMINAPI_ENABLED=false`; operator enables explicitly after reviewing exposure |
| Token | Required when enabled; missing token → **refuse to start** |
| Token compare | Constant-time (`crypto.timingSafeEqual`) |
| Bind | `127.0.0.1` |
| Port | `3210` |
| Auth | Bearer token on every route including `/health` (unless `ADMINAPI_HEALTH_PUBLIC=true`) |
| Request body | Capped at 1 MB (`413` beyond) |

Never log the raw token. Installing the package does **not** activate the API — that is a deliberate operator step.

## Error disclosure

Unexpected failures return a generic `500 internal_error` with no backend detail; the real error (which may contain DB constraint names or internal IDs) is logged host-side only. Known conditions (`400`/`401`/`403`/`404`/`409`/`413`) return specific, safe messages.

## Deployment guidance

- Prefer localhost + reverse proxy with the control plane’s own auth in front
- If binding beyond localhost: require TLS and network policy; rotate tokens
- Do not put this API on the public internet with only the static bearer token

## Trust vs container CLI

- Container/`ncl` callers are approval-gated for mutating commands
- Host socket callers and this HTTP API run as **host-trusted** (no per-request approval cards)

## Delete semantics

Delete removes DB rows (cascade). Containers and on-disk group/session directories may remain — stronger cleanup is a later phase.

Because `groups/<folder>/` survives a delete, recreating a group on the same folder makes the new group inherit the previous group's memory (`CLAUDE.local.md`, conversations). The API flags this with a `folder_reused_with_existing_data` warning on the create response; operators who want a clean group must remove the directory first.
