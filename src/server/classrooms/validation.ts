import { z } from 'zod';
import { missionBySlug } from '@/lib/missions/missions';
import { validateProject } from '@/lib/doc/validation';
import { ApiError } from './errors';

export const classInput = z.object({ name: z.string().trim().min(1).max(120) }).strict();
export const classUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 0);
export const joinInput = z.object({ code: z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/) }).strict();
export const assignmentInput = z.object({
  title: z.string().trim().min(1).max(160),
  missionSlug: z.string().max(100).refine(s => !!missionBySlug(s)),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();
export const reviewInput = z.object({ version: z.number().int().positive(), status: z.enum(['reviewed', 'needs-work']), feedback: z.string().trim().max(2000) }).strict();
export const submissionInput = z.object({ project: z.unknown().transform((v, context) => {
  const project = validateProject(v);
  if (!project) context.addIssue({ code: 'custom', message: 'Invalid project document' });
  return project!;
}) }).strict();
export const emptyInput = z.object({}).strict();
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'invalid-input', 'Check the submitted fields and project format.');
  return result.data;
}
export function resourceId(value: unknown): string { return parse(z.string().uuid(), value); }
