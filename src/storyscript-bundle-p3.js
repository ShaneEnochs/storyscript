(function(global) {
'use strict';
const SS = global.SS = global.SS || {};

// ─── lexer ──────────────────────────────────────────────────
SS._lexer = (function() {
/**
 * Lexer
 * 
 * Reads source text line-by-line and produces a flat array of tokens.
 * Each token: { type, depth, payload, lineNum, file }
 *
 * Types:
 *   'command'       — line begins with * (after tabs)
 *   'choice_option' — line begins with # (after tabs)
 *   'text'          — any other non-blank content
 *   'blank'         — empty or whitespace-only line
 *
 * Indentation: tabs only. Any leading space character is a hard error.
 */

class LexerError extends Error {
  constructor(message, file, lineNum) {
    super(`[StoryScript Lexer] ${file}:${lineNum} — ${message}`);
    this.name = 'LexerError';
    this.file = file;
    this.lineNum = lineNum;
  }
}

/**
 * Tokenize a source string into an array of tokens.
 * @param {string} source  - raw file content
 * @param {string} file    - filename for error messages
 * @returns {Array}        - array of token objects
 */
function tokenize(source, file = '<unknown>') {
  const lines = source.split('\n');
  const tokens = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];

    // Strip trailing carriage return (Windows line endings)
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    // Blank line check (before indentation analysis)
    if (line.trim() === '') {
      tokens.push({ type: 'blank', depth: 0, payload: '', lineNum, file });
      continue;
    }

    // Count and validate leading whitespace
    let depth = 0;
    let pos = 0;

    while (pos < line.length) {
      const ch = line[pos];
      if (ch === '\t') {
        depth++;
        pos++;
      } else if (ch === ' ') {
        throw new LexerError(
          `Indentation error: leading space found. Only tabs are permitted for indentation.`,
          file,
          lineNum
        );
      } else {
        break;
      }
    }

    const content = line.slice(pos);

    // After tabs: check for mixed indentation (space after tabs)
    // (Already caught above, but guard against space-only content that slipped through)
    if (content.length === 0) {
      // Line was only tabs — treat as blank
      tokens.push({ type: 'blank', depth: 0, payload: '', lineNum, file });
      continue;
    }

    // Classify by first character
    const first = content[0];

    if (first === '*') {
      // Strip the leading * and any space after it
      const payload = content.slice(1).trimStart();
      tokens.push({ type: 'command', depth, payload, lineNum, file });

    } else if (first === '#') {
      // Strip the leading # and any space after it
      const payload = content.slice(1).trimStart();
      tokens.push({ type: 'choice_option', depth, payload, lineNum, file });

    } else {
      tokens.push({ type: 'text', depth, payload: content, lineNum, file });
    }
  }

  return tokens;
}
return { tokenize, LexerError };
})();

// ─── evaluator ──────────────────────────────────────────────
SS._evaluator = (function() {
/**
 * Expression Evaluator
 *
 * A recursive descent parser for StoryScript expressions.
 * Never uses eval() or new Function().
 *
 * Operator precedence (low → high):
 *   1. or
 *   2. and
 *   3. = != < <= > >=      (= is equality, not assignment)
 *   4. + -
 *   5. * / %+ %-
 *   6. not  (unary)
 *   7. ( )  literals  variables
 *
 * FairMath:
 *   %+  value += round(remaining_to_100 * modifier/100)
 *   %-  value -= round(remaining_to_0   * modifier/100)
 */

class EvalError extends Error {
  constructor(message, expr) {
    super(`[StoryScript Eval] ${message}${expr ? ` (in: "${expr}")` : ''}`);
    this.name = 'EvalError';
  }
}

// ─── TOKENISER (for expressions, not source lines) ───────────────────────────

const TOKEN = {
  NUM:    'NUM',
  STR:    'STR',
  BOOL:   'BOOL',
  IDENT:  'IDENT',
  OP:     'OP',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  EOF:    'EOF',
};

function tokenizeExpr(expr) {
  const tokens = [];
  let i = 0;
  const src = expr.trim();

  while (i < src.length) {
    // Skip whitespace
    if (/\s/.test(src[i])) { i++; continue; }

    // String literals
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i++];
      let str = '';
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') { i++; }
        str += src[i++];
      }
      if (i >= src.length) throw new EvalError(`Unterminated string literal`, expr);
      i++; // closing quote
      tokens.push({ type: TOKEN.STR, value: str });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(src[i]) || (src[i] === '-' && /[0-9]/.test(src[i+1]) && (tokens.length === 0 || tokens[tokens.length-1].type === TOKEN.OP || tokens[tokens.length-1].type === TOKEN.LPAREN))) {
      let num = '';
      if (src[i] === '-') num += src[i++];
      while (i < src.length && /[0-9.]/.test(src[i])) num += src[i++];
      tokens.push({ type: TOKEN.NUM, value: parseFloat(num) });
      continue;
    }

    // Parentheses
    if (src[i] === '(') { tokens.push({ type: TOKEN.LPAREN }); i++; continue; }
    if (src[i] === ')') { tokens.push({ type: TOKEN.RPAREN }); i++; continue; }

    // Multi-char operators: %+, %-, <=, >=, !=
    if (i + 1 < src.length) {
      const two = src.slice(i, i+2);
      if (['%+', '%-', '<=', '>=', '!='].includes(two)) {
        tokens.push({ type: TOKEN.OP, value: two });
        i += 2;
        continue;
      }
    }

    // Single-char operators
    if ('+-*/=<>,'.includes(src[i])) {
      tokens.push({ type: TOKEN.OP, value: src[i] });
      i++;
      continue;
    }

    // Identifiers, keywords, booleans
    if (/[a-zA-Z_]/.test(src[i])) {
      let ident = '';
      while (i < src.length && /[a-zA-Z0-9_.?]/.test(src[i])) ident += src[i++];

      if (ident === 'true')  { tokens.push({ type: TOKEN.BOOL, value: true  }); continue; }
      if (ident === 'false') { tokens.push({ type: TOKEN.BOOL, value: false }); continue; }
      if (ident === 'and' || ident === 'or' || ident === 'not') {
        tokens.push({ type: TOKEN.OP, value: ident });
        continue;
      }
      tokens.push({ type: TOKEN.IDENT, value: ident });
      continue;
    }

    throw new EvalError(`Unexpected character: '${src[i]}'`, expr);
  }

  tokens.push({ type: TOKEN.EOF });
  return tokens;
}

// ─── RECURSIVE DESCENT PARSER ────────────────────────────────────────────────

class Parser {
  constructor(tokens, state, expr) {
    this.tokens = tokens;
    this.pos    = 0;
    this.state  = state; // StoryState for variable resolution
    this.src    = expr;  // original expression string for error messages
  }

  peek()    { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }

  expect(type) {
    const t = this.consume();
    if (t.type !== type) throw new EvalError(`Expected ${type}, got ${t.type}`, this.src);
    return t;
  }

  // or
  parseExpr() { return this.parseOr(); }

