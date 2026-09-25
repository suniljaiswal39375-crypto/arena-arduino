import { describe, expect, it } from 'vitest';
import { handleHostedMcpRequest, type HostedMcpEnv } from './hosted';

/**
 * The hosted transport: same protocol as stdio, plus the two things a
 * network endpoint owes its operator — a token gate and a filesystem
 * sandbox. Tests build real Requests and inspect real Responses.
 */

const TOKEN_ENV: HostedMcpEnv = { SPARKLAB_CLI_TOKEN: 'sekrit-token' };

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://lab.example/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sekrit-token', ...headers },
    body,
  });
}

async function jsonOf(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const text = await res.text();
  return { status: res.status, body: text.trim() === '' ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

describe('hosted MCP auth', () => {
  it('stays disabled without a configured token, whatever the request carries', async () => {
    const res = await handleHostedMcpRequest(post('{}', { authorization: 'Bearer x' }), {});
    const { status, body } = await jsonOf(res);
    expect(status).toBe(503);
    expect(body.error).toBe('mcp-not-configured');
    expect(String(body.message)).toMatch(/sparklab-cli mcp/);
  });

  it('rejects missing, malformed and wrong bearer tokens with 401', async () => {
    const noAuth = await handleHostedMcpRequest(new Request('https://x/mcp', { method: 'POST', body: '{}' }), TOKEN_ENV);
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('www-authenticate')).toBe('Bearer');
    const badScheme = await handleHostedMcpRequest(post('{}', { authorization: 'Basic sekrit-token' }), TOKEN_ENV);
    expect(badScheme.status).toBe(401);
    const wrong = await jsonOf(await handleHostedMcpRequest(post('{}', { authorization: 'Bearer nope' }), TOKEN_ENV));
    expect(wrong.status).toBe(401);
  });
});

describe('hosted MCP transport semantics', () => {
  it('answers requests over POST and returns one JSON body', async () => {
    const res = await handleHostedMcpRequest(
      post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })),
      TOKEN_ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe('sparklab-cli');
  });

  it('returns 202 empty for notifications, like stdio silence', async () => {
    const res = await handleHostedMcpRequest(
      post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })),
      TOKEN_ENV,
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('refuses other methods and malformed frames at the HTTP boundary', async () => {
    expect((await handleHostedMcpRequest(new Request('https://x/mcp', { method: 'GET', headers: { authorization: 'Bearer sekrit-token' } }), TOKEN_ENV)).status).toBe(405);
    const parse = await jsonOf(await handleHostedMcpRequest(post('not json'), TOKEN_ENV));
    expect(parse.status).toBe(400);
    expect((parse.body.error as { code: number }).code).toBe(-32700);
  });

  it('rejects oversized bodies with 413', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70 * 1024) } });
    expect((await handleHostedMcpRequest(post(big), TOKEN_ENV)).status).toBe(413);
  });
});

describe('the hosted sandbox', () => {
  it('confines path arguments to SPARKLAB_MCP_ROOT', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'mcp-root-'));
    const inside = join(root, 'proj');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(inside);
    writeFileSync(join(inside, 'diagram.json'), '{"version":1,"parts":[],"connections":[]}');

    const call = (path: string): Request =>
      post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'load_project', arguments: { path } } }));

    // Inside the root: works.
    const good = await jsonOf(
      await handleHostedMcpRequest(call(inside), { ...TOKEN_ENV, SPARKLAB_MCP_ROOT: root }),
    );
    expect(good.status).toBe(200);
    const summary = JSON.parse((good.body.result as { content: Array<{ text: string }> }).content[0]!.text) as { name: string };
    expect(summary.name).toBe('proj');

    // Outside the root: a tool error, never the machine.
    const bad = await jsonOf(await handleHostedMcpRequest(call('/etc'), { ...TOKEN_ENV, SPARKLAB_MCP_ROOT: root }));
    const payload = JSON.parse((bad.body.result as { content: Array<{ text: string }>; isError?: boolean }).content[0]!.text) as { error: string };
    expect((bad.body.result as { isError?: boolean }).isError).toBe(true);
    expect(payload.error).toMatch(/escapes the project root/);
  });
});
