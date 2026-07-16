# Security — nanoclaw-adminapi

## Threat model (v1)

`nanoclaw-adminapi` exposes agent-group lifecycle operations over HTTP. A valid bearer token is **root-equivalent** for creating, renaming, reconfiguring, restarting, and deleting agent groups on that host.

## Defaults (fail closed)

| Control | Default |
|---------|---------|
| Master switch | `ADMINAPI_ENABLED` unset/`false` → API does not listen |
| Token | Required when enabled; missing token → **refuse to start** |
| Bind | `127.0.0.1` |
| Port | `3210` |
| Auth | Bearer token on every route including `/health` |

Never log the raw token.

## Deployment guidance

- Prefer localhost + reverse proxy with the control plane’s own auth in front
- If binding beyond localhost: require TLS and network policy; rotate tokens
- Do not put this API on the public internet with only the static bearer token

## Trust vs container CLI

- Container/`ncl` callers are approval-gated for mutating commands
- Host socket callers and this HTTP API run as **host-trusted** (no per-request approval cards)

## Delete semantics

Delete removes DB rows (cascade). Containers and on-disk group/session directories may remain — document this to operators; stronger cleanup is a later phase.
