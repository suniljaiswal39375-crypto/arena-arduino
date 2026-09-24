/**
 * `POST /api/firmware-compile` — the server-side AVR compile service.
 *
 * Server-only Node.js runtime. This is the "toolchain present" upgrade path;
 * when `SPARKLAB_ARDUINO_CLI` is absent the handler answers with an honest 503
 * and the offline lab keeps running known-baseline firmware. Never a fake
 * build.
 */
import { appOrigin } from '@/server/config';
import { discoverLocalCli } from '@/server/firmware/compile-service';
import { handleFirmwareCompile } from '@/server/firmware/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleFirmwareCompile(request, { origin: appOrigin(), cli: discoverLocalCli });
}
