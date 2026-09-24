import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { createProject } from '@/lib/doc/factory';
import { MISSIONS as missions } from '@/lib/missions/missions';
import { ClassroomService, consumeLimit, principalFor, type Principal } from './service';
import { handleClassrooms, MAX_BODY_BYTES, readJson, type Dependencies } from './http';
import { parse, submissionInput, assignmentInput } from './validation';
import { accountsConfigured, appOrigin } from '@/server/config';
import { verifiedGoogleProfile } from '@/server/auth/policy';

const pg = new PGlite();
const db = drizzle(pg, { schema });
const teacher: Principal = { id: randomUUID(), name: 'Teacher', role: 'teacher' };
const student: Principal = { id: randomUUID(), name: 'Student', role: 'student' };
const peer: Principal = { id: randomUUID(), name: 'Peer', role: 'student' };
const stranger: Principal = { id: randomUUID(), name: 'Other teacher', role: 'teacher' };
const service = new ClassroomService(db);
const origin = 'https://lab.example';
const deps = (actor: Principal | null = teacher): Dependencies => ({ configured: true, origin, database: () => db, principal: async () => actor });
const request = (method: string, body?: unknown, from = origin) => new Request(origin + '/api/classrooms', { method, headers: { origin: from, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function fixture() {
  const classroom = await service.create(teacher, 'Grade eight');
  await service.join(student, classroom.joinCode);
  await service.join(peer, classroom.joinCode);
  const assignment = await service.assign(teacher, classroom.id, { title: 'Build a circuit', missionSlug: missions[0]!.slug, dueAt: null });
  if (!assignment) throw new Error("Assignment insert failed");
  return { classroom, assignment };
}
beforeAll(async () => { await pg.exec(readFileSync('db/migrations/0001_classrooms.sql', 'utf8')); }, 30000);
beforeEach(async () => {
  await pg.exec('TRUNCATE users, rate_limits CASCADE');
  await db.insert(schema.users).values([teacher, student, peer, stranger].map(u => ({ ...u, email: `${u.id}@example.test` })));
});
afterAll(async () => { await pg.close(); });

describe('PostgreSQL classroom permissions and lifecycle', () => {
  it('requires an operator-granted role, including a fresh database check on creation', async () => {
    await expect(service.create(student, 'Forbidden')).rejects.toMatchObject({ status: 403 });
    await db.update(schema.users).set({ role: 'student' }).where(eq(schema.users.id, teacher.id));
    expect(await principalFor(db, teacher.id)).toMatchObject({ role: 'student' });
    await expect(service.create(teacher, 'Revoked')).rejects.toMatchObject({ status: 403 });
  });
  it('joins idempotently and hides invitation codes and peer rosters from members', async () => {
    const { classroom } = await fixture();
    await service.join(student, classroom.joinCode);
    expect((await service.detail(teacher, classroom.id)).students).toHaveLength(2);
    const detail = await service.detail(student, classroom.id);
    expect(detail).not.toHaveProperty('students');
    expect(detail.classroom).not.toHaveProperty('joinCode');
    expect(await service.list(stranger)).toEqual([]);
    await expect(service.detail(stranger, classroom.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.update(student, classroom.id, { archived: true })).rejects.toMatchObject({ status: 404 });
  });
  it('rotates codes, rejects old invitations and prevents reuse of the current code', async () => {
    const { classroom } = await fixture();
    await expect(new ClassroomService(db, () => classroom.joinCode).rotateCode(teacher, classroom.id)).rejects.toMatchObject({ status: 503 });
    await service.rotateCode(teacher, classroom.id);
    await expect(service.join(stranger, classroom.joinCode)).rejects.toMatchObject({ status: 404 });
  });
  it('retries join-code collisions without leaving an aborted transaction', async () => {
    const fixed = new ClassroomService(db, () => 'ABC234');
    await fixed.create(teacher, 'First');
    const codes = ['ABC234', 'DEF567'];
    expect(await new ClassroomService(db, () => codes.shift()!).create(teacher, 'Second')).toMatchObject({ joinCode: 'DEF567' });
  });
  it('isolates snapshots, versions resubmissions and rejects stale reviews', async () => {
    const { classroom: c, assignment: a } = await fixture();
    await service.submit(student, c.id, a.id, createProject());
    expect((await service.assignmentDetail(peer, c.id, a.id)).submissions).toEqual([]);
    await expect(service.submission(peer, c.id, a.id, student.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.review(student, c.id, a.id, student.id, { version: 1, status: 'reviewed', feedback: '' })).rejects.toMatchObject({ status: 404 });
    await service.review(teacher, c.id, a.id, student.id, { version: 1, status: 'needs-work', feedback: 'Check the resistor.' });
    expect(await service.submit(student, c.id, a.id, createProject())).toMatchObject({ version: 2, feedback: '', reviewStatus: 'submitted', reviewedAt: null });
    await expect(service.review(teacher, c.id, a.id, student.id, { version: 1, status: 'reviewed', feedback: '' })).rejects.toMatchObject({ status: 409 });
    expect(await service.submission(teacher, c.id, a.id, student.id)).toHaveProperty('project');
    expect((await service.assignmentDetail(teacher, c.id, a.id)).submissions[0]).not.toHaveProperty('project');
    await expect(service.submit(teacher, c.id, a.id, createProject())).rejects.toMatchObject({ status: 403 });
  });
  it('binds assignments to their classroom and freezes archived writes', async () => {
    const { classroom: c, assignment: a } = await fixture();
    const second = await service.create(teacher, 'Second');
    await expect(service.assignmentDetail(teacher, second.id, a.id)).rejects.toMatchObject({ status: 404 });
    await service.update(teacher, c.id, { archived: true });
    await expect(service.join(stranger, c.joinCode)).rejects.toMatchObject({ status: 404 });
    await expect(service.submit(student, c.id, a.id, createProject())).rejects.toMatchObject({ status: 409 });
    expect((await service.detail(student, c.id)).classroom.archived).toBe(true);
    await service.update(teacher, c.id, { archived: false });
    await expect(service.submit(student, c.id, a.id, createProject())).resolves.toMatchObject({ version: 1 });
  });
  it('persists rate limits across callers and resets at the next window', async () => {
    const now = new Date('2026-09-24T00:00:00Z');
    await consumeLimit(db, student.id, 'join', 1, 60, now);
    await expect(consumeLimit(db, student.id, 'join', 1, 60, now)).rejects.toMatchObject({ status: 429 });
    await expect(consumeLimit(db, student.id, 'join', 1, 60, new Date(now.getTime() + 60000))).resolves.toBeUndefined();
  });
  it('enforces case-insensitive unique emails and cascading deletion in SQL', async () => {
    await db.insert(schema.users).values({ email: 'Mixed@Example.test' });
    await expect(db.insert(schema.users).values({ email: 'mixed@example.test' })).rejects.toThrow();
    await fixture();
    await db.delete(schema.users).where(eq(schema.users.id, teacher.id));
    expect(await db.select().from(schema.assignments)).toEqual([]);
    expect(await db.select().from(schema.memberships)).toEqual([]);
  });
});

describe('HTTP boundary', () => {
  it('keeps disabled and anonymous requests away from the database', async () => {
    const database = vi.fn(() => db);
    expect((await handleClassrooms(request('GET'), [], { ...deps(), configured: false, database })).status).toBe(503);
    expect((await handleClassrooms(request('GET'), [], { ...deps(null), database })).status).toBe(401);
    expect(database).not.toHaveBeenCalled();
  });
  it('rejects cross-origin mutations before authentication', async () => {
    const principal = vi.fn(async () => teacher);
    expect((await handleClassrooms(request('POST', {}, 'https://evil.example'), [], { ...deps(), principal })).status).toBe(403);
    expect(principal).not.toHaveBeenCalled();
  });
  it('creates, joins, assigns, submits and reviews through the real controller', async () => {
    const created = await handleClassrooms(request('POST', { name: 'Class' }), [], deps());
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toContain('no-store');
    const c = await created.json();
    expect((await handleClassrooms(request('POST', { code: c.joinCode }), ['join'], deps(student))).status).toBe(200);
    const task = await handleClassrooms(request('POST', { title: 'Mission', missionSlug: missions[0]!.slug }), [c.id, 'assignments'], deps());
    expect(task.status).toBe(201);
    const a = await task.json();
    expect((await handleClassrooms(request('POST', { project: createProject() }), [c.id, 'assignments', a.id, 'submission'], deps(student))).status).toBe(201);
    expect((await handleClassrooms(request('PATCH', { version: 1, status: 'reviewed', feedback: 'Good work' }), [c.id, 'assignments', a.id, 'submissions', student.id], deps())).status).toBe(200);
  });
  it.each([{ name: 'Class', role: 'teacher' }, { name: 'Class', ownerId: student.id }, { name: '' }])('rejects untrusted fields: %j', async body => {
    expect((await handleClassrooms(request('POST', body), [], deps())).status).toBe(400);
  });
  it('bounds actual request bytes even without Content-Length', async () => {
    await expect(readJson(request('POST', { value: 'a'.repeat(MAX_BODY_BYTES) }))).rejects.toMatchObject({ status: 413 });
    await expect(readJson(new Request(origin, { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } }))).rejects.toMatchObject({ status: 400 });
    await expect(readJson(new Request(origin, { method: 'POST', body: '{}' }))).rejects.toMatchObject({ status: 415 });
  });
  it('does not expose storage errors or secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await handleClassrooms(request('GET'), [], { ...deps(), principal: async () => { throw new Error('postgres://secret@host'); } });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('secret');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    } finally { log.mockRestore(); }
  });
});

describe('configuration and validation', () => {
  it('validates and sanitizes native snapshots without treating them as grades', () => {
    expect(parse(submissionInput, { project: createProject() }).project.version).toBe(1);
    expect(() => parse(submissionInput, { project: {} })).toThrow();
    expect(() => parse(submissionInput, { project: createProject(), studentId: peer.id })).toThrow();
    expect(parse(assignmentInput, { title: 'Test', missionSlug: missions[0]!.slug }).dueAt).toBeNull();
    expect(() => parse(assignmentInput, { title: 'Test', missionSlug: 'invented' })).toThrow();
  });
  it('requires explicit opt-in and a secure canonical origin', () => {
    const env = { SPARKLAB_CLASSROOMS_ENABLED: 'true', DATABASE_URL: 'postgres://db', AUTH_SECRET: 'a'.repeat(32), AUTH_GOOGLE_ID: 'id', AUTH_GOOGLE_SECRET: 'secret', AUTH_URL: origin };
    expect(accountsConfigured(env)).toBe(true);
    expect(accountsConfigured({ ...env, SPARKLAB_CLASSROOMS_ENABLED: 'false' })).toBe(false);
    expect(accountsConfigured({ ...env, AUTH_SECRET: '' })).toBe(false);
    for (const AUTH_URL of ['http://lab.example', 'https://lab.example/path', 'https://user:password@lab.example', 'invalid']) expect(appOrigin({ AUTH_URL })).toBeNull();
    expect(appOrigin({ AUTH_URL: 'http://localhost:3000' })).toBe('http://localhost:3000');
  });
  it('accepts only explicitly verified Google email profiles', () => {
    expect(verifiedGoogleProfile({ email: 'user@example.test', email_verified: true })).toBe(true);
    for (const value of [null, {}, { email: 'user@example.test' }, { email: 'user@example.test', email_verified: 'true' }]) expect(verifiedGoogleProfile(value)).toBe(false);
  });
});

describe('progress and privacy controls', () => {
  it('shows missing, submitted, reviewed and needs-work cells without project source', async () => {
    const { classroom: c, assignment: a } = await fixture();
    const before = await service.progress(teacher, c.id);
    expect(before).toHaveLength(2);
    expect(before.every(row => row.cells[0]?.status === 'not-submitted')).toBe(true);
    await service.submit(student, c.id, a.id, createProject());
    expect((await service.progress(student, c.id))[0]?.cells[0]?.status).toBe('submitted');
    await service.review(teacher, c.id, a.id, student.id, { version: 1, status: 'needs-work', feedback: 'Try again' });
    expect((await service.progress(student, c.id))[0]?.cells[0]?.status).toBe('needs-work');
    await service.review(teacher, c.id, a.id, student.id, { version: 1, status: 'reviewed', feedback: 'Done' });
    expect((await service.progress(student, c.id))[0]?.cells[0]?.status).toBe('reviewed');
    expect(JSON.stringify(await service.progress(teacher, c.id))).not.toContain('project');
  });
  it('scopes student progress to self, denies outsiders, and flags late latest snapshots', async () => {
    const { classroom: c, assignment: a } = await fixture();
    await db.update(schema.assignments).set({ dueAt: new Date('2020-01-01') }).where(eq(schema.assignments.id, a.id));
    await service.submit(student, c.id, a.id, createProject());
    const rows = await service.progress(student, c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: student.id, cells: [{ late: true, version: 1 }] });
    expect(JSON.stringify(rows)).not.toContain(peer.id);
    await expect(service.progress(stranger, c.id)).rejects.toMatchObject({ status: 404 });
    expect((await service.detail(student, c.id)).progress).toEqual(rows);
  });
  it('exports only personal metadata, never peer records, project source or auth secrets', async () => {
    const { classroom: c, assignment: a } = await fixture();
    await service.submit(student, c.id, a.id, createProject({ name: 'PRIVATE_SOURCE_MARKER' }));
    await service.submit(peer, c.id, a.id, createProject());
    await db.insert(schema.sessions).values({ userId: student.id, sessionToken: 'SESSION_SECRET_MARKER', expires: new Date('2030-01-01') });
    const value = await service.exportPersonal(student);
    expect(value.account.id).toBe(student.id);
    expect(value.submissions).toHaveLength(1);
    const text = JSON.stringify(value);
    for (const secret of [peer.id, 'PRIVATE_SOURCE_MARKER', 'SESSION_SECRET_MARKER', c.joinCode]) expect(text).not.toContain(secret);
    expect(value).toHaveProperty('snapshotNotice');
  });
  it('lets a student leave and erase only their work, including from archived classes', async () => {
    const { classroom: c, assignment: a } = await fixture();
    await service.submit(student, c.id, a.id, createProject());
    await service.submit(peer, c.id, a.id, createProject());
    await service.update(teacher, c.id, { archived: true });
    await expect(service.removeMember(student, c.id, peer.id)).rejects.toMatchObject({ status: 404 });
    await service.removeMember(student, c.id, student.id);
    await expect(service.detail(student, c.id)).rejects.toMatchObject({ status: 404 });
    expect(await service.submission(teacher, c.id, a.id, peer.id)).toBeDefined();
    expect((await db.select().from(schema.submissions))).toHaveLength(1);
  });
  it('allows only owners to remove others and preserves other classrooms', async () => {
    const { classroom: c, assignment: a } = await fixture();
    const other = await service.create(stranger, 'Other class');
    await service.join(student, other.joinCode);
    await service.submit(student, c.id, a.id, createProject());
    await expect(service.removeMember(stranger, c.id, student.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.removeMember(teacher, c.id, teacher.id)).rejects.toMatchObject({ status: 404 });
    await service.removeMember(teacher, c.id, student.id);
    expect((await service.list(student)).map(row => row.id)).toEqual([other.id]);
    expect(await db.select().from(schema.submissions)).toHaveLength(0);
  });
  it('permanently deletes only an owned classroom and cascades its records', async () => {
    const { classroom: c, assignment: a } = await fixture();
    await service.submit(student, c.id, a.id, createProject());
    const other = await service.create(stranger, 'Keep');
    await expect(service.deleteClass(student, c.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.deleteClass(stranger, c.id)).rejects.toMatchObject({ status: 404 });
    await service.deleteClass(teacher, c.id);
    expect(await db.select().from(schema.submissions)).toEqual([]);
    expect(await db.select().from(schema.assignments)).toEqual([]);
    expect((await service.detail(stranger, other.id)).classroom.name).toBe('Keep');
  });
  it('deletes student identity, sessions, work and counters without deleting peers or classes', async () => {
    const { classroom: c, assignment: a } = await fixture();
    await service.submit(student, c.id, a.id, createProject());
    await db.insert(schema.sessions).values({ userId: student.id, sessionToken: 'test-token', expires: new Date('2030-01-01') });
    await db.insert(schema.accounts).values({ userId: student.id, type: 'oauth', provider: 'google', providerAccountId: 'test-google' });
    await consumeLimit(db, student.id, 'read', 120, 60);
    await service.deleteAccount(student);
    expect(await principalFor(db, student.id)).toBeNull();
    expect(await principalFor(db, peer.id)).not.toBeNull();
    for (const table of [schema.sessions, schema.accounts, schema.submissions, schema.rateLimits]) expect(await db.select().from(table)).toEqual([]);
    expect((await service.detail(teacher, c.id)).students).toHaveLength(1);
  });
  it('deleting an owner also deletes owned classes and member work, not member accounts', async () => {
    const { classroom: c, assignment: a } = await fixture();
    await service.submit(student, c.id, a.id, createProject());
    await service.deleteAccount(teacher);
    expect(await db.select().from(schema.classrooms)).toEqual([]);
    expect(await db.select().from(schema.submissions)).toEqual([]);
    expect(await principalFor(db, student.id)).not.toBeNull();
  });
  it('requires exact confirmations and origin for destructive HTTP calls', async () => {
    const { classroom: c } = await fixture();
    for (const path of [['privacy', 'delete'], [c.id, 'delete'], [c.id, 'leave'], [c.id, 'members', student.id, 'remove']]) {
      expect((await handleClassrooms(request('POST', {}), path, deps())).status).toBe(400);
      expect((await handleClassrooms(request('POST', { confirmation: 'DELETE MY ACCOUNT' }, 'https://evil.test'), path, deps())).status).toBe(403);
    }
    const exported = await handleClassrooms(request('GET'), ['privacy', 'export'], deps(student));
    expect(exported.status).toBe(200);
    expect(exported.headers.get('cache-control')).toContain('no-store');
    expect((await handleClassrooms(request('GET'), [c.id, 'progress'], deps(student))).status).toBe(200);
    expect((await handleClassrooms(request('POST', { confirmation: 'REMOVE MEMBERSHIP' }), [c.id, 'leave'], deps(student))).status).toBe(200);
    expect((await handleClassrooms(request('POST', { confirmation: 'DELETE CLASSROOM' }), [c.id, 'delete'], deps())).status).toBe(200);
    expect((await handleClassrooms(request('POST', { confirmation: 'DELETE MY ACCOUNT' }), ['privacy', 'delete'], deps(student))).status).toBe(200);
  });
});
