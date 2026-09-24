/**
 * Netlist-backed virtual digital multimeter (DMM).
 *
 * Implements DC voltage, DC current, resistance, continuity and diode testing.
 * Readings are computed directly from the circuit netlist and simulated potentials.
 * Floating, unpowered, open or ambiguous states are surfaced explicitly
 * (e.g. 'O.L', 'unmeasured', 'floating') without invented noise or fake precision.
 */
import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import { buildNetlist, isResistor, type Netlist } from '@/lib/erc/netlist';
import type { Circuit, VoltageReading } from '../runtime';

export type MultimeterMode = 'dc-v' | 'dc-i' | 'resistance' | 'continuity' | 'diode';

export interface MultimeterReading {
  mode: MultimeterMode;
  probeA: string | null;
  probeB: string | null;
  value: number | null;
  unit: string;
  displayText: string;
  valid: boolean;
  status: 'ok' | 'floating' | 'unpowered' | 'open' | 'overcurrent' | 'unwired' | 'not-running';
  statusMessage: string;
  beep?: boolean;
}

interface GraphEdge {
  to: string;
  weight: number;
}

/**
 * Builds an impedance graph of the schematic to find passive resistance paths.
 * Direct wires and breadboard internal connections have 0 Ω; resistors carry
 * their nominal/configured resistance.
 */
function buildImpedanceGraph(doc: ProjectDoc): Map<string, GraphEdge[]> {
  const graph = new Map<string, GraphEdge[]>();

  const addEdge = (u: string, v: string, weight: number) => {
    if (!graph.has(u)) graph.set(u, []);
    if (!graph.has(v)) graph.set(v, []);
    graph.get(u)!.push({ to: v, weight });
    graph.get(v)!.push({ to: u, weight });
  };

  // Add wires as 0-ohm connections
  for (const conn of doc.diagram.connections) {
    const fromKey = `${conn.from.part}:${conn.from.pin}`;
    const toKey = `${conn.to.part}:${conn.to.pin}`;
    addEdge(fromKey, toKey, 0);
  }

  // Add internal part bonds (resistors, breadboard rows, closed switches)
  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    if (!def) continue;

    if (isResistor(def)) {
      const rawR = inst.attrs.resistance ?? def.defaults?.resistance ?? 220;
      const resistance = typeof rawR === 'number' ? rawR : Number(rawR) || 220;
      addEdge(`${inst.id}:1`, `${inst.id}:2`, resistance);
      continue;
    }

    // Default internal bonds (e.g. breadboard tie points)
    for (const bond of def.bonds ?? []) {
      const p1 = bond[0];
      const p2 = bond[1];
      if (p1 && p2) {
        addEdge(`${inst.id}:${p1}`, `${inst.id}:${p2}`, 0);
      }
    }
  }

  return graph;
}

/**
 * Shortest path resistance between two nodes using Dijkstra's algorithm.
 * Returns Infinity if nodes are disconnected (Open Loop).
 */
export function findPathResistance(doc: ProjectDoc, startNode: string, endNode: string): number {
  if (startNode === endNode) return 0;
  const graph = buildImpedanceGraph(doc);
  if (!graph.has(startNode) || !graph.has(endNode)) return Infinity;

  const distances = new Map<string, number>();
  const visited = new Set<string>();

  distances.set(startNode, 0);

  while (true) {
    let closestNode: string | null = null;
    let closestDist = Infinity;

    for (const [node, dist] of distances) {
      if (!visited.has(node) && dist < closestDist) {
        closestDist = dist;
        closestNode = node;
      }
    }

    if (closestNode === null || closestDist === Infinity) break;
    if (closestNode === endNode) return closestDist;

    visited.add(closestNode);

    const edges = graph.get(closestNode) ?? [];
    for (const edge of edges) {
      if (visited.has(edge.to)) continue;
      const newDist = closestDist + edge.weight;
      const currentDist = distances.get(edge.to) ?? Infinity;
      if (newDist < currentDist) {
        distances.set(edge.to, newDist);
      }
    }
  }

  return distances.get(endNode) ?? Infinity;
}

/**
 * Detects if a diode or LED is connected between probe A (anode) and probe B (cathode).
 */
function findDiodeDrop(doc: ProjectDoc, probeA: string, probeB: string): number | null {
  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    if (def?.adapter === 'led') {
      const anodeKey = `${inst.id}:A`;
      const cathodeKey = `${inst.id}:K`;

      const rAnode = findPathResistance(doc, probeA, anodeKey);
      const rCathode = findPathResistance(doc, probeB, cathodeKey);

      // Probe A reaches Anode through 0-ohm wire and Probe B reaches Cathode through 0-ohm wire
      if (rAnode === 0 && rCathode === 0) {
        const fv = def.defaults?.forwardVoltage;
        return typeof fv === 'number' ? fv : Number(fv) || 2.0;
      }
    }
  }
  return null;
}

