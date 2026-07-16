# Quickstart — nanoclaw-adminapi

Add a token-authenticated HTTP admin API to a NanoClaw fork in under 10 minutes.

## 1. Install

```bash
cd /path/to/your-nanoclaw-fork
pnpm add nanoclaw-adminapi
pnpm exec nanoclaw-adminapi install
```

Install scaffolds `.env` with a random `ADMINAPI_TOKEN` and, deliberately, `ADMINAPI_ENABLED=false` — the API is **off until you turn it on** (fail closed).

## 2. Enable (after reviewing exposure)

The install ships disabled so you can review network exposure and the generated token first. When ready:

```bash
# in your fork's .env
ADMINAPI_ENABLED=true
```

Optionally, for reverse-proxy/LB liveness probes that shouldn't carry the root token:

```bash
ADMINAPI_HEALTH_PUBLIC=true
```

## 3. Build & restart

```bash
pnpm run build
# restart your NanoClaw host process
pnpm exec nanoclaw-adminapi verify
```

## 4. Smoke test

```bash
set -a && source .env && set +a
curl -sS -H "Authorization: Bearer $ADMINAPI_TOKEN" \
  http://127.0.0.1:3210/internal/admin/health
```

Create an agent group:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMINAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Support","folder":"support"}' \
  http://127.0.0.1:3210/internal/admin/groups
```

List via HTTP and confirm with `ncl`:

```bash
curl -sS -H "Authorization: Bearer $ADMINAPI_TOKEN" \
  http://127.0.0.1:3210/internal/admin/groups
ncl groups list
```

## Upgrade

```bash
pnpm update nanoclaw-adminapi
pnpm exec nanoclaw-adminapi upgrade
pnpm run build
# restart host
```

## Uninstall

```bash
pnpm exec nanoclaw-adminapi uninstall
pnpm remove nanoclaw-adminapi
pnpm run build
# restart host
```

## Claude Code skill

```bash
pnpm exec nanoclaw-adminapi sync-skill
# then use /add-adminapi in Claude Code
```

Full contract: [api-contract.md](api-contract.md). Security notes: [SECURITY.md](SECURITY.md).
