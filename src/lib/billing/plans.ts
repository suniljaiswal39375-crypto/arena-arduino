/**
 * Pricing & plan model (spec §15 breadth item).
 *
 * The decision this module encodes (see DECISIONS.md):
 *
 *  - The local lab is free forever. Everything that runs in the browser or
 *    self-hosted (builder, engines, missions, exports, CLI/MCP, classrooms on
 *    your own Postgres, Co-Lab rooms via your own relay, the mentor gateway
 *    with your own model key) costs nothing and needs no account.
 *  - Paid tiers sell HOSTED convenience, never the lab itself: managed
 *    accounts/cloud storage, persistent cross-device Co-Lab, managed relay,
 *    managed model hosting, org administration and support.
 *  - The hosted tier is a product decision still open, so paid plans carry
 *    no invented prices: `priceInr: null` means "to be decided". The site
 *    never shows a number we have not decided, and there is no checkout:
 *    payment processing requires credentials and a legal entity this
 *    sandbox deliberately does not configure.
 */

export type PlanId = 'free' | 'classroom' | 'school';

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** null = price not decided yet; the UI must say so, not invent one. */
  priceInr: number | null;
  priceNote: string;
  cta: 'start' | 'contact';
  bullets: string[];
}

export type FeatureAvailability =
  /** Works today, in the browser, zero-config. */
  | 'local'
  /** Works today if you run the optional piece yourself (relay, DB, key). */
  | 'self-host'
  /** Needs the hosted tier; not built yet. */
  | 'hosted-planned';

export interface FeatureRow {
  id: string;
  label: string;
  availability: FeatureAvailability;
  /** Paid tiers that will include the feature once the hosted tier exists. */
  hostedIn: PlanId[];
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Local Lab',
    tagline: 'The whole lab, in the browser, forever free.',
    priceInr: 0,
    priceNote: 'No account. No API keys. No time limit.',
    cta: 'start',
    bullets: [
      'Builder, both engines, 166-part catalogue',
      '16 missions, skills model and badges',
      'Chaos Lab, Chip Studio, Inspect bench',
      'Wokwi / KiCad / BOM export, CLI, scenarios, MCP server',
      'Classrooms on your own database (optional)',
      'Co-Lab rooms in this browser, and cross-device via your own relay',
    ],
  },
  {
    id: 'classroom',
    name: 'Hosted Classroom',
    tagline: 'Managed accounts, storage and cross-device rooms.',
    priceInr: null,
    priceNote: 'Pricing is being decided with our pilot schools — talk to us.',
    cta: 'contact',
    bullets: [
      'Hosted accounts and cloud project storage',
      'Persistent cross-device Co-Lab rooms (managed relay)',
      'Classroom provisioning without self-hosting',
      'Hosted AI-mentor gateway (no key management)',
    ],
  },
  {
    id: 'school',
    name: 'School & Org',
    tagline: 'Everything in Hosted Classroom, run for the whole institution.',
    priceInr: null,
    priceNote: 'Institution pricing is being decided — talk to us.',
    cta: 'contact',
    bullets: [
      'Multiple classes under one organisation',
      'Managed firmware build farm quota',
      'Priority support and onboarding',
      'Everything in Hosted Classroom',
    ],
  },
];

export const FEATURE_MATRIX: FeatureRow[] = [
  { id: 'builder', label: 'Builder, functional + firmware engines, 166 parts', availability: 'local', hostedIn: [] },
  { id: 'missions', label: '16 guided missions, skills model, badges', availability: 'local', hostedIn: [] },
  { id: 'inspect', label: 'Chaos Lab, Chip Studio, Inspect bench (scope, logic, DMM)', availability: 'local', hostedIn: [] },
  { id: 'interop', label: 'Wokwi / KiCad / BOM export, CLI, scenarios, MCP server', availability: 'local', hostedIn: [] },
  { id: 'colab-local', label: 'Co-Lab rooms across tabs of one browser', availability: 'local', hostedIn: [] },
  { id: 'colab-selfhost', label: 'Cross-device Co-Lab rooms on your own relay', availability: 'self-host', hostedIn: ['classroom', 'school'] },
  { id: 'classrooms-selfhost', label: 'Classrooms on your own Postgres (teacher-approved)', availability: 'self-host', hostedIn: ['classroom', 'school'] },
  { id: 'mentor-selfhost', label: 'AI mentor gateway with your own model key', availability: 'self-host', hostedIn: ['classroom', 'school'] },
  { id: 'accounts-hosted', label: 'Hosted accounts and cloud project storage', availability: 'hosted-planned', hostedIn: ['classroom', 'school'] },
  { id: 'colab-hosted', label: 'Managed relay with persistent rooms', availability: 'hosted-planned', hostedIn: ['classroom', 'school'] },
  { id: 'mentor-hosted', label: 'Managed AI-mentor model hosting', availability: 'hosted-planned', hostedIn: ['classroom', 'school'] },
  { id: 'org-admin', label: 'Multi-class organisation administration', availability: 'hosted-planned', hostedIn: ['school'] },
  { id: 'build-farm-hosted', label: 'Managed firmware build farm quota', availability: 'hosted-planned', hostedIn: ['school'] },
  { id: 'support', label: 'Priority support and onboarding', availability: 'hosted-planned', hostedIn: ['school'] },
];

export function planById(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`unknown plan: ${id}`);
  return plan;
}

export type CellState =
  /** Included today. */
  | 'included'
  /** Available today if you run the optional piece yourself. */
  | 'self-host'
  /** Included in this tier once the hosted tier exists. */
  | 'planned'
  /** Not part of this tier. */
  | 'not-included';

/** What a comparison-table cell shows for a feature row in a given plan. */
export function cellFor(row: FeatureRow, plan: PlanId): CellState {
  if (plan === 'free') {
    if (row.availability === 'local') return 'included';
    if (row.availability === 'self-host') return 'self-host';
    return 'not-included';
  }
  if (row.availability !== 'hosted-planned') return 'included';
  return row.hostedIn.includes(plan) ? 'planned' : 'not-included';
}
