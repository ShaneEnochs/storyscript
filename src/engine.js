'use strict';

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

const { OP }                       = require('./compiler');
const { evaluate, substituteVars } = require('./evaluator');
const { StoryState }               = require('./state');

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
    const { compile } = require('./compiler');
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

module.exports = { Engine, RuntimeError };
