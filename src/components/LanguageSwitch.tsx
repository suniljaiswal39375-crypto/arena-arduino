'use client';
import { useI18n } from '@/lib/i18n/client';
import { parseLocale } from '@/lib/i18n/messages';

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return <label lang={locale} className="flex shrink-0 items-center gap-1 text-xs">
    <span className="sr-only">{t('language')}</span>
    <select className="input" style={{ width: 100 }} value={locale} onChange={e => setLocale(parseLocale(e.target.value))}>
      <option lang="en" value="en">English</option>
      <option lang="hi" value="hi">हिंदी</option>
    </select>
  </label>;
}
