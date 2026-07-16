---
name: add-adminapi
description: Add a token-authenticated HTTP admin API for NanoClaw agent groups (CRUD + config + restart). Installs nanoclaw-adminapi and a thin host adapter.
---

# /add-adminapi — Remote Admin HTTP API

Adds a localhost HTTP façade over `ncl groups` so remote control planes and automation can manage agent groups without SSH.

See also: [QUICKSTART.md](../../QUICKSTART.md) in the npm package.

## Prerequisites

- **Node.js ≥ 20** (CI uses 22)
- **pnpm** and a working NanoClaw fork
- Host must expose `ncl` group commands (CLI socket / `dispatch`)

## Architecture

```
Remote client  --Bearer token-->  adminapi HTTP (:3210/internal/admin)
                                      |
                                      v
                               dispatch({ caller: 'host' })
                                      |
                                      v
                               ncl groups handlers + DB / filesystem
```

## Install

### Pre-flight (idempotent)

Skip to **Credentials** if all of these are already in place:

- `src/adminapi-boot.ts` and `src/adminapi.ts` exist
- `src/index.ts` contains `await startAdminApi()`
- `nanoclaw-adminapi` is listed in `package.json`

Otherwise continue. Every step below is safe to re-run.

### 0. Copy this skill (first time only)

```bash
pnpm exec nanoclaw-adminapi sync-skill
```

### 1. Install npm package

```bash
pnpm add nanoclaw-adminapi@0.1.0
```

Local monorepo:

```bash
pnpm add file:../nanoclaw-adminapi
```

### 2. Run the installer

```bash
pnpm exec nanoclaw-adminapi install
```

This will:

1. Copy adapter sources into `src/`
2. Insert the `startAdminApi()` boot block after `await startCliServer()`
3. Scaffold `.env` keys (`ADMINAPI_ENABLED`, `ADMINAPI_PORT`, `ADMINAPI_TOKEN`)
4. Sync this skill to `.claude/skills/add-adminapi/`

### 3. Build and restart

```bash
pnpm run build
# restart the NanoClaw host
pnpm exec nanoclaw-adminapi verify
```

### 4. Smoke test

```bash
source .env
curl -sS -H "Authorization: Bearer $ADMINAPI_TOKEN" \
  http://127.0.0.1:3210/internal/admin/health
```

## Credentials / security

- Default bind: `127.0.0.1` (do not expose publicly without TLS + network policy)
- Token is **root-equivalent** for agent lifecycle — treat like a host secret
- If `ADMINAPI_ENABLED=true` and token unset, the host **refuses to start** the API

## Uninstall

```bash
pnpm exec nanoclaw-adminapi uninstall
pnpm remove nanoclaw-adminapi
pnpm run build
# restart host
```

See [REMOVE.md](REMOVE.md).