  parseOr() {
    let left = this.parseAnd();
    while (this.peek().type === TOKEN.OP && this.peek().value === 'or') {
      this.consume();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  parseAnd() {
    let left = this.parseEquality();
    while (this.peek().type === TOKEN.OP && this.peek().value === 'and') {
      this.consume();
      const right = this.parseEquality();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  parseEquality() {
    let left = this.parseAddSub();
    while (this.peek().type === TOKEN.OP && ['=','!=','<','<=','>','>='].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseAddSub();
      switch (op) {
        case '=':  left = left == right; break; // intentional loose equality for string/number mixing
        case '!=': left = left != right; break;
        case '<':  left = left <  right; break;
        case '<=': left = left <= right; break;
        case '>':  left = left >  right; break;
        case '>=': left = left >= right; break;
      }
    }
    return left;
  }

  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.peek().type === TOKEN.OP && ['+','-'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parseUnary();
    while (this.peek().type === TOKEN.OP && ['*','/','%+','%-'].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) throw new EvalError('Division by zero', this.src);
        left = left / right;
      } else if (op === '%+') {
        // FairMath add: increase left by (right % of remaining distance to 100)
        const remaining = 100 - left;
        left = left + Math.round(remaining * (right / 100));
      } else if (op === '%-') {
        // FairMath subtract: decrease left by (right % of remaining distance to 0)
        const remaining = left;
        left = left - Math.round(remaining * (right / 100));
      }
    }
    return left;
  }

  parseUnary() {
    if (this.peek().type === TOKEN.OP && this.peek().value === 'not') {
      this.consume();
      return !Boolean(this.parseUnary());
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const t = this.peek();

    if (t.type === TOKEN.LPAREN) {
      this.consume();
      const val = this.parseExpr();
      this.expect(TOKEN.RPAREN);
      return val;
    }

    if (t.type === TOKEN.NUM)  { this.consume(); return t.value; }
    if (t.type === TOKEN.STR)  { this.consume(); return t.value; }
    if (t.type === TOKEN.BOOL) { this.consume(); return t.value; }

    if (t.type === TOKEN.IDENT) {
      this.consume();
      // Check if this is a function call
      if (this.peek().type === TOKEN.LPAREN) {
        return this.parseCall(t.value);
      }
      // Support dot-notation for object access: player.hp
      const parts = t.value.split('.');
      let val = this.resolveVar(parts[0]);
      for (let i = 1; i < parts.length; i++) {
        if (val === null || typeof val !== 'object') {
          throw new EvalError(`Cannot access '${parts[i]}' on non-object '${parts[i-1]}'`, this.src);
        }
        val = val[parts[i]];
        if (val === undefined) throw new EvalError(`Key '${parts[i]}' not found on object '${parts[i-1]}'`, this.src);
      }
      return val;
    }

    throw new EvalError(`Unexpected token: ${t.type} ${t.value ?? ''}`, this.src);
  }

  resolveVar(name) {
    if (!this.state) throw new EvalError(`No state available to resolve variable '${name}'`, this.src);

    // Check for function call syntax: name(...args not supported here, but
    // zero-arg lookups like current_title are handled as special vars)
    // Built-in special variables
    if (name === 'current_title') {
      if (!this.state.activeTitle) return null;
      const schema = this.state.titleRegistry?.get(this.state.activeTitle) ?? {};
      return { id: this.state.activeTitle, ...schema };
    }

    if (this.state.temps.has(name))   return this.state.temps.get(name);
    if (this.state.globals.has(name)) return this.state.globals.get(name);
    throw new EvalError(`Undeclared variable '${name}'`, this.src);
  }

  // ── Built-in function calls: length(), upper(), lower(), contains(), has_item(), item_count(), achieved(), has_title() ──

  parseCall(name) {
    // name was already consumed as IDENT; next token should be LPAREN
    this.expect(TOKEN.LPAREN);
    const args = [];
    if (this.peek().type !== TOKEN.RPAREN) {
      args.push(this.parseExpr());
      while (this.peek().type === TOKEN.OP && this.peek().value === ',') {
        this.consume();
        args.push(this.parseExpr());
      }
    }
    this.expect(TOKEN.RPAREN);

    switch (name) {
      case 'length': {
        if (args.length !== 1) throw new EvalError('length() requires 1 argument', this.src);
        const v = args[0];
        if (typeof v === 'string') return v.length;
        if (Array.isArray(v)) return v.length;
        throw new EvalError('length() requires a string or list', this.src);
      }
      case 'upper': {
        if (args.length !== 1) throw new EvalError('upper() requires 1 argument', this.src);
        return String(args[0]).toUpperCase();
      }
      case 'lower': {
        if (args.length !== 1) throw new EvalError('lower() requires 1 argument', this.src);
        return String(args[0]).toLowerCase();
      }
      case 'contains': {
        if (args.length !== 2) throw new EvalError('contains() requires 2 arguments', this.src);
        const [haystack, needle] = args;
        if (typeof haystack === 'string') return haystack.includes(String(needle));
        if (Array.isArray(haystack)) return haystack.includes(needle);
        throw new EvalError('contains() requires a string or list as first argument', this.src);
      }
      case 'has_item': {
        if (args.length !== 1 && args.length !== 2) throw new EvalError('has_item() requires 1 or 2 arguments', this.src);
        if (!this.state) throw new EvalError('has_item() requires runtime state', this.src);
        const qty = this.state.inventory?.get(String(args[0])) ?? 0;
        const required = args.length === 2 ? Number(args[1]) : 1;
        return qty >= required;
      }
      case 'item_count': {
        if (args.length !== 1) throw new EvalError('item_count() requires 1 argument', this.src);
        if (!this.state) throw new EvalError('item_count() requires runtime state', this.src);
        return this.state.inventory?.get(String(args[0])) ?? 0;
      }
      case 'achieved': {
        if (args.length !== 1) throw new EvalError('achieved() requires 1 argument', this.src);
        if (!this.state) throw new EvalError('achieved() requires runtime state', this.src);
        return this.state.achievements?.has(String(args[0])) ?? false;
      }
      case 'has_title': {
        if (args.length !== 1) throw new EvalError('has_title() requires 1 argument', this.src);
        if (!this.state) throw new EvalError('has_title() requires runtime state', this.src);
        return this.state.grantedTitles?.has(String(args[0])) ?? false;
      }
      default:
        throw new EvalError(`Unknown built-in function: ${name}()`, this.src);
    }
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * Evaluate an expression string against the given state.
 * @param {string} expr   - expression string
 * @param {object} state  - StoryState (may be null for literal-only expressions)
 * @returns {*}           - result value
 */
function evaluate(expr, state = null) {
  const trimmed = (expr || '').trim();
  if (trimmed === '') throw new EvalError('Empty expression', expr);

  const tokens = tokenizeExpr(trimmed);
  const parser  = new Parser(tokens, state, trimmed);
  const result  = parser.parseExpr();

  if (parser.peek().type !== TOKEN.EOF) {
    throw new EvalError(`Unexpected tokens after expression`, expr);
  }

  return result;
}

/**
 * Perform inline variable substitution on a text string.
 * Replaces ${varname} and ${expr} with their evaluated values.
 * @param {string} text   - text with possible ${...} tokens
 * @param {object} state  - StoryState
 * @returns {string}
 */
function substituteVars(text, state) {
  return text.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    try {
      const val = evaluate(expr.trim(), state);
      return String(val);
    } catch (e) {
      throw new EvalError(`Variable substitution failed for '\${${expr}}': ${e.message}`);
    }
  });
}
return { evaluate, substituteVars, EvalError, tokenizeExpr, TOKEN };
})();

// ─── ir ─────────────────────────────────────────────────────
SS._ir = (function() {
/**
 * Intermediate Representation (IR)
 *
 * The IR sits between tokenization and bytecode emission.
 * Each IR node is a plain object with a `kind` discriminant and source
 * location fields (`file`, `lineNum`).  Nodes are nested for block
 * constructs (if/while/for/choice) so the IDE can query structure without
 * re-parsing bytecode.
 *
 * IR node kinds:
 *   Text, Blank, Label, Goto, Gosub, Return, Finish, PageBreak, Scene,
 *   Create, Temp, Set, ListCreate, ObjCreate, ObjSet, Push, Pop,
 *   Theme, ThemePush, ThemePop, Comment,
 *   If { condition, consequent[], elseifClauses[], alternate[] },
 *   While { condition, body[] },
 *   For { var, list, body[] },
 *   Choice { options: [{ text, cond, body[] }] }
 *
 * Bytecode version — bump when the bytecode format changes in a
 * backward-incompatible way so saved games / pre-compiled exports can
 * detect mismatches.
 */

const BYTECODE_VERSION = 3; // Phase 3: item/skill/achievement/title/random/input

// ─── IR Node Kinds ────────────────────────────────────────────────────────────

const IR = {
  TEXT:         'Text',
  BLANK:        'Blank',
  LABEL:        'Label',
  GOTO:         'Goto',
  GOSUB:        'Gosub',
  RETURN:       'Return',
  FINISH:       'Finish',
  PAGE_BREAK:   'PageBreak',
  SCENE:        'Scene',
  CREATE:       'Create',
  TEMP:         'Temp',
  SET:          'Set',
  LIST_CREATE:  'ListCreate',
  OBJ_CREATE:   'ObjCreate',
  OBJ_SET:      'ObjSet',
  PUSH:         'Push',
  POP:          'Pop',
  THEME:        'Theme',
  THEME_PUSH:   'ThemePush',
  THEME_POP:    'ThemePop',
  COMMENT:      'Comment',
  IF:           'If',
  WHILE:        'While',
  FOR:          'For',
  CHOICE:       'Choice',
  // Phase 3 additions
  RANDOM:       'Random',       // *random varname min max
  INPUT_TEXT:   'InputText',    // *input_text varname [prompt]
  INPUT_NUMBER: 'InputNumber',  // *input_number varname [prompt]
  ITEM:         'Item',         // *item id {schema}  — startup only
  GIVE:         'Give',         // *give id [qty]
  TAKE:         'Take',         // *take id [qty]
  SKILL:        'Skill',        // *skill id {schema} — startup only
  IMPROVE:      'Improve',      // *improve skillid amount
  REDUCE:       'Reduce',       // *reduce skillid amount
  ACHIEVEMENT:  'Achievement',  // *achievement id {schema} — startup only
  UNLOCK:       'Unlock',       // *unlock achievementid
  TITLE:        'Title',        // *title id {schema} — startup only
  GRANT:        'Grant',        // *grant titleid
  REVOKE:       'Revoke',       // *revoke titleid
  SHOW_SKILLS:  'ShowSkills',   // *show_skills
  SHOW_ACHIEVEMENTS: 'ShowAchievements', // *show_achievements
  SHOW_TITLE:   'ShowTitle',    // *show_title
  SHOW_INVENTORY: 'ShowInventory', // *show_inventory
};

// ─── SymbolTable ──────────────────────────────────────────────────────────────

/**
 * Collects declarations from an IR tree and makes them queryable.
 *
 * Populated by calling SymbolTable.populate(irNodes, file).
 * Used by the linter and (eventually) IDE features.
 */
class SymbolTable {
  constructor() {
    /** @type {Map<string, {file: string, lineNum: number}>} */
    this.labels = new Map();

    /** @type {Map<string, {file: string, lineNum: number, type: string}>} */
    this.globals = new Map();

    /** @type {Map<string, {file: string, lineNum: number, scope: string}>} */
    this.temps = new Map();

    /** @type {Map<string, string[]>} from-file → to-file[] */
    this.sceneRefs = new Map();

    /** @type {Set<string>} label names that are targeted by goto/gosub */
    this.labelTargets = new Set();

    // Phase 3 registries
    /** @type {Map<string, {file: string, lineNum: number, schema: object}>} */
    this.items = new Map();
    /** @type {Map<string, {file: string, lineNum: number, schema: object}>} */
    this.skills = new Map();
    /** @type {Map<string, {file: string, lineNum: number, schema: object}>} */
    this.achievements = new Map();
    /** @type {Map<string, {file: string, lineNum: number, schema: object}>} */
    this.titles = new Map();

    /** @type {Set<string>} achievement IDs that are unlocked somewhere */
    this.unlockedAchievements = new Set();
    /** @type {Set<string>} item IDs that are given/taken somewhere */
    this.usedItems = new Set();
    /** @type {Set<string>} skill IDs that are improved/reduced somewhere */
    this.usedSkills = new Set();
  }

  /**
   * Walk an IR node array and populate the symbol table.
   * @param {object[]} nodes
   * @param {string}   file
   */
  populate(nodes, file) {
    this._walk(nodes, file);
  }

  _walk(nodes, file) {
    for (const node of nodes) {
      this._visitNode(node, file);
    }
  }

  _visitNode(node, file) {
    switch (node.kind) {

      case IR.LABEL:
        this.labels.set(node.name, { file, lineNum: node.lineNum });
        break;

      case IR.GOTO:
      case IR.GOSUB:
        this.labelTargets.add(node.label);
        break;

      case IR.CREATE:
        this.globals.set(node.var, { file, lineNum: node.lineNum, type: 'scalar' });
        break;

      case IR.LIST_CREATE:
        this.globals.set(node.var, { file, lineNum: node.lineNum, type: 'list' });
        break;

      case IR.OBJ_CREATE:
        this.globals.set(node.var, { file, lineNum: node.lineNum, type: 'object' });
        break;

      case IR.TEMP:
        // Keyed by "file:var" since temps are scoped
        this.temps.set(`${file}:${node.var}`, { file, lineNum: node.lineNum, scope: file });
        break;

      case IR.SCENE: {
        const refs = this.sceneRefs.get(file) ?? [];
        refs.push(node.sceneName);
        this.sceneRefs.set(file, refs);
        break;
      }

      // Phase 3 declarations
      case IR.ITEM:
        this.items.set(node.id, { file, lineNum: node.lineNum, schema: node.schema });
        break;
      case IR.SKILL:
        this.skills.set(node.id, { file, lineNum: node.lineNum, schema: node.schema });
        break;
      case IR.ACHIEVEMENT:
        this.achievements.set(node.id, { file, lineNum: node.lineNum, schema: node.schema });
        break;
      case IR.TITLE:
        this.titles.set(node.id, { file, lineNum: node.lineNum, schema: node.schema });
        break;
      case IR.UNLOCK:
        this.unlockedAchievements.add(node.id);
        break;
      case IR.GIVE:
      case IR.TAKE:
        this.usedItems.add(node.id);
        break;
      case IR.IMPROVE:
      case IR.REDUCE:
        this.usedSkills.add(node.id);
        break;

      // Recurse into block nodes
      case IR.IF:
        this._walk(node.consequent, file);
        for (const clause of node.elseifClauses) {
          this._walk(clause.body, file);
        }
        if (node.alternate) this._walk(node.alternate, file);
        break;

      case IR.WHILE:
        this._walk(node.body, file);
        break;

      case IR.FOR:
        this._walk(node.body, file);
        break;

      case IR.CHOICE:
        for (const opt of node.options) {
          this._walk(opt.body, file);
        }
        break;

      default:
        break;
    }
  }

  /**
   * Returns names of all globals declared across all populated files.
   * @returns {Set<string>}
   */
  globalNames() {
    return new Set(this.globals.keys());
  }
}
return { IR, SymbolTable, BYTECODE_VERSION };
})();

// ─── state ──────────────────────────────────────────────────
SS._state = (function() {
/**
 * StoryState
 *
 * The single source of truth for all runtime state.
 * Serializable to/from plain JSON for save/load.
 */

const SAVE_VERSION = 2; // Phase 3: added inventory, skillMeta, achievements, titles

class StoryState {
  constructor() {
    this.globals      = new Map(); // *create variables
    this.temps        = new Map(); // *temp variables (scene-scoped)
    this.scene        = null;      // current scene filename
    this.ip           = 0;         // instruction pointer
    this.callStack    = [];        // [{returnIP, tempSnapshot}]
    this.undoStack    = [];        // deep-cloned snapshots (session only)
    this.loopCounters = new Map(); // loopInstrIdx → iteration count
    this.themeStack   = [];        // [{cssVar: value}] for push/pop

    // Phase 3 additions
    this.inventory    = new Map(); // itemId → qty
    this.itemRegistry = new Map(); // itemId → schema (set by *item)
    this.skillMeta    = new Map(); // skillId → {min, max, label, hidden}
    this.achievements = new Set(); // unlocked achievement IDs
    this.achievementRegistry = new Map(); // achievementId → schema
    this.titleRegistry = new Map(); // titleId → schema
    this.grantedTitles = new Set(); // granted title IDs
    this.activeTitle   = null;     // current highest-rank title id
  }

  // ── Variable access ────────────────────────────────────────────────────────

  get(name) {
    if (this.temps.has(name))   return this.temps.get(name);
    if (this.globals.has(name)) return this.globals.get(name);
    throw new Error(`[StoryScript Runtime] Undeclared variable: '${name}'`);
  }

  set(name, value) {
    if (this.temps.has(name)) {
      this.temps.set(name, value);
    } else if (this.globals.has(name)) {
      this.globals.set(name, value);
    } else {
      throw new Error(`[StoryScript Runtime] Cannot set undeclared variable: '${name}'`);
    }
  }

  has(name) {
    return this.temps.has(name) || this.globals.has(name);
  }

  createGlobal(name, value) {
    this.globals.set(name, value);
  }

  createTemp(name, value) {
    this.temps.set(name, value);
  }

  // ── Temp garbage collection ────────────────────────────────────────────────

  /** Remove all temp variables. Called on *scene change. */
  clearTemps() {
    this.temps.clear();
  }

  // ── Undo stack ─────────────────────────────────────────────────────────────

  /**
   * Push a deep snapshot of current state onto the undo stack.
   * Excludes the undo stack itself.
   * @param {number} maxDepth
   */
  pushUndo(maxDepth = 50) {
    const snapshot = {
      globals:   new Map(JSON.parse(JSON.stringify([...this.globals]))),
      temps:     new Map(JSON.parse(JSON.stringify([...this.temps]))),
      scene:     this.scene,
      ip:        this.ip,
      callStack: JSON.parse(JSON.stringify(this.callStack)),
    };
    this.undoStack.unshift(snapshot);
    if (this.undoStack.length > maxDepth) {
      this.undoStack.pop();
    }
  }

  /**
   * Restore state from the top of the undo stack.
   * Returns false if the stack is empty.
   */
  popUndo() {
    if (this.undoStack.length === 0) return false;
    const snapshot = this.undoStack.shift();
    this.globals   = snapshot.globals;
    this.temps     = snapshot.temps;
    this.scene     = snapshot.scene;
    this.ip        = snapshot.ip;
    this.callStack = snapshot.callStack;
    this.loopCounters.clear();
    return true;
  }

  get canUndo() { return this.undoStack.length > 0; }

  // ── Loop counters ──────────────────────────────────────────────────────────

  incrementLoop(loopInstrIdx, max) {
    const count = (this.loopCounters.get(loopInstrIdx) ?? 0) + 1;
    this.loopCounters.set(loopInstrIdx, count);
    if (count > max) {
      throw new Error(
        `[StoryScript Runtime] Infinite loop detected at instruction ${loopInstrIdx}. ` +
        `Loop exceeded ${max} iterations. Check your *while/*for condition.`
      );
    }
  }

  clearLoopCounter(loopInstrIdx) {
    this.loopCounters.delete(loopInstrIdx);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Serialize state to a JSON string for localStorage.
   * undoStack is intentionally excluded (session-only).
   */
  serialize() {
    return JSON.stringify({
      version:       SAVE_VERSION,
      scene:         this.scene,
      ip:            this.ip,
      globals:       [...this.globals],
      temps:         [...this.temps],
      callStack:     this.callStack,
      themeStack:    this.themeStack,
      inventory:     [...this.inventory],
      achievements:  [...this.achievements],
      grantedTitles: [...this.grantedTitles],
      activeTitle:   this.activeTitle,
    });
  }

  deserialize(jsonStr) {
    let data;
    try { data = JSON.parse(jsonStr); } catch { return false; }

    if (data.version !== SAVE_VERSION) {
      console.warn(`[StoryScript] Save file version ${data.version} does not match engine version ${SAVE_VERSION}. Save cleared.`);
      return false;
    }

    this.scene         = data.scene;
    this.ip            = data.ip;
    this.globals       = new Map(data.globals ?? []);
    this.temps         = new Map(data.temps ?? []);
    this.callStack     = data.callStack ?? [];
    this.themeStack    = data.themeStack ?? [];
    this.inventory     = new Map(data.inventory ?? []);
    this.achievements  = new Set(data.achievements ?? []);
    this.grantedTitles = new Set(data.grantedTitles ?? []);
    this.activeTitle   = data.activeTitle ?? null;
    return true;
  }
}
return { StoryState, SAVE_VERSION };
})();

// ─── renderer ───────────────────────────────────────────────
SS._renderer = (function() {
/**
 * DOMRenderer
 *
 * The browser-facing renderer. Uses event delegation — a single click
 * listener on a permanent container, identified by data attributes.
 * No individual listeners to remove on screen clear.
 *
 * Expected HTML structure:
 *   <div id="storyscript-root">
 *     <div id="storyscript-page"></div>
 *     <div id="storyscript-ui"></div>
 *   </div>
 *
 * PAGE_BREAK model (Session 2):
 *   *page_break appends a decorative divider and keeps running — no pause.
 *   Choices appear inline below accumulated text.
 *   Picking a choice calls clearChoices() — only the UI area is cleared,
 *   page text is preserved.
 *   clearScreen() still exists for restart only.
 */

class DOMRenderer {
  constructor(rootId = 'storyscript-root') {
    this.root = document.getElementById(rootId);
    if (!this.root) throw new Error(`[StoryScript] Root element #${rootId} not found`);

    this.page = document.getElementById('storyscript-page')
                ?? this._createElement('div', { id: 'storyscript-page' });
    this.ui   = document.getElementById('storyscript-ui')
                ?? this._createElement('div', { id: 'storyscript-ui' });

    if (!this.page.parentNode) this.root.appendChild(this.page);
    if (!this.ui.parentNode)   this.root.appendChild(this.ui);

    // Single delegated listener on the UI area
    this.ui.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this._handleAction(btn.dataset.action, btn.dataset.id);
    });

    this._callbacks = new Map(); // id → callback function
    this._nextId    = 0;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _id()    { return `ss-${this._nextId++}`; }
  _reg(cb) { const id = this._id(); this._callbacks.set(id, cb); return id; }

  _handleAction(action, id) {
    const cb = this._callbacks.get(id);
    if (cb) { this._callbacks.delete(id); cb(); }
  }

  _createElement(tag, attrs = {}, text = null) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== null) el.textContent = text;
    return el;
  }

  // ── Public API (called by Engine) ──────────────────────────────────────────

  appendText(text) {
    const p = this._createElement('p', { class: 'ss-text' });
    p.textContent = text;
    this.page.appendChild(p);
  }

  appendBlank() {
    this.page.appendChild(this._createElement('div', { class: 'ss-blank' }));
  }

  /**
   * Append a decorative section divider (the ✦ rule).
   * Called by PAGE_BREAK — does NOT pause execution.
   */
  appendDivider() {
    this.page.appendChild(this._createElement('div', { class: 'ss-divider' }));
  }

  /**
   * Clear only the UI area (choice buttons, undo button).
   * Leaves all page text intact. Called after a choice is picked.
   */
  clearChoices() {
    this.ui.innerHTML = '';
    this._callbacks.clear();
  }

  /**
   * Clear both page and UI completely. Used by restart only.
   */
  clearScreen() {
    this.page.innerHTML = '';
    this.ui.innerHTML   = '';
    this._callbacks.clear();
  }

  renderChoices(options) {
    const container = this._createElement('div', { class: 'ss-choices' });
    for (const opt of options) {
      const id  = this._reg(opt.onPick);
      const btn = this._createElement('button', {
        class:         'ss-choice-btn',
        'data-action': 'choice',
        'data-id':     id,
      });
      btn.textContent = opt.text;
      if (!opt.enabled) {
        btn.disabled = true;
        btn.classList.add('ss-choice-disabled');
      }
      container.appendChild(btn);
    }
    this.ui.appendChild(container);
  }

  renderUndo(onUndo) {
    const id  = this._reg(onUndo);
    const btn = this._createElement('button', {
      class:         'ss-undo-btn',
      'data-action': 'undo',
      'data-id':     id,
    }, '← Back');
    this.ui.appendChild(btn);
  }

  /**
   * @deprecated PAGE_BREAK no longer pauses. Kept for any external callers.
   */
  renderContinue(onContinue) {
    const id  = this._reg(onContinue);
    const btn = this._createElement('button', {
      class:         'ss-continue-btn',
      'data-action': 'continue',
      'data-id':     id,
    }, 'Continue');
    this.ui.appendChild(btn);
  }

  renderFinish() {
    const el = this._createElement('p', { class: 'ss-finish' }, '— The End —');
    this.page.appendChild(el);
    this.ui.innerHTML = '';
  }

  /**
   * Render a text or number input field, pausing execution until submitted.
   * @param {'text'|'number'} type
   * @param {string} prompt
   * @param {function} onSubmit
   */
  renderInput(type, prompt, onSubmit) {
    const container = this._createElement('div', { class: 'ss-input-block' });

    if (prompt) {
      const label = this._createElement('p', { class: 'ss-input-prompt' });
      label.textContent = prompt;
      container.appendChild(label);
    }

    const wrap = this._createElement('div', { class: 'ss-input-row' });
    const input = this._createElement('input', {
      type: type === 'number' ? 'number' : 'text',
      class: 'ss-input-field',
      placeholder: type === 'number' ? '0' : '…',
    });
    const btn = this._createElement('button', { class: 'ss-input-btn' }, 'Confirm');

    const submit = () => {
      const val = input.value.trim();
      if (type === 'number' && val === '') return;
      this.ui.innerHTML = '';
      this._callbacks.clear();
      onSubmit(val);
    };

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    btn.addEventListener('click', submit);

    wrap.appendChild(input);
    wrap.appendChild(btn);
    container.appendChild(wrap);
    this.ui.appendChild(container);
    setTimeout(() => input.focus(), 0);
  }

  /**
   * Render player inventory as a panel.
   */
  renderInventory(items) {
    if (items.length === 0) {
      const p = this._createElement('p', { class: 'ss-panel-empty' }, 'Your inventory is empty.');
      this.page.appendChild(p);
      return;
    }
    const panel = this._createElement('div', { class: 'ss-panel ss-inventory' });
    const hdr = this._createElement('div', { class: 'ss-panel-hdr' }, 'Inventory');
    panel.appendChild(hdr);
    for (const item of items) {
      const row = this._createElement('div', { class: 'ss-panel-row' });
      const nameEl = this._createElement('span', { class: 'ss-panel-label' });
      nameEl.textContent = item.name;
      const qtyEl = this._createElement('span', { class: 'ss-panel-value' });
      qtyEl.textContent = item.qty > 1 ? `×${item.qty}` : '';
      row.appendChild(nameEl);
      row.appendChild(qtyEl);
      if (item.desc) {
        const desc = this._createElement('span', { class: 'ss-panel-desc' });
        desc.textContent = item.desc;
        row.appendChild(desc);
      }
      panel.appendChild(row);
    }
    this.page.appendChild(panel);
  }

  /**
   * Render skill bars.
   */
  renderSkills(skills) {
    const panel = this._createElement('div', { class: 'ss-panel ss-skills' });
    const hdr = this._createElement('div', { class: 'ss-panel-hdr' }, 'Skills');
    panel.appendChild(hdr);
    for (const skill of skills) {
      const row = this._createElement('div', { class: 'ss-panel-row ss-skill-row' });
      const label = this._createElement('span', { class: 'ss-panel-label' });
      label.textContent = skill.label;
      const barWrap = this._createElement('div', { class: 'ss-skill-bar-wrap' });
      const bar = this._createElement('div', { class: 'ss-skill-bar' });
      const pct = Math.round(((skill.value - skill.min) / Math.max(1, skill.max - skill.min)) * 100);
      bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      barWrap.appendChild(bar);
      const val = this._createElement('span', { class: 'ss-panel-value' });
      val.textContent = String(skill.value);
      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(val);
      panel.appendChild(row);
    }
    this.page.appendChild(panel);
  }

  /**
   * Show a brief achievement unlock toast.
   */
  renderAchievementUnlock(id, schema) {
    const toast = this._createElement('div', { class: 'ss-achievement-toast' });
    const icon = schema.icon ?? '🏅';
    const title = schema.title ?? id;
    toast.textContent = `${icon} Achievement Unlocked: ${title}`;
    if (schema.desc) {
      const desc = this._createElement('div', { class: 'ss-achievement-desc' });
      desc.textContent = schema.desc;
      toast.appendChild(desc);
    }
    this.page.appendChild(toast);
  }

  /**
   * Render achievement list panel.
   */
  renderAchievements(list) {
    const panel = this._createElement('div', { class: 'ss-panel ss-achievements' });
    const hdr = this._createElement('div', { class: 'ss-panel-hdr' }, 'Achievements');
    panel.appendChild(hdr);
    for (const { id, schema, unlocked } of list) {
      const row = this._createElement('div', { class: `ss-panel-row ss-achievement-row${unlocked ? ' unlocked' : ' locked'}` });
      const icon = this._createElement('span', { class: 'ss-achievement-icon' });
      icon.textContent = unlocked ? (schema.icon ?? '🏅') : '🔒';
      const nameEl = this._createElement('span', { class: 'ss-panel-label' });
      nameEl.textContent = (unlocked || !schema.hidden) ? (schema.title ?? id) : '???';
      row.appendChild(icon);
      row.appendChild(nameEl);
      if (unlocked && schema.desc) {
        const desc = this._createElement('span', { class: 'ss-panel-desc' });
        desc.textContent = schema.desc;
        row.appendChild(desc);
      }
      panel.appendChild(row);
    }
    this.page.appendChild(panel);
  }

  showError(message) {
    const el = this._createElement('div', { class: 'ss-error' });
    el.textContent = message;
    this.page.appendChild(el);
    this.ui.innerHTML = '';
    console.error(message);
  }

  setTheme(vars) {
    for (const [key, val] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, val);
    }
  }

