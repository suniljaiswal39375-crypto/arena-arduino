'use client';

import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { useState } from 'react';
import { ALL_PARTS, getPart } from '@/lib/parts';
import { useLab } from '@/store/lab';

/** Native form controls provide a pointer-free alternative to the SVG canvas. */
export function ConnectionsPanel() {
  const { t, locale } = useI18n();
  const doc = useLab(s => s.doc);
  const [type, setType] = useState('led');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState<{ key: MessageKey; values?: Record<string, string | number> } | null>(null);
  const ends = doc.diagram.parts.flatMap(part => (getPart(part.type)?.pins ?? []).map(pin => ({
    value: JSON.stringify({ part: part.id, pin: pin.name }),
    label: `${part.label ?? getPart(part.type)?.name ?? part.type} (${part.id}) — ${pin.name}`,
  })));
  const endpoint = (label: string, value: string, change: (v: string) => void) => (
    <label className="flex min-w-0 max-w-full flex-col gap-1">{label}
      <select className="input min-w-0 max-w-full" value={ends.some(e => e.value === value) ? value : ''} onChange={e => change(e.target.value)} required>
        <option value="">{t('choosePin')}</option>
        {ends.map(e => <option lang="en" key={e.value} value={e.value}>{e.label}</option>)}
      </select>
    </label>
  );
  return <section lang={locale} aria-label={t('circuitRegion')} className="h-full overflow-auto p-3 text-sm">
    <h2 className="font-semibold">{t('circuitCommands')}</h2>
    <p className="my-2 text-[var(--color-text-dim)]">{t('keyboardHelp')}</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
      e.preventDefault();
      const id = useLab.getState().addPartAt(type, 320 + (doc.diagram.parts.length % 4) * 160, 160);
      setMessage(id ? { key: 'added', values: { name: getPart(type)?.name ?? type } } : { key: 'addFailed' });
    }}>
      <label className="flex min-w-0 max-w-full flex-col gap-1">{t('component')}
        <select className="input min-w-0 max-w-full" value={type} onChange={e => setType(e.target.value)}>
          {ALL_PARTS.map(p => <option lang="en" key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <button className="btn" type="submit">{t('addComponent')}</button>
    </form>
    <form className="my-4 grid gap-2 sm:grid-cols-3" onSubmit={e => {
      e.preventDefault();
      if (!ends.some(v => v.value === from) || !ends.some(v => v.value === to)) return;
      const store = useLab.getState();
      const count = store.doc.diagram.connections.length;
      store.startWire(JSON.parse(from), 0, 0);
      store.finishWire(JSON.parse(to));
      setMessage({ key: useLab.getState().doc.diagram.connections.length > count ? 'connected' : 'noConnection' });
    }}>
      {endpoint(t('fromPin'), from, setFrom)}
      {endpoint(t('toPin'), to, setTo)}
      <button className="btn self-end" type="submit">{t('connectPins')}</button>
    </form>
    <p role="status" aria-live="polite" className="my-2">{message ? t(message.key, message.values) : ''}</p>
    <div className="overflow-x-auto"><table className="w-full text-left">
      <caption className="text-left font-semibold">{t('connections', { count: doc.diagram.connections.length })}</caption>
      <thead><tr><th scope="col">{t('from')}</th><th scope="col">{t('to')}</th><th scope="col">{t('colour')}</th><th scope="col">{t('action')}</th></tr></thead>
      <tbody>{doc.diagram.connections.map(w => <tr key={w.id}>
        <td>{w.from.part}: {w.from.pin}</td><td>{w.to.part}: {w.to.pin}</td><td>{w.color}</td>
        <td><button className="btn btn-sm" type="button" aria-label={t('removeWire', { fromPart: w.from.part, fromPin: w.from.pin, toPart: w.to.part, toPin: w.to.pin })} onClick={() => {
          useLab.getState().apply({ t: 'removeWire', id: w.id }); setMessage({ key: 'wireRemoved' });
        }}>{t('remove')}</button></td>
      </tr>)}</tbody>
    </table></div>
    <h3 className="mt-4 font-semibold">{t('placed')}</h3>
    <ul>{doc.diagram.parts.map(p => <li key={p.id} className="my-2 flex flex-wrap items-center gap-2">
      <span lang="en">{getPart(p.type)?.name ?? p.type} ({p.id})</span>
      <button className="btn btn-sm" type="button" aria-label={t('rotatePart', { id: p.id })} onClick={() => useLab.getState().apply({ t: 'rotatePart', id: p.id })}>{t('rotate')}</button>
      <button className="btn btn-sm" type="button" aria-label={t('removePart', { id: p.id })} onClick={() => {
        useLab.getState().apply({ t: 'removePart', id: p.id }); setMessage({ key: 'partRemoved', values: { id: p.id } });
      }}>{t('remove')}</button>
    </li>)}</ul>
  </section>;
}
