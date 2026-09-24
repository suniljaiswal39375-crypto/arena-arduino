import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, integer, uuid, boolean, jsonb, primaryKey, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import type { AdapterAccountType } from 'next-auth/adapters';
import type { ProjectDoc } from '@/lib/doc/types';

export const users = pgTable('users', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`).$defaultFn(() => crypto.randomUUID()),
  name: text('name'), email: text('email').unique(), emailVerified: timestamp('email_verified', { withTimezone: true, mode: 'date' }), image: text('image'),
  role: text('role').$type<'student' | 'teacher'>().notNull().default('student'),
}, t => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`), check('users_role_check', sql`${t.role} in ('student', 'teacher')`)]);
export const accounts = pgTable('accounts', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').$type<AdapterAccountType>().notNull(), provider: text('provider').notNull(), providerAccountId: text('provider_account_id').notNull(),
  refresh_token: text('refresh_token'), access_token: text('access_token'), expires_at: integer('expires_at'), token_type: text('token_type'), scope: text('scope'), id_token: text('id_token'), session_state: text('session_state'),
}, t => [primaryKey({ columns: [t.provider, t.providerAccountId] })]);
export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
}, t => [index('sessions_user_idx').on(t.userId)]);
export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(), token: text('token').notNull(), expires: timestamp('expires', { withTimezone: true, mode: 'date' }).notNull(),
}, t => [primaryKey({ columns: [t.identifier, t.token] })]);

export const classrooms = pgTable('classrooms', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), joinCode: text('join_code').notNull().unique(), archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, t => [index('classrooms_owner_idx').on(t.ownerId), check('classrooms_name_check', sql`length(${t.name}) between 1 and 120`), check('classrooms_join_code_check', sql`${t.joinCode} ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$'`)]);
export const memberships = pgTable('memberships', {
  classroomId: uuid('classroom_id').notNull().references(() => classrooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.classroomId, t.userId] }), index('memberships_user_idx').on(t.userId)]);
export const assignments = pgTable('assignments', {
  id: uuid('id').primaryKey().defaultRandom(), classroomId: uuid('classroom_id').notNull().references(() => classrooms.id, { onDelete: 'cascade' }),
  title: text('title').notNull(), missionSlug: text('mission_slug').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }), createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, t => [index('assignments_class_idx').on(t.classroomId), check('assignments_title_check', sql`length(${t.title}) between 1 and 160`)]);
export const submissions = pgTable('submissions', {
  assignmentId: uuid('assignment_id').notNull().references(() => assignments.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  project: jsonb('project').$type<ProjectDoc>().notNull(), version: integer('version').notNull().default(1),
  submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  reviewStatus: text('review_status').$type<'submitted' | 'reviewed' | 'needs-work'>().notNull().default('submitted'), feedback: text('feedback').notNull().default(''),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
}, t => [primaryKey({ columns: [t.assignmentId, t.studentId] }), check('submission_version_positive', sql`${t.version} > 0`),
  check('submissions_feedback_check', sql`length(${t.feedback}) <= 2000`), check('submission_review_check', sql`${t.reviewStatus} in ('submitted', 'reviewed', 'needs-work')`)]);
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
}, t => [index('rate_limits_expiry_idx').on(t.expiresAt), check('rate_limits_count_check', sql`${t.count} > 0`)]);
