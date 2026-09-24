# Localized mission presentation

`MissionDetail` renders a mission and its next-mission link using the active UI language. The server route keeps static parameters, not-found handling and English metadata; the client view translates its visible teaching content after the saved language preference hydrates.

Props are canonical `Mission` objects. `missionPresentation` projects teaching text only; URLs, component IDs and validator data are unchanged. Lesson hints use native `<details>` controls, and untranslated component/skill blocks retain `lang="en"`. Long API syntax wraps on narrow screens. Reference sketches are not rendered in this lesson view; the existing builder unlock UI is unchanged (this is not a secure assessment boundary).

Run `npm test -- src/components/missions/render.test.tsx` to render all 16 Hindi lessons and their trackers. `npm run test:e2e` covers directory search/filtering, detail hints, prerequisite navigation, canonical confirmation keys, offline dynamic-route hydration and mobile hint layout.
