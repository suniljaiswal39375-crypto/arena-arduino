export type TokenKind = 'num' | 'str' | 'char' | 'ident' | 'op' | 'eof';

export interface Token {
  kind: TokenKind;
  value: string | number;
  /** 1-based line, for diagnostics. */
  line: number;
  /** A numeric literal written with a decimal point or exponent: 7.0, 1e3, 2.5f. */
  isFloat?: boolean;
}

export class SkethError extends Error {
  line: number;
  code: string;
  constructor(message: string, line = 0, code = 'SYNTAX') {
    super(message);
    this.name = 'SkethError';
    this.line = line;
    this.code = code;
  }
}

const OPERATORS = [
  '<<=',
  '>>=',
  '===',
  '!==',
  '<<',
  '>>',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '->',
  '::',
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '<',
  '>',
  '!',
  '&',
  '|',
  '^',
  '~',
  '?',
  ':',
  ',',
  ';',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '.',
];

export interface PreprocessResult {
  /** Object-like macros: name -> replacement source text. */
  defines: Map<string, string>;
  /** Libraries requested with #include, e.g. "Servo.h". */
  includes: string[];
}

/**
 * Strip comments and pull out preprocessor directives. Directives are removed
 * from the source so the parser only ever sees real C++.
 */
export function preprocess(src: string): { source: string; meta: PreprocessResult } {
  const defines = new Map<string, string>();
  const includes: string[] = [];
  const out: string[] = [];
  let line = 1;
  let i = 0;

  while (i < src.length) {
    const c = src[i] ?? '';

    if (c === '\n') {
      line++;
      out.push('\n');
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '#') {
      const start = i;
      while (i < src.length && src[i] !== '\n') i++;
      const directive = src.slice(start + 1, i).trim();
      const directiveLine = line;
      const spaceAt = directive.search(/\s/);
      const name = spaceAt === -1 ? directive : directive.slice(0, spaceAt);
      const rest = spaceAt === -1 ? '' : directive.slice(spaceAt + 1).trim();

      if (name === 'define') {
        const sp = rest.search(/\s/);
        if (sp > 0) {
          const macro = rest.slice(0, sp);
          const repl = rest.slice(sp + 1).trim();
          // Function-like macros get a trailing "(" straight after the name.
          if (!macro.endsWith(')') && !repl.startsWith('(')) {
            defines.set(macro, repl);
          }
        }
      } else if (name === 'include') {
        const m = /[<"]([^>"]+)[>"]/.exec(rest);
        if (m?.[1]) includes.push(m[1]);
      }
      out.push('\n');
      void directiveLine;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      out.push(src.slice(start, i));
      continue;
    }
    out.push(c);
    i++;
  }

  return { source: out.join(''), meta: { defines, includes } };
}

/** Split source into tokens. Macros are expanded as identifiers are emitted. */
export function tokenize(src: string, defines: Map<string, string> = new Map()): Token[] {
  const { source, meta } = preprocess(src);
  for (const [k, v] of defines) meta.defines.set(k, v);

  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  const expanding = new Set<string>();

  const push = (kind: TokenKind, value: string | number): void => {
    tokens.push({ kind, value, line });
  };

  const expandIdent = (name: string): boolean => {
    if (!meta.defines.has(name) || expanding.has(name)) return false;
    const repl = meta.defines.get(name) ?? '';
    if (repl === name) return false;
    expanding.add(name);
    const sub = tokenize(repl, meta.defines);
    expanding.delete(name);
    for (const t of sub) {
      if (t.kind !== 'eof') tokens.push({ ...t, line });
    }
    return true;
  };

  while (i < source.length) {
    const c = source[i] ?? '';

    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      // Hex, binary and float literals.
      if (c === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
        j = i + 2;
        while (j < source.length && /[0-9a-fA-F]/.test(source[j] ?? '')) j++;
        push('num', parseInt(source.slice(i + 2, j), 16));
        i = j;
        continue;
      }
      while (j < source.length && /[0-9]/.test(source[j] ?? '')) j++;
      if (source[j] === '.' && /[0-9]/.test(source[j + 1] ?? '')) {
        j++;
        while (j < source.length && /[0-9]/.test(source[j] ?? '')) j++;
      }
      if (source[j] === 'e' || source[j] === 'E') {
        let k = j + 1;
        if (source[k] === '+' || source[k] === '-') k++;
        if (/[0-9]/.test(source[k] ?? '')) {
          while (k < source.length && /[0-9]/.test(source[k] ?? '')) k++;
          j = k;
        }
      }
      const text = source.slice(i, j);
      let suffix = '';
      while (j < source.length && /[uUlLfF]/.test(source[j] ?? '')) {
        suffix += source[j];
        j++;
      }
      const hasDot = text.includes('.') || /[eE]/.test(text);
      push('num', hasDot ? parseFloat(text) : parseInt(text, 10));
      // 7.0 and 2.5f are floats in C, even when the value is whole.
      if (hasDot || /[fF]/.test(suffix)) {
        const last = tokens[tokens.length - 1];
        if (last) last.isFloat = true;
      }
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j] ?? '')) j++;
      const name = source.slice(i, j);
      if (!expandIdent(name)) push('ident', name);
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\') {
          const esc = source[j + 1] ?? '';
          s +=
            esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === 'r' ? '\r' : esc === '0' ? '\0' : esc;
          j += 2;
          continue;
        }
        s += source[j];
        j++;
      }
      i = j + 1;
      push('str', s);
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let ch = source[j] ?? '';
      if (ch === '\\') {
        const esc = source[j + 1] ?? '';
        ch = esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === '0' ? '\0' : esc;
        j += 2;
      } else {
        j++;
      }
      i = j + 1;
      push('char', ch);
      continue;
    }

    const three = source.slice(i, i + 3);
    const two = source.slice(i, i + 2);
    const op = OPERATORS.find((o) => o === three) ?? OPERATORS.find((o) => o === two) ?? c;
    if (!OPERATORS.includes(op)) {
      throw new SkethError(`Unexpected character "${c}"`, line, 'LEX');
    }
    push('op', op);
    i += op.length;
  }

  tokens.push({ kind: 'eof', value: '', line });
  return tokens;
}
