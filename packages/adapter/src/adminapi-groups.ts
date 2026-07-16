/**
 * Host-coupled groups backend. Copied into the NanoClaw fork `src/`.
 * Uses in-process `dispatch(..., { caller: 'host' })` for ncl fidelity,
 * plus folder-idempotent create + initGroupFilesystem.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dispatch } from './cli/dispatch.js';
import type { ErrorCode } from './cli/frame.js';
import { GROUPS_DIR } from './config.js';
import { getAgentGroup, getAgentGroupByFolder } from './db/agent-groups.js';
import { getContainerConfig } from './db/container-configs.js';
import { initGroupFilesystem } from './group-init.js';
import { AdminHttpError, type CreateResult, type GroupRecord, type GroupsBackend } from './adminapi-http.js';

/** Map an ncl dispatch error code to an HTTP-facing status/code. */
function mapDispatchError(code: ErrorCode, message: string): Error {
  switch (code) {
    case 'not-found':
      return new AdminHttpError(404, 'not_found', message);
    case 'invalid-args':
      return new AdminHttpError(400, 'validation_error', message);
    case 'forbidden':
    case 'permission-denied':
      return new AdminHttpError(403, 'forbidden', message);
    default:
      // unknown-command / handler-error / transport-error / approval-pending →
      // unexpected for a host caller; surface as a generic 500 (router logs it).
      return new Error(message);
  }
}

/** True when `groups/<folder>/` already exists on disk (e.g. left by a prior DB-only delete). */
function folderExistsOnDisk(folder: string): boolean {
  try {
    return fs.existsSync(path.resolve(GROUPS_DIR, folder));
  } catch {
    return false;
  }
}

// getContainerConfig is synchronous today; presentGroup relies on that so it
// can stay non-async. If it ever becomes async, presentGroup must follow.
function configSummary(agentGroupId: string): Record<string, unknown> | null {
  const row = getContainerConfig(agentGroupId);
  if (!row) return null;
  return {
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    image_tag: row.image_tag,
    assistant_name: row.assistant_name,
    max_messages_per_prompt: row.max_messages_per_prompt,
    cli_scope: row.cli_scope,
  };
}

function presentGroup(group: {
  id: string;
  name: string;
  folder: string;
  created_at?: string;
  [key: string]: unknown;
}, warnings: string[] = []): GroupRecord {
  return {
    ...group,
    id: group.id,
    name: group.name,
    folder: group.folder,
    created_at: group.created_at,
    config: configSummary(group.id),
    warnings,
  };
}

async function dispatchHost(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const frame = await dispatch(
    { id: randomUUID(), command, args },
    { caller: 'host' },
  );
  if (!frame.ok) {
    const message = frame.error?.message || `command failed: ${command}`;
    throw mapDispatchError(frame.error?.code ?? 'handler-error', message);
  }
  return frame.data;
}

function isNotFound(err: unknown): boolean {
  return err instanceof AdminHttpError && err.status === 404;
}

export function createHostGroupsBackend(): GroupsBackend {
  return {
    async list() {
      const data = (await dispatchHost('groups-list')) as Array<{
        id: string;
        name: string;
        folder: string;
        created_at?: string;
      }>;
      return (data ?? []).map((g) => presentGroup(g));
    },

    async get(id: string) {
      try {
        const data = (await dispatchHost('groups-get', { id })) as {
          id: string;
          name: string;
          folder: string;
          created_at?: string;
        };
        return presentGroup(data);
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async create(body): Promise<CreateResult> {
      // Idempotent reuse of an existing DB row is benign — the group already
      // owns its filesystem.
      const existing = getAgentGroupByFolder(body.folder);
      if (existing) {
        initGroupFilesystem(existing);
        return { group: presentGroup(existing, []), created: false };
      }

      // No DB row yet. If `groups/<folder>/` still exists on disk (DELETE is
      // DB-cascade only) the new group would inherit the old CLAUDE.local.md /
      // memory. We surface that via a warning rather than silently adopting it.
      const staleData = folderExistsOnDisk(body.folder);

      const args: Record<string, unknown> = {
        name: body.name,
        folder: body.folder,
      };
      if (body.template) args.template = body.template;

      let created: { id: string; name: string; folder: string; created_at?: string };
      try {
        created = (await dispatchHost('groups-create', args)) as typeof created;
      } catch (err) {
        // TOCTOU: a concurrent create won the race between our folder check and
        // dispatch. Treat as idempotent reuse instead of a spurious 409/500.
        const raced = getAgentGroupByFolder(body.folder);
        if (raced) {
          initGroupFilesystem(raced);
          return { group: presentGroup(raced, []), created: false };
        }
        throw err;
      }

      const group = getAgentGroup(created.id) ?? getAgentGroupByFolder(body.folder) ?? created;
      initGroupFilesystem(group as Parameters<typeof initGroupFilesystem>[0]);
      const refreshed = getAgentGroup(group.id) ?? group;
      const warnings = staleData ? ['folder_reused_with_existing_data'] : [];
      return { group: presentGroup(refreshed as typeof created, warnings), created: true };
    },

    async update(id, body) {
      const data = (await dispatchHost('groups-update', { id, name: body.name })) as {
        id: string;
        name: string;
        folder: string;
        created_at?: string;
      };
      return presentGroup(data);
    },

    async delete(id) {
      return dispatchHost('groups-delete', { id });
    },

    async getConfig(id) {
      try {
        return (await dispatchHost('groups-config-get', { id })) as Record<string, unknown>;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async updateConfig(id, body) {
      const allowed = [
        'provider',
        'model',
        'effort',
        'image_tag',
        'assistant_name',
        'max_messages_per_prompt',
        'cli_scope',
      ] as const;
      const args: Record<string, unknown> = { id };
      for (const key of allowed) {
        if (body[key] !== undefined) args[key] = body[key];
      }
      return (await dispatchHost('groups-config-update', args)) as Record<string, unknown>;
    },

    async restart(id, opts) {
      const args: Record<string, unknown> = { id };
      if (opts?.rebuild) args.rebuild = true;
      return dispatchHost('groups-restart', args);
    },
  };
}