  snapshotTheme() {
    const style    = document.documentElement.style;
    const snapshot = {};
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.startsWith('--')) snapshot[prop] = style.getPropertyValue(prop);
    }
    return snapshot;
  }
}

// ── NullRenderer (for fuzzer / headless testing) ────────────────────────────

class NullRenderer {
  constructor() {
    this._pendingOptions = null;
    this._undoCb         = null;
    this.finished        = false;
  }

  appendText()    {}
  appendBlank()   {}

  /** PAGE_BREAK no longer pauses; this is intentionally a no-op. */
  appendDivider() {}

  /** Clear choice buttons only. Called after a choice is picked. */
  clearChoices() {
    this._pendingOptions = null;
    this._undoCb         = null;
  }

  /** Full reset — used by restart. */
  clearScreen() {
    this._pendingOptions = null;
    this._undoCb         = null;
    this.finished        = false;
  }

  renderChoices(options) {
    this._pendingOptions = options;
  }

  renderUndo(cb) {
    this._undoCb = cb;
  }

  /** @deprecated PAGE_BREAK no longer calls this. No-op for compatibility. */
  renderContinue(cb) {}

  renderFinish() {
    this.finished = true;
  }

  renderInput(type, prompt, onSubmit) {
    // In headless mode, auto-submit a default value
    onSubmit(type === 'number' ? '0' : 'test');
  }

