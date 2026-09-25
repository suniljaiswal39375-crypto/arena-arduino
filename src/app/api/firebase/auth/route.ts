/**
 * Firebase Auth session endpoint.
 * GET returns current auth config status.
 * Used by client to check if Firebase is configured.
 */

import { NextResponse } from 'next/server';
import { firebaseConfigured, firebaseAdminConfigured } from '@/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const clientConfigured = firebaseConfigured();
  const adminConfigured = firebaseAdminConfigured();

  return NextResponse.json(
    {
      configured: clientConfigured,
      adminConfigured,
      features: {
        auth: clientConfigured,
        storage: clientConfigured,
        firestore: clientConfigured,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
