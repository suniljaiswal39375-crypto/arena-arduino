/**
 * Firebase ID token verification endpoint.
 * POST /api/firebase/verify { idToken }
 * Returns the verified user profile or 401.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyFirebaseIdToken, isFirebaseAdminConfigured } from '@/lib/firebase/admin';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  idToken: z.string().min(10).max(10000),
});

export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured()) {
    return NextResponse.json(
      { error: { code: 'not-configured', message: 'Firebase Admin not configured' } },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'bad-request', message: 'Invalid JSON' } },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'bad-request', message: 'Invalid request body' } },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const verified = await verifyFirebaseIdToken(parsed.data.idToken);
  if (!verified) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Invalid or expired token' } },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  return NextResponse.json(
    { user: verified },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
