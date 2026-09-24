import { randomUUID } from 'node:crypto';
import type { Database } from '@/server/db/types';
import { ApiError } from './errors';
import { ClassroomService, consumeLimit, type Principal } from './service';
import { assignmentInput, classInput, classUpdate, emptyInput, joinInput, parse, resourceId, reviewInput, submissionInput } from './validation';

export const MAX_BODY_BYTES = 1_048_576;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
export const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
export interface Dependencies {
  configured: boolean;
  origin: string | null;
  database: () => Database;
  principal: () => Promise<Principal | null>;
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'json-required', 'Send an application/json body.');
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, 'too-large', 'Project uploads are limited to 1 MiB.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid-json', 'A JSON body is required.');
  let total = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'too-large', 'Project uploads are limited to 1 MiB.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid-json', 'The request body must contain valid JSON.');
  } finally { reader.releaseLock(); }
}

/** No identity, role, owner ID or student ID for writes is accepted from a browser body. */
export async function handleClassrooms(request: Request, path: string[], deps: Dependencies): Promise<Response> {
  try {
    if (!deps.configured) throw new ApiError(503, 'not-configured', 'Classroom accounts are not configured on this deployment. The local lab is still available.');
    if (!['GET', 'POST', 'PATCH'].includes(request.method)) throw new ApiError(405, 'method-not-allowed', 'This method is not supported.');
    const mutation = request.method !== 'GET';
    if (mutation && (!deps.origin || request.headers.get('origin') !== deps.origin)) throw new ApiError(403, 'origin-rejected', 'This request must come from the configured app origin.');
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'origin-rejected', 'Cross-site requests are not accepted.');
    const actor = await deps.principal();
    if (!actor) throw new ApiError(401, 'sign-in-required', 'Sign in to use classrooms.');
    const db = deps.database();
    await consumeLimit(db, actor.id, mutation ? 'write' : 'read', mutation ? 30 : 120, 60);
    const service = new ClassroomService(db);
    if (path.length === 0) {
      if (request.method === 'GET') return reply({ user: actor, classrooms: await service.list(actor) });
      if (request.method === 'POST') return reply(await service.create(actor, parse(classInput, await readJson(request)).name), 201);
    }
    if (path.length === 1 && path[0] === 'join' && request.method === 'POST') {
      await consumeLimit(db, actor.id, 'join', 10, 600);
      const input = parse(joinInput, await readJson(request));
      return reply(await service.join(actor, input.code));
    }
    if (path.length >= 1 && path.length <= 5) {
      const classId = resourceId(path[0]);
      if (path.length === 1) {
        if (request.method === 'GET') return reply(await service.detail(actor, classId));
        if (request.method === 'PATCH') return reply(await service.update(actor, classId, parse(classUpdate, await readJson(request))));
      }
      if (path.length === 2 && path[1] === 'join-code' && request.method === 'POST') {
        parse(emptyInput, await readJson(request));
        return reply(await service.rotateCode(actor, classId));
      }
      if (path[1] === 'assignments') {
        if (path.length === 2 && request.method === 'POST') return reply(await service.assign(actor, classId, parse(assignmentInput, await readJson(request))), 201);
        if (path.length >= 3) {
          const assignmentId = resourceId(path[2]);
          if (path.length === 3 && request.method === 'GET') return reply(await service.assignmentDetail(actor, classId, assignmentId));
          if (path.length === 4 && path[3] === 'submission' && request.method === 'POST') {
            const { project } = parse(submissionInput, await readJson(request));
            return reply(await service.submit(actor, classId, assignmentId, project), 201);
          }
          if (path.length === 5 && path[3] === 'submissions') {
            const studentId = resourceId(path[4]);
            if (request.method === 'GET') return reply(await service.submission(actor, classId, assignmentId, studentId));
            if (request.method === 'PATCH') return reply(await service.review(actor, classId, assignmentId, studentId, parse(reviewInput, await readJson(request))));
          }
        }
      }
    }
    throw new ApiError(404, 'not-found', 'This classroom endpoint does not exist.');
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: { code: error.code, message: error.message } }, error.status);
    const requestId = randomUUID();
    // Avoid logging SQL, emails, OAuth tokens, join codes or student project source.
    console.error('Classroom service failed', { requestId, errorName: error instanceof Error ? error.name : 'Unknown' });
    return reply({ error: { code: 'service-unavailable', message: 'Classroom storage is unavailable. Try again later.', requestId } }, 503);
  }
}
