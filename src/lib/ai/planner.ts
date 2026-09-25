import type { ProjectDoc } from '@/lib/doc/types';
import { ALL_PARTS, resolvePart, getPart } from '@/lib/parts';
import { templateDoc, templates } from '@/lib/templates';
import { MISSIONS, missionBySlug, type Mission } from '@/lib/missions/missions';
import { checkMission } from '@/lib/missions/validate';
import type { ToolCallInput, ToolContext } from './tools';
import { DEFAULT_FILES } from '@/lib/doc/types';

/**
 * The deterministic rule-based mentor (spec §12.1 offline fallback).
 *
 * When no model gateway is configured — the default for a zero-config lab, and
 * the guaranteed behaviour offline — this planner turns the student's message
 * into a plan, a reply and typed tool calls. It is pure: same input, same
 * turn, every time. It reads the live circuit through the same ToolContext the
 * hosted path would use, so switching engines never changes behaviour.
 *
 * Guardrail first: when a mission is active the planner teaches (hints from
 * the failing step) and never emits the reference solution — no intent can
 * produce it, which is a stronger guarantee than asking a model nicely.
 */

export type Locale = 'en' | 'hi';

export interface PlannerInput {
  /** Student text, already injection-filtered by the session. */
  text: string;
  locale: Locale;
  ctx: ToolContext;
}

export interface PlannerTurn {
  /** One line: what the mentor is about to do (spec behaviour rule). */
  plan: string;
  /** The teaching reply, in the student's language. */
  reply: string;
  /** Typed tool calls for the session to execute in order. */
  calls: ToolCallInput[];
}

/* ------------------------------------------------------------ text helpers */

const has = (text: string, words: string[]): boolean =>
  words.some((w) => text.includes(w));

/** Longest catalogue name/alias mentioned in the text, resolved to a part def. */
function mentionedPart(text: string): { id: string; name: string } | null {
  let best: { id: string; name: string } | null = null;
  for (const def of ALL_PART_DEFS) {
    for (const label of [def.name, def.id, ...def.aliases]) {
      const needle = label.toLowerCase();
      if (needle.length >= 3 && text.includes(needle)) {
        if (!best || needle.length > best.name.length) best = { id: def.id, name: def.name };
      }
    }
  }
  return best;
}

// Module-level snapshot: the catalogue is static data.
const ALL_PART_DEFS = ALL_PARTS;

/* --------------------------------------------------------- mission helpers */

function failingStep(mission: Mission, doc: ProjectDoc): { instruction: string; hint: string; index: number } | null {
  const confirmed = new Set(doc.provenance.confirmedSteps ?? []);
  const results = checkMission(mission, doc, confirmed);
  const idx = results.findIndex((r) => r.status === 'todo');
  if (idx < 0) return null;
  const step = mission.steps[idx];
  return step ? { instruction: step.instruction, hint: step.hint, index: idx } : null;
}

function activeMission(ctx: ToolContext): Mission | undefined {
  return ctx.missionSlug ? missionBySlug(ctx.missionSlug) : undefined;
}

/** Is the current sketch clearly not student work (default blink or empty)? */
function sketchIsPristine(doc: ProjectDoc): boolean {
  const src = (doc.files['sketch.ino'] ?? '').trim();
  if (!src) return true;
  const pristine = (DEFAULT_FILES['sketch.ino'] ?? '').trim();
  return src === pristine;
}

/* ---------------------------------------------------------------- recipes */

interface Recipe {
  key: string;
  en: string;
  hi: string;
  template: string;
  /** Extra words that signal this recipe beyond the part names themselves. */
  words: string[];
}

const RECIPES: Recipe[] = [
  { key: 'blink', en: 'Blink', hi: 'ब्लिंक', template: 'uno-blink', words: ['blink', 'ब्लिंक'] },
  { key: 'button', en: 'Button + LED', hi: 'बटन + LED', template: 'button-led', words: ['button and led', 'button led', 'push button', 'pushbutton'] },
  { key: 'thermometer', en: 'Temperature & humidity display (DHT11 + LCD)', hi: 'तापमान व आर्द्रता डिस्प्ले (DHT11 + LCD)', template: 'dht-lcd', words: ['thermometer', 'temperature and humidity', 'temperature & humidity', 'weather station', 'तापमान'] },
  { key: 'streetlight', en: 'LDR relay lamp', hi: 'LDR रिले लैंप', template: 'ldr-relay-lamp', words: ['streetlight', 'street light', 'light controlled lamp', 'स्ट्रीटलाइट'] },
  { key: 'radar', en: 'Ultrasonic distance alert', hi: 'अल्ट्रासोनिक दूरी अलर्ट', template: 'ultrasonic-radar', words: ['parking radar', 'distance sensor', 'ultrasonic', 'पार्किंग रडार'] },
];