  renderInventory(items) {}
  renderSkills(skills) {}
  renderAchievements(list) {}
  renderAchievementUnlock(id, schema) {}

  showError(msg) {
    throw new Error(msg);
  }

  setTheme()      {}
  snapshotTheme() { return {}; }
}

if (typeof module !== 'undefined') {
  module.exports = { DOMRenderer, NullRenderer };
}
return { DOMRenderer, NullRenderer };
})();

// ─── emitter ────────────────────────────────────────────────
SS._emitter = (function() {
/**
 * Emitter — IR → { program, sourceMap }
 *
 * Walks the structured IR tree and produces the flat instruction array
 * that the Engine executes. Every emitted instruction now carries `file`
 * and `lineNum` fields (source map), satisfying the Phase 1 requirement.
 *
 * The Emitter uses the same two-pass strategy as the old Compiler:
 *   Pass 1: emit instructions, collect label definitions and forward-ref patches
 *   Pass 2: backpatch all forward label references
 *
 * Errors are collected (not thrown) so the IDE can display all of them.
 */

const {IR,BYTECODE_VERSION} = SS._ir;

// ─── Re-export OP codes ───────────────────────────────────────────────────────
// (Same as the original compiler's OP — engine.js depends on these names.)

const OP = {
  TEXT:         'TEXT',
  BLANK:        'BLANK',
  LABEL:        'LABEL',
  GOTO:         'GOTO',
  GOSUB:        'GOSUB',
  RETURN:       'RETURN',
  CHOICE_PUSH:  'CHOICE_PUSH',
  CHOICE_END:   'CHOICE_END',
  IF:           'IF',
  ELSE:         'ELSE',
  ENDIF:        'ENDIF',
  WHILE:        'WHILE',
  ENDWHILE:     'ENDWHILE',
  FOR:          'FOR',
  ENDFOR:       'ENDFOR',
  SET:          'SET',
  SET_TEMP:     'SET_TEMP',
  CREATE:       'CREATE',
  LIST_CREATE:  'LIST_CREATE',
  OBJ_CREATE:   'OBJ_CREATE',
  OBJ_SET:      'OBJ_SET',
  PUSH:         'PUSH',
  POP:          'POP',
  PRINT:        'PRINT',
  PAGE_BREAK:   'PAGE_BREAK',
  SCENE:        'SCENE',
  FINISH:       'FINISH',
  THEME:        'THEME',
  THEME_PUSH:   'THEME_PUSH',
  THEME_POP:    'THEME_POP',
  LOOP_GUARD:   'LOOP_GUARD',
  ERROR:        'ERROR',
  // Phase 3
  RANDOM:       'RANDOM',
  INPUT_TEXT:   'INPUT_TEXT',
  INPUT_NUMBER: 'INPUT_NUMBER',
  ITEM:         'ITEM',
  GIVE:         'GIVE',
  TAKE:         'TAKE',
  SKILL:        'SKILL',
  IMPROVE:      'IMPROVE',
  REDUCE:       'REDUCE',
  ACHIEVEMENT:  'ACHIEVEMENT',
  UNLOCK:       'UNLOCK',
  TITLE:        'TITLE',
  GRANT:        'GRANT',
  REVOKE:       'REVOKE',
  SHOW_SKILLS:  'SHOW_SKILLS',
  SHOW_ACHIEVEMENTS: 'SHOW_ACHIEVEMENTS',
  SHOW_TITLE:   'SHOW_TITLE',
  SHOW_INVENTORY: 'SHOW_INVENTORY',
};

class EmitError {
  constructor(message, file, lineNum) {
    this.message = message;
    this.file    = file    ?? '<unknown>';
    this.lineNum = lineNum ?? 0;
    this.asError = () => {
      const e = new Error(`[StoryScript Emitter] ${this.file}:${this.lineNum} — ${this.message}`);
      e.name = 'EmitError';
      return e;
    };
  }
}

// ─── Emitter ──────────────────────────────────────────────────────────────────

class Emitter {
  constructor(options = {}) {
    this.loopCap    = options.loopCap ?? 100000;
    this.file       = '<unknown>';
    this._choiceSeq = 0;

    this.program    = [];
    this.sourceMap  = []; // parallel array: sourceMap[i] = { file, lineNum }
    this.labelTable = new Map(); // labelName → instrIdx
    this.patchList  = [];        // [{ instrIdx, field, labelName }]
    this.errors     = [];
  }

  // ── Instruction emission ───────────────────────────────────────────────────

  emit(instr, irNode) {
    const idx = this.program.length;
    // Attach source location to every instruction
    const loc = irNode
      ? { file: irNode.file ?? this.file, lineNum: irNode.lineNum ?? 0 }
      : { file: this.file, lineNum: 0 };
    this.program.push({ ...instr, ...loc });
    this.sourceMap.push(loc);
    return idx;
  }

  patch(instrIdx, field, labelName) {
    this.patchList.push({ instrIdx, field, labelName });
  }

  defLabel(name, irNode) {
    if (this.labelTable.has(name)) {
      this.errors.push(new EmitError(`Duplicate label: '${name}'`, irNode?.file, irNode?.lineNum));
    }
    const idx = this.emit({ op: OP.LABEL, name }, irNode);
    this.labelTable.set(name, idx);
    return idx;
  }

  addError(msg, irNode) {
    this.errors.push(new EmitError(msg, irNode?.file, irNode?.lineNum));
  }

  // ── Walk IR nodes ─────────────────────────────────────────────────────────

  emitNodes(nodes) {
    for (const node of nodes) {
      this.emitNode(node);
    }
  }

  emitNode(node) {
    switch (node.kind) {

      // ── Text ───────────────────────────────────────────────────────────────
      case IR.TEXT:
        this.emit({ op: OP.PRINT, value: node.value }, node);
        break;

      case IR.BLANK:
        this.emit({ op: OP.BLANK }, node);
        break;

      case IR.COMMENT:
        // No bytecode — comments are pure IR metadata
        break;

      // ── Control flow ───────────────────────────────────────────────────────
      case IR.FINISH:
        this.emit({ op: OP.FINISH }, node);
        break;

      case IR.PAGE_BREAK:
        this.emit({ op: OP.PAGE_BREAK }, node);
        break;

      case IR.RETURN:
        this.emit({ op: OP.RETURN }, node);
        break;

      case IR.LABEL:
        this.defLabel(node.name, node);
        break;

      case IR.GOTO: {
        const idx = this.emit({ op: OP.GOTO, target: null }, node);
        this.patch(idx, 'target', node.label);
        break;
      }

      case IR.GOSUB: {
        const idx = this.emit({ op: OP.GOSUB, target: null, args: node.args }, node);
        this.patch(idx, 'target', node.label);
        break;
      }

      case IR.SCENE:
        this.emit({ op: OP.SCENE, file: node.sceneName }, node);
        break;

      // ── Variables ──────────────────────────────────────────────────────────
      case IR.CREATE:
        this.emit({ op: OP.CREATE, var: node.var, expr: node.expr }, node);
        break;

      case IR.TEMP:
        this.emit({ op: OP.SET_TEMP, var: node.var, expr: node.expr }, node);
        break;

      case IR.SET:
        this.emit({ op: OP.SET, var: node.var, expr: node.expr }, node);
        break;

      case IR.LIST_CREATE:
        this.emit({ op: OP.LIST_CREATE, var: node.var, value: node.value }, node);
        break;

      case IR.OBJ_CREATE:
        this.emit({ op: OP.OBJ_CREATE, var: node.var, value: node.value }, node);
        break;

      case IR.OBJ_SET:
        this.emit({ op: OP.OBJ_SET, obj: node.obj, key: node.key, expr: node.expr }, node);
        break;

      case IR.PUSH:
        this.emit({ op: OP.PUSH, list: node.list, expr: node.expr }, node);
        break;

      case IR.POP:
        this.emit({ op: OP.POP, list: node.list, into: node.into }, node);
        break;

      // ── Theme ──────────────────────────────────────────────────────────────
      case IR.THEME:
        this.emit({ op: OP.THEME, vars: node.vars }, node);
        break;

      case IR.THEME_PUSH:
        this.emit({ op: OP.THEME_PUSH }, node);
        break;

      case IR.THEME_POP:
        this.emit({ op: OP.THEME_POP }, node);
        break;

      // ── If / elseif / else / endif ─────────────────────────────────────────
      case IR.IF:
        this.emitIf(node);
        break;

      // ── While ──────────────────────────────────────────────────────────────
      case IR.WHILE:
        this.emitWhile(node);
        break;

      // ── For ────────────────────────────────────────────────────────────────
      case IR.FOR:
        this.emitFor(node);
        break;

      // ── Choice ─────────────────────────────────────────────────────────────
      case IR.CHOICE:
        this.emitChoice(node);
        break;

      // ── Phase 3: Random & Input ─────────────────────────────────────────────
      case IR.RANDOM:
        this.emit({ op: OP.RANDOM, var: node.var, min: node.min, max: node.max }, node);
        break;

      case IR.INPUT_TEXT:
        this.emit({ op: OP.INPUT_TEXT, var: node.var, prompt: node.prompt }, node);
        break;

      case IR.INPUT_NUMBER:
        this.emit({ op: OP.INPUT_NUMBER, var: node.var, prompt: node.prompt }, node);
        break;

      // ── Phase 3: Item system ────────────────────────────────────────────────
      case IR.ITEM:
        this.emit({ op: OP.ITEM, id: node.id, schema: node.schema }, node);
        break;

      case IR.GIVE:
        this.emit({ op: OP.GIVE, id: node.id, qty: node.qty }, node);
        break;

      case IR.TAKE:
        this.emit({ op: OP.TAKE, id: node.id, qty: node.qty }, node);
        break;

      case IR.SHOW_INVENTORY:
        this.emit({ op: OP.SHOW_INVENTORY }, node);
        break;

      // ── Phase 3: Skill system ───────────────────────────────────────────────
      case IR.SKILL:
        this.emit({ op: OP.SKILL, id: node.id, schema: node.schema }, node);
        break;

      case IR.IMPROVE:
        this.emit({ op: OP.IMPROVE, id: node.id, expr: node.expr }, node);
        break;

      case IR.REDUCE:
        this.emit({ op: OP.REDUCE, id: node.id, expr: node.expr }, node);
        break;

      case IR.SHOW_SKILLS:
        this.emit({ op: OP.SHOW_SKILLS }, node);
        break;

      // ── Phase 3: Achievement system ─────────────────────────────────────────
      case IR.ACHIEVEMENT:
        this.emit({ op: OP.ACHIEVEMENT, id: node.id, schema: node.schema }, node);
        break;

      case IR.UNLOCK:
        this.emit({ op: OP.UNLOCK, id: node.id }, node);
        break;

      case IR.SHOW_ACHIEVEMENTS:
        this.emit({ op: OP.SHOW_ACHIEVEMENTS }, node);
        break;

      // ── Phase 3: Title system ───────────────────────────────────────────────
      case IR.TITLE:
        this.emit({ op: OP.TITLE, id: node.id, schema: node.schema }, node);
        break;

      case IR.GRANT:
        this.emit({ op: OP.GRANT, id: node.id }, node);
        break;

      case IR.REVOKE:
        this.emit({ op: OP.REVOKE, id: node.id }, node);
        break;

      case IR.SHOW_TITLE:
        this.emit({ op: OP.SHOW_TITLE }, node);
        break;

      default:
        this.addError(`Unknown IR node kind: ${node.kind}`, node);
        break;
    }
  }

  // ── If emission ───────────────────────────────────────────────────────────

  emitIf(node) {
    // Structure:
    //   IF expr else→A
    //   <consequent>
    //   [ELSE end→Z]       ← only if there are elseif/else clauses
    //   A: ENDIF or next elseif IF ...
    //   ...
    //   Z: ENDIF

    // Collect all "arms": the main if + elseifs + optional else
    const arms = [
      { condition: node.condition, body: node.consequent, irNode: node },
      ...node.elseifClauses.map(c => ({ condition: c.condition, body: c.body, irNode: c })),
    ];
    const hasAlternate = node.alternate !== null;

    // We'll emit arms in order. Each IF instruction needs its else-target
    // patched to the next arm's label, or to the ENDIF if it's the last.
    // Each body ends with an ELSE jump to the ENDIF.

    const endLabel = `__endif_${this._uid()}`;
    const armElseLabels = arms.map(() => `__else_${this._uid()}`);

    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];

      // Emit the IF instruction; else target → next arm or alternate or endif
      const ifIdx = this.emit({ op: OP.IF, expr: arm.condition, else: null }, arm.irNode);

      const elseTarget = i + 1 < arms.length
        ? armElseLabels[i + 1]
        : (hasAlternate ? armElseLabels[armElseLabels.length] : endLabel);

      // We'll patch this after we know the next arm's label index
      // For now: record a symbolic patch using a temp label
      const myElseLabel = `__if_else_${this._uid()}`;
      this.patchList.push({ instrIdx: ifIdx, field: 'else', labelName:
        i + 1 < arms.length
          ? armElseLabels[i + 1]
          : (hasAlternate ? `__arm_alt_${node.file}_${node.lineNum}` : endLabel)
      });

      // Emit body
      this.emitNodes(arm.body);

      // After body: jump to end (unless this is the last arm and there's no alternate)
      if (i + 1 < arms.length || hasAlternate) {
        const elseIdx = this.emit({ op: OP.ELSE, end: null }, arm.irNode);
        this.patch(elseIdx, 'end', endLabel);
      }

      // Emit label for next arm's else-jump target
      if (i + 1 < arms.length) {
        const labelIdx = this.emit({ op: OP.LABEL, name: armElseLabels[i + 1] }, arm.irNode);
        this.labelTable.set(armElseLabels[i + 1], labelIdx);
        // Now fix the IF's else patch to point here
        // (We over-wrote above with symbolic patch — correct that one)
      }
    }

    // Emit alternate (else body)
    if (hasAlternate) {
      const altLabel = `__arm_alt_${node.file}_${node.lineNum}`;
      const altIdx = this.emit({ op: OP.LABEL, name: altLabel }, node);
      this.labelTable.set(altLabel, altIdx);
      this.emitNodes(node.alternate);
    }

    // ENDIF label
    const endIdx = this.emit({ op: OP.ENDIF }, node);
    this.labelTable.set(endLabel, endIdx);
  }

  // ── While emission ────────────────────────────────────────────────────────

  emitWhile(node) {
    const whileIdx = this.emit({ op: OP.WHILE, expr: node.condition, end: null, loopStart: null }, node);
    this.program[whileIdx].loopStart = whileIdx;
    this.emit({ op: OP.LOOP_GUARD, max: this.loopCap, loopInstrIdx: whileIdx }, node);

    this.emitNodes(node.body);

    const endIdx = this.emit({ op: OP.ENDWHILE, loopStart: whileIdx }, node);
    this.program[whileIdx].end = endIdx + 1; // ip after ENDWHILE
  }

  // ── For emission ──────────────────────────────────────────────────────────

  emitFor(node) {
    const forIdx = this.emit({ op: OP.FOR, var: node.var, list: node.list, end: null, loopStart: null }, node);
    this.program[forIdx].loopStart = forIdx;
    this.emit({ op: OP.LOOP_GUARD, max: this.loopCap, loopInstrIdx: forIdx }, node);

    this.emitNodes(node.body);

    const endIdx = this.emit({ op: OP.ENDFOR, loopStart: forIdx }, node);
    this.program[forIdx].end = endIdx + 1;
  }

  // ── Choice emission ───────────────────────────────────────────────────────

  emitChoice(node) {
    const choiceId   = this._choiceSeq++;
    const afterLabel = `__choice_after_${choiceId}`;

    this.emit({ op: OP.CHOICE_PUSH }, node);
    const choiceEndIdx = this.emit({ op: OP.CHOICE_END, options: [] }, node);

    for (const opt of node.options) {
      const bodyStart = this.program.length;

      this.emitNodes(opt.body);

      // After each body, jump to after the whole choice
      const gotoIdx = this.emit({ op: OP.GOTO, target: null }, node);
      this.patch(gotoIdx, 'target', afterLabel);

      this.program[choiceEndIdx].options.push({
        text:   opt.text,
        cond:   opt.cond,
        target: bodyStart,
      });
    }

    // After-choice label
    const afterIdx = this.emit({ op: OP.LABEL, name: afterLabel }, node);
    this.labelTable.set(afterLabel, afterIdx);
  }

  // ── Backpatching ──────────────────────────────────────────────────────────

  backpatch() {
    for (const { instrIdx, field, labelName } of this.patchList) {
      if (!this.labelTable.has(labelName)) {
        const instr = this.program[instrIdx];
        this.errors.push(new EmitError(
          `Unresolved label: '${labelName}'`,
          instr?.file,
          instr?.lineNum
        ));
        continue;
      }
      this.program[instrIdx][field] = this.labelTable.get(labelName);
    }
  }

  // ── UID generator ─────────────────────────────────────────────────────────

  _uid() {
    if (!this._uidCounter) this._uidCounter = 0;
    return this._uidCounter++;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Emit bytecode from an IR node array.
 *
 * @param {object[]} nodes    - from parser.parse()
 * @param {string}   file     - filename (for source map)
 * @param {object}   options
 * @param {number}   [options.loopCap] - max loop iterations
 *
 * @returns {{
 *   program:   object[],
 *   sourceMap: {file: string, lineNum: number}[],
 *   errors:    EmitError[],
 *   version:   number,
 * }}
 */
function emit(nodes, file = '<unknown>', options = {}) {
  const emitter = new Emitter(options);
  emitter.file  = file;
  emitter.emitNodes(nodes);
  emitter.backpatch();
  return {
    program:   emitter.program,
    sourceMap: emitter.sourceMap,
    errors:    emitter.errors,
    version:   BYTECODE_VERSION,
  };
}
return { emit, OP, BYTECODE_VERSION, Emitter };
})();

