/**
 * SparkLab Co-Lab relay — zero-config multiplayer room router.
 *
 * Run:   npm run collab:relay          (port 8787 by default)
 * Then:  set NEXT_PUBLIC_COLLAB_WS_URL=ws://localhost:8787 for the builder.
 *
 * Rooms live ONLY in this process's memory: no accounts, no persistence,
 * restart clears everything. That is by design for the foundation slice —
 * see DECISIONS.md ("Co-Lab relay").
 */
import { startRelay } from '../src/lib/collab/relay';

const port = Number(process.env.SPARKLAB_COLLAB_PORT ?? '8787');
const host = process.env.SPARKLAB_COLLAB_HOST ?? '0.0.0.0';

const relay = await startRelay({ port, host });

console.log(`SparkLab Co-Lab relay listening on ${relay.url} (bound ${host}:${relay.port})`);
console.log('Point NEXT_PUBLIC_COLLAB_WS_URL at this address to enable server rooms.');
console.log('Rooms are memory-only: restarting the relay clears them. No persistence.');

const shutdown = (): void => {
  void relay.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
