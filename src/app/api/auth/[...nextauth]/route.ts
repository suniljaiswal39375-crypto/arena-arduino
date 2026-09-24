import type { NextRequest } from 'next/server';
import { handlers } from '@/server/auth';
import { accountsConfigured } from '@/server/config';
import { reply } from '@/server/classrooms/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function unavailable() { return reply({ error: { code: 'not-configured', message: 'Classroom sign-in is not configured.' } }, 503); }
async function handle(request: NextRequest, method: 'GET' | 'POST') {
  const response = accountsConfigured() ? await handlers[method](request) : unavailable();
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}
export async function GET(request: NextRequest) { return handle(request, 'GET'); }
export async function POST(request: NextRequest) { return handle(request, 'POST'); }
