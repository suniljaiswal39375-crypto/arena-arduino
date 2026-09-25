/**
 * `POST /api/mentor` — the server-side model gateway for the AI lab assistant.
 *
 * Mounted only in deployments that configure a model (`OPENAI_API_KEY`); every
 * other deployment answers 503 and the client falls back to the deterministic
 * offline planner, so the zero-config lab keeps its mentor. See
 * `src/server/mentor/gateway.ts` for the contract and limits.
 */
import { handleMentorRequest } from '@/server/mentor/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleMentorRequest(request, { env: process.env as Record<string, string | undefined> });
}
