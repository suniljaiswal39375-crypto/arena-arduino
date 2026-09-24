import { SiteHeader } from '@/components/SiteHeader';
import { PRODUCT_NAME } from '@/lib/brand';

export const metadata = {
  title: 'Accessibility',
  description: `How ${PRODUCT_NAME} supports keyboard, screen reader and low-vision users, and what is not finished yet.`,
};

/**
 * The accessibility statement the spec requires (Section 18.3). It says what
 * works and, just as plainly, what does not yet: a statement that overclaims is
 * worse than none, because it tells people not to report the gaps.
 */
export default function AccessibilityPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[760px] px-5 py-10 text-[13.5px] leading-relaxed">
        <h1 className="text-2xl font-semibold tracking-tight">Accessibility statement</h1>
        <p className="mt-2 text-[var(--color-text-dim)]">
          {PRODUCT_NAME} is aiming for WCAG 2.2 level AA. We are not there yet, and this page lists
          honestly what works today and what does not.
        </p>

        <h2 className="mt-8 text-[17px] font-semibold">What works today</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[var(--color-text-dim)]">
          <li>The builder’s “Keyboard wiring &amp; connections” view provides native controls for adding parts, connecting pins, rotating parts and removing wires, plus a text connection table.</li>
          <li>The language switch provides English/Hindi navigation and core builder controls. Hindi font files are bundled locally; the offline cache includes them.</li>
          <li>Mission, Chaos and Inspector panels are reachable on smaller screens through “Guidance &amp; inspector”. Escape closes this view and returns keyboard focus to the opener.</li>
          <li>Every page outside the builder can be used with the keyboard alone, with visible focus.</li>
          <li>
            Diagnostics never rely on colour alone: each finding has a title, a plain-language explanation,
            the physics behind it and a fix, and faults are listed as text in the Diagnostics panel.
          </li>
          <li>Navigation landmarks are labelled, and the current page is announced in the main menu.</li>
          <li>Every virtual input slider in the Inputs panel has an accessible name naming its part.</li>
          <li>Status messages in the Chaos Lab and the import/export notices use live regions.</li>
          <li>Numbers and code use a monospace face with tabular figures; body text is never below 13 px.</li>
          <li>
            The canvas is SVG, not a bitmap, so it scales cleanly with browser zoom up to 400 %.
          </li>
        </ul>

        <h2 className="mt-8 text-[17px] font-semibold">Known gaps</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[var(--color-text-dim)]">
          <li>
            <strong>Canvas placement needs a pointer.</strong> Use the text connection view for wiring; precise component positioning and wire routing remain pointer-only. Browser wiring and focus tests pass; screen-reader testing is still needed.
          </li>
          <li>
            <strong>Simulation state is not announced.</strong> A screen reader is not told when an LED
            changes or a relay clicks. The Serial panel and Inspector show state as text you can read, but
            nothing is pushed to you.
          </li>
          <li>
            <strong>No high-contrast theme or reduced-motion setting yet.</strong> The interface does not
            animate much, but the few animations do not yet respect prefers-reduced-motion everywhere.
          </li>
          <li>
            <strong>Partial Hindi translation.</strong> Navigation, simulation controls, keyboard wiring and mission action buttons are translated. Lesson text, component names, inspector details, import/export menus and diagnostic explanations remain English, with language attributes identifying English sections.
          </li>
          <li>
            <strong>Not yet audited.</strong> No automated axe scan or screen-reader test (NVDA, VoiceOver)
            has been run against the builder.
          </li>
        </ul>

        <h2 className="mt-8 text-[17px] font-semibold">Tell us</h2>
        <p className="mt-2 text-[var(--color-text-dim)]">
          If something here stops you from building or learning, that is a bug, and it is one we want to
          hear about. Open an issue in the project repository describing what you tried, what assistive
          technology you use, and what happened.
        </p>
      </main>
    </div>
  );
}
