# English / Hindi core controls

**Responsibility:** translate navigation and core lab controls without changing circuit data, Arduino source, filenames, pin identifiers, mission IDs or assessment behaviour.

## Public API
- `messages.ts`: `Locale`, `MessageKey`, `en`, `hi`, `translate(locale, key, values)`, `parseLocale(value)`, `LANGUAGE_KEY`.
- `client.tsx`: `LanguageProvider` and `useI18n()` (`locale`, `setLocale`, `t`).
- `components/LanguageSwitch.tsx`: labelled native English/Hindi select.

Hindi keys must cover every English key at compile time. Interpolation is text-only; React escapes output. Locale values other than `hi` fall back to English. Both dictionaries are bundled locally, so switching never needs a translation service.

The provider renders English on the server and hydrates the stored preference after mount, avoiding an SSR mismatch. `sparklab:language` persists in localStorage; a blocked/quota-limited store still allows page-session switching. Storage events synchronize tabs.

## Scope and language attributes
Translated: site navigation, toolbar/save feedback, native keyboard wiring, mission action buttons, dock navigation, logic-analyzer tab/export/ground controls, serial send controls, and the directory/detail/tracker teaching content for all 16 guided missions and 121 steps. Mission content lives in `lib/missions/hi-a.ts` and `hi-b.ts`, separate from UI labels. Component names, skill descriptions, inspector details, diagnostics, import/export and several specialist panels remain English. A Hindi notice explicitly explains that scope.

The document language stays English because many public page bodies and all metadata remain English. Mission content uses its own scoped language tag. Translated headers, builder controls and the builder main region get `lang="hi"`; untranslated sections explicitly declare `lang="en"`. Do not set the entire document to Hindi until its content is translated.

## Fonts
Noto Sans Devanagari (400, 500, 600) is served from the pinned `@fontsource/noto-sans-devanagari` package, not a CDN. The build includes hashed font assets in the offline precache. Copyright/licence: `public/fonts/noto-sans-devanagari-OFL.txt` (SIL OFL 1.1).

## Verification
`npm test -- src/lib/i18n/i18n.test.tsx` checks key coverage, interpolation parity, invalid preference fallback, escaping, SSR defaults and translated controls without project mutations. `npm run test:e2e` verifies persistence, blocked storage, cross-tab sync, responsive guidance and offline Hindi font loading. Translation needs educator/native-language review; coverage of the authored mission text is complete, but this is not a claim of full-site localization or screen-reader certification.
