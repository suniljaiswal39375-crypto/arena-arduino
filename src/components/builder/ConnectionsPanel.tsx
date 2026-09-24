'use client';

import { useState } from 'react';
import { ALL_PARTS, getPart } from '@/lib/parts';
import { useLab } from '@/store/lab';

/** Native form controls provide a pointer-free alternative to the SVG canvas. */
export function ConnectionsPanel() {
  const doc = useLab(s => s.doc);
  const [type, setType] = useState('led');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const ends = doc.diagram.parts.flatMap(part => (getPart(part.type)?.pins ?? []).map(pin => ({
    value: JSON.stringify({ part: part.id, pin: pin.name }),
    label: `${part.label ?? getPart(part.type)?.name ?? part.type} (${part.id}) — ${pin.name}`,
  })));
  const endpoint = (label: string, value: string, change: (v: string) => void) => (
    <label className="flex flex-col gap-1">{label}
      <select className="input" value={ends.some(e => e.value === value) ? value : ''} onChange={e => change(e.target.value)} required>
        <option value="">Choose a pin</option>
        {ends.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
      </select>
    </label>
  );
  return <section aria-label="Circuit commands and connections" className="h-full overflow-auto p-3 text-sm">
    <h2 className="font-semibold">Circuit commands</h2>
    <p className="my-2 text-[var(--color-text-dim)]">Use Tab and the arrow keys to choose parts and pins. All changes support Undo.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
      e.preventDefault();
      const id = useLab.getState().addPartAt(type, 320 + (doc.diagram.parts.length % 4) * 160, 160);
      setMessage(id ? `Added ${getPart(type)?.name}.` : 'Could not add that part.');
    }}>
      <label className="flex flex-col gap-1">Component
        <select className="input" value={type} onChange={e => setType(e.target.value)}>
          {ALL_PARTS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <button className="btn" type="submit">Add component</button>
    </form>
    <form className="my-4 grid gap-2 sm:grid-cols-3" onSubmit={e => {
      e.preventDefault();
      if (!ends.some(v => v.value === from) || !ends.some(v => v.value === to)) return;
      const store = useLab.getState();
      const count = store.doc.diagram.connections.length;
      store.startWire(JSON.parse(from), 0, 0);
      store.finishWire(JSON.parse(to));
      setMessage(useLab.getState().doc.diagram.connections.length > count ? 'Wire connected.' : 'No change: select two different pins without an existing wire.');
    }}>
      {endpoint('From pin', from, setFrom)}
      {endpoint('To pin', to, setTo)}
      <button className="btn self-end" type="submit">Connect pins</button>
    </form>
    <p role="status" aria-live="polite" className="my-2">{message}</p>
    <table className="w-full text-left">
      <caption className="text-left font-semibold">Connections ({doc.diagram.connections.length})</caption>
      <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Colour</th><th scope="col">Action</th></tr></thead>
      <tbody>{doc.diagram.connections.map(w => <tr key={w.id}>
        <td>{w.from.part}: {w.from.pin}</td><td>{w.to.part}: {w.to.pin}</td><td>{w.color}</td>
        <td><button className="btn btn-sm" type="button" aria-label={`Remove wire ${w.from.part} ${w.from.pin} to ${w.to.part} ${w.to.pin}`} onClick={() => {
          useLab.getState().apply({ t: 'removeWire', id: w.id }); setMessage('Wire removed.');
        }}>Remove</button></td>
      </tr>)}</tbody>
    </table>
    <h3 className="mt-4 font-semibold">Placed components</h3>
    <ul>{doc.diagram.parts.map(p => <li key={p.id} className="my-2 flex flex-wrap items-center gap-2">
      <span>{getPart(p.type)?.name ?? p.type} ({p.id})</span>
      <button className="btn btn-sm" type="button" aria-label={`Rotate ${p.id}`} onClick={() => useLab.getState().apply({ t: 'rotatePart', id: p.id })}>Rotate</button>
      <button className="btn btn-sm" type="button" aria-label={`Remove ${p.id}`} onClick={() => {
        useLab.getState().apply({ t: 'removePart', id: p.id }); setMessage(`Removed ${p.id} and its wires.`);
      }}>Remove</button>
    </li>)}</ul>
  </section>;
}
