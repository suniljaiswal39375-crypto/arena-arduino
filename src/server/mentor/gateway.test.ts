import { describe, expect, it } from 'vitest';
import { handleMentorRequest, IpRateLimiter, mentorRateConfig } from './gateway';

/**
 * The hosted path is opt-in; these tests prove every failure degrades to an
 * honest status the client can fall back from, and that the tool contract is
 * enforced on the server side too.
 */

const ENV_WITH_KEY = { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' };

function mentorRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/mentor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function providerJson(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
  });
}

const validBody = {
  message: 'why is my LED dark?',
  history: [],
  context: { locale: 'en', mission: null, diagnosticCodes: [], partTypes: ['arduino-uno'] },
};

describe('server mentor gateway', () => {
  it('answers 503 mentor-not-configured without a key', async () => {
    const res = await handleMentorRequest(mentorRequest(validBody), { env: {} });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'mentor-not-configured' });
  });

  it('forwards to an OpenAI-compatible endpoint and validates tool calls', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured = { url: String(input), init: init ?? {} };
      return providerJson({
        reply: 'Check the LED orientation.',
        plan: 'I will ask for a diagnostic run.',
        calls: [
          { tool: 'readDiagnostics' },
          { tool: 'runSimulation', ms: 1000 },
          { tool: 'totallyMadeUp' }, // dropped server-side
          { tool: 'placePart', part: 42 }, // dropped: fails the contract
        ],
      });
    };
    const res = await handleMentorRequest(mentorRequest(validBody), { env: ENV_WITH_KEY, fetchImpl });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; calls: Array<{ tool: string }> };
    expect(body.reply).toMatch(/LED/);
    expect(body.calls.map((c) => c.tool)).toEqual(['readDiagnostics', 'runSimulation']);
    expect((captured as unknown as { url: string }).url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('honours OPENAI_BASE_URL for any compatible provider', async () => {
    let url = '';
    const fetchImpl: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
      url = String(input);
      return providerJson({ reply: 'ok', calls: [] });
    };
    await handleMentorRequest(mentorRequest(validBody), {
      env: { ...ENV_WITH_KEY, OPENAI_BASE_URL: 'https://llm.school.example/v1/' },
      fetchImpl,
    });
    expect(url).toBe('https://llm.school.example/v1/chat/completions');
  });

  it('returns honest 502s for provider failures and unparseable answers', async () => {
    const boom: typeof fetch = async (): Promise<Response> => {
      throw new TypeError('network down');
    };
    const net = await handleMentorRequest(mentorRequest(validBody), { env: ENV_WITH_KEY, fetchImpl: boom });
    expect(net.status).toBe(502);
    expect(((await net.json()) as { error: string }).error).toBe('model-unreachable');

    const http500: typeof fetch = async (): Promise<Response> => new Response('nope', { status: 500 });
    const provider = await handleMentorRequest(mentorRequest(validBody), { env: ENV_WITH_KEY, fetchImpl: http500 });
    expect(provider.status).toBe(502);

    const garbage: typeof fetch = async (): Promise<Response> => providerJson('this is not json at all {');
    const unparseable = await handleMentorRequest(mentorRequest(validBody), { env: ENV_WITH_KEY, fetchImpl: garbage });
    expect(unparseable.status).toBe(502);
  });

  it('rejects invalid and oversized requests before touching the provider', async () => {
    const noCalls = { fetchImpl: (async (): Promise<Response> => providerJson({ reply: 'hi', calls: [] })) as typeof fetch };
    const bad = await handleMentorRequest(mentorRequest({ message: '' }), { env: ENV_WITH_KEY, ...noCalls });
    expect(bad.status).toBe(400);
    const huge = await handleMentorRequest(mentorRequest({ ...validBody, message: 'x'.repeat(33 * 1024) }), {
      env: ENV_WITH_KEY,
      ...noCalls,
    });
    expect(huge.status).toBe(413);
    const notJson = await handleMentorRequest(
      new Request('http://localhost/api/mentor', { method: 'POST', body: 'not json', headers: { 'Content-Type': 'application/json' } }),
      { env: ENV_WITH_KEY, ...noCalls },
    );
    expect(notJson.status).toBe(400);
  });

  it('rate limits per client IP', async () => {
    const limiter = new IpRateLimiter(2, 3_600_000);
    const noCalls = { fetchImpl: async (): Promise<Response> => providerJson({ reply: 'hi', calls: [] }), limiter };
    const ok1 = await handleMentorRequest(mentorRequest(validBody, { 'x-forwarded-for': '10.0.0.1' }), {
      env: ENV_WITH_KEY,
      ...noCalls,
    });
    const ok2 = await handleMentorRequest(mentorRequest(validBody, { 'x-forwarded-for': '10.0.0.1' }), {
      env: ENV_WITH_KEY,
      ...noCalls,
    });
    const blocked = await handleMentorRequest(mentorRequest(validBody, { 'x-forwarded-for': '10.0.0.1' }), {
      env: ENV_WITH_KEY,
      ...noCalls,
    });
    expect(ok1.status).toBe(200);
    expect(ok2.status).toBe(200);
    expect(blocked.status).toBe(429);
    // A different client is a different bucket.
    const other = await handleMentorRequest(mentorRequest(validBody, { 'x-forwarded-for': '10.0.0.2' }), {
      env: ENV_WITH_KEY,
      ...noCalls,
    });
    expect(other.status).toBe(200);
  });

  it('reads the classroom ceiling from env with a safe default', () => {
    expect(mentorRateConfig({})).toEqual({ max: 60, windowMs: 3_600_000 });
    expect(mentorRateConfig({ MENTOR_RATE_LIMIT_PER_HOUR: '120' }).max).toBe(120);
    expect(mentorRateConfig({ MENTOR_RATE_LIMIT_PER_HOUR: '-5' }).max).toBe(60);
  });
});
