/**
 * Single source of truth for the product name.
 * The spec requires SparkLab to be renamable in one commit - this is that commit point.
 */
export const PRODUCT_NAME = 'SparkLab' as const;
export const PRODUCT_TAGLINE =
  'The browser lab where a student in Panchkula and an engineer in Munich open the same link, get the same hardware, and learn the same thing.';
export const PRODUCT_VERSION = '0.1.0';

export const URLS = {
  schema: 'https://sparklab.dev/schema/project-v1.json',
} as const;

/** Fidelity tiers, in the order the spec defines them. */
export const FIDELITY_TIERS = ['exact', 'model', 'visual', 'export'] as const;
export type FidelityTier = (typeof FIDELITY_TIERS)[number];

export const FIDELITY_LABEL: Record<FidelityTier, string> = {
  exact: 'EXACT',
  model: 'MODEL',
  visual: 'VISUAL',
  export: 'EXPORT',
};

export const FIDELITY_BLURB: Record<FidelityTier, string> = {
  exact: 'Real emulation. The compiled firmware runs instruction by instruction.',
  model: 'Behaviourally modelled. Response is right, electrical timing is not.',
  visual: 'Rendered and wired, but not simulated. Present for realism and wiring practice.',
  export: 'Not simulated here. Hand this project to the emulator or a real toolchain.',
};