export function solveMultimeter(
  doc: ProjectDoc,
  nl: Netlist,
  circuit: Circuit | null,
  mode: MultimeterMode,
  probeA: string | null,
  probeB: string | null,
): MultimeterReading {
  if (!probeA || !probeB) {
    return {
      mode,
      probeA,
      probeB,
      value: null,
      unit: mode === 'dc-v' ? 'V' : mode === 'dc-i' ? 'mA' : 'Ω',
      displayText: '---',
      valid: false,
      status: 'unwired',
      statusMessage: 'Assign both probes to pins or nets to take a measurement.',
    };
  }

  // Resistance mode
  if (mode === 'resistance') {
    const r = findPathResistance(doc, probeA, probeB);
    if (!Number.isFinite(r)) {
      return {
        mode,
        probeA,
        probeB,
        value: null,
        unit: 'Ω',
        displayText: 'O.L',
        valid: true,
        status: 'open',
        statusMessage: 'Open loop: no conductive path between probes.',
      };
    }

    const displayText =
      r >= 1_000_000
        ? `${(r / 1_000_000).toFixed(2)} MΩ`
        : r >= 1_000
          ? `${(r / 1_000).toFixed(2)} kΩ`
          : `${r.toFixed(1)} Ω`;

    return {
      mode,
      probeA,
      probeB,
      value: r,
      unit: 'Ω',
      displayText,
      valid: true,
      status: 'ok',
      statusMessage: `Measured path resistance: ${displayText}.`,
    };
  }

  // Continuity mode
  if (mode === 'continuity') {
    const r = findPathResistance(doc, probeA, probeB);
    const continuous = Number.isFinite(r) && r < 50;

    return {
      mode,
      probeA,
      probeB,
      value: Number.isFinite(r) ? r : null,
      unit: 'Ω',
      displayText: continuous ? `SHORT (< 50 Ω)` : 'OPEN (O.L)',
      valid: true,
      status: continuous ? 'ok' : 'open',
      statusMessage: continuous
        ? `Continuity confirmed: path resistance is ${r.toFixed(1)} Ω.`
        : 'Open circuit: resistance exceeds continuity threshold (50 Ω).',
      beep: continuous,
    };
  }

  // Diode test mode
  if (mode === 'diode') {
    const forwardDrop = findDiodeDrop(doc, probeA, probeB);
    if (forwardDrop !== null) {
      return {
        mode,
        probeA,
        probeB,
        value: forwardDrop,
        unit: 'V',
        displayText: `${forwardDrop.toFixed(3)} V`,
        valid: true,
        status: 'ok',
        statusMessage: `Forward bias detected across diode/LED (${forwardDrop.toFixed(2)} V).`,
      };
    }

    // Check if reverse biased
    const reverseDrop = findDiodeDrop(doc, probeB, probeA);
    if (reverseDrop !== null) {
      return {
        mode,
        probeA,
        probeB,
        value: null,
        unit: 'V',
        displayText: 'O.L',
        valid: true,
        status: 'open',
        statusMessage: 'Diode reverse-biased: blocking test current.',
      };
    }

    return {
      mode,
      probeA,
      probeB,
      value: null,
      unit: 'V',
      displayText: 'O.L',
      valid: true,
      status: 'open',
      statusMessage: 'No forward-biased diode detected between probes.',
    };
  }

  // For DC Voltage and DC Current, simulation must be running
  if (!circuit) {
    return {
      mode,
      probeA,
      probeB,
      value: null,
      unit: mode === 'dc-v' ? 'V' : 'mA',
      displayText: mode === 'dc-v' ? '--- V' : '--- mA',
      valid: false,
      status: 'not-running',
      statusMessage: 'Simulation is stopped. Start the simulation to measure active voltages and currents.',
    };
  }

  const vA = circuit.nodeVoltage(probeA);
  const vB = circuit.nodeVoltage(probeB);

  if (vA.kind === 'unmeasured' || vB.kind === 'unmeasured') {
    const unmeasured = vA.kind === 'unmeasured' ? vA : (vB as { kind: 'unmeasured'; reason: string });
    return {
      mode,
      probeA,
      probeB,
      value: null,
      unit: mode === 'dc-v' ? 'V' : 'mA',
      displayText: mode === 'dc-v' ? '--- V' : '--- mA',
      valid: false,
      status: 'floating',
      statusMessage: `Probe placed on an unmeasured node (${unmeasured.reason}). Circuit node may be floating, unpowered, or unwired.`,
    };
  }

  // Mode: DC Voltage
  if (mode === 'dc-v') {
    const diff = vA.volts - vB.volts;
    const sign = diff >= 0 ? '+' : '';
    const displayText = `${sign}${diff.toFixed(3)} V`;

    return {
      mode,
      probeA,
      probeB,
      value: Math.round(diff * 1000) / 1000,
      unit: 'V',
      displayText,
      valid: true,
      status: 'ok',
      statusMessage: `Potential difference: ${vA.volts.toFixed(3)} V - ${vB.volts.toFixed(3)} V = ${displayText}`,
    };
  }

  // Mode: DC Current
  if (mode === 'dc-i') {
    const diff = Math.abs(vA.volts - vB.volts);
    const r = findPathResistance(doc, probeA, probeB);

    if (r === 0 && diff > 0.5) {
      return {
        mode,
        probeA,
        probeB,
        value: null,
        unit: 'mA',
        displayText: '> 500 mA (SHORT)',
        valid: false,
        status: 'overcurrent',
        statusMessage: 'Short circuit detected! Probes placed directly across an active voltage source with 0 Ω impedance.',
      };
    }

    if (!Number.isFinite(r) || r === 0) {
      return {
        mode,
        probeA,
        probeB,
        value: 0,
        unit: 'mA',
        displayText: '0.00 mA',
        valid: true,
        status: 'open',
        statusMessage: 'No closed current path between probes (0.00 mA).',
      };
    }

    const currentAmps = diff / r;
    const currentMa = currentAmps * 1000;
    const displayText = `${currentMa.toFixed(2)} mA`;

    return {
      mode,
      probeA,
      probeB,
      value: Math.round(currentMa * 100) / 100,
      unit: 'mA',
      displayText,
      valid: true,
      status: 'ok',
      statusMessage: `Branch current: I = ${diff.toFixed(2)} V / ${r} Ω = ${displayText}`,
    };
  }

  return {
    mode,
    probeA,
    probeB,
    value: null,
    unit: '',
    displayText: '---',
    valid: false,
    status: 'unwired',
    statusMessage: 'Unknown mode.',
  };
}
