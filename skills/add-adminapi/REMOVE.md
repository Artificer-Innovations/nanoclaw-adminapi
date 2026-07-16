# Remove nanoclaw-adminapi

```bash
pnpm exec nanoclaw-adminapi uninstall
pnpm remove nanoclaw-adminapi
pnpm run build
# restart host
```

The uninstall command removes:

- Copied adapter files under `src/adminapi*.ts`
- The `startAdminApi()` boot block in `src/index.ts`
- Scaffolded `.env` keys: `ADMINAPI_ENABLED`, `ADMINAPI_PORT`, `ADMINAPI_TOKEN`

It does **not** remove:

- Other `ADMINAPI_*` keys you added manually
- `.claude/skills/add-adminapi/` (delete manually if desired)
- Agent groups created via the API