/**
 * Turn a template into typed tool calls against the current canvas: place what
 * is missing, wire by type, and load the template sketch. The wire tool
 * resolves catalogue types to the single instance on the canvas, so this
 * composes cleanly with parts the student already has.
 */
function recipeCalls(doc: ProjectDoc, recipe: Recipe): { calls: ToolCallInput[]; missing: string[]; wired: number } {
  const tmpl = templateDoc(recipe.template);
  if (!tmpl) return { calls: [], missing: [], wired: 0 };
  const presentTypes = new Map<string, number>();
  for (const p of doc.diagram.parts) presentTypes.set(p.type, (presentTypes.get(p.type) ?? 0) + 1);
  const calls: ToolCallInput[] = [];
  const missing: string[] = [];
  const placedIdByType = new Map<string, string>();
  let row = 0;
  for (const p of tmpl.diagram.parts) {
    const have = presentTypes.get(p.type) ?? 0;
    if (have > 0) {
      placedIdByType.set(p.type, 'existing');
      presentTypes.set(p.type, have - 1);
    } else {
      const def = getPart(p.type);
      calls.push({ tool: 'placePart', part: p.type, x: 320, y: 60 + row * 130 });
      missing.push(def?.name ?? p.type);
      placedIdByType.set(p.type, 'new');
      row++;
    }
  }
  let wired = 0;
  for (const w of tmpl.diagram.connections) {
    const fromType = tmpl.diagram.parts.find((p) => p.id === w.from.part)?.type;
    const toType = tmpl.diagram.parts.find((p) => p.id === w.to.part)?.type;
    if (!fromType || !toType) continue;
    // Only wire pairs we know resolve (unique instance, existing or just placed).
    const countOf = (t: string) => doc.diagram.parts.filter((p) => p.type === t).length + (placedIdByType.get(t) === 'new' ? 1 : 0);
    if (countOf(fromType) === 1 && countOf(toType) === 1) {
      calls.push({
        tool: 'wire',
        from: { part: fromType, pin: w.from.pin },
        to: { part: toType, pin: w.to.pin },
        colour: w.color,
      });
      wired++;
    }
  }
  calls.push({
    tool: 'writeSketch',
    code: tmpl.files['sketch.ino'] ?? '',
    mode: 'replace',
    // Overwriting the untouched starter sketch is not destroying student work.
    ...(sketchIsPristine(doc) ? { confirm: true } : {}),
  });
  return { calls, missing, wired };
}

/* ----------------------------------------------------------------- planner */

