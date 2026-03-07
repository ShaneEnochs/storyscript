'use strict';

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

const { IR, BYTECODE_VERSION } = require('./ir');

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

module.exports = { emit, Emitter, EmitError, OP, BYTECODE_VERSION };
