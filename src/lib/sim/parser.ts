import type { CType, Expr, FuncDecl, Param, Program, Stmt, StructDecl } from './ast';
import { preprocess, SkethError, tokenize, type Token } from './tokens';

const TYPE_KEYWORDS = new Set([
  'void',
  'int',
  'long',
  'short',
  'char',
  'byte',
  'bool',
  'boolean',
  'float',
  'double',
  'unsigned',
  'signed',
  'String',
  'word',
  'size_t',
  'uint8_t',
  'uint16_t',
  'uint32_t',
  'int8_t',
  'int16_t',
  'int32_t',
]);

const MODIFIERS = new Set(['const', 'static', 'volatile', 'constexpr', 'PROGMEM']);

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

function normaliseType(raw: string[]): CType {
  const t = raw.join(' ');
  switch (t) {
    case 'unsigned':
    case 'unsigned int':
    case 'uint8_t':
    case 'uint16_t':
    case 'uint32_t':
    case 'word':
    case 'size_t':
      return 'unsigned';
    case 'unsigned long':
      return 'unsigned long';
    case 'unsigned char':
    case 'byte':
    case 'uint8_t ':
      return 'unsigned char';
    case 'boolean':
    case 'bool':
      return 'bool';
    case 'String':
      return 'String';
    case 'long':
      return 'long';
    case 'short':
    case 'int8_t':
    case 'int16_t':
      return 'short';
    case 'double':
    case 'float':
      return 'float';
    case 'char':
      return 'char';
    case 'int':
    case 'int32_t':
      return 'int';
    case 'void':
      return 'void';
    default:
      return 'int';
  }
}

const BINARY_PRECEDENCE: Record<string, number> = {
  '=': 1,
  '+=': 1,
  '-=': 1,
  '*=': 1,
  '/=': 1,
  '%=': 1,
  '&=': 1,
  '|=': 1,
  '^=': 1,
  '<<=': 1,
  '>>=': 1,
  '||': 3,
  '&&': 4,
  '|': 5,
  '^': 6,
  '&': 7,
  '==': 8,
  '!=': 8,
  '<': 9,
  '<=': 9,
  '>': 9,
  '>=': 9,
  '<<': 10,
  '>>': 10,
  '+': 11,
  '-': 11,
  '*': 12,
  '/': 12,
  '%': 12,
};