export function planTurn(input: PlannerInput): PlannerTurn {
  const text = input.text.toLowerCase().trim();
  const { ctx, locale } = input;
  const hi = locale === 'hi';
  const mission = activeMission(ctx);

  // 1. Asking for the answer on an open mission: the smallest hint instead.
  const asksSolution = has(text, [
    'solution', 'the answer', 'answer key', 'give me the code', 'write the code for me',
    'do it for me', 'just do it', 'full code', 'reference code', 'reveal',
    'समाधान', 'उत्तर', 'पूरा कोड', 'मेरे लिए लिखो',
  ]);
  if (asksSolution && mission) {
    const step = failingStep(mission, ctx.doc);
    if (step) {
      return {
        plan: hi ? 'मैं लॉक किए गए समाधान की जगह सबसे छोटा संकेत दूँगा।' : 'I will give the smallest hint instead of the locked solution.',
        reply: hi
          ? `मैं समाधान नहीं दूँगा — मिशन खुला है, और खुद हल करने से ही सीखना होता है। अभी आप यह चरण कर रहे हैं: ${step.instruction}\nसंकेत: ${step.hint}`
          : `I will not hand over the solution — the mission is open, and working it out is the learning. The step you are on: ${step.instruction}\nSmallest hint: ${step.hint}`,
        calls: [],
      };
    }
    // Steps all pass: the reference is unlocked; say so rather than dumping it.
    return {
      plan: hi ? 'मैं जाँचूँगा कि क्या संदर्भ खुल गया है।' : 'I will check whether the reference is unlocked.',
      reply: hi
        ? 'हर चरण पास हो रहा है — संदर्भ अब अनलॉक है। StepTracker से "Reveal the reference sketch" दबाएँ और अंतर देखें।'
        : 'Every step passes — the reference is unlocked now. Use "Reveal the reference sketch" in the step tracker and compare.',
      calls: [{ tool: 'diffAgainstReference' }],
    };
  }

  // 2. Hints on the current step.
  if (has(text, ['hint', 'stuck', 'help me', 'what next', 'संकेत', 'मदद', 'फंस', 'आगे क्या'])) {
    if (mission) {
      const step = failingStep(mission, ctx.doc);
      if (step) {
        return {
          plan: hi ? 'मैं वर्तमान चरण का संकेत दूँगा।' : 'I will read the failing step and give its hint.',
          reply: hi
            ? `चरण ${step.index + 1}: ${step.instruction}\nसंकेत: ${step.hint}`
            : `Step ${step.index + 1}: ${step.instruction}\nHint: ${step.hint}`,
          calls: [{ tool: 'summariseMistake' }],
        };
      }
      return {
        plan: hi ? 'मैं जाँचूँगा कि क्या बचा है।' : 'I will check what is left.',
        reply: hi ? 'सभी स्वतः-जाँचे पास हैं। बचे मैन्युअल चरण स्वयं पुष्टि करें।' : 'Every auto-checked step passes. Confirm any remaining manual steps yourself.',
        calls: [],
      };
    }
    // No mission: fall through to diagnosis below.
    return {
      plan: hi ? 'मैं सर्किट की जाँच करूँगा।' : 'I will check your circuit and sketch.',
      reply: hi
        ? 'कोई मिशन सक्रिय नहीं है। मैं ERC जाँच चलाकर सबसे बड़ी समस्या बताता हूँ।'
        : 'No mission is active, so I will run the electrical check and explain the worst finding.',
      calls: [{ tool: 'readDiagnostics' }, { tool: 'summariseMistake' }],
    };
  }

  // 3. Diagnosis.
  if (has(text, ['why', 'not working', "doesn't work", 'does not work', 'wrong', 'error', 'broken', 'problem', 'fix', 'fault', 'क्यों', 'नहीं चल', 'गड़बड़', 'त्रुटि', 'ठीक'])) {
    return {
      plan: hi ? 'मैं निदान चलाकर सबसे बड़ी समस्या समझाऊँगा।' : 'I will run diagnostics and explain the worst problem first.',
      reply: hi
        ? 'पहले बिजली की जाँच (ERC), फिर वहीं से सुधार का तरीका।'
        : 'Electrical check first, then the fix for whatever it finds — worst problem first.',
      calls: [{ tool: 'readDiagnostics' }, { tool: 'summariseMistake' }],
    };
  }

  // 4. Sketch explanation.
  if (has(text, ['explain', 'what does this code', 'what does my sketch', 'read my code', 'समझाओ', 'यह कोड', 'कोड समझ'])) {
    return {
      plan: hi ? 'मैं स्केच को पंक्ति-दर-पंक्ति समझाऊँगा।' : 'I will walk through your sketch.',
      reply: hi ? 'मैं पिन उपयोग, संरचना और देरी (delay) देखूँगा।' : 'I will summarise structure, pin use and any long delays.',
      calls: [{ tool: 'explainSketch' }],
    };
  }

  // 5. Run it.
  if (has(text, ['run', 'simulate', 'test it', 'try it', 'चलाओ', 'चलाएँ', 'परख'])) {
    return {
      plan: hi ? 'मैं सिमुलेशन चलाकर आउटपुट बताऊँगा।' : 'I will run the simulation and report what happens.',
      reply: hi ? 'वर्चुअल समय पर हेडलेस रन — असली दुनिया का कोई समय नहीं लगेगा।' : 'A headless run on virtual time — it costs no real seconds.',
      calls: [{ tool: 'runSimulation', ms: 2000 }, { tool: 'readSerial', tail: 20 }],
    };
  }

  // 6. Serial.
  if (has(text, ['serial', 'print out', 'monitor', 'सीरियल', 'आउटपुट देख'])) {
    return {
      plan: hi ? 'मैं सीरियल आउटपुट पढ़ूँगा।' : 'I will read the serial output.',
      reply: hi ? 'अंतिम पंक्तियाँ देखता हूँ।' : 'Let me read the latest lines.',
      calls: [{ tool: 'readSerial', tail: 30 }],
    };
  }

  // 7. Next mission.
  if (has(text, ['next mission', 'what should i build', 'recommend', 'अगला अभ्यास', 'आगे क्या बनाऊँ'])) {
    return {
      plan: hi ? 'मैं आपकी प्रगति देखकर अगला अभ्यास सुझाऊँगा।' : 'I will look at your progress and recommend the next mission.',
      reply: hi ? 'पहले वही अभ्यास जिसकी पूर्व-आवश्यकताएँ आपने पूरी की हैं।' : 'First mission whose prerequisites you have already finished.',
      calls: [{ tool: 'recommendNextMission' }],
    };
  }

  // 8. Build recipes (acceptance criterion 5: "make a thermometer…").
  for (const recipe of RECIPES) {
    if (!has(text, recipe.words)) continue;
    if (mission) {
      const step = failingStep(mission, ctx.doc);
      return {
        plan: hi ? 'मिशन के दौरान मैं सीधे नहीं बनाऊँगा।' : 'I will not build it for you during a mission.',
        reply: hi
          ? `मिशन चल रहा है — मैं पूरा प्रोजेक्ट नहीं बनाऊँगा। ${step ? `अभी का चरण: ${step.instruction}\nसंकेत: ${step.hint}` : ''}`
          : `A mission is active, so I will not drop a full project on your canvas. ${step ? `Current step: ${step.instruction}\nHint: ${step.hint}` : ''}`,
        calls: [],
      };
    }
    const { calls, missing, wired } = recipeCalls(ctx.doc, recipe);
    if (calls.length === 0) continue;
    return {
      plan: hi
        ? `मैं ${missing.length} घटक जोड़ूँगा, ${wired} तार लगाऊँगा और स्केच लिखूँगा।`
        : `I will place ${missing.length} part(s), add ${wired} wire(s), then write the sketch.`,
      reply: hi
        ? `${recipe.hi} बना रहा हूँ। जोड़े जा रहे घटक: ${missing.join(', ') || 'कोई नहीं — सब मौजूद हैं'}। हर कदम Ctrl+Z से वापस हो सकता है।`
        : `Building ${recipe.en}. Parts to place: ${missing.join(', ') || 'none — you already have them'}. Every step is undoable with Ctrl+Z, and replacing your sketch asks first.`,
      calls,
    };
  }

  // 9. Single-part add.
  const part = mentionedPart(text);
  if (part && has(text, ['add', 'place', 'put', 'drop', 'जोड़ो', 'लगाओ', 'रखो'])) {
    const def = resolvePart(part.id) ?? getPart(part.id);
    const count = ctx.doc.diagram.parts.filter((p) => p.type === part.id).length;
    return {
      plan: hi ? `मैं ${def?.name ?? part.id} कैनवास पर रखूँगा।` : `I will place the ${def?.name ?? part.id} on the canvas.`,
      reply: hi
        ? `${def?.name ?? part.id} रख दिया। उसे पावर/ग्राउंड देना न भूलें — बोलो तो पिन तालिका दिखाऊँ।`
        : `Placing the ${def?.name ?? part.id}${count ? ` (you already have ${count})` : ''}. Say the word and I will wire it, or check the pin table first.`,
      calls: [{ tool: 'placePart', part: part.id, x: 320, y: 160 }],
    };
  }

  // 10. Greetings and capability fallback.
  if (has(text, ['hello', 'hi ', 'hey', 'नमस्ते', 'हैलो']) && text.length < 30) {
    return {
      plan: hi ? 'मैं परिचय दूँगा।' : 'I will introduce myself.',
      reply: hi
        ? 'नमस्ते! मैं साक्षम हूँ। मैं आपका सर्किट पढ़ सकता हूँ, निदान चला सकता हूँ, घटक जोड़ सकता हूँ, स्केच समझा सकता हूँ और मिशन के संकेत दे सकता हूँ — पर लॉक समाधान कभी नहीं।'
        : 'Hello! I am the lab mentor. I can read your circuit, run diagnostics, place and wire parts, explain your sketch and give mission hints — but never a locked solution.',
      calls: [],
    };
  }
  return {
    plan: hi ? 'मैं बताऊँगा कि मैं क्या कर सकता हूँ।' : 'I will list what I can do here.',
    reply: hi
      ? 'मैं ये कर सकता हूँ: "why does it not work?" (निदान), "add a buzzer" (घटक जोड़ना), "make a thermometer" (पूरा सेटअप), "explain my sketch", "run it", "next mission", या मिशन में "hint"। जो कुछ भी बदलूँगा वह Undo में रहेगा।'
      : 'Try: "why does it not work?" (diagnosis), "add a buzzer" (place a part), "make a thermometer" (a full build), "explain my sketch", "run it", "next mission", or "hint" inside a mission. Everything I change is undoable, and I ask before removing anything.',
    calls: [],
  };
}

/** The planner is deterministic: useful to guarantee in tests. */
export const PLANNER_TEMPLATE_SLUGS = RECIPES.map((r) => r.template).filter((t) =>
  templates().some((x) => x.slug === t),
);
