import { getPart } from '@/lib/parts';
import type { PartDef, PinDef } from '@/lib/parts/types';
import type { ProjectDoc } from '@/lib/doc/types';
import { refKey, type PinRef } from '@/lib/doc/types';

export type NodeKey = string;

export interface ResolvedPin {
  partId: string;
  partType: string;
  part: PartDef;
  pin: PinDef;
}

export interface NetInfo {
  id: string;
  nodes: NodeKey[];
  /** Nominal voltage if a supply drives this net, otherwise null. */
  voltage: number | null;
  /** A supply (a board's 5V/3V3 pin, a battery, a power bank) drives this net. */
  isPower: boolean;
  /** A real ground reference (a board GND, a supply's negative) is on this net. */
  isGround: boolean;
  /** True when some output-capable pin drives the net. */
  driven: boolean;
  /** Every distinct supply voltage on the net, for back-powering checks. */
  supplies: number[];
}

export interface NetlistOptions {
  /**
   * Treat a resistor as a wire when grouping nets (the default). That is right
   * for asking "which parts share a signal" and wrong for asking "is this a
   * short circuit": 5V through a resistor to GND is a load, not a short.
   */
  resistorsAsWires?: boolean;
}

/**
 * The voltage a pin *supplies*, or null if the pin consumes power.
 *
 * A sensor's VCC pin is a load, not a source. Treating it as a source was a
 * real bug: a 3.3 V sensor on the Uno's 3V3 pin was reported as sitting on a
 * 5 V rail because the board's nominal supply leaked onto every power pin.
 */
export function supplyVoltage(part: PartDef, pin: PinDef): number | null {
  if (pin.electrical !== 'power') return null;
  if (part.adapter === 'power') {
    const v = part.defaults?.voltage;
    return typeof v === 'number' ? v : (part.supply ?? null);
  }
  if (part.adapter !== 'board') return null;
  const name = pin.name.toUpperCase();
  if (name === '3V3' || name === '3.3V') return 3.3;
  if (name === '5V') return 5;
  // VIN, VSYS and friends are inputs to the regulator, not outputs.
  if (name === 'VIN' || name === 'VSYS' || name === 'VBUS') return null;
  return part.supply ?? null;
}

/** A ground pin that is a real reference, rather than a module's GND input. */
export function isGroundSource(part: PartDef, pin: PinDef): boolean {
  return pin.electrical === 'ground' && (part.adapter === 'board' || part.adapter === 'power');
}

export interface Netlist {
  nets: Map<string, NetInfo>;
  nodeNet: Map<NodeKey, string>;
  nodes: Map<NodeKey, ResolvedPin>;
  /** Board part ids present on the canvas. */
  boards: string[];
}

class DSU {
  private parent = new Map<NodeKey, NodeKey>();

  add(x: NodeKey): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }

  find(x: NodeKey): NodeKey {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) {
      const next = this.parent.get(root);
      if (next === undefined) break;
      root = next;
    }
    // Path compression
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      if (next === undefined) break;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: NodeKey, b: NodeKey): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** True for the two-legged resistor parts, whose bond is a resistance, not a wire. */
export function isResistor(def: PartDef | undefined): boolean {
  return def?.id === 'resistor' || def?.id === 'emu-resistor';
}

export function netKey(ref: PinRef): NodeKey {
  return refKey(ref);
}

/**
 * Build the netlist for a document. Incremental in spirit: the caller rebuilds
 * after each command, which is well under the 8 ms budget for typical projects.
 */
