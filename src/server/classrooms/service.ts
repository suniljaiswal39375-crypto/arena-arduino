import { randomInt } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/types';
import { assignments, classrooms, memberships, rateLimits, submissions, users } from '@/server/db/schema';
import type { ProjectDoc } from '@/lib/doc/types';
import { ApiError, missing } from './errors';

export interface Principal { id: string; name: string; role: 'student' | 'teacher' }
export const JOIN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const makeJoinCode = () => Array.from({ length: 6 }, () => JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)]).join('');
const meta = {
  assignmentId: submissions.assignmentId, studentId: submissions.studentId, version: submissions.version,
  submittedAt: submissions.submittedAt, reviewStatus: submissions.reviewStatus, feedback: submissions.feedback, reviewedAt: submissions.reviewedAt,
};

export async function principalFor(db: Database, id: string): Promise<Principal | null> {
  const [user] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, id));
  return user ? { ...user, name: user.name ?? 'Learner' } : null;
}

/** Fixed-window, atomic limits shared by every application instance. */
export async function consumeLimit(db: Database, userId: string, action: string, limit: number, seconds: number, now = new Date()) {
  const window = Math.floor(now.getTime() / (seconds * 1000));
  await db.delete(rateLimits).where(lt(rateLimits.expiresAt, now));
  const [bucket] = await db.insert(rateLimits).values({ key: `${userId}:${action}:${window}`, count: 1, expiresAt: new Date((window + 1) * seconds * 1000) })
    .onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count} + 1` } }).returning({ count: rateLimits.count });
  if (!bucket || bucket.count > limit) throw new ApiError(429, 'rate-limited', 'Too many requests. Wait a few minutes before trying again.');
}

export class ClassroomService {
  constructor(private db: Database, private code: () => string = makeJoinCode) {}

  private async access(classId: string, actor: Principal, lock = false) {
    const query = this.db.select().from(classrooms).where(eq(classrooms.id, classId));
    const [classroom] = await (lock ? query.for('update') : query);
    if (!classroom) throw missing();
    const owner = classroom.ownerId === actor.id && actor.role === 'teacher';
    if (!owner) {
      const [member] = await this.db.select().from(memberships).where(and(eq(memberships.classroomId, classId), eq(memberships.userId, actor.id)));
      if (!member) throw missing();
    }
    return { classroom, owner };
  }
  private async owned(classId: string, actor: Principal, lock = false) {
    const result = await this.access(classId, actor, lock);
    if (!result.owner) throw missing();
    return result.classroom;
  }
  private active(classroom: typeof classrooms.$inferSelect) {
    if (classroom.archived) throw new ApiError(409, 'archived', 'This classroom is archived and cannot accept changes.');
  }
  private async assignment(classId: string, assignmentId: string) {
    const [assignment] = await this.db.select().from(assignments).where(and(eq(assignments.classroomId, classId), eq(assignments.id, assignmentId)));
    if (!assignment) throw missing();
    return assignment;
  }
  async list(actor: Principal) {
    const rows = await this.db.select({ id: classrooms.id, name: classrooms.name, ownerId: classrooms.ownerId, archived: classrooms.archived, createdAt: classrooms.createdAt })
      .from(classrooms).leftJoin(memberships, and(eq(memberships.classroomId, classrooms.id), eq(memberships.userId, actor.id)))
      .where(actor.role === 'teacher' ? or(eq(classrooms.ownerId, actor.id), eq(memberships.userId, actor.id)) : eq(memberships.userId, actor.id)).orderBy(desc(classrooms.createdAt));
    return rows.map(row => ({ ...row, relationship: row.ownerId === actor.id && actor.role === 'teacher' ? 'owner' as const : 'student' as const }));
  }
  async create(actor: Principal, name: string) {
    if (actor.role !== 'teacher') throw new ApiError(403, 'teacher-required', 'Only an operator-approved teacher can create a classroom.');
    return this.db.transaction(async tx => {
      const [user] = await tx.select().from(users).where(eq(users.id, actor.id)).for('update');
      if (user?.role !== 'teacher') throw new ApiError(403, 'teacher-required', 'Teacher access is required.');
      const existing = await tx.select({ id: classrooms.id }).from(classrooms).where(eq(classrooms.ownerId, actor.id));
      if (existing.length >= 20) throw new ApiError(409, 'class-limit', 'A teacher can own up to 20 classrooms.');
      for (let attempt = 0; attempt < 8; attempt++) {
        const [row] = await tx.insert(classrooms).values({ name, ownerId: actor.id, joinCode: this.code() }).onConflictDoNothing({ target: classrooms.joinCode }).returning();
        if (row) return row;
      }
      throw new ApiError(503, 'code-unavailable', 'Could not allocate a join code. Try again.');
    });
  }
  async join(actor: Principal, code: string) {
    return this.db.transaction(async tx => {
      const [classroom] = await tx.select().from(classrooms).where(and(eq(classrooms.joinCode, code), eq(classrooms.archived, false))).for('update');
      if (!classroom) throw new ApiError(404, 'code-unavailable', 'That join code is not available. Ask your teacher for a current code.');
      if (classroom.ownerId === actor.id) return { id: classroom.id };
      const current = await tx.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.classroomId, classroom.id));
      if (current.some(m => m.userId === actor.id)) return { id: classroom.id };
      if (current.length >= 250) throw new ApiError(409, 'member-limit', 'This classroom has reached its 250-member limit.');
      await tx.insert(memberships).values({ classroomId: classroom.id, userId: actor.id }).onConflictDoNothing();
      return { id: classroom.id };
    });
  }
  async detail(actor: Principal, classId: string) {
    const { classroom, owner } = await this.access(classId, actor);
    const tasks = await this.db.select().from(assignments).where(eq(assignments.classroomId, classId)).orderBy(desc(assignments.createdAt));
    const students = owner ? await this.db.select({ id: users.id, name: users.name, joinedAt: memberships.joinedAt }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.classroomId, classId)).orderBy(asc(memberships.joinedAt)) : undefined;
    return {
      classroom: { id: classroom.id, name: classroom.name, archived: classroom.archived, createdAt: classroom.createdAt,
        ...(owner ? { joinCode: classroom.joinCode } : {}) },
      relationship: owner ? 'owner' as const : 'student' as const, assignments: tasks, progress: await this.progress(actor, classId), ...(students ? { students } : {}),
    };
  }
  /** Snapshot/review status only: never presented as simulator-verified mastery. */
  async progress(actor: Principal, classId: string) {
    const { owner } = await this.access(classId, actor);
    const tasks = await this.db.select().from(assignments).where(eq(assignments.classroomId, classId)).orderBy(asc(assignments.createdAt));
    const members = await this.db.select({ id: users.id, name: users.name }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.classroomId, classId), owner ? undefined : eq(memberships.userId, actor.id)));
    const work = await this.db.select({ assignmentId: submissions.assignmentId, studentId: submissions.studentId, version: submissions.version, submittedAt: submissions.submittedAt, reviewStatus: submissions.reviewStatus }).from(submissions).innerJoin(assignments, eq(assignments.id, submissions.assignmentId))
      .where(and(eq(assignments.classroomId, classId), owner ? undefined : eq(submissions.studentId, actor.id)));
    const lookup = new Map(work.map(row => [`${row.studentId}:${row.assignmentId}`, row]));
    return members.map(member => ({ ...member, cells: tasks.map(task => {
      const row = lookup.get(`${member.id}:${task.id}`);
      return { assignmentId: task.id, title: task.title, status: row?.reviewStatus ?? 'not-submitted',
        version: row?.version ?? null, submittedAt: row?.submittedAt ?? null,
        late: !!(row && task.dueAt && row.submittedAt > task.dueAt) };
    }) }));
  }
  async removeMember(actor: Principal, classId: string, studentId: string) {
    return this.db.transaction(async tx => {
      const scoped = new ClassroomService(tx);
      const { classroom, owner } = await scoped.access(classId, actor, true);
      if ((!owner && studentId !== actor.id) || studentId === classroom.ownerId) throw missing();
      const [member] = await tx.select().from(memberships).where(and(eq(memberships.classroomId, classId), eq(memberships.userId, studentId)));
      if (!member) throw missing();
      const tasks = tx.select({ id: assignments.id }).from(assignments).where(eq(assignments.classroomId, classId));
      await tx.delete(submissions).where(and(eq(submissions.studentId, studentId), inArray(submissions.assignmentId, tasks)));
      await tx.delete(memberships).where(and(eq(memberships.classroomId, classId), eq(memberships.userId, studentId)));
      return { removed: true };
    });
  }
  async deleteClass(actor: Principal, classId: string) {
    return this.db.transaction(async tx => {
      await new ClassroomService(tx).owned(classId, actor, true);
      await tx.delete(classrooms).where(eq(classrooms.id, classId));
      return { deleted: true };
    });
  }
  /** Portable account metadata. Large source snapshots remain separate authorized downloads. */
  async exportPersonal(actor: Principal) {
    const [account] = await this.db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.id, actor.id));
    if (!account) throw missing();
    const classes = await this.list(actor);
    const work = await this.db.select({ ...meta, classroomId: assignments.classroomId, title: assignments.title })
      .from(submissions).innerJoin(assignments, eq(assignments.id, submissions.assignmentId)).where(eq(submissions.studentId, actor.id));
    return { formatVersion: 1, exportedAt: new Date(), account, classrooms: classes, submissions: work,
      snapshotNotice: 'Project source is not included in this metadata export. Download each snapshot from its classroom before leaving or deleting your account. Local builder data and downloaded files are stored on your device, not in this account.' };
  }
  async deleteAccount(actor: Principal) {
    // FK cascades erase sessions, identities, memberships, submissions and owned classrooms.
    await this.db.transaction(async tx => {
      await tx.delete(rateLimits).where(sql`left(${rateLimits.key}, ${actor.id.length + 1}) = ${actor.id + ':'}`);
      await tx.delete(users).where(eq(users.id, actor.id));
    });
    return { deleted: true };
  }
  async update(actor: Principal, classId: string, changes: { name?: string; archived?: boolean }) {
    await this.owned(classId, actor);
    const [row] = await this.db.update(classrooms).set(changes).where(eq(classrooms.id, classId)).returning();
    return row;
  }
  async rotateCode(actor: Principal, classId: string) {
    // Retry the whole statement after a unique collision; do not retry inside an aborted transaction.
    const previous = await this.owned(classId, actor);
    for (let i = 0; i < 8; i++) {
      const joinCode = this.code();
      if (joinCode === previous.joinCode) continue;
      try {
        const [row] = await this.db.update(classrooms).set({ joinCode }).where(eq(classrooms.id, classId)).returning({ joinCode: classrooms.joinCode });
        return row;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ApiError(503, 'code-unavailable', 'Could not allocate a join code. Try again.');
  }
  async assign(actor: Principal, classId: string, input: { title: string; missionSlug: string; dueAt: string | null }) {
    return this.db.transaction(async tx => {
      const scoped = new ClassroomService(tx);
      this.active(await scoped.owned(classId, actor, true));
      const tasks = await tx.select({ id: assignments.id }).from(assignments).where(eq(assignments.classroomId, classId));
      if (tasks.length >= 100) throw new ApiError(409, 'assignment-limit', 'A classroom can contain up to 100 assignments.');
      const [row] = await tx.insert(assignments).values({ classroomId: classId, title: input.title, missionSlug: input.missionSlug, dueAt: input.dueAt ? new Date(input.dueAt) : null }).returning();
      return row;
    });
  }
  async assignmentDetail(actor: Principal, classId: string, assignmentId: string) {
    const { owner } = await this.access(classId, actor);
    const assignment = await this.assignment(classId, assignmentId);
    const rows = await this.db.select(meta).from(submissions).where(and(eq(submissions.assignmentId, assignmentId), owner ? undefined : eq(submissions.studentId, actor.id))).orderBy(desc(submissions.submittedAt));
    return { assignment, submissions: rows };
  }
  async submit(actor: Principal, classId: string, assignmentId: string, project: ProjectDoc) {
    return this.db.transaction(async tx => {
      const scoped = new ClassroomService(tx);
      const { classroom, owner } = await scoped.access(classId, actor, true);
      this.active(classroom);
      if (owner) throw new ApiError(403, 'student-required', 'Teachers review this classroom; members submit work.');
      await scoped.assignment(classId, assignmentId);
      const [row] = await tx.insert(submissions).values({ assignmentId, studentId: actor.id, project })
        .onConflictDoUpdate({ target: [submissions.assignmentId, submissions.studentId], set: {
          project, version: sql`${submissions.version} + 1`, submittedAt: new Date(), reviewStatus: 'submitted', feedback: '', reviewedAt: null,
        } }).returning(meta);
      return row;
    });
  }
  async submission(actor: Principal, classId: string, assignmentId: string, studentId: string) {
    const { owner } = await this.access(classId, actor);
    await this.assignment(classId, assignmentId);
    if (!owner && studentId !== actor.id) throw missing();
    const [row] = await this.db.select().from(submissions).where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)));
    if (!row) throw missing();
    return row;
  }
  async review(actor: Principal, classId: string, assignmentId: string, studentId: string, input: { version: number; status: 'reviewed' | 'needs-work'; feedback: string }) {
    return this.db.transaction(async tx => {
      const scoped = new ClassroomService(tx);
      this.active(await scoped.owned(classId, actor, true));
      await scoped.assignment(classId, assignmentId);
      const [row] = await tx.update(submissions).set({ reviewStatus: input.status, feedback: input.feedback, reviewedAt: new Date() })
        .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId), eq(submissions.version, input.version))).returning(meta);
      if (!row) throw new ApiError(409, 'stale-submission', 'The submission changed or was removed. Refresh before reviewing it.');
      return row;
    });
  }
}
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; cause?: unknown };
  return value.code === '23505' || (!!value.cause && isUniqueViolation(value.cause));
}
