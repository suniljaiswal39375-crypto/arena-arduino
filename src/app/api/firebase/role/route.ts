/**
 * Firebase role management — admin only.
 * POST /api/firebase/role { uid, role }
 * Requires Firebase Admin and a bearer token of an admin user.
 * In production, this should be called only by server scripts or via Firebase Console.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminAuth, isFirebaseAdminConfigured, verifyFirebaseIdToken } from '@/lib/firebase/admin';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  uid: z.string().min(1).max(128),
  role: z.enum(['student', 'teacher', 'admin']),
});

export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured()) {
    return NextResponse.json(
      { error: { code: 'not-configured', message: 'Firebase Admin not configured' } },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Missing authorization' } },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const idToken = authHeader.slice('Bearer '.length);
  const caller = await verifyFirebaseIdToken(idToken);
  if (!caller) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Invalid token' } },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  // Verify caller is admin via Admin SDK
  const adminAuth = getFirebaseAdminAuth();
  if (!adminAuth) {
    return NextResponse.json(
      { error: { code: 'not-configured', message: 'Admin auth unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  try {
    const callerUser = await adminAuth.getUser(caller.uid);
    const callerRole = (callerUser.customClaims?.role as string) ?? 'student';
    if (callerRole !== 'admin') {
      return NextResponse.json(
        { error: { code: 'forbidden', message: 'Admin role required' } },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
  } catch {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Caller not found' } },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
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
      { error: { code: 'bad-request', message: 'Invalid body' } },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  try {
    await adminAuth.setCustomUserClaims(parsed.data.uid, { role: parsed.data.role });
    return NextResponse.json(
      { ok: true, uid: parsed.data.uid, role: parsed.data.role },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch {
    return NextResponse.json(
      { error: { code: 'internal', message: 'Failed to set role' } },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
