'use strict';

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

module.exports = { IR, SymbolTable, BYTECODE_VERSION };
