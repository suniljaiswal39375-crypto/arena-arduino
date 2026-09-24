import { auth } from '@/server/auth';
import { accountsConfigured, appOrigin } from '@/server/config';
import { getDatabase } from '@/server/db/client';
import { principalFor } from '@/server/classrooms/service';
import { handleClassrooms } from '@/server/classrooms/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  return handleClassrooms(request, path, {
    configured: accountsConfigured(), origin: appOrigin(), database: getDatabase,
    principal: async () => {
      const session = await auth();
      return session?.user?.id ? principalFor(getDatabase(), session.user.id) : null;
    },
  });
}
export { handle as GET, handle as POST, handle as PATCH };
