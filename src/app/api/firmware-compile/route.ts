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
  const url = process.env.SPARKLAB_BUILD_FARM_URL;
  const token = process.env.SPARKLAB_BUILD_FARM_TOKEN;
  const farm = url || token ? { url: url ?? '', token: token ?? '' } : undefined;
  return handleFirmwareCompile(request, { origin: appOrigin(), cli: discoverLocalCli, farm });
}
