/** Operator-runner entry point. Keep the Docker socket off the web app host. */
import { createFirmwareFarm } from '@/server/firmware/farm-http';

const token = process.env.SPARKLAB_BUILD_FARM_TOKEN ?? '';
const image = process.env.SPARKLAB_BUILD_FARM_IMAGE ?? '';
const host = process.env.SPARKLAB_BUILD_FARM_HOST ?? '127.0.0.1';
const port = Number(process.env.SPARKLAB_BUILD_FARM_PORT ?? '4010');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid build-farm port.');
const server = createFirmwareFarm({ token, image, dockerPath: process.env.SPARKLAB_DOCKER_BIN });
server.requestTimeout = 10_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => console.info(`AVR build farm listening on ${host}:${port}`));
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
