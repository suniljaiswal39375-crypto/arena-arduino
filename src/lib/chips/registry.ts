import { ALL_PARTS, registerPart } from '@/lib/parts';
import { addUserChip, chipPart, userChips, type ChipDef } from './chips';

/**
 * Registration side for student-authored chips (compose.ts builds the
 * definition; this module wires it into the catalogue). Kept apart from
 * `chips.ts` so the data module and the part catalogue never import each
 * other in a cycle.
 */

/**
 * Make an authored chip available everywhere: chipById, the part catalogue
 * (palette, search, ERC) and the simulator. Idempotent per id; authored ids
 * must start with `user-chip-` so they can never shadow a shipped part.
 */
export function registerUserChip(def: ChipDef): void {
  if (!def.id.startsWith('user-chip-')) {
    throw new Error(`refusing to register ${def.id}: authored chip ids must start with user-chip-`);
  }
  if (!addUserChip(def)) return;
  registerPart(chipPart(def));
}

/** Every id an authored chip must avoid: shipped parts and registered chips. */
export function takenChipIds(): Set<string> {
  return new Set([...ALL_PARTS.map((p) => p.id), ...userChips().map((c) => c.id)]);
}
