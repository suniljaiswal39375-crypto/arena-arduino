import { handleHostedMcpRequest } from '@/server/mcp/hosted';

/**
 * POST /api/mcp — the hosted MCP transport (see src/server/mcp/hosted.ts).
 * Disabled until SPARKLAB_CLI_TOKEN is set; local agents use `sparklab-cli
 * mcp` on stdio instead, which needs no server and no token.
 */
export async function POST(request: Request): Promise<Response> {
  return handleHostedMcpRequest(request, {
    SPARKLAB_CLI_TOKEN: process.env.SPARKLAB_CLI_TOKEN,
    SPARKLAB_MCP_ROOT: process.env.SPARKLAB_MCP_ROOT,
  });
}

export async function GET(): Promise<Response> {
  return handleHostedMcpRequest(new Request('https://local/mcp', { method: 'GET' }), {
    SPARKLAB_CLI_TOKEN: process.env.SPARKLAB_CLI_TOKEN,
  });
}
