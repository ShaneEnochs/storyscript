'use strict';

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

module.exports = { evaluate, substituteVars, EvalError, tokenizeExpr, TOKEN };
