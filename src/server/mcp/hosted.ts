import { resolve } from 'node:path';
import { handleMcpMessage } from '@/lib/cli/mcp';

/**
 * The hosted MCP transport (spec §12.7/§17): the same tool surface as
 * `sparklab-cli mcp`, served over HTTP for agents that are not on the
 * student's machine. Two rules define it:
 *
 *  - **Auth is not optional.** A local stdio server was spawned by the user's
 *    own host and needs no token; a network endpoint does. Without
 *    `SPARKLAB_CLI_TOKEN` configured the endpoint is disabled (503), and with
 *    it configured every request must present `Authorization: Bearer <token>`.
 *  - **The token principal only sees the project tree.** All path arguments
 *    resolve inside `SPARKLAB_MCP_ROOT` (default: the server's cwd) via the
 *    sandbox in `lib/cli/mcp.ts`; an escape is a tool error, not a traversal.
 *
 * Transport shape: one JSON-RPC message per POST (the MCP streamable-HTTP
 * "single JSON response" mode). Notifications get 202 with an empty body,
 * exactly as the stdio transport stays silent.
 */

export interface HostedMcpEnv {
  SPARKLAB_CLI_TOKEN?: string;
  SPARKLAB_MCP_ROOT?: string;
}

const MAX_BODY_BYTES = 64 * 1024;

function json(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export async function handleHostedMcpRequest(
  request: Request,
  env: HostedMcpEnv = {},
  now: () => number = Date.now,
): Promise<Response> {
  void now; // reserved for request-id/latency logging; no prompt or path content is ever logged
  const token = env.SPARKLAB_CLI_TOKEN?.trim();
  if (!token) {
    return json(503, {
      error: 'mcp-not-configured',
      message:
        'Hosted MCP needs SPARKLAB_CLI_TOKEN. For local use run `sparklab-cli mcp` (stdio, no token, zero config).',
    });
  }

  const auth = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || match[1]!.trim() !== token) {
    return json(401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
  }

  if (request.method !== 'POST') {
    return json(405, { error: 'method-not-allowed', message: 'POST one JSON-RPC message.' }, { allow: 'POST' });
  }

  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    return json(413, { error: 'request-too-large' });
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return json(400, { error: 'unreadable-body' });
  }
  if (text.length > MAX_BODY_BYTES) {
    return json(413, { error: 'request-too-large' });
  }

  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }

  const root = env.SPARKLAB_MCP_ROOT && env.SPARKLAB_MCP_ROOT.trim() !== '' ? env.SPARKLAB_MCP_ROOT : process.cwd();
  const cwd = resolve(root);
  const response = handleMcpMessage(message, cwd);
  if (response === null) return new Response(null, { status: 202 });
  return new Response(`${response}\n`, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
