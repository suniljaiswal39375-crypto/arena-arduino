/**
 * Adapt a firmware snapshot to the functional engine's `SimSnapshot`, the one
 * shape the builder UI already renders. The firmware engine's status/error
 * fields differ in name only; this maps them without inventing data.
 */
import type { SimError, SimSnapshot } from '../engine';
import type { FirmwareSnapshot } from './interfaces';

export function firmwareLoadError(message: string): SimError {
  return { message, line: 0, code: 'firmware-compile', kind: 'compile' };
}

/**
 * Project a firmware snapshot onto the UI snapshot. `loadError` carries a
 * failed compile/load (a refused sketch, a bad image) that the worker reports
 * separately from the running state; it wins over `status.lastError`.
 */
export function firmwareSnapshotAsSim(snapshot: FirmwareSnapshot, loadError: SimError | null = null): SimSnapshot {
  const statusError = snapshot.status.lastError;
  const error: SimError | null = loadError ?? (statusError
    ? { message: statusError, line: 0, code: 'firmware', kind: 'runtime' }
    : null);
  return {
    running: snapshot.running,
    clockUs: snapshot.clockUs,
    parts: snapshot.parts,
    serial: snapshot.serial,
    serialTotal: snapshot.serialTotal,
    serialDropped: snapshot.serialDropped,
    plot: snapshot.plot,
    plotLabels: snapshot.plotLabels,
    logicAnalyzers: snapshot.logicAnalyzers,
    scope: snapshot.scope,
    multimeter: snapshot.multimeter,
    error,
    unsupported: snapshot.unsupported,
  };
}
