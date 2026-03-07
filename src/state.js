'use strict';

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

module.exports = { StoryState, SAVE_VERSION };
