import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { buildNetlist } from '@/lib/erc/netlist';
import { PRODUCT_NAME, PRODUCT_VERSION } from '@/lib/brand';

/** Bill of materials rows: one per part type, with the ids of every instance. */
export function bomRows(doc: ProjectDoc): Array<{ type: string; name: string; category: string; quantity: number; refs: string[] }> {
  const rows = new Map<string, { type: string; name: string; category: string; quantity: number; refs: string[] }>();
  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    const row = rows.get(inst.type) ?? {
      type: inst.type,
      name: def?.name ?? inst.type,
      category: def?.category ?? 'Unknown',
      quantity: 0,
      refs: [],
    };
    row.quantity++;
    row.refs.push(inst.id);
    rows.set(inst.type, row);
  }
  return [...rows.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** BOM as CSV, ready for a spreadsheet or a purchase order. */
export function bomCsv(doc: ProjectDoc): string {
  const lines = [['Quantity', 'Part', 'Category', 'Type', 'References'].join(',')];
  for (const r of bomRows(doc)) {
    lines.push([r.quantity, r.name, r.category, r.type, r.refs.join(' ')].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** KiCad's S-expression string quoting. */
function q(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The circuit as a KiCad netlist (S-expression, the format KiCad's PCB editor
 * imports). Footprints are left for the designer to assign: SparkLab parts are
 * modules and breakouts, and guessing a footprint would be worse than asking.
 * Nets containing a single pin are omitted, as KiCad does.
 */
export function kicadNetlist(doc: ProjectDoc): string {
  const nl = buildNetlist(doc);
  const out: string[] = [];
  out.push('(export (version "E")');
  out.push('  (design');
  out.push(`    (source ${q(`${doc.name}.sparklab.json`)})`);
  out.push(`    (tool ${q(`${PRODUCT_NAME} ${PRODUCT_VERSION}`)}))`);
  out.push('  (components');
  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    out.push(`    (comp (ref ${q(inst.id)})`);
    out.push(`      (value ${q(def?.name ?? inst.type)})`);
    out.push(`      (libsource (lib "sparklab") (part ${q(inst.type)}) (description ${q(def?.category ?? '')})))`);
  }
  out.push('  )');
  out.push('  (nets');

  const nets = [...nl.nets.values()].filter((n) => n.nodes.length > 1);
  nets.forEach((net, i) => {
    const rp = net.nodes.map((k) => nl.nodes.get(k)).filter((x) => x !== undefined);
    const named = rp.find((p) => p.pin.electrical === 'ground')
      ? 'GND'
      : net.isPower && net.voltage !== null
        ? `+${String(net.voltage).replace('.', 'V')}${String(net.voltage).includes('.') ? '' : 'V'}`
        : `Net-${i + 1}`;
    out.push(`    (net (code ${q(String(i + 1))}) (name ${q(named)})`);
    for (const p of rp) out.push(`      (node (ref ${q(p.partId)}) (pin ${q(p.pin.name)}))`);
    out.push('    )');
  });
  out.push('  )');
  out.push(')');
  return `${out.join('\n')}\n`;
}
