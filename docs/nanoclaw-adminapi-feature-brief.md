# Feature Brief: `nanoclaw-adminapi`

**For:** Artificer Innovations, LLC  
**Date:** 2026-07-16  
**Status:** Draft for implementation  
**License:** MIT (npm + GitHub, same as `nanoclaw-webchat`)  
**Suggested package name:** `nanoclaw-adminapi`  
**Suggested repo:** `Artificer-Innovations/nanoclaw-adminapi`  
**Reference product:** [`nanoclaw-webchat`](https://github.com/Artificer-Innovations/nanoclaw-webchat) (packaging, CLI, skill, docs shape)

---

## 1. Summary

Ship a **MIT-licensed npm package** that adds a **remote HTTP admin API** to a NanoClaw host for managing **agent groups** (create / list / get / update / delete + basic container config), without baking logic into NanoClaw core.

Today NanoClaw’s official admin surface is the **`ncl` CLI over a Unix socket**. Architecture docs state there is **no HTTP admin API**. Webchat and the dashboard only **read** agent lists. Operators who run NanoClaw behind a reverse proxy (or who want a remote product or ops UI) cannot manage agents remotely without SSH/`docker exec`.

This package closes that gap the same way webchat closed the “no browser channel” gap: **independent package + install skill + thin host reach-in**, upgradeable without fighting `/update-nanoclaw`.

**Out of scope for Artificer:** Downstream product UIs, BFFs, and infrastructure (Helm, CDN, etc.). Consumers will use the published package.

---

## 2. Problem statement

| Need | Current state |
|------|----------------|
| List / create / rename / delete agents from a remote control plane | Only `ncl groups …` on `data/ncl.sock` |
| Stable HTTP contract for product UIs and automation | None (by design in core) |
| Upgrade-friendly customization | Skills model: don’t thicken fork core |

Closest prior art (all insufficient alone):

- **`ncl groups *`** — full CRUD, local socket only
- **MCP `create_agent`** — create-only, approval-gated, not a general admin HTTP API
- **`nanoclaw-webchat`** — `GET /api/bootstrap` lists agents; chat only
- **`@nanoco/nanoclaw-dashboard`** / **`add-clidash`** — read-only monitoring / CLI mirror

There is **no existing skill or package** that provides remote HTTP CRUD for agent groups. This is net-new community value.

---

## 3. Goals and non-goals

### Goals

1. Public npm package `nanoclaw-adminapi` (MIT), Node ≥ 20, ESM.
2. Install into an existing NanoClaw fork via CLI + `/add-adminapi` skill (mirror webchat).
3. Expose authenticated HTTP CRUD for **agent groups**, semantics aligned with `ncl groups`.
4. Keep NanoClaw core thin: skill **adds** files + **one-line** register; no large edits to trunk.
5. Documented `api-contract.md`, QUICKSTART, SECURITY, CHANGELOG; changesets + provenance publish like webchat.
6. Safe defaults: disabled unless enabled; token required; bind localhost by default.

### Non-goals (v1)

- Full `ncl` resource surface (wirings, roles, messaging-groups, sessions, tasks, …) — later phases OK if designed for extension.
- Browser admin SPA (optional later; downstream products may ship their own admin UI).
- Replacing `ncl` or the Unix socket.
- Changing NanoClaw upstream core (unless a tiny hook is negotiated with nanocoai).
- Downstream product integration (separate workstream).

---

## 4. Packaging model (match `nanoclaw-webchat`)

### 4.1 What ships in the package

| Piece | Purpose |
|-------|---------|
| HTTP router module | Implements `/internal/admin/...` (or agreed prefix) |
| Host adapter templates | Files copied into the fork (`src/adminapi.ts` or similar) |
| CLI bin `nanoclaw-adminapi` | `install`, `upgrade`, `sync-skill`, `verify`, `uninstall` |
| Skill `skills/add-adminapi/` | Claude Code `/add-adminapi` flow |
| `api-contract.md` | Normative REST contract |
| README / QUICKSTART / SECURITY / LICENSE (MIT) / CHANGELOG | Operator docs |

### 4.2 What the fork looks like after install

```
pnpm add nanoclaw-adminapi
pnpm exec nanoclaw-adminapi install   # or /add-adminapi
```

- Dependency in `package.json`
- Copied host module under `src/` (owned by package upgrades)
- One reach-in: e.g. `import './adminapi.js'` or `await startAdminApi()` near host boot / HTTP startup
- `.env` keys scaffolded if missing
- Skill synced to `.claude/skills/add-adminapi/`

**Do not** require operators to clone this repo beside their fork.

### 4.3 Upgrade story

```bash
pnpm update nanoclaw-adminapi
pnpm exec nanoclaw-adminapi upgrade   # re-copy adapter if needed; refresh skill
# rebuild + restart host
```

Must remain compatible with NanoClaw’s skills model ([skills-model](https://github.com/nanocoai/nanoclaw/blob/main/docs/skills-model.md)): mostly **adds**; reach-ins ≤ a few lines.

---

## 5. Architecture

```text
Remote client (product BFF / curl)
        │  Authorization: Bearer <ADMINAPI_TOKEN>
        ▼
HTTP listener (host process; default 127.0.0.1)
        │  /internal/admin/groups*
        ▼
nanoclaw-adminapi router (package code)
        │
        ▼
Same semantics as `ncl groups` handlers
  (list / get / create / update / delete / config get|update / restart)
        │
        ▼
Central DB + filesystem (groups/<folder>/, container_configs, …)
```

**Control-plane rule:** HTTP is a façade over existing group lifecycle logic. Do not invent a second create path that skips `initGroupFilesystem` / container config provisioning.

**Preferred implementation approaches (Artificer chooses; document in README):**

1. **In-process** — call the same functions the CLI resource handlers use (best fidelity; may need thin host hooks/exports).
2. **Local socket bridge** — HTTP handler execs/calls `ncl` over `data/ncl.sock` as a trusted host client (simpler isolation; must handle JSON/`--json` and errors cleanly).

Either is acceptable for v1 if behavior matches `ncl` and tests prove it.

### 5.1 Coexistence with webchat / webhooks

- Webchat often owns `:3200`. Admin API may:
  - **Mount on the same HTTP server** under `/internal/admin/*` (preferred when webchat is present), or
  - **Separate port** via `ADMINAPI_PORT` (default e.g. `3210`), bind `127.0.0.1`.
- Must not break webchat routes or static assets.
- Path prefix must be configurable (`ADMINAPI_PUBLIC_PATH` or similar) for reverse-proxy deployments.

### 5.2 Post-mutation side effects

Creating/deleting agents can leave webchat wirings stale until sync/restart (webchat installers already restart after seed). v1 **must**:

- Document the requirement, and
- Provide a hook or call to refresh wirings when webchat is installed (e.g. invoke existing sync if present, or document `ncl groups restart` / host restart).

Ideal: `POST /internal/admin/groups` returns the group **and** triggers sync when `nanoclaw-webchat` adapter is present; otherwise returns a `warnings: ["wiring_sync_skipped"]` field.

---

## 6. API contract (v1 MVP)

Normative details live in package `api-contract.md`. Sketch:

### 6.1 Auth

- Header: `Authorization: Bearer <token>`
- Env: `ADMINAPI_TOKEN` (or `NANOCLAW_ADMINAPI_TOKEN`) — required when enabled
- If enabled and token unset → **refuse to start** (fail closed)
- Missing/wrong token → `401`

### 6.2 Base path

Default: `/internal/admin`  
Optional strip/prefix for proxies.

### 6.3 Endpoints

| Method | Path | Maps to | Notes |
|--------|------|---------|--------|
| `GET` | `/internal/admin/health` | — | liveness; may be unauthenticated or token-gated (document choice; prefer token or localhost-only) |
| `GET` | `/internal/admin/groups` | `ncl groups list` | Array of groups; include basic config summary if cheap |
| `GET` | `/internal/admin/groups/:id` | `ncl groups get` | 404 if missing |
| `POST` | `/internal/admin/groups` | `ncl groups create` | Body: `{ name, folder, template? }` — idempotent on `folder` |
| `PATCH` | `/internal/admin/groups/:id` | `ncl groups update` | Body: `{ name }` only (folder immutable) |
| `DELETE` | `/internal/admin/groups/:id` | `ncl groups delete` | Document: DB cascade only; containers/disk cleanup out of scope unless improved |
| `GET` | `/internal/admin/groups/:id/config` | `ncl groups config get` | |
| `PATCH` | `/internal/admin/groups/:id/config` | `ncl groups config update` | Scalars: provider, model, effort, image_tag, assistant_name, max_messages_per_prompt, cli_scope |
| `POST` | `/internal/admin/groups/:id/restart` | `ncl groups restart` | Optional but strongly recommended in v1 |

**JSON:** `Content-Type: application/json`  
**Errors:** `{ "error": "machine_code", "message": "human readable" }` with appropriate HTTP status (`400`, `401`, `404`, `409`, `500`).

### 6.4 Example create

```http
POST /internal/admin/groups
Authorization: Bearer <token>
Content-Type: application/json

{ "name": "Support", "folder": "support" }
```

```json
{
  "id": "ag-…",
  "name": "Support",
  "folder": "support",
  "created_at": "…",
  "config": { "provider": "…", "model": "…", "…": "…" },
  "warnings": []
}
```

### 6.5 Approval model note

CLI writes from **containers** are approval-gated. Host socket callers are trusted. The HTTP admin API is a **host-trusted** surface (like running `ncl` on the host). Do **not** re-introduce per-request human approval cards for token-authenticated admin API calls in v1. Document this security model clearly in SECURITY.md.

---

## 7. Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `ADMINAPI_ENABLED` | `false` | Master switch |
| `ADMINAPI_TOKEN` | _(required if enabled)_ | Bearer secret |
| `ADMINAPI_BIND` | `127.0.0.1` | Listen address |
| `ADMINAPI_PORT` | `3210` (or mount-only mode) | Port if standalone listener |
| `ADMINAPI_BASE_PATH` | `/internal/admin` | URL prefix |

Install CLI should generate a random token hint (like webchat’s secret helper).

**Security defaults:**

- Bind localhost unless operator explicitly sets otherwise
- Never log the raw token
- Document: exposing beyond localhost requires TLS + network policy; treat token as root-equivalent for agent lifecycle

---

## 8. Skill & CLI requirements

Mirror webchat CLI verbs:

| Command | Behavior |
|---------|----------|
| `install` | Copy adapter, wire reach-in, scaffold env, sync skill |
| `upgrade` | Re-copy adapter/skill as needed after package bump |
| `sync-skill` | Refresh `.claude/skills/add-adminapi` |
| `verify` | Check files present, import works, env sanity |
| `uninstall` | Remove copied files + reach-in (document residual env) |

Skill `SKILL.md` must be idempotent and agent-applicable (Claude Code).

Integration test: prove reach-in still works against a pinned NanoClaw host fixture (webchat’s fixture pattern is a good model).

---

## 9. Testing bar

- Unit tests for router auth, validation, error mapping
- Integration tests against a minimal NanoClaw host fixture: create → list → get → rename → config patch → delete
- Idempotent create on same `folder`
- Token missing / wrong → 401
- `verify` CI job on Node 20/22

---

## 10. Documentation deliverables

1. **README** — what it is / isn’t; install; security warning
2. **QUICKSTART** — fork install in under 10 minutes
3. **api-contract.md** — normative REST
4. **SECURITY.md** — trust model, binding, token handling, “not a public internet API by default”
5. **CHANGELOG** — changesets
6. Short note for upstream docs / skills directory (optional PR to nanoclaw docs pointing at the package)

---

## 11. Phased delivery

### Phase 0 — Spike (optional, short)

Confirm in-process vs socket-bridge against current NanoClaw `groups` handlers; identify any needed host export/hook.

### Phase 1 — MVP (this brief)

- Package + skill + CLI
- Groups list/get/create/update/delete
- Config get/update (scalars)
- Restart endpoint
- Auth + localhost defaults
- api-contract + QUICKSTART + SECURITY
- Publish `0.1.0` to npm (public, MIT, provenance if matching webchat)

### Phase 2 — Hardening (recommended follow-on)

- Stronger delete cleanup (containers + `groups/<folder>` + session dirs) — align with upstream if possible
- Explicit wiring sync when webchat present
- OpenAPI/Swagger optional
- Rate limiting / audit log hook

### Phase 3 — Extended admin (optional)

- Templates list endpoint
- MCP/skills/mounts config (JSON fields)
- Read-only pass-through for sessions
- Optional minimal admin SPA (**not** required for remote product UIs)

---

## 12. Acceptance criteria (Phase 1)

1. `pnpm add nanoclaw-adminapi` + `pnpm exec nanoclaw-adminapi install` on a clean NanoClaw fork enables the API after build/restart.
2. With `ADMINAPI_ENABLED=true` and a token, curl can create an agent group and see it via `ncl groups list` and via `GET /internal/admin/groups`.
3. Create is idempotent on `folder`; folder cannot be changed via PATCH.
4. Delete removes the group from `ncl groups list` (disk/container caveats documented).
5. Unauthenticated requests fail; disabled flag leaves no open listener (or listener rejects all).
6. `/update-nanoclaw` / package upgrade path documented; adapter re-copy via `upgrade` works.
7. MIT LICENSE present; package publicly installable.
8. No requirement to edit large NanoClaw core files beyond the documented reach-in.

---

## 13. Downstream consumption (context only — not Artificer scope)

After `0.1.0`, a typical remote control plane would:

1. Add the package to a NanoClaw host image or install.
2. Inject the admin token via secrets / env.
3. Reverse-proxy a path (e.g. `/admin/nanoclaw/*`) with the control plane’s own auth → host admin API.
4. Call the HTTP contract from a product UI, ops tool, or automation client.

Artificer success is measured by the **package**, not any specific downstream UI.

---

## 14. Open questions for Artificer (resolve in kickoff)

1. **Mount vs separate port** when webchat already binds `0.0.0.0:3200` — recommendation: mount under `/internal/admin` on the same server when available; else dedicated port.
2. **In-process vs `ncl` socket bridge** — pick one for v1; keep the door open to switch.
3. **Package name bikeshed:** `nanoclaw-adminapi` vs `nanoclaw-admin-api` vs `@artificer/nanoclaw-adminapi` — prefer unscoped public name consistent with `nanoclaw-webchat` unless Artificer standard says otherwise.
4. Whether to propose a tiny upstream **hook** (e.g. `registerHttpMount`) to nanocoai to avoid any reach-in fragility.

---

## 15. References

- NanoClaw architecture (no HTTP admin): https://docs.nanoclaw.dev/concepts/architecture
- `ncl` CLI / groups: https://docs.nanoclaw.dev/reference/ncl-cli
- Skills model: NanoClaw `docs/skills-model.md`
- Reference package: https://github.com/Artificer-Innovations/nanoclaw-webchat
- `ncl` admin CLI origin: https://github.com/nanocoai/nanoclaw/pull/2350
- Read-only HTTP prior art: `add-clidash`, `@nanoco/nanoclaw-dashboard`

---

## 16. One-line pitch for the community

> **`nanoclaw-adminapi`** — MIT npm package that adds a token-authenticated HTTP façade over `ncl groups`, installable as a NanoClaw skill like webchat, so remote control planes can manage agents without SSH.