export function buildNetlist(doc: ProjectDoc, options: NetlistOptions = {}): Netlist {
  const resistorsAsWires = options.resistorsAsWires ?? true;
  const dsu = new DSU();
  const nodes = new Map<NodeKey, ResolvedPin>();
  const boards: string[] = [];

  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    if (!def) continue;
    if (def.adapter === 'board') boards.push(inst.id);
    for (const pin of def.pins) {
      const key = `${inst.id}:${pin.name}`;
      dsu.add(key);
      nodes.set(key, { partId: inst.id, partType: inst.type, part: def, pin });
    }
  }

  // Pins bonded inside a part (the two legs of a resistor) are one node.
  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    if (!resistorsAsWires && isResistor(def)) continue;
    for (const bond of def?.bonds ?? []) {
      const a = bond[0];
      const b = bond[1];
      if (a && b) dsu.union(`${inst.id}:${a}`, `${inst.id}:${b}`);
    }
  }

  for (const w of doc.diagram.connections) {
    dsu.union(netKey(w.from), netKey(w.to));
  }

  // Group nodes by root, then classify each net.
  const grouped = new Map<NodeKey, NodeKey[]>();
  for (const key of nodes.keys()) {
    const root = dsu.find(key);
    const arr = grouped.get(root);
    if (arr) arr.push(key);
    else grouped.set(root, [key]);
  }

  const nets = new Map<string, NetInfo>();
  const nodeNet = new Map<NodeKey, string>();

  for (const [root, members] of grouped) {
    let voltage: number | null = null;
    let isPower = false;
    let isGround = false;
    let driven = false;
    const supplies: number[] = [];

    for (const key of members) {
      const rp = nodes.get(key);
      if (!rp) continue;
      const v = supplyVoltage(rp.part, rp.pin);
      if (v !== null) {
        isPower = true;
        voltage = Math.max(voltage ?? 0, v);
        if (!supplies.includes(v)) supplies.push(v);
      }
      if (isGroundSource(rp.part, rp.pin)) isGround = true;
      if (
        rp.pin.electrical === 'digital' ||
        rp.pin.electrical === 'pwm' ||
        rp.pin.electrical === 'analog'
      ) {
        // A board pin can drive; a sensor pin generally listens.
        if (rp.part.adapter === 'board') driven = true;
      }
      nodeNet.set(key, root);
    }

    nets.set(root, {
      id: root,
      nodes: members.sort(),
      voltage,
      isPower,
      isGround,
      driven,
      supplies: supplies.sort((a, b) => a - b),
    });
  }

  return { nets, nodeNet, nodes, boards };
}

export function netOf(nl: Netlist, ref: PinRef): NetInfo | undefined {
  const id = nl.nodeNet.get(netKey(ref));
  return id ? nl.nets.get(id) : undefined;
}

export function pinsOnNet(nl: Netlist, netId: string): ResolvedPin[] {
  const net = nl.nets.get(netId);
  if (!net) return [];
  return net.nodes
    .map((k) => nl.nodes.get(k))
    .filter((v): v is ResolvedPin => v !== undefined);
}

/** Every wire that touches a given net, for highlighting in the UI. */
export function wiresOnNet(doc: ProjectDoc, nl: Netlist, netId: string): string[] {
  return doc.diagram.connections
    .filter((w) => {
      const a = nl.nodeNet.get(netKey(w.from));
      const b = nl.nodeNet.get(netKey(w.to));
      return a === netId || b === netId;
    })
    .map((w) => w.id);
}

/** Series resistance sitting on the path between two pins of the same net group. */
export function seriesResistance(doc: ProjectDoc, nl: Netlist, anode: PinRef, cathode: PinRef): number | null {
  const na = netOf(nl, anode);
  const nb = netOf(nl, cathode);
  if (!na || !nb) return null;
  let total = 0;
  let found = false;
  for (const netId of new Set([na.id, nb.id])) {
    for (const rp of pinsOnNet(nl, netId)) {
      if (isResistor(rp.part)) {
        const inst = doc.diagram.parts.find((p) => p.id === rp.partId);
        const r = inst?.attrs.resistance ?? rp.part.defaults?.resistance ?? 220;
        total += typeof r === 'number' ? r : Number(r);
        found = true;
      }
    }
  }
  return found ? total : null;
}