// ─── parser ─────────────────────────────────────────────────
SS._parser = (function() {
/**
 * Parser — tokens → IR
 *
 * Converts the flat token stream from the lexer into a structured IR tree.
 * Block constructs (if/while/for/choice) produce nested IR nodes.
 *
 * IMPORTANT: The StoryScript language uses explicit terminators
 * (*endif, *endwhile, *endfor) for control-flow blocks — NOT indentation.
 * Indentation is only structurally meaningful for *choice option bodies.
 *
 * Error handling: the parser collects errors rather than throwing on the
 * first one, enabling the IDE to display multiple diagnostics at once.
 *
 * Returns: { nodes: IR[], errors: ParseError[], warnings: ParseWarning[] }
 */

const {IR} = SS._ir;

class ParseError {
  constructor(message, file, lineNum) {
    this.message = message;
    this.file    = file    ?? '<unknown>';
    this.lineNum = lineNum ?? 0;
    this.asError = () => {
      const e = new Error(`[StoryScript Parser] ${this.file}:${this.lineNum} — ${this.message}`);
      e.name = 'ParseError';
      e.file = this.file;
      e.lineNum = this.lineNum;
      return e;
    };
  }
}

class ParseWarning {
  constructor(message, file, lineNum) {
    this.message = message;
    this.file    = file    ?? '<unknown>';
    this.lineNum = lineNum ?? 0;
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

class Parser {
  constructor(tokens, file, startupFile) {
    this.tokens      = tokens;
    this.file        = file;
    this.startupFile = startupFile ?? 'startup.txt';
    this.pos         = 0;
    this.errors      = [];
    this.warnings    = [];
  }

  // ── Token navigation ───────────────────────────────────────────────────────

  peek()    { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }
  atEnd()   { return this.pos >= this.tokens.length; }

  // ── Helpers ────────────────────────────────────────────────────────────────

  addError(msg, tok) {
    this.errors.push(new ParseError(msg, tok?.file ?? this.file, tok?.lineNum ?? 0));
  }

  addWarning(msg, tok) {
    this.warnings.push(new ParseWarning(msg, tok?.file ?? this.file, tok?.lineNum ?? 0));
  }

  parseCmd(payload) {
    const sp = payload.search(/\s/);
    if (sp === -1) return { name: payload.toLowerCase(), rest: '' };
    return { name: payload.slice(0, sp).toLowerCase(), rest: payload.slice(sp + 1).trimStart() };
  }

  loc(tok) {
    return { file: tok?.file ?? this.file, lineNum: tok?.lineNum ?? 0 };
  }

  // ── Peek at the name of the next command (without consuming) ───────────────
  peekCmdName() {
    const tok = this.peek();
    if (!tok || tok.type !== 'command') return null;
    return this.parseCmd(tok.payload).name;
  }

  // ── Main parse entry ───────────────────────────────────────────────────────

  /**
   * Parse tokens until end-of-input or a stop condition.
   * stopNames: set of command names that stop parsing (not consumed).
   */
  parseNodes(stopNames) {
    const nodes = [];
    stopNames = stopNames ?? new Set();

    while (!this.atEnd()) {
      const tok = this.peek();

      // Stop at terminators
      if (tok.type === 'command') {
        const { name } = this.parseCmd(tok.payload);
        if (stopNames.has(name)) break;
      }

      if (tok.type === 'blank') {
        this.consume();
        nodes.push({ kind: IR.BLANK, ...this.loc(tok) });
        continue;
      }

      if (tok.type === 'choice_option') {
        this.consume();
        this.addError('Choice option (#) outside of a *choice block', tok);
        continue;
      }

      if (tok.type === 'text') {
        this.consume();
        nodes.push({ kind: IR.TEXT, value: tok.payload, ...this.loc(tok) });
        continue;
      }

      if (tok.type === 'command') {
        const node = this.parseCommand(tok);
        if (node) nodes.push(node);
        continue;
      }

      this.consume(); // unknown — skip
    }

    return nodes;
  }

  // ── Single command dispatch ────────────────────────────────────────────────

  parseCommand(tok) {
    this.consume();
    const { name, rest } = this.parseCmd(tok.payload);

    switch (name) {

      // ── Trivial single-line nodes ─────────────────────────────────────────
      case 'finish':     return { kind: IR.FINISH,     ...this.loc(tok) };
      case 'page_break': return { kind: IR.PAGE_BREAK, ...this.loc(tok) };
      case 'return':     return { kind: IR.RETURN,     ...this.loc(tok) };
      case 'theme_push': return { kind: IR.THEME_PUSH, ...this.loc(tok) };
      case 'theme_pop':  return { kind: IR.THEME_POP,  ...this.loc(tok) };
      case 'comment':    return { kind: IR.COMMENT, value: rest, ...this.loc(tok) };

      case 'label': {
        const n = rest.trim();
        if (!n) { this.addError('*label requires a name', tok); return null; }
        return { kind: IR.LABEL, name: n, ...this.loc(tok) };
      }

      case 'goto': {
        const n = rest.trim();
        if (!n) { this.addError('*goto requires a label name', tok); return null; }
        return { kind: IR.GOTO, label: n, ...this.loc(tok) };
      }

      case 'scene': {
        const n = rest.trim();
        if (!n) { this.addError('*scene requires a filename', tok); return null; }
        return { kind: IR.SCENE, sceneName: n, ...this.loc(tok) };
      }

      case 'theme': {
        let v;
        try { v = JSON.parse(rest.trim()); }
        catch { this.addError('*theme requires a valid JSON object', tok); return null; }
        return { kind: IR.THEME, vars: v, ...this.loc(tok) };
      }

      // ── Variable declarations ─────────────────────────────────────────────

      case 'create': {
        if (this.file !== this.startupFile) {
          this.addError(
            `*create '${rest.split(/\s+/)[0]}' is only allowed in ${this.startupFile}. ` +
            `Use *temp for scene-local variables.`,
            tok
          );
          return null;
        }
        const m = rest.match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*create: expected *create varname value', tok); return null; }
        return { kind: IR.CREATE, var: m[1], expr: m[2], ...this.loc(tok) };
      }

      case 'temp': {
        const m = rest.match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*temp: expected *temp varname value', tok); return null; }
        return { kind: IR.TEMP, var: m[1], expr: m[2], ...this.loc(tok) };
      }

      case 'set': {
        const m = rest.match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*set: expected *set varname expression', tok); return null; }
        return { kind: IR.SET, var: m[1], expr: m[2], ...this.loc(tok) };
      }

      case 'list': {
        if (this.file !== this.startupFile) {
          this.addError(
            `*list '${rest.split(/\s+/)[0]}' declares a global and is only allowed in ${this.startupFile}. ` +
            `Use *temp for scene-local variables.`,
            tok
          );
          return null;
        }
        const m = rest.match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*list: expected *list varname [...]', tok); return null; }
        let v;
        try { v = JSON.parse(m[2]); }
        catch { this.addError(`*list: invalid JSON: ${m[2]}`, tok); return null; }
        if (!Array.isArray(v)) { this.addError('*list value must be a JSON array', tok); return null; }
        return { kind: IR.LIST_CREATE, var: m[1], value: v, ...this.loc(tok) };
      }

      case 'object': {
        if (this.file !== this.startupFile) {
          this.addError(
            `*object '${rest.split(/\s+/)[0]}' declares a global and is only allowed in ${this.startupFile}. ` +
            `Use *temp for scene-local variables.`,
            tok
          );
          return null;
        }
        const m = rest.match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*object: expected *object varname {...}', tok); return null; }
        let v;
        try { v = JSON.parse(m[2]); }
        catch { this.addError(`*object: invalid JSON: ${m[2]}`, tok); return null; }
        if (typeof v !== 'object' || Array.isArray(v)) {
          this.addError('*object value must be a JSON object', tok); return null;
        }
        return { kind: IR.OBJ_CREATE, var: m[1], value: v, ...this.loc(tok) };
      }

      case 'obj_set': {
        const m = rest.match(/^(\S+)\.(\S+)\s+(.+)$/);
        if (!m) { this.addError('*obj_set: expected *obj_set obj.key expr', tok); return null; }
        return { kind: IR.OBJ_SET, obj: m[1], key: m[2], expr: m[3], ...this.loc(tok) };
      }

      case 'push': {
        const m = rest.match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*push: expected *push listname expr', tok); return null; }
        return { kind: IR.PUSH, list: m[1], expr: m[2], ...this.loc(tok) };
      }

      case 'pop': {
        const m = rest.match(/^(\S+)(?:\s+into\s+(\S+))?$/i);
        if (!m) { this.addError('*pop: expected *pop listname [into varname]', tok); return null; }
        return { kind: IR.POP, list: m[1], into: m[2] ?? null, ...this.loc(tok) };
      }

      case 'gosub': {
        const parts = rest.trim().split(/\s+/);
        if (!parts[0]) { this.addError('*gosub requires a label name', tok); return null; }
        return { kind: IR.GOSUB, label: parts[0], args: parts.slice(1), ...this.loc(tok) };
      }

      // ── Phase 3: Random & Input ───────────────────────────────────────────
      case 'random': {
        const m = rest.trim().match(/^(\S+)\s+(\S+)\s+(\S+)$/);
        if (!m) { this.addError('*random: expected *random varname min max', tok); return null; }
        return { kind: IR.RANDOM, var: m[1], min: m[2], max: m[3], ...this.loc(tok) };
      }

      case 'input_text': {
        const m = rest.trim().match(/^(\S+)(?:\s+"(.+)")?$/);
        if (!m) { this.addError('*input_text: expected *input_text varname ["prompt"]', tok); return null; }
        return { kind: IR.INPUT_TEXT, var: m[1], prompt: m[2] ?? null, ...this.loc(tok) };
      }

      case 'input_number': {
        const m = rest.trim().match(/^(\S+)(?:\s+"(.+)")?$/);
        if (!m) { this.addError('*input_number: expected *input_number varname ["prompt"]', tok); return null; }
        return { kind: IR.INPUT_NUMBER, var: m[1], prompt: m[2] ?? null, ...this.loc(tok) };
      }

      // ── Phase 3: Item system ─────────────────────────────────────────────
      case 'item': {
        if (this.file !== this.startupFile) {
          this.addError(`*item declarations are only allowed in ${this.startupFile}`, tok); return null;
        }
        const m = rest.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*item: expected *item id {...}', tok); return null; }
        let schema;
        try { schema = JSON.parse(m[2]); }
        catch { this.addError(`*item: invalid JSON schema: ${m[2]}`, tok); return null; }
        return { kind: IR.ITEM, id: m[1], schema, ...this.loc(tok) };
      }

      case 'give': {
        const m = rest.trim().match(/^(\S+)(?:\s+(\d+))?$/);
        if (!m) { this.addError('*give: expected *give itemid [qty]', tok); return null; }
        return { kind: IR.GIVE, id: m[1], qty: m[2] ? parseInt(m[2]) : 1, ...this.loc(tok) };
      }

      case 'take': {
        const m = rest.trim().match(/^(\S+)(?:\s+(\d+))?$/);
        if (!m) { this.addError('*take: expected *take itemid [qty]', tok); return null; }
        return { kind: IR.TAKE, id: m[1], qty: m[2] ? parseInt(m[2]) : 1, ...this.loc(tok) };
      }

      case 'show_inventory':
        return { kind: IR.SHOW_INVENTORY, ...this.loc(tok) };

      // ── Phase 3: Skill system ────────────────────────────────────────────
      case 'skill': {
        if (this.file !== this.startupFile) {
          this.addError(`*skill declarations are only allowed in ${this.startupFile}`, tok); return null;
        }
        const m = rest.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*skill: expected *skill id {...}', tok); return null; }
        let schema;
        try { schema = JSON.parse(m[2]); }
        catch { this.addError(`*skill: invalid JSON schema: ${m[2]}`, tok); return null; }
        return { kind: IR.SKILL, id: m[1], schema, ...this.loc(tok) };
      }

      case 'improve': {
        const m = rest.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*improve: expected *improve skillid amount', tok); return null; }
        return { kind: IR.IMPROVE, id: m[1], expr: m[2], ...this.loc(tok) };
      }

      case 'reduce': {
        const m = rest.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*reduce: expected *reduce skillid amount', tok); return null; }
        return { kind: IR.REDUCE, id: m[1], expr: m[2], ...this.loc(tok) };
      }

      case 'show_skills':
        return { kind: IR.SHOW_SKILLS, ...this.loc(tok) };

      // ── Phase 3: Achievement system ──────────────────────────────────────
      case 'achievement': {
        if (this.file !== this.startupFile) {
          this.addError(`*achievement declarations are only allowed in ${this.startupFile}`, tok); return null;
        }
        const m = rest.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*achievement: expected *achievement id {...}', tok); return null; }
        let schema;
        try { schema = JSON.parse(m[2]); }
        catch { this.addError(`*achievement: invalid JSON schema: ${m[2]}`, tok); return null; }
        return { kind: IR.ACHIEVEMENT, id: m[1], schema, ...this.loc(tok) };
      }

      case 'unlock': {
        const id = rest.trim();
        if (!id) { this.addError('*unlock requires an achievement id', tok); return null; }
        return { kind: IR.UNLOCK, id, ...this.loc(tok) };
      }

      case 'show_achievements':
        return { kind: IR.SHOW_ACHIEVEMENTS, ...this.loc(tok) };

      // ── Phase 3: Title system ────────────────────────────────────────────
      case 'title': {
        if (this.file !== this.startupFile) {
          this.addError(`*title declarations are only allowed in ${this.startupFile}`, tok); return null;
        }
        const m = rest.trim().match(/^(\S+)\s+(.+)$/);
        if (!m) { this.addError('*title: expected *title id {...}', tok); return null; }
        let schema;
        try { schema = JSON.parse(m[2]); }
        catch { this.addError(`*title: invalid JSON schema: ${m[2]}`, tok); return null; }
        return { kind: IR.TITLE, id: m[1], schema, ...this.loc(tok) };
      }

      case 'grant': {
        const id = rest.trim();
        if (!id) { this.addError('*grant requires a title id', tok); return null; }
        return { kind: IR.GRANT, id, ...this.loc(tok) };
      }

      case 'revoke': {
        const id = rest.trim();
        if (!id) { this.addError('*revoke requires a title id', tok); return null; }
        return { kind: IR.REVOKE, id, ...this.loc(tok) };
      }

      case 'show_title':
        return { kind: IR.SHOW_TITLE, ...this.loc(tok) };

      // ── Block constructs ──────────────────────────────────────────────────
      case 'if':      return this.parseIf(tok, rest);
      case 'while':   return this.parseWhile(tok, rest);
      case 'for':     return this.parseFor(tok, rest);
      case 'choice':  return this.parseChoice(tok);

      // ── Unexpected terminators ────────────────────────────────────────────
      case 'elseif':
      case 'else':
      case 'endif':
        this.addError(`*${name} without matching *if`, tok);
        return null;

      case 'endwhile':
        this.addError('*endwhile without matching *while', tok);
        return null;

      case 'endfor':
        this.addError('*endfor without matching *for', tok);
        return null;

      default:
        this.addError(`Unknown command: *${name}`, tok);
        return null;
    }
  }

  // ── If/elseif/else/endif ──────────────────────────────────────────────────

  parseIf(tok, condition) {
    if (!condition.trim()) { this.addError('*if requires a condition', tok); return null; }

    const node = {
      kind:          IR.IF,
      condition:     condition.trim(),
      consequent:    [],
      elseifClauses: [],
      alternate:     null,
      ...this.loc(tok),
    };

    // Body continues until *elseif/*else/*endif
    node.consequent = this.parseNodes(new Set(['elseif', 'else', 'endif']));

    // Consume elseif/else/endif chain
    while (!this.atEnd()) {
      const next = this.peek();
      if (next.type !== 'command') break;
      const { name, rest } = this.parseCmd(next.payload);

      if (name === 'elseif') {
        this.consume();
        if (!rest.trim()) { this.addError('*elseif requires a condition', next); continue; }
        const body = this.parseNodes(new Set(['elseif', 'else', 'endif']));
        node.elseifClauses.push({ condition: rest.trim(), body, ...this.loc(next) });
        continue;
      }

      if (name === 'else') {
        this.consume();
        node.alternate = this.parseNodes(new Set(['endif']));
        // consume *endif
        if (!this.atEnd() && this.peekCmdName() === 'endif') {
          this.consume();
        } else {
          this.addError('Missing *endif after *else block', tok);
        }
        return node;
      }

      if (name === 'endif') {
        this.consume();
        return node;
      }

      break;
    }

    this.addError('Missing *endif', tok);
    return node;
  }

  // ── While/endwhile ────────────────────────────────────────────────────────

  parseWhile(tok, condition) {
    if (!condition.trim()) { this.addError('*while requires a condition', tok); return null; }

    const node = {
      kind:      IR.WHILE,
      condition: condition.trim(),
      body:      [],
      ...this.loc(tok),
    };

    node.body = this.parseNodes(new Set(['endwhile']));

    if (!this.atEnd() && this.peekCmdName() === 'endwhile') {
      this.consume();
    } else {
      this.addError('Missing *endwhile', tok);
    }

    return node;
  }

  // ── For/endfor ────────────────────────────────────────────────────────────

  parseFor(tok, rest) {
    const m = rest.match(/^(\S+)\s+in\s+(\S+)$/i);
    if (!m) { this.addError('*for: expected *for varname in listname', tok); return null; }

    const node = {
      kind: IR.FOR,
      var:  m[1],
      list: m[2],
      body: [],
      ...this.loc(tok),
    };

    node.body = this.parseNodes(new Set(['endfor']));

    if (!this.atEnd() && this.peekCmdName() === 'endfor') {
      this.consume();
    } else {
      this.addError('Missing *endfor', tok);
    }

    return node;
  }

  // ── Choice ────────────────────────────────────────────────────────────────
  // Choice IS depth-based: option bodies are more indented than the # line.

  parseChoice(tok) {
    const choiceDepth = tok.depth;
    const node = {
      kind:    IR.CHOICE,
      options: [],
      ...this.loc(tok),
    };

    while (!this.atEnd()) {
      const next = this.peek();

      if (next.type === 'blank') { this.consume(); continue; }

      // Dedented past choice depth — stop
      if (next.depth <= choiceDepth) break;

      if (next.type !== 'choice_option') {
        this.consume();
        this.addError('Expected a choice option (#) inside *choice block', next);
        continue;
      }

      this.consume(); // consume the # token

      // Parse optional [if condition] prefix
      let optText = next.payload;
      let optCond = null;
      const ifMatch = optText.match(/^\[if\s+(.+?)\]\s*/i);
      if (ifMatch) {
        optCond = ifMatch[1];
        optText = optText.slice(ifMatch[0].length);
      }

      const optDepth = next.depth;

      // Parse option body — everything more indented than the # line
      const optBody = this.parseChoiceBody(optDepth);

      node.options.push({
        text: optText,
        cond: optCond,
        body: optBody,
        ...this.loc(next),
      });
    }

    if (node.options.length === 0) {
      this.addError('*choice block has no options (#)', tok);
    }

    return node;
  }

  /**
   * Parse a choice option body — all tokens at depth > optDepth.
   * Stops (without consuming) when a token at depth <= optDepth is seen
   * or another # sibling appears.
   */
  parseChoiceBody(optDepth) {
    const nodes = [];

    while (!this.atEnd()) {
      const tok = this.peek();

      if (tok.type === 'blank') {
        this.consume();
        nodes.push({ kind: IR.BLANK, ...this.loc(tok) });
        continue;
      }

      // Stop at dedent
      if (tok.depth <= optDepth) break;

      if (tok.type === 'text') {
        this.consume();
        nodes.push({ kind: IR.TEXT, value: tok.payload, ...this.loc(tok) });
        continue;
      }

      if (tok.type === 'choice_option') {
        // Next sibling option — stop
        break;
      }

      if (tok.type === 'command') {
        const { name } = this.parseCmd(tok.payload);
        if (name === 'choice') {
          this.consume();
          const nested = this.parseChoice(tok);
          if (nested) nodes.push(nested);
        } else {
          // Normal command — parseCommand respects terminators internally
          const node = this.parseCommand(tok);
          if (node) nodes.push(node);
        }
        continue;
      }

      this.consume();
    }

    return nodes;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function parse(tokens, file, options) {
  file    = file    ?? '<unknown>';
  options = options ?? {};
  const parser = new Parser(tokens, file, options.startupFile ?? 'startup.txt');
  const nodes  = parser.parseNodes();
  return { nodes, errors: parser.errors, warnings: parser.warnings };
}
return { parse, ParseError, ParseWarning };
})();

// ─── compiler ───────────────────────────────────────────────
SS._compiler = (function() {
/**
 * Compiler — orchestrates lexer → parser → emitter
 *
 * PUBLIC API
 * ──────────
 *
 * compileFull(source, file, options)
 *   → {
 *       program:     object[],      // flat bytecode (Engine-ready)
 *       sourceMap:   {file, lineNum}[], // parallel to program
 *       symbolTable: SymbolTable,   // labels, globals, temps, scene refs
 *       errors:      DiagnosticError[],
 *       warnings:    DiagnosticWarning[],
 *       version:     number,        // BYTECODE_VERSION
 *     }
 *
 *   Never throws. Always returns a result. Errors are collected in .errors.
 *
 * compile(source, file, options)
 *   Backward-compatible shim. Returns program[] directly, throws CompileError
 *   on the first error (matching the old behavior that engine.js depends on).
 *
 * OP  — opcode constants (re-exported from emitter)
 */

const {tokenize} = SS._lexer;
const {parse} = SS._parser;
const {emit,OP,BYTECODE_VERSION} = SS._emitter;
const {SymbolTable} = SS._ir;

// ─── CompileError (backward compat) ──────────────────────────────────────────

class CompileError extends Error {
  constructor(message, file, lineNum) {
    const loc = (file && lineNum) ? `${file}:${lineNum} — ` : '';
    super(`[StoryScript Compiler] ${loc}${message}`);
    this.name    = 'CompileError';
    this.file    = file;
    this.lineNum = lineNum;
  }
}

// ─── Unified diagnostic wrappers ─────────────────────────────────────────────

class DiagnosticError {
  constructor(message, file, lineNum) {
    this.message = message;
    this.file    = file    ?? '<unknown>';
    this.lineNum = lineNum ?? 0;
  }
  toString() { return `[ERROR] ${this.file}:${this.lineNum} — ${this.message}`; }
}

class DiagnosticWarning {
  constructor(message, file, lineNum) {
    this.message = message;
    this.file    = file    ?? '<unknown>';
    this.lineNum = lineNum ?? 0;
  }
  toString() { return `[WARN] ${this.file}:${this.lineNum} — ${this.message}`; }
}

// ─── compileFull ──────────────────────────────────────────────────────────────

/**
 * Full compilation pipeline with error collection.
 * Does not throw — all errors are returned in .errors.
 *
 * @param {string} source
 * @param {string} file
 * @param {object} options
 * @param {string} [options.startupFile]
 * @param {number} [options.loopCap]
 *
 * @returns {{
 *   program:     object[],
 *   sourceMap:   {file: string, lineNum: number}[],
 *   symbolTable: SymbolTable,
 *   errors:      DiagnosticError[],
 *   warnings:    DiagnosticWarning[],
 *   version:     number,
 * }}
 */
function compileFull(source, file, options) {
  file    = file    ?? '<unknown>';
  options = options ?? {};

  const errors   = [];
  const warnings = [];

  // ── Lex ───────────────────────────────────────────────────────────────────
  let tokens;
  try {
    tokens = tokenize(source, file);
  } catch (e) {
    errors.push(new DiagnosticError(e.message, file, e.lineNum ?? 0));
    return {
      program: [], sourceMap: [], symbolTable: new SymbolTable(),
      errors, warnings, version: BYTECODE_VERSION,
    };
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  const parseResult = parse(tokens, file, {
    startupFile: options.startupFile ?? 'startup.txt',
  });

  for (const e of parseResult.errors) {
    errors.push(new DiagnosticError(e.message, e.file, e.lineNum));
  }
  for (const w of parseResult.warnings) {
    warnings.push(new DiagnosticWarning(w.message, w.file, w.lineNum));
  }

  // ── Build SymbolTable ─────────────────────────────────────────────────────
  const symbolTable = new SymbolTable();
  symbolTable.populate(parseResult.nodes, file);

  // ── Emit ──────────────────────────────────────────────────────────────────
  const emitResult = emit(parseResult.nodes, file, {
    loopCap: options.loopCap ?? 100000,
  });

  for (const e of emitResult.errors) {
    errors.push(new DiagnosticError(e.message, e.file, e.lineNum));
  }

  return {
    program:     emitResult.program,
    sourceMap:   emitResult.sourceMap,
    symbolTable,
    errors,
    warnings,
    version:     BYTECODE_VERSION,
  };
}

// ─── compile (backward-compatible shim) ───────────────────────────────────────

/**
 * Backward-compatible compilation function.
 * Returns a program array; throws CompileError on any error.
 * This is what engine.js, lint.js, and fuzz.js currently call.
 */
function compile(source, file, options) {
  file    = file    ?? '<unknown>';
  options = options ?? {};

  const result = compileFull(source, file, options);

  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new CompileError(first.message, first.file, first.lineNum);
  }

  return result.program;
}

// ─── Compiler class (backward-compatible shim) ────────────────────────────────

class Compiler {
  constructor(options) {
    this._options = options ?? {};
  }

  compile(source, file) {
    return compile(source, file, this._options);
  }
}
return { compile, compileFull, Compiler, CompileError, DiagnosticError, DiagnosticWarning, OP, BYTECODE_VERSION };
})();

// ─── engine ─────────────────────────────────────────────────
SS._engine = (function() {
/**
 * Engine
 *
 * Drives the instruction pointer through a compiled program array.
 * Renderer-agnostic: calls methods on a renderer object (DOMRenderer in
 * browser, NullRenderer in the fuzzer / test suite).
 *
 * PAGE_BREAK model (Session 2):
 *   PAGE_BREAK calls renderer.appendDivider() and returns immediately —
 *   it does NOT set waiting=true, does NOT call renderContinue, and does
 *   NOT clear the screen. Execution continues uninterrupted.
 *
 * CHOICE_END model (Session 2):
 *   After a choice is picked the engine calls renderer.clearChoices() to
 *   remove only the choice buttons, leaving accumulated page text intact.
 */

const {OP} = SS._compiler;
const {evaluate,substituteVars} = SS._evaluator;
const {StoryState} = SS._state;

const SAVE_KEY = 'storyscript_save';

class RuntimeError extends Error {
  constructor(message, scene, ip) {
    super(`[StoryScript Runtime] ${scene ?? '?'}@${ip ?? '?'} — ${message}`);
    this.name = 'RuntimeError';
  }
}

class Engine {
  constructor(renderer, sceneLoader, config = {}) {
    this.renderer  = renderer;
    this.loadScene = sceneLoader;   // async (filename) => source string
    this.config    = {
      undoStackDepth: config.undoStackDepth ?? 50,
      loopCap:        config.loopCap        ?? 100000,
      startupFile:    config.startupFile    ?? 'startup.txt',
    };
    this.state    = new StoryState();
    this.programs = new Map();   // filename → compiled program (cache)
    this.program  = [];          // current program array
    this.running  = false;
    this.waiting  = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(fromSave = true) {
    if (fromSave && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(SAVE_KEY);
      if (saved && this.state.deserialize(saved)) {
        await this._loadProgram(this.state.scene);
        this.program = this.programs.get(this.state.scene);
        this.running = true;
        this._run();
        return;
      }
    }
    await this._loadProgram(this.config.startupFile);
    this.program     = this.programs.get(this.config.startupFile);
    this.state.scene = this.config.startupFile;
    this.state.ip    = 0;
    this.running     = true;
    this._run();
  }

  restart() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
    this.state    = new StoryState();
    this.programs.clear();
    this.running  = false;
    this.waiting  = false;
    this.renderer.clearScreen();
    this.start(false);
  }

  // ── Scene loading ──────────────────────────────────────────────────────────

  async _loadProgram(filename) {
    if (this.programs.has(filename)) return;
    const source  = await this.loadScene(filename);
    const {compile} = SS._compiler;
    const program = compile(source, filename, {
      loopCap: this.config.loopCap,
      startupFile: this.config.startupFile
    });
    this.programs.set(filename, program);
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  _save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SAVE_KEY, this.state.serialize());
    } catch (e) {
      console.warn('[StoryScript] Save failed:', e);
    }
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  _run() {
    try {
      while (this.running && !this.waiting) {
        if (this.state.ip >= this.program.length) {
          this._handleFinish();
          return;
        }
        const instr = this.program[this.state.ip];
        this.state.ip++;
        this._dispatch(instr);
      }
    } catch (e) {
      this.running = false;
      this.renderer.showError(e.message);
    }
  }

  _dispatch(instr) {
    switch (instr.op) {

      // ── Text ──────────────────────────────────────────────────────────────
      case OP.TEXT: {
        this.renderer.appendText(instr.value);
        break;
      }

      case OP.PRINT: {
        this.renderer.appendText(substituteVars(instr.value, this.state));
        break;
      }

      case OP.BLANK: {
        this.renderer.appendBlank();
        break;
      }

      // ── Page break ────────────────────────────────────────────────────────
      // PAGE_BREAK no longer pauses. It appends a decorative divider and
      // saves state, then execution continues immediately.
      case OP.PAGE_BREAK: {
        this._save();
        this.renderer.appendDivider();
        break;
      }

      // ── Choice ────────────────────────────────────────────────────────────
      case OP.CHOICE_PUSH: {
        this.state.pushUndo(this.config.undoStackDepth);
        break;
      }

      case OP.CHOICE_END: {
        // options: [{text, cond, target}]
        const opts = instr.options;
        this._save();
        this.waiting = true;
        this.renderer.renderChoices(opts.map(o => ({
          text:    o.text,
          enabled: o.cond ? Boolean(evaluate(o.cond, this.state)) : true,
          onPick:  () => {
            // Clear only the choice buttons — page text stays
            this.renderer.clearChoices();
            this.state.ip = o.target;
            this.waiting  = false;
            this._run();
          },
        })));
        if (this.state.canUndo) {
          this.renderer.renderUndo(() => {
            this.renderer.clearChoices();
            this.state.popUndo();
            this.program = this.programs.get(this.state.scene);
            this.waiting = false;
            this._run();
          });
        }
        break;
      }

      // ── Control flow ──────────────────────────────────────────────────────
      case OP.LABEL: { break; } // no-op

      case OP.GOTO: {
        if (instr.target === null) throw new RuntimeError('GOTO has null target', this.state.scene, this.state.ip);
        this.state.ip = instr.target;
        break;
      }

      case OP.GOSUB: {
        if (instr.target === null) throw new RuntimeError('GOSUB has null target', this.state.scene, this.state.ip);
        const snap = new Map(this.state.temps);
        this.state.callStack.push({ returnIP: this.state.ip, tempSnapshot: [...snap] });
        instr.args.forEach((argExpr, idx) => {
          this.state.createTemp(`_arg${idx}`, evaluate(argExpr, this.state));
        });
        this.state.ip = instr.target;
        break;
      }

      case OP.RETURN: {
        const frame = this.state.callStack.pop();
        if (!frame) throw new RuntimeError('*return with empty call stack', this.state.scene, this.state.ip);
        const retVal = this.state.temps.has('_return') ? this.state.temps.get('_return') : undefined;
        this.state.temps = new Map(frame.tempSnapshot);
        if (retVal !== undefined) this.state.temps.set('_return', retVal);
        this.state.ip = frame.returnIP;
        break;
      }

      // ── Conditionals ──────────────────────────────────────────────────────
      case OP.IF: {
        if (!evaluate(instr.expr, this.state)) this.state.ip = instr.else;
        break;
      }

      case OP.ELSE: {
        this.state.ip = instr.end;
        break;
      }

      case OP.ENDIF: { break; } // no-op

      // ── Loops ─────────────────────────────────────────────────────────────
      case OP.LOOP_GUARD: {
        this.state.incrementLoop(instr.loopInstrIdx, instr.max);
        break;
      }

      case OP.WHILE: {
        if (!evaluate(instr.expr, this.state)) {
          this.state.ip = instr.end;
          this.state.clearLoopCounter(instr.loopStart);
        }
        break;
      }

      case OP.ENDWHILE: {
        this.state.ip = instr.loopStart;
        break;
      }

      case OP.FOR: {
        const list = this.state.get(instr.list);
        if (!Array.isArray(list)) throw new RuntimeError(`*for target '${instr.list}' is not a list`, this.state.scene, this.state.ip);
        const idx = this.state.loopCounters.get(instr.loopStart) ?? 0;
        if (idx >= list.length) {
          this.state.ip = instr.end;
          this.state.clearLoopCounter(instr.loopStart);
        } else {
          if (this.state.has(instr.var)) this.state.set(instr.var, list[idx]);
          else this.state.createTemp(instr.var, list[idx]);
        }
        break;
      }

      case OP.ENDFOR: {
        const cur = this.state.loopCounters.get(instr.loopStart) ?? 0;
        this.state.loopCounters.set(instr.loopStart, cur + 1);
        this.state.ip = instr.loopStart;
        break;
      }

      // ── Variables ─────────────────────────────────────────────────────────
      case OP.CREATE: {
        this.state.createGlobal(instr.var, evaluate(instr.expr, this.state));
        break;
      }

      case OP.SET: {
        const val = evaluate(instr.expr, this.state);
        if (instr.var.includes('.')) {
          const [obj, key] = instr.var.split('.');
          const target = this.state.get(obj);
          if (typeof target !== 'object' || Array.isArray(target))
            throw new RuntimeError(`Cannot set key on non-object '${obj}'`, this.state.scene, this.state.ip);
          target[key] = val;
        } else {
          this.state.set(instr.var, val);
        }
        break;
      }

      case OP.SET_TEMP: {
        this.state.createTemp(instr.var, evaluate(instr.expr, this.state));
        break;
      }

      // ── Collections ───────────────────────────────────────────────────────
      case OP.LIST_CREATE: {
        this.state.createGlobal(instr.var, [...instr.value]);
        break;
      }

      case OP.OBJ_CREATE: {
        this.state.createGlobal(instr.var, { ...instr.value });
        break;
      }

      case OP.OBJ_SET: {
        const obj = this.state.get(instr.obj);
        if (typeof obj !== 'object' || Array.isArray(obj))
          throw new RuntimeError(`'${instr.obj}' is not an object`, this.state.scene, this.state.ip);
        obj[instr.key] = evaluate(instr.expr, this.state);
        break;
      }

      case OP.PUSH: {
        const list = this.state.get(instr.list);
        if (!Array.isArray(list)) throw new RuntimeError(`'${instr.list}' is not a list`, this.state.scene, this.state.ip);
        list.push(evaluate(instr.expr, this.state));
        break;
      }

      case OP.POP: {
        const list = this.state.get(instr.list);
        if (!Array.isArray(list)) throw new RuntimeError(`'${instr.list}' is not a list`, this.state.scene, this.state.ip);
        if (list.length === 0) throw new RuntimeError(`Cannot *pop empty list '${instr.list}'`, this.state.scene, this.state.ip);
        const popped = list.pop();
        if (instr.into) {
          if (this.state.has(instr.into)) this.state.set(instr.into, popped);
          else this.state.createTemp(instr.into, popped);
        }
        break;
      }

      // ── Scene ─────────────────────────────────────────────────────────────
      case OP.SCENE: {
        this.state.clearTemps();
        this.state.loopCounters.clear();
        this.waiting = true;
        this._loadProgram(instr.file).then(() => {
          this.program     = this.programs.get(instr.file);
          this.state.scene = instr.file;
          this.state.ip    = 0;
          this.waiting     = false;
          this._run();
        }).catch(e => this.renderer.showError(e.message));
        break;
      }

      case OP.FINISH: {
        this._handleFinish();
        break;
      }

      // ── Theme ─────────────────────────────────────────────────────────────
      case OP.THEME: {
        this.renderer.setTheme(instr.vars);
        break;
      }

      case OP.THEME_PUSH: {
        const snap = this.renderer.snapshotTheme?.() ?? {};
        this.state.themeStack.push(snap);
        break;
      }

      case OP.THEME_POP: {
        const snap = this.state.themeStack.pop();
        if (snap) this.renderer.setTheme(snap);
        break;
      }

      case OP.ERROR: {
        throw new RuntimeError(instr.msg, this.state.scene, this.state.ip);
      }

      // ── Phase 3: Random ───────────────────────────────────────────────────
      case OP.RANDOM: {
        const min = Math.ceil(Number(evaluate(instr.min, this.state)));
        const max = Math.floor(Number(evaluate(instr.max, this.state)));
        const val = Math.floor(Math.random() * (max - min + 1)) + min;
        if (this.state.has(instr.var)) this.state.set(instr.var, val);
        else this.state.createTemp(instr.var, val);
        break;
      }

      // ── Phase 3: Input ────────────────────────────────────────────────────
      case OP.INPUT_TEXT: {
        this._save();
        this.waiting = true;
        this.renderer.renderInput('text', instr.prompt ?? 'Enter text:', (val) => {
          if (this.state.has(instr.var)) this.state.set(instr.var, val);
          else this.state.createTemp(instr.var, val);
          this.waiting = false;
          this._run();
        });
        break;
      }

      case OP.INPUT_NUMBER: {
        this._save();
        this.waiting = true;
        this.renderer.renderInput('number', instr.prompt ?? 'Enter a number:', (val) => {
          const num = parseFloat(val);
          const result = isNaN(num) ? 0 : num;
          if (this.state.has(instr.var)) this.state.set(instr.var, result);
          else this.state.createTemp(instr.var, result);
          this.waiting = false;
          this._run();
        });
        break;
      }

      // ── Phase 3: Item system ──────────────────────────────────────────────
      case OP.ITEM: {
        this.state.itemRegistry.set(instr.id, instr.schema);
        break;
      }

      case OP.GIVE: {
        const schema = this.state.itemRegistry.get(instr.id);
        if (!schema) throw new RuntimeError(`*give: unknown item '${instr.id}'`, this.state.scene, this.state.ip);
        const stackable = schema.stackable !== false;
        const current = this.state.inventory.get(instr.id) ?? 0;
        const addQty = stackable ? instr.qty : 1;
        this.state.inventory.set(instr.id, current + addQty);
        break;
      }

      case OP.TAKE: {
        const current = this.state.inventory.get(instr.id) ?? 0;
        const newQty = Math.max(0, current - instr.qty);
        if (newQty === 0) this.state.inventory.delete(instr.id);
        else this.state.inventory.set(instr.id, newQty);
        break;
      }

      case OP.SHOW_INVENTORY: {
        const items = [];
        for (const [id, qty] of this.state.inventory) {
          const schema = this.state.itemRegistry.get(id) ?? {};
          items.push({ id, qty, name: schema.name ?? id, desc: schema.desc ?? '' });
        }
        this.renderer.renderInventory(items);
        break;
      }

      // ── Phase 3: Skill system ─────────────────────────────────────────────
      case OP.SKILL: {
        const s = instr.schema;
        this.state.skillMeta.set(instr.id, {
          label:  s.label  ?? instr.id,
          min:    s.min    ?? 0,
          max:    s.max    ?? 100,
          hidden: s.hidden ?? false,
        });
        // Also register in globals so expressions can reference the skill by name
        this.state.createGlobal(instr.id, s.value ?? 50);
        break;
      }

      case OP.IMPROVE: {
        const meta = this.state.skillMeta.get(instr.id);
        if (!meta) throw new RuntimeError(`*improve: unknown skill '${instr.id}'`, this.state.scene, this.state.ip);
        const amount = Number(evaluate(instr.expr, this.state));
        const current = Number(this.state.globals.get(instr.id) ?? 0);
        this.state.globals.set(instr.id, Math.min(meta.max, current + amount));
        break;
      }

      case OP.REDUCE: {
        const meta = this.state.skillMeta.get(instr.id);
        if (!meta) throw new RuntimeError(`*reduce: unknown skill '${instr.id}'`, this.state.scene, this.state.ip);
        const amount = Number(evaluate(instr.expr, this.state));
        const current = Number(this.state.globals.get(instr.id) ?? 0);
        this.state.globals.set(instr.id, Math.max(meta.min, current - amount));
        break;
      }

      case OP.SHOW_SKILLS: {
        const skills = [];
        for (const [id, meta] of this.state.skillMeta) {
          if (meta.hidden) continue;
          const value = Number(this.state.globals.get(id) ?? 0);
          skills.push({ id, label: meta.label, value, min: meta.min, max: meta.max });
        }
        this.renderer.renderSkills(skills);
        break;
      }

      // ── Phase 3: Achievement system ───────────────────────────────────────
      case OP.ACHIEVEMENT: {
        this.state.achievementRegistry.set(instr.id, instr.schema);
        break;
      }

      case OP.UNLOCK: {
        if (!this.state.achievements.has(instr.id)) {
          this.state.achievements.add(instr.id);
          const schema = this.state.achievementRegistry.get(instr.id) ?? {};
          this.renderer.renderAchievementUnlock(instr.id, schema);
        }
        break;
      }

      case OP.SHOW_ACHIEVEMENTS: {
        const list = [];
        for (const [id, schema] of this.state.achievementRegistry) {
          list.push({ id, schema, unlocked: this.state.achievements.has(id) });
        }
        this.renderer.renderAchievements(list);
        break;
      }

      // ── Phase 3: Title system ─────────────────────────────────────────────
      case OP.TITLE: {
        this.state.titleRegistry.set(instr.id, instr.schema);
        break;
      }

      case OP.GRANT: {
        const schema = this.state.titleRegistry.get(instr.id);
        if (!schema) throw new RuntimeError(`*grant: unknown title '${instr.id}'`, this.state.scene, this.state.ip);
        this.state.grantedTitles.add(instr.id);
        const newRank = schema.rank ?? 0;
        const currentSchema = this.state.activeTitle
          ? (this.state.titleRegistry.get(this.state.activeTitle) ?? {})
          : null;
        const currentRank = currentSchema ? (currentSchema.rank ?? 0) : -1;
        if (newRank >= currentRank) {
          this.state.activeTitle = instr.id;
        }
        break;
      }

      case OP.REVOKE: {
        this.state.grantedTitles.delete(instr.id);
        if (this.state.activeTitle === instr.id) {
          // Find next highest-rank title among remaining
          let best = null, bestRank = -1;
          for (const tid of this.state.grantedTitles) {
            const s = this.state.titleRegistry.get(tid) ?? {};
            const r = s.rank ?? 0;
            if (r > bestRank) { best = tid; bestRank = r; }
          }
          this.state.activeTitle = best;
        }
        break;
      }

      case OP.SHOW_TITLE: {
        const titleId = this.state.activeTitle;
        if (titleId) {
          const schema = this.state.titleRegistry.get(titleId) ?? {};
          this.renderer.appendText(schema.label ?? titleId);
        }
        break;
      }
        throw new RuntimeError(`Unknown opcode: ${instr.op}`, this.state.scene, this.state.ip);
    }
  }

  _handleFinish() {
    this.running = false;
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
    this.renderer.renderFinish();
  }
}
return { Engine, RuntimeError };
})();


// ─── Public API ───────────────────────────────────────────────────────────────
SS.tokenize         = SS._lexer.tokenize;
SS.compileFull      = SS._compiler.compileFull;
SS.compile          = SS._compiler.compile;
SS.OP               = SS._compiler.OP;
SS.BYTECODE_VERSION = SS._compiler.BYTECODE_VERSION;
SS.IR               = SS._ir.IR;
SS.SymbolTable      = SS._ir.SymbolTable;
SS.Engine           = SS._engine.Engine;
SS.RuntimeError     = SS._engine.RuntimeError;
SS.StoryState       = SS._state.StoryState;
SS.DOMRenderer      = SS._renderer.DOMRenderer;
SS.NullRenderer     = SS._renderer.NullRenderer;

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));