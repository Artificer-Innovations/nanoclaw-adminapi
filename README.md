# nanoclaw-adminapi

MIT npm package that adds a **token-authenticated HTTP admin API** to a NanoClaw host for managing **agent groups** (create / list / get / update / delete + config + restart), without baking logic into NanoClaw core.

Installable like [`nanoclaw-webchat`](https://github.com/Artificer-Innovations/nanoclaw-webchat): independent package + `/add-adminapi` skill + thin host reach-in.

## Why

NanoClaw’s official admin surface is `ncl` over a Unix socket. There is no HTTP admin API in core. This package closes that gap for remote control planes and automation.

## Install

```bash
pnpm add nanoclaw-adminapi
pnpm exec nanoclaw-adminapi install
pnpm run build
# restart host
```

See [QUICKSTART.md](QUICKSTART.md).

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `ADMINAPI_ENABLED` | `false` | Master switch (install scaffolds `false` — fail closed) |
| `ADMINAPI_TOKEN` | _(required if enabled)_ | Bearer secret (constant-time compared) |
| `ADMINAPI_BIND` | `127.0.0.1` | Listen address |
| `ADMINAPI_PORT` | `3210` | Standalone listener port |
| `ADMINAPI_BASE_PATH` | `/internal/admin` | URL prefix |
| `ADMINAPI_HEALTH_PUBLIC` | `false` | Serve `GET /health` unauthenticated (LB/proxy probes) |

## API sketch

```http
GET    /internal/admin/health
GET    /internal/admin/groups
POST   /internal/admin/groups
GET    /internal/admin/groups/:id
PATCH  /internal/admin/groups/:id
DELETE /internal/admin/groups/:id
GET    /internal/admin/groups/:id/config
PATCH  /internal/admin/groups/:id/config
POST   /internal/admin/groups/:id/restart
```

Normative details: [api-contract.md](api-contract.md).

## Security

Defaults bind localhost and require a token. Treat the token as root-equivalent for agent lifecycle. See [SECURITY.md](SECURITY.md).

## CLI

```bash
nanoclaw-adminapi install
nanoclaw-adminapi upgrade
nanoclaw-adminapi sync-skill
nanoclaw-adminapi verify
nanoclaw-adminapi uninstall
```

## Development

```bash
pnpm install
pnpm run test:unit
pnpm run build
pnpm run test:integration
```

## License

MIT © Artificer Innovations, LLC
