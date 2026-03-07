'use strict';

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

const { IR } = require('./ir');

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

module.exports = { parse, Parser, ParseError, ParseWarning };
