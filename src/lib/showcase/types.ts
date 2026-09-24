import type { WireColor } from '@/lib/doc/types';

/**
 * A showcase project: a finished build a student can open, run and remix.
 *
 * Every entry is a runnable revision - real parts, real wiring, a real sketch -
 * plus a behaviour probe: a short automation scenario that proves the project
 * does what its description claims. The test suite runs every probe, so the
 * showcase can never quietly rot into pretty pictures of broken circuits.
 */
export interface ShowcaseProject {
  slug: string;
  title: string;
  emoji: string;
  /** One line for the card. */
  tagline: string;
  /** A paragraph for the project page. */
  description: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  tags: string[];
  learningOutcomes: string[];
  /** Real-world wiring advice beyond what the simulator checks. */
  wiringNotes: string[];
  /** Mission a student should do first, if any. */
  builtOn?: string;
  /** Anything the functional runtime cannot show, stated plainly. */
  fidelityNote?: string;
  board: string;
  parts: Array<{ id: string; type: string; x: number; y: number; attrs?: Record<string, string | number | boolean> }>;
  wires: Array<[fromPart: string, fromPin: string, toPart: string, toPin: string, color?: WireColor]>;
  inputs?: Record<string, number>;
  sketch: string;
  /** Automation scenario YAML proving the headline behaviour. */
  probe: string;
}
