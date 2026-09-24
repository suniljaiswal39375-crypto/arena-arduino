export type CType =
  | 'void'
  | 'int'
  | 'long'
  | 'short'
  | 'char'
  | 'byte'
  | 'bool'
  | 'float'
  | 'double'
  | 'unsigned'
  | 'unsigned int'
  | 'unsigned long'
  | 'unsigned char'
  | 'String'
  | 'object';

export type Expr =
  | { k: 'lit'; value: number | string | boolean; isChar?: boolean; isFloat?: boolean }
  | { k: 'ident'; name: string }
  | { k: 'binary'; op: string; left: Expr; right: Expr }
  | { k: 'assign'; op: string; target: Expr; value: Expr }
  | { k: 'unary'; op: string; operand: Expr; prefix: boolean }
  | { k: 'postfix'; op: string; operand: Expr }
  | { k: 'call'; callee: Expr; args: Expr[] }
  | { k: 'member'; object: Expr; name: string }
  | { k: 'index'; object: Expr; index: Expr }
  | { k: 'ternary'; cond: Expr; then: Expr; else: Expr }
  | { k: 'initlist'; items: Expr[] };

export interface DeclInfo {
  type: CType;
  name: string;
  isArray: boolean;
  arraySize?: number;
  init?: Expr;
  /** Class name for object declarations such as `Servo myservo;`. */
  className?: string;
  /** Constructor arguments, as in `DHT dht(2, DHT11);`. */
  ctorArgs?: Expr[];
}

export type Stmt =
  | { k: 'block'; body: Stmt[] }
  | ({ k: 'var' } & DeclInfo)
  | { k: 'expr'; expr: Expr }
  | { k: 'if'; cond: Expr; then: Stmt; else?: Stmt }
  | { k: 'while'; cond: Expr; body: Stmt }
  | { k: 'dowhile'; body: Stmt; cond: Expr }
  | { k: 'for'; init?: Stmt; cond?: Expr; step?: Expr; body: Stmt }
  | { k: 'switch'; expr: Expr; cases: Array<{ value: Expr | null; body: Stmt[] }> }
  | { k: 'return'; expr?: Expr }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'empty' };

export interface Param {
  type: CType;
  name: string;
  isArray: boolean;
}

export interface FuncDecl {
  name: string;
  returnType: CType;
  params: Param[];
  body: Stmt;
  line: number;
}

export interface StructDecl {
  name: string;
  fields: Array<{ type: CType; name: string }>;
}

export interface Program {
  globals: DeclInfo[];
  funcs: FuncDecl[];
  structs: StructDecl[];
  includes: string[];
}

export const NUMERIC_TYPES: CType[] = [
  'int',
  'long',
  'short',
  'char',
  'byte',
  'bool',
  'float',
  'double',
  'unsigned',
  'unsigned int',
  'unsigned long',
  'unsigned char',
];

export function isIntegral(t: CType): boolean {
  return t !== 'float' && t !== 'double' && t !== 'String' && t !== 'object';
}
