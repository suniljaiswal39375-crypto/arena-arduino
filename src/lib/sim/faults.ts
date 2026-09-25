import type { ProjectDoc } from '@/lib/doc/types';

/**
 * Mystery-hardware faults (spec §12.5, ROADMAP Phase 13): the document looks
 * completely healthy — clean ERC, wiring right, code unchanged — but a part
 * misbehaves on a virtual-time schedule, like real hardware that fails after
 * it warms up. The schedule is session state passed alongside the sim load
 * call; it is never stored in a ProjectDoc, exported, or persisted.
 *
 * Only the functional interpreter engine applies these faults: its sensor
 * models are the ones whose physics we actually simulate. The firmware
 * (avr8js) path keeps reporting the healthy value — inventing a fault there
 * would break the project's honesty rule.
 */
export type FaultEvent =
  /** After `afterMs` of virtual time, the part's reading drifts `perSecond` units per second. */
  | { kind: 'sensor-drift'; partId: string; afterMs: number; perSecond: number }
  /** After `afterMs`, the part stops responding; its reads return `stuckAt` (default: not-a-number, as a dead sensor does). */
  | { kind: 'sensor-fails'; partId: string; afterMs: number; stuckAt?: number };

export type FaultSchedule = FaultEvent[];

/** Shared empty schedule — a stable identity so effect deps never churn. */
export const EMPTY_SCHEDULE: FaultSchedule = [];

/** The parts a schedule can point at. */
export function faultPartIds(schedule: FaultSchedule): Set<string> {
  return new Set(schedule.map((e) => e.partId));
}

/**
 * Effective reading of `partId` at virtual time `tMs` given the healthy
 * `base`. Drift accumulates linearly from `afterMs`; a failed part returns
 * its stuck value (or NaN) from `afterMs` on. Multiple events on one part
 * compose in order, last one wins for the stuck value.
 */
export function applyFaultEvents(schedule: FaultSchedule, partId: string, base: number, tMs: number): number {
  let value = base;
  for (const event of schedule) {
    if (event.partId !== partId || tMs < event.afterMs) continue;
    if (event.kind === 'sensor-drift') {
      value += event.perSecond * ((tMs - event.afterMs) / 1000);
    } else {
      value = event.stuckAt ?? NaN;
    }
  }
  return value;
}
