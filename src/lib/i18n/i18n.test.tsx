import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { en, hi, parseLocale, translate, type MessageKey } from './messages';
import { LanguageProvider, useI18n } from './client';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { ConnectionsPanel } from '@/components/builder/ConnectionsPanel';
import { Toolbar } from '@/components/builder/Toolbar';
import { firstRunDoc, useLab } from '@/store/lab';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
describe('English / Hindi message catalogue', () => {
  it('has a nonempty Hindi translation for every English key', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as MessageKey[]) expect(hi[key].trim(), key).not.toBe('');
  });
  it('preserves every interpolation variable in both languages', () => {
    for (const key of Object.keys(en) as MessageKey[]) expect(placeholders(hi[key]), key).toEqual(placeholders(en[key]));
  });
  it.each([null, undefined, 'fr', 'HI', '<script>', {}, 1])('falls back to English for invalid locale %j', value => {
    expect(parseLocale(value)).toBe('en');
  });
  it('accepts only the supported locale values', () => {
    expect(parseLocale('hi')).toBe('hi'); expect(parseLocale('en')).toBe('en');
  });
  it('interpolates pin identifiers without translating them', () => {
    expect(translate('hi', 'removeWire', { fromPart: 'uno', fromPin: 'D13', toPart: 'r1', toPin: '1' }))
      .toBe('uno D13 से r1 1 तक का तार हटाएं');
  });
  it('does not interpret markup or omit zero values', () => {
    expect(translate('hi', 'connections', { count: 0 })).toBe('कनेक्शन (0)');
    expect(translate('en', 'added', { name: '<script>alert(1)</script>' })).toBe('Added <script>alert(1)</script>.');
    expect(translate('en', 'added')).toBe('Added {name}.');
  });
});

function Label() {
  const { t, locale } = useI18n();
  return <p lang={locale}>{t('added', { name: '<script>' })}</p>;
}
describe('translated controls', () => {
  it('keeps server output English by default and escapes text', () => {
    expect(renderToString(<LanguageProvider><Label /></LanguageProvider>)).toBe('<p lang="en">Added &lt;script&gt;.</p>');
  });
  it('renders Hindi controls and a bilingual language label', () => {
    const html = renderToString(<LanguageProvider initialLocale="hi"><LanguageSwitch /><Label /></LanguageProvider>);
    expect(html).toContain('lang="hi"');
    expect(html).toContain('Language / भाषा');
    expect(html).toContain('&lt;script&gt; जोड़ा गया।');
  });
  it('translates connection controls without mutating the circuit', () => {
    useLab.getState().loadDoc(firstRunDoc());
    Object.assign(useLab.getInitialState(), useLab.getState());
    const before = JSON.stringify(useLab.getState().doc);
    const html = renderToString(<LanguageProvider initialLocale="hi"><ConnectionsPanel /></LanguageProvider>);
    expect(html).toContain('पहला पिन');
    expect(html).toContain('पिन जोड़ें');
    expect(html).toContain('कनेक्शन (3)');
    expect(html).toContain('uno D13 से r1 1 तक का तार हटाएं');
    expect(JSON.stringify(useLab.getState().doc)).toBe(before);
  });
  it('translates toolbar actions and offers the AVR firmware mode', () => {
    const html = renderToString(<LanguageProvider initialLocale="hi"><Toolbar running={false} snapshot={null}
      onRun={() => undefined} onStop={() => undefined} onReset={() => undefined} onSpeed={() => undefined} speed={1} /></LanguageProvider>);
    expect(html).toContain('चलाएं');
    expect(html).toContain('परियोजना का नाम');
    expect(html).toContain('aria-label="पूर्ववत करें"');
    expect(html).toContain('value="firmware"');
    expect(html).not.toContain('value="firmware" disabled=""');
  });
});
