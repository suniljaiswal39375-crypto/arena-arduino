import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker() {
  const listeners: Record<string, (event: any) => void> = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn(), put: vi.fn().mockResolvedValue(undefined), keys: vi.fn().mockResolvedValue([]), delete: vi.fn().mockResolvedValue(true) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue(['other-cache', 'sparklab-offline-old', 'sparklab-offline-test']), delete: vi.fn().mockResolvedValue(true) };
  const claim = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn();
  const code = readFileSync('scripts/service-worker.js', 'utf8').replace('__VERSION__', 'test').replace('__PRECACHE__', '["/offline.html", "/builder"]');
  runInNewContext(code, { URL, Response, fetch, caches, self: {
    location: { origin: 'https://lab.test' }, clients: { claim },
    addEventListener: (name: string, listener: (event: any) => void) => { listeners[name] = listener; },
  } });
  function request(path: string, mode = 'navigate', headers: Record<string, string> = {}, method = 'GET') {
    const response = vi.fn();
    const waits: Promise<unknown>[] = [];
    listeners.fetch!({ request: { url: new URL(path, 'https://lab.test').href, mode, headers: new Headers(headers), method },
      respondWith: response, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    return { response, waits };
  }
  return { cache, caches, listeners, request, fetch, claim };
}

describe('offline service worker', () => {
  it('precaches atomically and deletes only its old cache on activation', async () => {
    const w = worker();
    let work: Promise<unknown> = Promise.resolve();
    const event = { waitUntil: (p: Promise<unknown>) => { work = p; } };
    w.listeners.install!(event); await work;
    expect(w.cache.addAll).toHaveBeenCalledWith(['/offline.html', '/builder']);
    w.listeners.activate!(event); await work;
    expect(w.caches.delete).toHaveBeenCalledExactlyOnceWith('sparklab-offline-old');
    expect(w.claim).toHaveBeenCalledOnce();
  });
  it.each(['/api/projects', '/api/classrooms', '/api/auth/session', '/classrooms', '/classrooms/private', '/account', 'https://external.test/builder', '/builder?_rsc=x'])('never intercepts %s', path => {
    expect(worker().request(path).response).not.toHaveBeenCalled();
  });
  it('excludes mutations, RSC payloads and arbitrary subresources', () => {
    const w = worker();
    expect(w.request('/builder', 'navigate', {}, 'POST').response).not.toHaveBeenCalled();
    expect(w.request('/builder', 'navigate', { RSC: '1' }).response).not.toHaveBeenCalled();
    expect(w.request('/private.json', 'cors').response).not.toHaveBeenCalled();
  });
  it('uses cache first for versioned app assets', async () => {
    const w = worker(); const cached = new Response('script'); w.cache.match.mockResolvedValue(cached);
    const result = w.request('/_next/static/a.js', 'cors');
    expect(await result.response.mock.calls[0]![0]).toBe(cached);
    expect(w.fetch).not.toHaveBeenCalled();
  });
  it('caches a successful document without waiting for disk', async () => {
    const w = worker(); const fresh = new Response('html'); w.fetch.mockResolvedValue(fresh);
    const result = w.request('/builder?mission=traffic-light');
    expect(await result.response.mock.calls[0]![0]).toBe(fresh);
    await Promise.all(result.waits);
    expect(w.cache.put).toHaveBeenCalledOnce();
  });
  it('does not cache errors or redirects', async () => {
    const w = worker(); w.fetch.mockResolvedValue(new Response('failed', { status: 500 }));
    await w.request('/builder').response.mock.calls[0]![0];
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it('uses the exact visited page when offline, otherwise the fallback', async () => {
    const w = worker(); w.fetch.mockRejectedValue(new Error('offline'));
    const cached = new Response('visited page');
    w.cache.match.mockResolvedValueOnce(cached);
    expect(await w.request('/missions').response.mock.calls[0]![0]).toBe(cached);
    const fallback = new Response('offline page');
    w.cache.match.mockResolvedValueOnce(undefined).mockResolvedValueOnce(fallback);
    expect(await w.request('/parts/uncached').response.mock.calls[0]![0]).toBe(fallback);
    expect(w.cache.match).toHaveBeenLastCalledWith('/offline.html');
  });
  it('does not discard network responses when cache quota is exceeded', async () => {
    const w = worker(); const fresh = new Response('ok');
    w.fetch.mockResolvedValue(fresh); w.cache.put.mockRejectedValue(new Error('quota'));
    const result = w.request('/builder');
    expect(await result.response.mock.calls[0]![0]).toBe(fresh);
    await expect(Promise.all(result.waits)).resolves.toBeDefined();
  });
});


describe('client navigation document caching', () => {
  it('fetches HTML separately from Next RSC navigation', async () => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    let task: Promise<unknown> = Promise.resolve();
    w.listeners.message!({ data: { type: 'CACHE_PAGE', url: 'https://lab.test/missions#heading' }, waitUntil: (p: Promise<unknown>) => { task = p; } });
    await task;
    expect(w.fetch).toHaveBeenCalledWith('https://lab.test/missions', { credentials: 'omit' });
    expect(w.cache.put).toHaveBeenCalledWith('https://lab.test/missions', expect.any(Response));
  });
  it.each(['https://external.test/missions', 'https://lab.test/api/secrets', 'invalid url'])('ignores unsafe cache messages: %s', url => {
    const w = worker(); const waitUntil = vi.fn();
    w.listeners.message!({ data: { type: 'CACHE_PAGE', url }, waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
  });
  it('caps extra pages without evicting the installed builder', async () => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response('html', { headers: { 'content-type': 'text/html' } }));
    w.cache.keys.mockResolvedValue([
      { url: 'https://lab.test/builder' },
      ...Array.from({ length: 83 }, (_, i) => ({ url: `https://lab.test/parts/part${i}` })),
    ]);
    let task: Promise<unknown> = Promise.resolve();
    w.listeners.message!({ data: { type: 'CACHE_PAGE', url: 'https://lab.test/missions' }, waitUntil: (p: Promise<unknown>) => { task = p; } });
    await task;
    expect(w.cache.delete).toHaveBeenCalledTimes(3);
    expect(w.cache.delete).not.toHaveBeenCalledWith({ url: 'https://lab.test/builder' });
  });
});
