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
      case 'discovered': {
        if (args.length !== 1) throw new EvalError('discovered() requires 1 argument (clue id)', this.src);
        if (!this.state) throw new EvalError('discovered() requires runtime state', this.src);
        return this.state.discoveredClues?.has(String(args[0])) ?? false;
      }
      case 'resolved': {
        if (args.length !== 1) throw new EvalError('resolved() requires 1 argument (clue id)', this.src);
        if (!this.state) throw new EvalError('resolved() requires runtime state', this.src);
        return this.state.resolvedClues?.has(String(args[0])) ?? false;
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
 *   Text, Blank, Label, Goto, Gosub, Return, Finish, PageBreak, NewPage, Scene,
 *   Create, Temp, Set, ListCreate, ObjCreate, ObjSet, Push, Pop,
 *   Theme, ThemePush, ThemePop, Comment,
 *   If { condition, consequent[], elseifClauses[], alternate[] },
 *   While { condition, body[] },
 *   For { var, list, body[] },
 *   Choice { options: [{ text, cond, body[] }] },
 *   Check { skillId, difficulty, successBody[], failureBody[] },
 *   Once { id, body[] },
 *   Switch { expr, cases: [{value, body[]}], defaultBody[] },
 *   Chapter { title, icon }, Flag { id }, Raise { id }, Lower { id }
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
  NEW_PAGE:     'NewPage',     // *new_page — clears screen and continues
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
  // Phase 5c
  CHECK:        'Check',        // *check skillId [difficulty=N] ... *success ... *failure ... *endcheck
  // Phase 5g
  CHAPTER:      'Chapter',      // *chapter "Title" [icon="emoji"] — structural metadata, no runtime effect
  // Phase 6a
  FLAG:         'Flag',         // *flag id — declare a boolean flag global (startup only)
  RAISE:        'Raise',        // *raise id — set flag/var to true
  LOWER:        'Lower',        // *lower id — set flag/var to false
  // Phase 6b
  ONCE:         'Once',         // *once id ... *endonce — execute body only once per save
  // Phase 6c
  SWITCH:       'Switch',       // *switch expr *case v ... *default ... *endswitch
  // Phase 6d
  DELAY:        'Delay',        // *delay N — pause rendering for N seconds
  // Phase 6e
  NPC:          'Npc',          // *npc id {"name":"...","color":"..."} — declare NPC
  DIALOGUE:     'Dialogue',     // *dialogue npcId [mood="..."] ... *enddialogue
  // Phase 6f
  CLUE:         'Clue',         // *clue id {"title":"...","text":"...","category":"..."} — declare clue
  DISCOVER:     'Discover',     // *discover id — add clue to journal
  RESOLVE:      'Resolve',      // *resolve id — mark clue as resolved
  // Phase 6g
  TRANSITION:   'Transition',   // *transition preset [duration=N] — pending scene transition
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

    // Phase 5/6
    /** @type {Map<string, {file: string, lineNum: number, title: string, icon: string|null}>} */
    this.chapters = new Map();
    /** @type {Set<string>} flag IDs declared with *flag */
    this.flags = new Set();
    // Phase 6e
    /** @type {Map<string, {file: string, lineNum: number, schema: object}>} */
    this.npcs = new Map();
    // Phase 6f
    /** @type {Map<string, {file: string, lineNum: number, schema: object}>} */
    this.clues = new Map();
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

      // Phase 5/6 block recursion
      case IR.CHECK:
        this._walk(node.successBody, file);
        this._walk(node.failureBody, file);
        break;

      case IR.ONCE:
        this._walk(node.body, file);
        break;

      case IR.SWITCH:
        for (const c of node.cases) this._walk(c.body, file);
        if (node.defaultBody) this._walk(node.defaultBody, file);
        break;

      case IR.CHAPTER:
        this.chapters.set(node.title, { file, lineNum: node.lineNum, title: node.title, icon: node.icon });
        break;

      case IR.FLAG:
        this.flags.add(node.id);
        break;

      // Phase 6e: NPC
      case IR.NPC:
        this.npcs.set(node.id, { file, lineNum: node.lineNum, schema: node.schema });
        break;

      // Phase 6e: Dialogue recurse
      case IR.DIALOGUE:
        this._walk(node.body, file);
        break;

      // Phase 6f: Clue
      case IR.CLUE:
        this.clues.set(node.id, { file, lineNum: node.lineNum, schema: node.schema });
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

const SAVE_VERSION = 4; // Phase 6: added npcRegistry, clueRegistry, discoveredClues, resolvedClues

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

    // Phase 5/6 additions
    this.seenOnce     = new Set(); // IDs of *once blocks already executed
    this.flagRegistry = new Set(); // IDs declared with *flag
    // Phase 6e: NPC registry
    this.npcRegistry  = new Map(); // npcId → { name, color, ... }
    // Phase 6f: Clue / journal
    this.clueRegistry    = new Map(); // clueId → { title, text, category }
    this.discoveredClues = new Set(); // clue IDs the player has found
    this.resolvedClues   = new Set(); // clue IDs marked resolved
    // Phase 6g: Pending transition
    this.pendingTransition = null; // { preset, duration } | null
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
      seenOnce:      [...this.seenOnce],
      flagRegistry:  [...this.flagRegistry],
      npcRegistry:   [...this.npcRegistry],
      clueRegistry:  [...this.clueRegistry],
      discoveredClues: [...this.discoveredClues],
      resolvedClues:   [...this.resolvedClues],
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
    this.seenOnce      = new Set(data.seenOnce ?? []);
    this.flagRegistry  = new Set(data.flagRegistry ?? []);
    this.npcRegistry   = new Map(data.npcRegistry ?? []);
    this.clueRegistry  = new Map(data.clueRegistry ?? []);
    this.discoveredClues = new Set(data.discoveredClues ?? []);
    this.resolvedClues   = new Set(data.resolvedClues ?? []);
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
    this._dialogueContainer = null; // Phase 6e: active dialogue block container
    this.config     = null; // set externally by Engine if needed
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
    this._getTextTarget().appendChild(p);
  }

  appendBlank() {
    this._getTextTarget().appendChild(this._createElement('div', { class: 'ss-blank' }));
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
    this._dialogueContainer = null; // Phase 6e: reset dialogue context
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
    }, '<- Back');
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
    const el = this._createElement('p', { class: 'ss-finish' }, '- The End -');
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
      placeholder: type === 'number' ? '0' : '...',
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
      qtyEl.textContent = item.qty > 1 ? 'x' + item.qty : '';
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
    const icon = schema.icon ?? '[*]';
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
      icon.textContent = unlocked ? (schema.icon ?? '[*]') : '[?]';
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

  /**
   * Show a skill check result card inline in the story.
   * @param {string} skillId   - the skill being checked
   * @param {number} roll      - the dice roll (1–100)
   * @param {number} threshold - the success threshold
   * @param {boolean} success  - whether the roll succeeded
   */
  showCheckResult(skillId, roll, threshold, success) {
    const card = this._createElement('div', { class: `ss-check-card ${success ? 'ss-check-success' : 'ss-check-failure'}` });
    const icon  = this._createElement('span', { class: 'ss-check-icon' }, success ? '✦' : '✕');
    const label = this._createElement('span', { class: 'ss-check-label' });
    label.textContent = `${skillId.toUpperCase()} CHECK`;
    const detail = this._createElement('span', { class: 'ss-check-detail' });
    detail.textContent = `Rolled ${roll} vs ${threshold} — ${success ? 'SUCCESS' : 'FAILURE'}`;
    card.appendChild(icon);
    card.appendChild(label);
    card.appendChild(detail);
    this.page.appendChild(card);
  }

  showError(message) {
    const el = this._createElement('div', { class: 'ss-error' });
    el.textContent = message;
    this.page.appendChild(el);
    this.ui.innerHTML = '';
    console.error(message);
  }

  setTheme(vars) {
    // Apply to the story root element only, so the top bar stays stable
    const target = document.getElementById('storyscript-root') || document.documentElement;
    for (const [key, val] of Object.entries(vars)) {
      target.style.setProperty(key, val);
    }
  }

  snapshotTheme() {
    const target = document.getElementById('storyscript-root') || document.documentElement;
    const style  = target.style;
    const snapshot = {};
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.startsWith('--')) snapshot[prop] = style.getPropertyValue(prop);
    }
    return snapshot;
  }

  // ── Phase 6e: Dialogue ────────────────────────────────────────────────────

  renderDialogueStart(npc, mood) {
    const container = this._createElement('div', { class: 'ss-dialogue' });
    container.style.setProperty('--npc-color', npc.color ?? '#888');
    const speaker = this._createElement('div', { class: 'ss-dialogue-speaker' });
    speaker.textContent = npc.name ?? npc.id ?? 'Speaker';
    if (mood) {
      const moodEl = this._createElement('span', { class: 'ss-dialogue-mood' });
      moodEl.textContent = ` (${mood})`;
      speaker.appendChild(moodEl);
    }
    container.appendChild(speaker);
    this.page.appendChild(container);
    // Redirect subsequent appendText calls into this container
    this._dialogueContainer = container;
  }

  renderDialogueEnd() {
    this._dialogueContainer = null;
  }

  // Override appendText to redirect into dialogue container when active
  _getTextTarget() {
    return this._dialogueContainer ?? this.page;
  }

  // ── Phase 6f: Clue discovery toast ────────────────────────────────────────

  renderDiscoverToast(clue) {
    const toast = this._createElement('div', { class: 'ss-discover-toast' });
    toast.innerHTML = `<span class="ss-discover-icon">📋</span> <strong>Journal:</strong> ${clue.title ?? clue.id}`;
    this.page.appendChild(toast);
    // Fade out after 3 seconds
    setTimeout(() => { if (toast.parentNode) toast.classList.add('ss-discover-toast-hide'); }, 3000);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3600);
  }

  // ── Phase 6g: Transition ──────────────────────────────────────────────────

  applyTransition(preset, duration, onClear) {
    const previewSpeedup = this.config?.previewMode ? 2 : 1;
    const dur = (duration ?? 0.5) / previewSpeedup;
    const root = this.page.parentElement ?? this.page;
    root.style.setProperty('--t-dur', `${dur}s`);
    root.classList.add(`ss-transition-out-${preset}`);
    const cleanup = () => {
      root.classList.remove(`ss-transition-out-${preset}`);
      root.removeEventListener('transitionend', onTransEnd);
      onClear();
      // Brief frame for DOM to settle, then fade in
      requestAnimationFrame(() => {
        root.classList.add(`ss-transition-in-${preset}`);
        setTimeout(() => root.classList.remove(`ss-transition-in-${preset}`), dur * 1000 + 50);
      });
    };
    const onTransEnd = () => cleanup();
    root.addEventListener('transitionend', onTransEnd, { once: true });
    // Fallback: if transition doesn't fire (e.g., prefers-reduced-motion), run after dur
    setTimeout(() => { cleanup(); }, dur * 1000 + 200);
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
  showCheckResult(skillId, roll, threshold, success) {}

  showError(msg) {
    throw new Error(msg);
  }

  setTheme()      {}
  snapshotTheme() { return {}; }

  // Phase 6 stubs
  renderDialogueStart() {}
  renderDialogueEnd()   {}
  renderDiscoverToast() {}
  applyTransition(preset, duration, onClear) { onClear(); } // instant in null renderer
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
  NEW_PAGE:     'NEW_PAGE',    // *new_page — clears screen and continues
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
  // Phase 5c
  CHECK_ROLL:   'CHECK_ROLL',   // { skillId, difficulty, failTarget } — rolls dice, jumps to failTarget if fail
  // Phase 5g
  CHAPTER:      'CHAPTER',      // { title, icon } — metadata only, no runtime effect
  // Phase 6a
  FLAG:         'FLAG',         // { id } — declare boolean flag global
  RAISE:        'RAISE',        // { id } — set boolean to true
  LOWER:        'LOWER',        // { id } — set boolean to false
  // Phase 6b
  ONCE:         'ONCE',         // { id, skipTarget } — skip body if seen
  ENDONCE:      'ENDONCE',      // { id } — mark block as seen
  // Phase 6d
  DELAY:        'DELAY',        // { seconds } — pause rendering
  // Phase 6e
  NPC:          'NPC',          // { id, schema } — register NPC in state
  DIALOGUE_START: 'DIALOGUE_START', // { npcId, mood } — begin dialogue block
  DIALOGUE_END: 'DIALOGUE_END', // {} — end dialogue block
  // Phase 6f
  CLUE:         'CLUE',         // { id, schema } — register clue
  DISCOVER:     'DISCOVER',     // { id } — discover a clue
  RESOLVE:      'RESOLVE',      // { id } — resolve a clue
  // Phase 6g
  TRANSITION:   'TRANSITION',   // { preset, duration } — set pending transition
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

      case IR.NEW_PAGE:
        this.emit({ op: OP.NEW_PAGE }, node);
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

      // ── Phase 5c: Check ─────────────────────────────────────────────────────
      case IR.CHECK:
        this.emitCheck(node);
        break;

      // ── Phase 5g: Chapter metadata ──────────────────────────────────────────
      case IR.CHAPTER:
        this.emit({ op: OP.CHAPTER, title: node.title, icon: node.icon }, node);
        break;

      // ── Phase 6a: Flags ─────────────────────────────────────────────────────
      case IR.FLAG:
        this.emit({ op: OP.FLAG, id: node.id }, node);
        break;

      case IR.RAISE:
        this.emit({ op: OP.RAISE, id: node.id }, node);
        break;

      case IR.LOWER:
        this.emit({ op: OP.LOWER, id: node.id }, node);
        break;

      // ── Phase 6b: Once ──────────────────────────────────────────────────────
      case IR.ONCE:
        this.emitOnce(node);
        break;

      // ── Phase 6c: Switch ────────────────────────────────────────────────────
      case IR.SWITCH:
        this.emitSwitch(node);
        break;

      // ── Phase 6d: Delay ─────────────────────────────────────────────────────
      case IR.DELAY:
        this.emit({ op: OP.DELAY, seconds: node.seconds }, node);
        break;

      // ── Phase 6e: NPC / Dialogue ─────────────────────────────────────────────
      case IR.NPC:
        this.emit({ op: OP.NPC, id: node.id, schema: node.schema }, node);
        break;

      case IR.DIALOGUE:
        this.emit({ op: OP.DIALOGUE_START, npcId: node.npcId, mood: node.mood }, node);
        for (const child of node.body) this.emitNode(child);
        this.emit({ op: OP.DIALOGUE_END }, node);
        break;

      // ── Phase 6f: Clue / Discover / Resolve ──────────────────────────────────
      case IR.CLUE:
        this.emit({ op: OP.CLUE, id: node.id, schema: node.schema }, node);
        break;

      case IR.DISCOVER:
        this.emit({ op: OP.DISCOVER, id: node.id }, node);
        break;

      case IR.RESOLVE:
        this.emit({ op: OP.RESOLVE, id: node.id }, node);
        break;

      // ── Phase 6g: Transition ──────────────────────────────────────────────────
      case IR.TRANSITION:
        this.emit({ op: OP.TRANSITION, preset: node.preset, duration: node.duration }, node);
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

  // ── Phase 5c: Check emission ──────────────────────────────────────────────
  // *check skillId [difficulty=N]
  //   *success
  //     ... success body ...
  //   *failure
  //     ... failure body ...
  // *endcheck
  //
  // Compiles to:
  //   CHECK_ROLL { skillId, difficulty, failTarget → failLabel }
  //   ... successBody ...
  //   ELSE end→endLabel
  //   failLabel: LABEL
  //   ... failureBody ...
  //   endLabel: ENDIF

  emitCheck(node) {
    const endLabel  = `__check_end_${this._uid()}`;
    const failLabel = `__check_fail_${this._uid()}`;

    const rollIdx = this.emit({ op: OP.CHECK_ROLL, skillId: node.skillId, difficulty: node.difficulty, failTarget: null }, node);
    this.patch(rollIdx, 'failTarget', failLabel);

    this.emitNodes(node.successBody);

    const elseIdx = this.emit({ op: OP.ELSE, end: null }, node);
    this.patch(elseIdx, 'end', endLabel);

    const failIdx = this.emit({ op: OP.LABEL, name: failLabel }, node);
    this.labelTable.set(failLabel, failIdx);

    this.emitNodes(node.failureBody);

    const endIdx = this.emit({ op: OP.ENDIF }, node);
    this.labelTable.set(endLabel, endIdx);
  }

  // ── Phase 6b: Once emission ────────────────────────────────────────────────
  // Compiles to:
  //   ONCE { id, skipTarget → skipLabel }
  //   ... body ...
  //   ENDONCE { id }
  //   skipLabel: LABEL

  emitOnce(node) {
    const skipLabel = `__once_skip_${this._uid()}`;

    const onceIdx = this.emit({ op: OP.ONCE, id: node.id, skipTarget: null }, node);
    this.patch(onceIdx, 'skipTarget', skipLabel);

    this.emitNodes(node.body);

    this.emit({ op: OP.ENDONCE, id: node.id }, node);

    const skipIdx = this.emit({ op: OP.LABEL, name: skipLabel }, node);
    this.labelTable.set(skipLabel, skipIdx);
  }

  // ── Phase 6c: Switch emission ──────────────────────────────────────────────
  // Evaluates expr once into a temp var, then chains IF comparisons.
  //
  // *switch expr        →  SET_TEMP __sw_N expr
  //   *case "a"         →  IF __sw_N = "a" else→nextLabel
  //     body            →    body
  //   *case "b"         →  ELSE end→endLabel  nextLabel: IF __sw_N = "b" ...
  //   *default          →  defaultLabel: body
  // *endswitch          →  endLabel: ENDIF

  emitSwitch(node) {
    const tmpVar   = `__sw_${this._uid()}`;
    const endLabel = `__sw_end_${this._uid()}`;

    this.emit({ op: OP.SET_TEMP, var: tmpVar, expr: node.expr }, node);

    const caseNextLabels = node.cases.map(() => `__sw_next_${this._uid()}`);
    const defLabel = node.defaultBody !== null ? `__sw_default_${this._uid()}` : endLabel;

    for (let i = 0; i < node.cases.length; i++) {
      const c = node.cases[i];

      // Build comparison expression: tmpVar = value
      let valStr;
      if (typeof c.value === 'string')       valStr = `"${c.value}"`;
      else if (typeof c.value === 'boolean') valStr = c.value ? 'true' : 'false';
      else                                   valStr = String(c.value);
      const cmpExpr = `${tmpVar} = ${valStr}`;

      const nextTarget = i + 1 < node.cases.length ? caseNextLabels[i + 1] : defLabel;

      const ifIdx = this.emit({ op: OP.IF, expr: cmpExpr, else: null }, node);
      this.patch(ifIdx, 'else', nextTarget);

      this.emitNodes(c.body);

      const elseIdx = this.emit({ op: OP.ELSE, end: null }, node);
      this.patch(elseIdx, 'end', endLabel);

      if (i + 1 < node.cases.length) {
        const nextIdx = this.emit({ op: OP.LABEL, name: caseNextLabels[i + 1] }, node);
        this.labelTable.set(caseNextLabels[i + 1], nextIdx);
      }
    }

    if (node.defaultBody !== null) {
      if (node.cases.length > 0) {
        const defIdx = this.emit({ op: OP.LABEL, name: defLabel }, node);
        this.labelTable.set(defLabel, defIdx);
      }
      this.emitNodes(node.defaultBody);
    }

    const endIdx = this.emit({ op: OP.ENDIF }, node);
    this.labelTable.set(endLabel, endIdx);
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
        // Phase 5d: inline [if ...][else][endif] in text lines
        for (const n of this.parseInlineConditionals(tok)) nodes.push(n);
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
      case 'new_page':   return { kind: IR.NEW_PAGE,   ...this.loc(tok) };
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
      case 'check':   return this.parseCheck(tok, rest);
      case 'once':    return this.parseOnce(tok, rest);
      case 'switch':  return this.parseSwitch(tok, rest);

      // ── Phase 5g: Chapter metadata ────────────────────────────────────────
      case 'chapter': {
        const m = rest.trim().match(/^"([^"]*)"(?:\s+icon="([^"]*)")?$/);
        if (!m) { this.addError('*chapter: expected *chapter "Title" [icon="emoji"]', tok); return null; }
        return { kind: IR.CHAPTER, title: m[1], icon: m[2] ?? null, ...this.loc(tok) };
      }

      // ── Phase 6a: Flag system ─────────────────────────────────────────────
      case 'flag': {
        const id = rest.trim();
        if (!id || !/^\w+$/.test(id)) { this.addError('*flag requires a valid identifier', tok); return null; }
        if (this.file !== this.startupFile) {
          this.addError(`*flag '${id}' must be declared in ${this.startupFile}`, tok); return null;
        }
        return { kind: IR.FLAG, id, ...this.loc(tok) };
      }

      case 'raise': {
        const id = rest.trim();
        if (!id) { this.addError('*raise requires a flag id', tok); return null; }
        return { kind: IR.RAISE, id, ...this.loc(tok) };
      }

      case 'lower': {
        const id = rest.trim();
        if (!id) { this.addError('*lower requires a flag id', tok); return null; }
        return { kind: IR.LOWER, id, ...this.loc(tok) };
      }

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

      case 'endcheck':
        this.addError('*endcheck without matching *check', tok);
        return null;

      case 'success':
      case 'failure':
        this.addError(`*${name} outside of a *check block`, tok);
        return null;

      case 'endonce':
        this.addError('*endonce without matching *once', tok);
        return null;

      case 'endswitch':
        this.addError('*endswitch without matching *switch', tok);
        return null;

      case 'case':
      case 'default':
        this.addError(`*${name} outside of a *switch block`, tok);
        return null;

      // ── Phase 6d: Delay ───────────────────────────────────────────────────
      case 'delay': {
        const secs = parseFloat(rest.trim());
        if (isNaN(secs) || secs < 0) { this.addError('*delay requires a non-negative number of seconds', tok); return null; }
        return { kind: IR.DELAY, seconds: Math.min(secs, 30), ...this.loc(tok) };
      }

      // ── Phase 6e: NPC / Dialogue ──────────────────────────────────────────
      case 'npc': {
        const m = rest.trim().match(/^(\w+)\s*(.*)$/);
        if (!m) { this.addError('*npc requires: *npc id {"name":"...","color":"..."}', tok); return null; }
        const id = m[1], raw = m[2].trim();
        let schema = { name: id, color: '#888' };
        if (raw) {
          try { schema = Object.assign(schema, JSON.parse(raw)); }
          catch { this.addError('*npc: JSON schema is invalid', tok); return null; }
        }
        if (this.file !== this.startupFile) { this.addError(`*npc '${id}' must be declared in ${this.startupFile}`, tok); return null; }
        return { kind: IR.NPC, id, schema, ...this.loc(tok) };
      }

      case 'dialogue': return this.parseDialogue(tok, rest);
      case 'enddialogue':
        this.addError('*enddialogue without matching *dialogue', tok);
        return null;

      // ── Phase 6f: Clue / Discover / Resolve ──────────────────────────────
      case 'clue': {
        const m = rest.trim().match(/^(\w+)\s*(.*)$/);
        if (!m) { this.addError('*clue requires: *clue id {"title":"...","text":"...","category":"..."}', tok); return null; }
        const id = m[1], raw = m[2].trim();
        let schema = { title: id, text: '', category: 'General' };
        if (raw) {
          try { schema = Object.assign(schema, JSON.parse(raw)); }
          catch { this.addError('*clue: JSON schema is invalid', tok); return null; }
        }
        if (this.file !== this.startupFile) { this.addError(`*clue '${id}' must be declared in ${this.startupFile}`, tok); return null; }
        return { kind: IR.CLUE, id, schema, ...this.loc(tok) };
      }

      case 'discover': {
        const id = rest.trim();
        if (!id) { this.addError('*discover requires a clue id', tok); return null; }
        return { kind: IR.DISCOVER, id, ...this.loc(tok) };
      }

      case 'resolve': {
        const id = rest.trim();
        if (!id) { this.addError('*resolve requires a clue id', tok); return null; }
        return { kind: IR.RESOLVE, id, ...this.loc(tok) };
      }

      // ── Phase 6g: Transition ──────────────────────────────────────────────
      case 'transition': {
        const PRESETS = ['fade', 'slideLeft', 'slideRight', 'dissolve'];
        const m = rest.trim().match(/^(\w+)(?:\s+duration=(\d+(?:\.\d+)?))?$/);
        if (!m) { this.addError('*transition requires: *transition <preset> [duration=N]', tok); return null; }
        if (!PRESETS.includes(m[1])) { this.addError(`*transition: unknown preset '${m[1]}'. Use: ${PRESETS.join(', ')}`, tok); return null; }
        return { kind: IR.TRANSITION, preset: m[1], duration: m[2] ? parseFloat(m[2]) : 0.5, ...this.loc(tok) };
      }

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
        // Phase 5d: inline [if ...][else][endif] in choice body text
        for (const n of this.parseInlineConditionals(tok)) nodes.push(n);
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

  // ── Phase 5d: Inline [if expr] ... [else] ... [endif] ───────────────────
  // Parses a TEXT token that may contain inline conditional markers.
  // Returns an array of IR nodes (TEXT and IF trees).
  //
  // Example:
  //   "You [if has_map]check the map and[endif] take the fork."
  // Produces:
  //   TEXT "You "
  //   IF { condition: "has_map", consequent: [TEXT "check the map and"], alternate: null }
  //   TEXT " take the fork."

  parseInlineConditionals(tok) {
    const raw = tok.payload;
    const loc = this.loc(tok);

    // Fast path — no inline markers
    if (!/\[if\s/i.test(raw)) {
      return [{ kind: IR.TEXT, value: raw, ...loc }];
    }

    // Tokenise the text into literal segments and markers
    const parts = [];
    const markerRe = /\[if\s+([^\]]+)\]|\[else\]|\[endif\]/gi;
    let pos = 0;
    let m;
    while ((m = markerRe.exec(raw)) !== null) {
      if (m.index > pos) parts.push({ type: 'text', value: raw.slice(pos, m.index) });
      if (m[1] !== undefined)         parts.push({ type: 'if',    cond: m[1].trim() });
      else if (/\[else\]/i.test(m[0])) parts.push({ type: 'else' });
      else                              parts.push({ type: 'endif' });
      pos = m.index + m[0].length;
    }
    if (pos < raw.length) parts.push({ type: 'text', value: raw.slice(pos) });

    // Build IR tree from parts using a recursion stack.
    // Stack entries: arrays that are the current "active body" being filled.
    const result = [];
    const stack  = [result];  // stack[0] is the top-level output

    for (const part of parts) {
      const current = stack[stack.length - 1];

      if (part.type === 'text') {
        if (part.value) current.push({ kind: IR.TEXT, value: part.value, ...loc });

      } else if (part.type === 'if') {
        const ifNode = {
          kind: IR.IF, condition: part.cond,
          consequent: [], elseifClauses: [], alternate: null, ...loc,
        };
        current.push(ifNode);
        stack.push(ifNode.consequent);  // fill consequent next

      } else if (part.type === 'else') {
        if (stack.length < 2) { this.addError('Inline [else] without matching [if]', tok); continue; }
        stack.pop();  // done filling consequent (or previous else)
        // Find the enclosing IF node in the parent body
        const parent = stack[stack.length - 1];
        const ifNode = parent[parent.length - 1];
        if (!ifNode || ifNode.kind !== IR.IF) {
          this.addError('Inline [else] cannot be matched to an [if]', tok); continue;
        }
        ifNode.alternate = [];
        stack.push(ifNode.alternate);  // fill alternate next

      } else {  // endif
        if (stack.length < 2) { this.addError('Inline [endif] without matching [if]', tok); continue; }
        stack.pop();
      }
    }

    if (stack.length > 1) this.addError('Unclosed inline [if] in text line', tok);
    return result;
  }

  // ── Phase 5c: Check / success / failure / endcheck ───────────────────────
  // *check skillId [difficulty=N]
  //     *success
  //         ... success body ...
  //     *failure
  //         ... failure body ...
  // *endcheck
  //
  // difficulty defaults to 0 if omitted.

  parseCheck(tok, rest) {
    const m = rest.trim().match(/^(\S+)(?:\s+difficulty=(\S+))?$/i);
    if (!m) {
      this.addError('*check: expected *check skillId [difficulty=N]', tok);
      return null;
    }

    const node = {
      kind:        IR.CHECK,
      skillId:     m[1],
      difficulty:  m[2] ?? '0',
      successBody: [],
      failureBody: [],
      ...this.loc(tok),
    };

    // Discard any text before *success (shouldn't be any, but be safe)
    this.parseNodes(new Set(['success', 'failure', 'endcheck']));

    if (!this.atEnd() && this.peekCmdName() === 'success') {
      this.consume();
      node.successBody = this.parseNodes(new Set(['failure', 'endcheck']));
    } else {
      this.addWarning('*check block has no *success section', tok);
    }

    if (!this.atEnd() && this.peekCmdName() === 'failure') {
      this.consume();
      node.failureBody = this.parseNodes(new Set(['endcheck']));
    } else {
      this.addWarning('*check block has no *failure section', tok);
    }

    if (!this.atEnd() && this.peekCmdName() === 'endcheck') {
      this.consume();
    } else {
      this.addError('Missing *endcheck', tok);
    }

    return node;
  }

  // ── Phase 6b: Once / endonce ──────────────────────────────────────────────
  // *once <id>
  //     ... body executed only the first time ...
  // *endonce

  parseOnce(tok, rest) {
    const id = rest.trim();
    if (!id || !/^\w+$/.test(id)) {
      this.addError('*once requires a valid identifier (letters, digits, underscores)', tok);
      return null;
    }

    const node = {
      kind: IR.ONCE,
      id,
      body: [],
      ...this.loc(tok),
    };

    node.body = this.parseNodes(new Set(['endonce']));

    if (!this.atEnd() && this.peekCmdName() === 'endonce') {
      this.consume();
    } else {
      this.addError('Missing *endonce', tok);
    }

    return node;
  }

  // ── Phase 6c: Switch / case / default / endswitch ────────────────────────
  // *switch expr
  //     *case "value"
  //         ... body ...
  //     *default
  //         ... body ...
  // *endswitch

  parseSwitch(tok, rest) {
    const expr = rest.trim();
    if (!expr) { this.addError('*switch requires an expression', tok); return null; }

    const node = {
      kind:        IR.SWITCH,
      expr,
      cases:       [],   // [{ value, body[] }]
      defaultBody: null,
      ...this.loc(tok),
    };

    // Collect *case / *default blocks
    while (!this.atEnd()) {
      const next = this.peek();

      // Skip blank lines
      if (next.type === 'blank') { this.consume(); continue; }

      if (next.type !== 'command') { this.consume(); continue; }
      const { name: cname, rest: crest } = this.parseCmd(next.payload);

      if (cname === 'case') {
        this.consume();
        const valStr = crest.trim();
        let caseVal;
        if      ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) caseVal = valStr.slice(1, -1);
        else if (valStr === 'true')    caseVal = true;
        else if (valStr === 'false')   caseVal = false;
        else if (!isNaN(Number(valStr))) caseVal = Number(valStr);
        else {
          this.addError(`*case value must be a string literal, number, or boolean — got "${valStr}"`, next);
          caseVal = valStr;
        }
        const body = this.parseNodes(new Set(['case', 'default', 'endswitch']));
        node.cases.push({ value: caseVal, body, ...this.loc(next) });
        continue;
      }

      if (cname === 'default') {
        this.consume();
        node.defaultBody = this.parseNodes(new Set(['endswitch']));
        if (!this.atEnd() && this.peekCmdName() === 'endswitch') this.consume();
        else this.addError('Missing *endswitch after *default', tok);
        return node;
      }

      if (cname === 'endswitch') {
        this.consume();
        return node;
      }

      // Unexpected
      this.consume();
      this.addError(`Unexpected *${cname} inside *switch block`, next);
    }

    this.addError('Missing *endswitch', tok);
    return node;
  }

  // ── Phase 6e: Dialogue ────────────────────────────────────────────────────
  parseDialogue(tok, rest) {
    const m = rest.trim().match(/^(\w+)(?:\s+mood="([^"]*)")?$/);
    if (!m) { this.addError('*dialogue requires: *dialogue npcId [mood="..."]', tok); return null; }
    const npcId = m[1], mood = m[2] ?? null;
    const node = { kind: IR.DIALOGUE, npcId, mood, body: [], ...this.loc(tok) };
    node.body = this.parseNodes(new Set(['enddialogue']));
    if (!this.atEnd() && this.peekCmdName() === 'enddialogue') this.consume();
    else this.addError('Missing *enddialogue', tok);
    return node;
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
      allowSave:      config.allowSave      !== false,
      previewMode:    config.previewMode    ?? false,
    };
    // Share config with renderer so it can adjust transitions/delays
    if (this.renderer && typeof this.renderer === 'object') {
      this.renderer.config = this.config;
    }
    this.state    = new StoryState();
    this.programs = new Map();   // filename → compiled program (cache)
    this.program  = [];          // current program array
    this.running  = false;
    this.waiting  = false;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(fromSave = true) {
    const allowSave = this.config.allowSave !== false;
    if (fromSave && allowSave) {
      try {
        if (typeof localStorage !== 'undefined') {
          const saved = localStorage.getItem(SAVE_KEY);
          if (saved && this.state.deserialize(saved)) {
            await this._loadProgram(this.state.scene);
            this.program = this.programs.get(this.state.scene);
            this.running = true;
            this._run();
            return;
          }
        }
      } catch(e) { /* localStorage unavailable (sandboxed iframe, etc.) */ }
    }
    await this._loadProgram(this.config.startupFile);
    this.program     = this.programs.get(this.config.startupFile);
    this.state.scene = this.config.startupFile;
    this.state.ip    = 0;
    this.running     = true;
    this._run();
  }

  restart() {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY); } catch(e) {}
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
    if (this.config.allowSave === false) return;
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(SAVE_KEY, this.state.serialize());
    } catch (e) {
      /* localStorage unavailable (sandboxed iframe, etc.) — silently skip */
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

      // ── New page (clear screen) ───────────────────────────────────────────
      // *new_page clears all existing story content from the page, then
      // continues execution without pausing. Distinct from *page_break which
      // appends a decorative divider without clearing.
      case OP.NEW_PAGE: {
        this._save();
        // Apply pending transition if any
        if (this.state.pendingTransition) {
          const t = this.state.pendingTransition;
          this.state.pendingTransition = null;
          this.renderer.applyTransition(t.preset, t.duration, () => {
            this.renderer.clearScreen();
          });
        } else {
          this.renderer.clearScreen();
        }
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
          text:    substituteVars(o.text, this.state),
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
        const doLoad = () => {
          this._loadProgram(instr.file).then(() => {
            this.program     = this.programs.get(instr.file);
            this.state.scene = instr.file;
            this.state.ip    = 0;
            this.waiting     = false;
            this._run();
          }).catch(e => this.renderer.showError(e.message));
        };
        // Apply pending transition if any
        if (this.state.pendingTransition) {
          const t = this.state.pendingTransition;
          this.state.pendingTransition = null;
          this.renderer.applyTransition(t.preset, t.duration, () => {
            this.renderer.clearScreen();
            doLoad();
          });
        } else {
          doLoad();
        }
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

      // ── Phase 5c: Skill check roll ─────────────────────────────────────────
      // Rolls 1–100. success = roll <= (skillValue + difficulty).
      // Shows a card in the story output, then falls through (success) or
      // jumps to failTarget (failure).
      case OP.CHECK_ROLL: {
        let skillVal = 50;  // safe default if skill not found
        try { skillVal = Number(this.state.get(instr.skillId)) || 0; } catch(e) {}
        let diff = 0;
        try { diff = Number(evaluate(instr.difficulty, this.state)) || 0; } catch(e) {}
        const roll      = Math.floor(Math.random() * 100) + 1;
        const threshold = Math.max(1, Math.min(99, skillVal + diff));
        const success   = roll <= threshold;
        this.renderer.showCheckResult(instr.skillId, roll, threshold, success);
        if (!success) this.state.ip = instr.failTarget;
        break;
      }

      // ── Phase 5g: Chapter metadata — no runtime effect ─────────────────────
      case OP.CHAPTER: { break; }

      // ── Phase 6a: Flags ─────────────────────────────────────────────────────
      case OP.FLAG: {
        // Declare a boolean flag global (idempotent — startup may run twice in preview)
        this.state.flagRegistry.add(instr.id);
        if (!this.state.globals.has(instr.id)) {
          this.state.createGlobal(instr.id, false);
        }
        break;
      }

      case OP.RAISE: {
        if (this.state.globals.has(instr.id))      this.state.globals.set(instr.id, true);
        else if (this.state.temps.has(instr.id))   this.state.temps.set(instr.id, true);
        else throw new RuntimeError(`*raise: '${instr.id}' is not a declared variable or flag`, this.state.scene, this.state.ip);
        break;
      }

      case OP.LOWER: {
        if (this.state.globals.has(instr.id))      this.state.globals.set(instr.id, false);
        else if (this.state.temps.has(instr.id))   this.state.temps.set(instr.id, false);
        else throw new RuntimeError(`*lower: '${instr.id}' is not a declared variable or flag`, this.state.scene, this.state.ip);
        break;
      }

      // ── Phase 6b: Once ─────────────────────────────────────────────────────
      case OP.ONCE: {
        if (this.state.seenOnce.has(instr.id)) this.state.ip = instr.skipTarget;
        break;
      }

      case OP.ENDONCE: {
        this.state.seenOnce.add(instr.id);
        this._save();  // persist seenOnce immediately so it survives page reload
        break;
      }

      // ── Phase 6d: Delay ───────────────────────────────────────────────────
      case OP.DELAY: {
        const ms = this.config.previewMode
          ? Math.min(instr.seconds * 1000, 100)  // clamp to 100ms in preview
          : instr.seconds * 1000;
        this.waiting = true;
        setTimeout(() => { this.waiting = false; this._run(); }, ms);
        return; // return early — _run resumes after timeout
      }

      // ── Phase 6e: NPC / Dialogue ──────────────────────────────────────────
      case OP.NPC: {
        this.state.npcRegistry.set(instr.id, instr.schema);
        break;
      }

      case OP.DIALOGUE_START: {
        const npc = this.state.npcRegistry.get(instr.npcId) ?? { name: instr.npcId, color: '#888' };
        this.renderer.renderDialogueStart(npc, instr.mood);
        break;
      }

      case OP.DIALOGUE_END: {
        this.renderer.renderDialogueEnd();
        break;
      }

      // ── Phase 6f: Clue / Discover / Resolve ──────────────────────────────
      case OP.CLUE: {
        this.state.clueRegistry.set(instr.id, instr.schema);
        break;
      }

      case OP.DISCOVER: {
        if (!this.state.clueRegistry.has(instr.id)) {
          console.warn(`[StoryScript] *discover: clue '${instr.id}' not declared`);
        } else if (!this.state.discoveredClues.has(instr.id)) {
          this.state.discoveredClues.add(instr.id);
          const clue = this.state.clueRegistry.get(instr.id);
          this.renderer.renderDiscoverToast(clue);
          this._save();
        }
        break;
      }

      case OP.RESOLVE: {
        this.state.resolvedClues.add(instr.id);
        this._save();
        break;
      }

      // ── Phase 6g: Transition ──────────────────────────────────────────────
      case OP.TRANSITION: {
        this.state.pendingTransition = { preset: instr.preset, duration: instr.duration };
        break;
      }

        throw new RuntimeError(`Unknown opcode: ${instr.op}`, this.state.scene, this.state.ip);
    }
  }

  _handleFinish() {
    this.running = false;
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY); } catch(e) {}
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