export class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(source: string, defines: Map<string, string> = new Map()) {
    this.tokens = tokenize(source, defines);
  }

  private eofToken(): Token {
    return { kind: 'eof', value: '', line: 0 };
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.eofToken();
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private at(value: string): boolean {
    const t = this.peek();
    return (t.kind === 'op' || t.kind === 'ident') && t.value === value;
  }

  private eat(value: string): boolean {
    if (this.at(value)) {
      this.next();
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    if (!this.at(value)) {
      const t = this.peek();
      throw new SkethError(
        `Expected "${value}" but found ${t.kind === 'eof' ? 'end of file' : `"${String(t.value)}"`}`,
        t.line,
        'PARSE',
      );
    }
    return this.next();
  }

  private line(): number {
    return this.peek().line;
  }

  parseProgram(): Program {
    const globals: Program['globals'] = [];
    const funcs: FuncDecl[] = [];
    const structs: StructDecl[] = [];

    while (this.peek().kind !== 'eof') {
      if (MODIFIERS.has(String(this.peek().value))) {
        this.next();
        continue;
      }
      if (this.at('struct')) {
        const s = this.parseStruct();
        if (s) structs.push(s);
        continue;
      }
      if (this.at('enum')) {
        this.skipEnum();
        continue;
      }
      if (this.at('typedef')) {
        this.next();
        while (!this.at(';') && this.peek().kind !== 'eof') this.next();
        this.eat(';');
        continue;
      }
      if (this.at('extern')) {
        this.next();
        continue;
      }

      const spec = this.parseTypeSpec();
      const nameTok = this.next();
      if (nameTok.kind !== 'ident') {
        throw new SkethError(`Expected a name after "${spec.type}"`, nameTok.line, 'PARSE');
      }
      const name = String(nameTok.value);

      if (this.at('(')) {
        if (spec.type === 'object') {
          // A global object built with constructor arguments: DHT dht(2, DHT11);
          const ctorArgs = this.parseCallArgs();
          this.expect(';');
          globals.push({
            type: 'object',
            name,
            isArray: false,
            className: spec.className,
            ctorArgs,
          });
        } else {
          funcs.push(this.parseFunction(spec.type, name, nameTok.line));
        }
        continue;
      }

      // One or more declarators sharing a type: int a = 1, b = 2, c[4];
      let declName = name;
      for (;;) {
        let isArray = false;
        let arraySize: number | undefined;
        if (this.at('[')) {
          isArray = true;
          this.next();
          if (!this.at(']')) {
            const n = this.parseExpr();
            arraySize = n.k === 'lit' && typeof n.value === 'number' ? n.value : undefined;
          }
          this.expect(']');
        }
        let init: Expr | undefined;
        if (this.eat('=')) init = this.parseInit();
        globals.push({
          type: spec.type,
          name: declName,
          init,
          isArray,
          arraySize,
          className: spec.className,
        });
        if (!this.eat(',')) break;
        const nxt = this.next();
        if (nxt.kind !== 'ident') {
          throw new SkethError('Expected a variable name after ","', nxt.line, 'PARSE');
        }
        declName = String(nxt.value);
      }
      this.expect(';');
    }

    return { globals, funcs, structs, includes: [] };
  }

  /**
   * Read a type. Anything we do not recognise as a builtin followed by another
   * identifier is treated as a class instance declaration (`Servo myservo;`).
   */
  private parseTypeSpec(): { type: CType; className?: string } {
    const t = this.peek();
    const nextTok = this.peek(1);
    const isKnown = t.kind === 'ident' && TYPE_KEYWORDS.has(String(t.value));
    if (!isKnown && t.kind === 'ident' && nextTok.kind === 'ident') {
      const className = String(this.next().value);
      while (this.at('*')) this.next();
      return { type: 'object', className };
    }
    return { type: this.parseType() };
  }

  private parseCallArgs(): Expr[] {
    this.expect('(');
    const args: Expr[] = [];
    if (!this.at(')')) {
      for (;;) {
        args.push(this.parseAssignment());
        if (!this.eat(',')) break;
      }
    }
    this.expect(')');
    return args;
  }

  private parseType(): CType {
    const parts: string[] = [];
    while (this.peek().kind === 'ident' && TYPE_KEYWORDS.has(String(this.peek().value))) {
      parts.push(String(this.next().value));
      if (parts.length >= 2) break;
    }
    // Skip pointer stars rather than modelling them.
    while (this.at('*')) this.next();
    if (parts.length === 0) {
      const t = this.peek();
      throw new SkethError(
        `Expected a type but found ${t.kind === 'eof' ? 'end of file' : `"${String(t.value)}"`}`,
        t.line,
        'PARSE',
      );
    }
    return normaliseType(parts);
  }

  private parseStruct(): StructDecl | null {
    this.next(); // struct
    const nameTok = this.next();
    if (nameTok.kind !== 'ident') return null;
    const fields: StructDecl['fields'] = [];
    if (this.at('{')) {
      this.next();
      while (!this.at('}') && this.peek().kind !== 'eof') {
        const type = this.parseType();
        const fname = this.next();
        if (fname.kind === 'ident') fields.push({ type, name: String(fname.value) });
        this.eat(';');
      }
      this.expect('}');
    }
    this.expect(';');
    return { name: String(nameTok.value), fields };
  }

  private skipEnum(): void {
    this.next(); // enum
    if (this.peek().kind === 'ident') this.next();
    if (this.at('{')) {
      this.next();
      let depth = 1;
      while (depth > 0 && this.peek().kind !== 'eof') {
        if (this.at('{')) depth++;
        if (this.at('}')) depth--;
        this.next();
      }
    }
    this.eat(';');
  }

  private parseFunction(returnType: CType, name: string, line: number): FuncDecl {
    this.expect('(');
    const params: Param[] = [];
    if (!this.at(')')) {
      for (;;) {
        const ptype = this.parseType();
        const pname = this.next();
        let isArray = false;
        if (this.at('[')) {
          isArray = true;
          this.next();
          this.eat(']');
        }
        if (pname.kind === 'ident') {
          params.push({ type: ptype, name: String(pname.value), isArray });
        }
        if (!this.eat(',')) break;
      }
    }
    this.expect(')');
    const body = this.parseBlock();
    return { name, returnType, params, body, line };
  }

  private parseBlock(): Stmt {
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.at('}') && this.peek().kind !== 'eof') {
      body.push(this.parseStmt());
    }
    this.expect('}');
    return { k: 'block', body };
  }

  private parseStmt(): Stmt {
    const t = this.peek();
    const line = t.line;

    if (this.at('{')) return this.parseBlock();
    if (this.eat(';')) return { k: 'empty' };

    if (this.at('if')) {
      this.next();
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      const then = this.parseStmt();
      if (this.eat('else')) {
        return { k: 'if', cond, then, else: this.parseStmt() };
      }
      return { k: 'if', cond, then };
    }

    if (this.at('while')) {
      this.next();
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      return { k: 'while', cond, body: this.parseStmt() };
    }

    if (this.at('do')) {
      this.next();
      const body = this.parseStmt();
      this.expect('while');
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      this.expect(';');
      return { k: 'dowhile', body, cond };
    }

    if (this.at('for')) {
      this.next();
      this.expect('(');
      let init: Stmt | undefined;
      if (!this.at(';')) init = this.parseSimpleOrVar();
      this.expect(';');
      let cond: Expr | undefined;
      if (!this.at(';')) cond = this.parseExpr();
      this.expect(';');
      let step: Expr | undefined;
      if (!this.at(')')) step = this.parseExpr();
      this.expect(')');
      return { k: 'for', init, cond, step, body: this.parseStmt() };
    }

    if (this.at('switch')) {
      this.next();
      this.expect('(');
      const expr = this.parseExpr();
      this.expect(')');
      this.expect('{');
      const cases: Array<{ value: Expr | null; body: Stmt[] }> = [];
      let current: { value: Expr | null; body: Stmt[] } | null = null;
      while (!this.at('}') && this.peek().kind !== 'eof') {
        if (this.at('case')) {
          this.next();
          const value = this.parseExpr();
          this.expect(':');
          current = { value, body: [] };
          cases.push(current);
          continue;
        }
        if (this.at('default')) {
          this.next();
          this.expect(':');
          current = { value: null, body: [] };
          cases.push(current);
          continue;
        }
        const s = this.parseStmt();
        if (current) current.body.push(s);
      }
      this.expect('}');
      return { k: 'switch', expr, cases };
    }

    if (this.at('return')) {
      this.next();
      if (this.at(';')) {
        this.next();
        return { k: 'return' };
      }
      const expr = this.parseExpr();
      this.expect(';');
      return { k: 'return', expr };
    }

    if (this.at('break')) {
      this.next();
      this.expect(';');
      return { k: 'break' };
    }

    if (this.at('continue')) {
      this.next();
      this.expect(';');
      return { k: 'continue' };
    }

    // A declaration: a builtin type, a modifier, or a class name followed by
    // an identifier, as in `Servo myservo;`.
    const isTypeStart =
      (t.kind === 'ident' && TYPE_KEYWORDS.has(String(t.value))) ||
      (t.kind === 'ident' && MODIFIERS.has(String(t.value))) ||
      (t.kind === 'ident' && this.peek(1).kind === 'ident');

    if (isTypeStart) {
      const stmt = this.parseSimpleOrVar();
      this.expect(';');
      return stmt;
    }

    const expr = this.parseExpr();
    this.expect(';');
    return { k: 'expr', expr };
  }

  /**
   * Parse one declaration or expression. Does not consume the trailing ";",
   * because a `for` header uses that same semicolon as its separator.
   */
  private parseSimpleOrVar(): Stmt {
    while (MODIFIERS.has(String(this.peek().value))) this.next();

    const t = this.peek();
    const isTypeStart =
      (t.kind === 'ident' && TYPE_KEYWORDS.has(String(t.value))) ||
      (t.kind === 'ident' && this.peek(1).kind === 'ident');

    if (!isTypeStart) {
      return { k: 'expr', expr: this.parseExpr() };
    }

    const spec = this.parseTypeSpec();
    const nameTok = this.next();
    if (nameTok.kind !== 'ident') {
      throw new SkethError('Expected a variable name', nameTok.line, 'PARSE');
    }
    const name = String(nameTok.value);

    if (this.at('(') && spec.type === 'object') {
      const ctorArgs = this.parseCallArgs();
      return { k: 'var', type: 'object', name, isArray: false, className: spec.className, ctorArgs };
    }

    let isArray = false;
    let arraySize: number | undefined;
    if (this.at('[')) {
      isArray = true;
      this.next();
      if (!this.at(']')) {
        const n = this.parseExpr();
        arraySize = n.k === 'lit' && typeof n.value === 'number' ? n.value : undefined;
      }
      this.expect(']');
    }
    let init: Expr | undefined;
    if (this.eat('=')) init = this.parseInit();
    return {
      k: 'var',
      type: spec.type,
      name,
      isArray,
      arraySize,
      init,
      className: spec.className,
    };
  }

  private parseInit(): Expr {
    if (this.at('{')) {
      this.next();
      const items: Expr[] = [];
      while (!this.at('}') && this.peek().kind !== 'eof') {
        items.push(this.parseInit());
        if (!this.eat(',')) break;
      }
      this.expect('}');
      return { k: 'initlist', items };
    }
    return this.parseExpr();
  }

  parseExpr(): Expr {
    return this.parseAssignment();
  }

  private parseAssignment(): Expr {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.kind === 'op' && ASSIGN_OPS.has(String(t.value))) {
      this.next();
      const value = this.parseAssignment();
      return { k: 'assign', op: String(t.value), target: left, value };
    }
    return left;
  }

  private parseTernary(): Expr {
    const cond = this.parseBinary(2);
    if (this.at('?')) {
      this.next();
      const then = this.parseAssignment();
      this.expect(':');
      const els = this.parseAssignment();
      return { k: 'ternary', cond, then, else: els };
    }
    return cond;
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op') break;
      const op = String(t.value);
      const prec = BINARY_PRECEDENCE[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1);
      left = { k: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'op') {
      const op = String(t.value);
      if (op === '!' || op === '-' || op === '+' || op === '~' || op === '*' || op === '&') {
        this.next();
        const operand = this.parseUnary();
        if (op === '&' || op === '*') {
          // Address-of and dereference are not modelled; pass the operand through.
          return operand;
        }
        return { k: 'unary', op, operand, prefix: true };
      }
      if (op === '++' || op === '--') {
        this.next();
        const operand = this.parseUnary();
        return { k: 'unary', op, operand, prefix: true };
      }
      if (op === 'sizeof') {
        this.next();
        this.eat('(');
        let depth = this.at('(') ? 1 : 0;
        while (depth > 0 && this.peek().kind !== 'eof') {
          if (this.at('(')) depth++;
          if (this.at(')')) depth--;
          this.next();
        }
        return { k: 'lit', value: 2 };
      }
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.at(')')) {
          for (;;) {
            args.push(this.parseAssignment());
            if (!this.eat(',')) break;
          }
        }
        this.expect(')');
        expr = { k: 'call', callee: expr, args };
        continue;
      }
      if (this.at('[')) {
        this.next();
        const index = this.parseAssignment();
        this.expect(']');
        expr = { k: 'index', object: expr, index };
        continue;
      }
      if (this.at('.') || this.at('->')) {
        this.next();
        const nameTok = this.next();
        if (nameTok.kind !== 'ident') {
          throw new SkethError('Expected a member name after "."', nameTok.line, 'PARSE');
        }
        expr = { k: 'member', object: expr, name: String(nameTok.value) };
        continue;
      }
      if (this.at('++') || this.at('--')) {
        const op = String(this.next().value);
        expr = { k: 'postfix', op, operand: expr };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    if (t.kind === 'num') {
      this.next();
      return t.isFloat ? { k: 'lit', value: t.value as number, isFloat: true } : { k: 'lit', value: t.value as number };
    }
    if (t.kind === 'char') {
      // In C++ 'o' is the integer 111, not a one-letter string. Treating it as
      // a string made every `if (c == 'o')` after Serial.read() silently false.
      this.next();
      return { k: 'lit', value: String(t.value).charCodeAt(0) || 0, isChar: true };
    }
    if (t.kind === 'str') {
      this.next();
      return { k: 'lit', value: t.value as string };
    }
    if (t.kind === 'ident') {
      const name = String(t.value);
      if (name === 'true' || name === 'false') {
        this.next();
        return { k: 'lit', value: name === 'true' };
      }
      if (name === 'HIGH' || name === 'LOW' || name === 'INPUT' || name === 'OUTPUT') {
        this.next();
        return { k: 'lit', value: name === 'HIGH' ? 1 : name === 'LOW' ? 0 : name === 'INPUT' ? 0 : 1 };
      }
      // A cast: int(x), float(x), byte(x) and friends.
      if (
        this.peek(1).kind === 'op' &&
        this.peek(1).value === '(' &&
        TYPE_KEYWORDS.has(name)
      ) {
        this.next();
        this.next();
        const inner = this.parseAssignment();
        this.expect(')');
        return { k: 'unary', op: `cast:${name}`, operand: inner, prefix: true };
      }
      this.next();
      return { k: 'ident', name };
    }
    if (t.kind === 'op' && t.value === '(') {
      this.next();
      const e = this.parseAssignment();
      this.expect(')');
      return e;
    }
    if (t.kind === 'op' && t.value === '{') {
      this.next();
      const items: Expr[] = [];
      while (!this.at('}') && this.peek().kind !== 'eof') {
        items.push(this.parseAssignment());
        if (!this.eat(',')) break;
      }
      this.expect('}');
      return { k: 'initlist', items };
    }
    throw new SkethError(
      `Unexpected ${t.kind === 'eof' ? 'end of file' : `"${String(t.value)}"`}`,
      t.line,
      'PARSE',
    );
  }
}

export interface ParsedSketch {
  program: Program;
  includes: string[];
  defines: Map<string, string>;
}

/**
 * Parse a sketch end to end: preprocess for macros and #includes, then parse.
 * Returns everything the interpreter needs to build the runtime environment.
 */
export function parseSketch(source: string): ParsedSketch {
  const { meta } = preprocess(source);
  const program = new Parser(source, meta.defines).parseProgram();
  program.includes = meta.includes;
  return { program, includes: meta.includes, defines: meta.defines };
}
