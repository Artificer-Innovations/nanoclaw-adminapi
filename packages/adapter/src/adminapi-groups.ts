/**
 * Host-coupled groups backend. Copied into the NanoClaw fork `src/`.
 * Uses in-process `dispatch(..., { caller: 'host' })` for ncl fidelity,
 * plus folder-idempotent create + initGroupFilesystem.
 */
import { randomUUID } from 'node:crypto';
import { dispatch } from './cli/dispatch.js';
import { getAgentGroup, getAgentGroupByFolder } from './db/agent-groups.js';
import { getContainerConfig } from './db/container-configs.js';
import { initGroupFilesystem } from './group-init.js';
import type { GroupRecord, GroupsBackend } from './adminapi-http.js';

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
    throw new Error(message);
  }
  return frame.data;
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
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes('not found')) return null;
        throw err;
      }
    },

    async create(body) {
      const existing = getAgentGroupByFolder(body.folder);
      if (existing) {
        initGroupFilesystem(existing);
        return presentGroup(existing, []);
      }

      const args: Record<string, unknown> = {
        name: body.name,
        folder: body.folder,
      };
      if (body.template) args.template = body.template;

      const created = (await dispatchHost('groups-create', args)) as {
        id: string;
        name: string;
        folder: string;
        created_at?: string;
      };

      const group = getAgentGroup(created.id) ?? getAgentGroupByFolder(body.folder) ?? created;
      initGroupFilesystem(group as Parameters<typeof initGroupFilesystem>[0]);
      const refreshed = getAgentGroup(group.id) ?? group;
      return presentGroup(refreshed as typeof created, []);
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
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes('not found')) return null;
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
