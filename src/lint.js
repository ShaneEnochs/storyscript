#!/usr/bin/env node
'use strict';

/**
 * StoryScript Linter — lint.js (Phase 4 update)
 *
 * Phase 4 additions over Phase 2 rewrite:
 *   ERROR  — *unlock referencing achievement not declared in startup.txt
 *   ERROR  — *give / *take referencing item not declared in startup.txt
 *   ERROR  — *improve / *reduce referencing skill not declared in startup.txt
 *   ERROR  — *grant / *revoke referencing title not declared in startup.txt
 *   WARNING — Achievement declared but *unlock never called anywhere
 *   WARNING — Skill declared but never *improve-d or *reduce-d anywhere
 *   WARNING — Item declared but never *give-n anywhere
 *   WARNING — Title declared but never *grant-ed anywhere
 *
 * All prior Phase 2 checks are preserved:
 *   ERROR  — All compile errors surfaced from compileFull()
 *   ERROR  — *create/*list/*object outside startup file
 *   ERROR  — *scene references a file that cannot be found
 *   ERROR  — Spaces used for indentation
 *   WARNING — Variables declared but never read (dead variables)
 *   WARNING — Labels defined but never targeted by *goto/*gosub
 *   WARNING — Unreachable instructions after unconditional *goto/*finish/*return
 *
 * Usage:
 *   node lint.js [startupFile] [--json] [--no-warn]
 */

const fs   = require('fs');
const path = require('path');

const { compileFull, OP } = require('./src/compiler');
const { IR, SymbolTable } = require('./src/ir');

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const jsonMode     = args.includes('--json');
const noWarn       = args.includes('--no-warn');
const explicitFile = args.find(a => !a.startsWith('--'));

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync('storyscript.json', 'utf8')); } catch { return {}; }
}

const config      = loadConfig();
const startupFile = explicitFile ?? config.startScene ?? 'startup.txt';

function resolveScenePath(name) {
  const candidates = [
    name,
    `${name}.txt`,
    path.join('scenes', name),
    path.join('scenes', `${name}.txt`),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

// ─── Issue collection ─────────────────────────────────────────────────────────

const issues = [];

function error(file, line, msg) {
  issues.push({ level: 'ERROR', file, line: line ?? 0, msg });
}

function warn(file, line, msg) {
  if (!noWarn) issues.push({ level: 'WARN', file, line: line ?? 0, msg });
}

// ─── Indentation check ────────────────────────────────────────────────────────

function checkIndentation(source, file) {
  const lines = source.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') return;
    if (/^ /.test(line) || /^\t+ /.test(line)) {
      error(file, i + 1, 'Indentation error: leading spaces found. Only tabs are permitted.');
    }
  });
}

// ─── Expression variable extraction ──────────────────────────────────────────

function markRead(expr, varsRead) {
  if (!expr || typeof expr !== 'string') return;
  const keywords = new Set(['true', 'false', 'and', 'or', 'not', 'in', 'null']);
  const tokens = expr.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  for (const tok of tokens) {
    if (!keywords.has(tok)) {
      varsRead.add(tok.split('.')[0]);
    }
  }
}

function isBlockEnd(instr) {
  return instr && [OP.LABEL, OP.ENDIF, OP.ENDWHILE, OP.ENDFOR].includes(instr.op);
}

// ─── Per-file analysis ────────────────────────────────────────────────────────

function analyzeProgram(program, file, isStartup, globalSymbols, p3Registry, p3Used) {
  const labelsDefined  = new Map();
  const labelsUsedIdxs = new Set();
  const varsDeclared   = new Map();
  const varsRead       = new Set();
  const forLoopVars    = new Set();

  let unreachable = false;

  for (let idx = 0; idx < program.length; idx++) {
    const instr   = program[idx];
    const lineNum = instr.lineNum ?? 0;

    if ([OP.LABEL, OP.ENDIF, OP.ENDWHILE, OP.ENDFOR].includes(instr.op)) {
      unreachable = false;
    }

    if (unreachable) {
      if (![OP.LABEL, OP.ENDIF, OP.ENDWHILE, OP.ENDFOR, OP.BLANK].includes(instr.op)) {
        continue;
      }
    }

    switch (instr.op) {

      case OP.LABEL: {
        if (!instr.name.startsWith('__choice_after_') && !instr.name.startsWith('__')) {
          labelsDefined.set(instr.name, idx);
        }
        break;
      }

      case OP.GOTO: {
        if (instr.target !== null) labelsUsedIdxs.add(instr.target);
        const next = program[idx + 1];
        if (next && !isBlockEnd(next)) {
          unreachable = true;
          warn(file, next.lineNum ?? 0, `Unreachable instruction after unconditional *goto.`);
        }
        break;
      }

      case OP.GOSUB: {
        if (instr.target !== null) labelsUsedIdxs.add(instr.target);
        if (Array.isArray(instr.args)) {
          for (const argExpr of instr.args) markRead(argExpr, varsRead);
        }
        break;
      }

      case OP.FINISH:
      case OP.RETURN: {
        const next = program[idx + 1];
        if (next && !isBlockEnd(next)) {
          unreachable = true;
          warn(file, next.lineNum ?? 0,
            `Unreachable instruction after *${instr.op === OP.FINISH ? 'finish' : 'return'}.`);
        }
        break;
      }

      case OP.CREATE: {
        if (!isStartup) {
          error(file, lineNum, `*create '${instr.var}' is not allowed outside startup.txt.`);
        }
        if (!varsDeclared.has(instr.var)) varsDeclared.set(instr.var, { lineNum });
        if (instr.expr) markRead(instr.expr, varsRead);
        break;
      }

      case OP.SET_TEMP: {
        if (!varsDeclared.has(instr.var)) varsDeclared.set(instr.var, { lineNum });
        if (instr.expr) markRead(instr.expr, varsRead);
        break;
      }

      case OP.SET: {
        if (instr.expr) markRead(instr.expr, varsRead);
        break;
      }

      case OP.LIST_CREATE:
      case OP.OBJ_CREATE: {
        if (!isStartup) {
          const cmd = instr.op === OP.LIST_CREATE ? '*list' : '*object';
          error(file, lineNum, `${cmd} '${instr.var}' declares a global but is not in startup.txt.`);
        }
        if (!varsDeclared.has(instr.var)) varsDeclared.set(instr.var, { lineNum });
        break;
      }

      case OP.IF: {
        if (instr.else !== null) labelsUsedIdxs.add(instr.else);
        if (instr.expr) markRead(instr.expr, varsRead);
        break;
      }

      case OP.ELSE: {
        if (instr.end !== null) labelsUsedIdxs.add(instr.end);
        break;
      }

      case OP.WHILE: {
        if (instr.end !== null) labelsUsedIdxs.add(instr.end);
        if (instr.expr) markRead(instr.expr, varsRead);
        break;
      }

      case OP.FOR: {
        if (instr.end !== null) labelsUsedIdxs.add(instr.end);
        varsRead.add(instr.list);
        forLoopVars.add(instr.var);
        if (!varsDeclared.has(instr.var)) {
          varsDeclared.set(instr.var, { lineNum, implicit: true });
        }
        break;
      }

      case OP.PRINT: {
        const subs = instr.value?.match(/\$\{([^}]+)\}/g) ?? [];
        for (const s of subs) markRead(s.slice(2, -1).trim(), varsRead);
        break;
      }

      case OP.PUSH: {
        varsRead.add(instr.list);
        if (instr.expr) markRead(instr.expr, varsRead);
        break;
      }

      case OP.POP: {
        varsRead.add(instr.list);
        break;
      }

      case OP.OBJ_SET: {
        varsRead.add(instr.obj);
        if (instr.expr) markRead(instr.expr, varsRead);
        break;
      }

      case OP.CHOICE_END: {
        for (const opt of (instr.options ?? [])) {
          if (opt.cond) markRead(opt.cond, varsRead);
          if (opt.target !== null && opt.target !== undefined) {
            labelsUsedIdxs.add(opt.target);
          }
        }
        break;
      }

      // ── Phase 3 construct checks ──────────────────────────────────────────

      case OP.SKILL: {
        // Declaration — only valid in startup, parser handles enforcement
        if (p3Registry) p3Registry.skills.set(instr.id, { lineNum, file });
        break;
      }

      case OP.ITEM: {
        if (p3Registry) p3Registry.items.set(instr.id, { lineNum, file });
        break;
      }

      case OP.ACHIEVEMENT: {
        if (p3Registry) p3Registry.achievements.set(instr.id, { lineNum, file });
        break;
      }

      case OP.TITLE: {
        if (p3Registry) p3Registry.titles.set(instr.id, { lineNum, file });
        break;
      }

      case OP.IMPROVE:
      case OP.REDUCE:
      case OP.SET_SKILL: {
        if (p3Used && instr.id) p3Used.skills.add(instr.id);
        // Cross-reference check (only if we have a registry already built)
        if (!isStartup && p3Registry && instr.id && !p3Registry.skills.has(instr.id)) {
          error(file, lineNum, `*${instr.op === OP.IMPROVE ? 'improve' : instr.op === OP.REDUCE ? 'reduce' : 'set_skill'} references undeclared skill '${instr.id}'. Declare it with *skill in startup.txt.`);
        }
        break;
      }

      case OP.GIVE:
      case OP.TAKE: {
        if (p3Used && instr.id) p3Used.items.add(instr.id);
        if (!isStartup && p3Registry && instr.id && !p3Registry.items.has(instr.id)) {
          error(file, lineNum, `*${instr.op === OP.GIVE ? 'give' : 'take'} references undeclared item '${instr.id}'. Declare it with *item in startup.txt.`);
        }
        break;
      }

      case OP.UNLOCK: {
        if (p3Used && instr.id) p3Used.achievements.add(instr.id);
        if (!isStartup && p3Registry && instr.id && !p3Registry.achievements.has(instr.id)) {
          error(file, lineNum, `*unlock references undeclared achievement '${instr.id}'. Declare it with *achievement in startup.txt.`);
        }
        break;
      }

      case OP.GRANT:
      case OP.REVOKE: {
        if (p3Used && instr.id) p3Used.titles.add(instr.id);
        if (!isStartup && p3Registry && instr.id && !p3Registry.titles.has(instr.id)) {
          error(file, lineNum, `*${instr.op === OP.GRANT ? 'grant' : 'revoke'} references undeclared title '${instr.id}'. Declare it with *title in startup.txt.`);
        }
        break;
      }

      default:
        break;
    }
  }

  // Dead variable warnings
  for (const [name, info] of varsDeclared) {
    if (forLoopVars.has(name)) continue;
    if (isStartup && globalSymbols.has(name)) continue;
    if (!varsRead.has(name) && !globalSymbols.has(name)) {
      warn(file, info.lineNum, `Variable '${name}' is declared but never read.`);
    }
  }

  // Undeclared-variable warnings
  for (const name of varsRead) {
    if (!varsDeclared.has(name) && !globalSymbols.has(name) && !forLoopVars.has(name)) {
      warn(file, 0, `Variable '${name}' is referenced but never declared.`);
    }
  }

  // Unused label warnings
  for (const [name, instrIdx] of labelsDefined) {
    if (!labelsUsedIdxs.has(instrIdx) && !name.startsWith('__')) {
      warn(file, 0, `Label '${name}' is defined but never targeted by *goto or *gosub.`);
    }
  }
}

// ─── Phase 3 "declared but never used" warnings ───────────────────────────────

function checkP3Usage(registry, used) {
  for (const [id, info] of registry.achievements) {
    if (!used.achievements.has(id)) {
      warn(info.file, info.lineNum, `Achievement '${id}' is declared but *unlock is never called for it.`);
    }
  }
  for (const [id, info] of registry.skills) {
    if (!used.skills.has(id)) {
      warn(info.file, info.lineNum, `Skill '${id}' is declared but never *improve-d or *reduce-d.`);
    }
  }
  for (const [id, info] of registry.items) {
    if (!used.items.has(id)) {
      warn(info.file, info.lineNum, `Item '${id}' is declared but never *give-n.`);
    }
  }
  for (const [id, info] of registry.titles) {
    if (!used.titles.has(id)) {
      warn(info.file, info.lineNum, `Title '${id}' is declared but never *grant-ed.`);
    }
  }
}

// ─── Scene loader ──────────────────────────────────────────────────────────────

function loadAndAnalyze(filePath, sceneName, globalSymbols) {
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    error(sceneName, 0, `Cannot read file: ${filePath}`);
    return null;
  }

  checkIndentation(source, sceneName);

  const result = compileFull(source, sceneName, {
    loopCap:     config.config?.loopCap ?? 100000,
    startupFile: startupFile,
  });

  for (const e of result.errors) {
    error(e.file ?? sceneName, e.lineNum, e.message);
  }
  for (const w of result.warnings) {
    warn(w.file ?? sceneName, w.lineNum, w.message);
  }

  if (result.errors.length > 0) return null;

  return { source, program: result.program, symbolTable: result.symbolTable };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const startupPath = resolveScenePath(startupFile) ?? startupFile;

  if (!fs.existsSync(startupPath)) {
    error(startupFile, 0, `Startup file not found: ${startupPath}`);
    report();
    return;
  }

  // Pass 0: compile startup to get the authoritative global symbol table + p3 registry
  const startupResult = loadAndAnalyze(startupPath, startupFile, new Set());
  const globalSymbols = startupResult
    ? startupResult.symbolTable.globalNames()
    : new Set();

  // Phase 3 registry: collected from startup.txt declarations
  const p3Registry = {
    skills:       new Map(),
    items:        new Map(),
    achievements: new Map(),
    titles:       new Map(),
  };

  // Phase 3 used: collected across all files
  const p3Used = {
    skills:       new Set(),
    items:        new Set(),
    achievements: new Set(),
    titles:       new Set(),
  };

  // Analyze startup for declarations (pass registry as target)
  if (startupResult) {
    analyzeProgram(startupResult.program, startupFile, true, globalSymbols, p3Registry, p3Used);
  }

  const queue   = [{ filePath: startupPath, sceneName: startupFile, isStartup: true }];
  const visited = new Set();
  visited.add(startupPath);

  // Queue remaining scenes for analysis
  if (startupResult) {
    const sceneOps = startupResult.program.filter(i => i.op === OP.SCENE);
    for (const sceneInstr of sceneOps) {
      const ref     = sceneInstr.file;
      const refPath = resolveScenePath(ref);
      if (refPath && !visited.has(refPath)) {
        queue.push({ filePath: refPath, sceneName: ref, isStartup: false });
      }
    }
  }

  while (queue.length > 0) {
    const { filePath, sceneName, isStartup } = queue.shift();
    if (visited.has(filePath) && sceneName !== startupFile) continue;
    visited.add(filePath);

    if (isStartup) continue; // Already analyzed above

    const result = loadAndAnalyze(filePath, sceneName, globalSymbols);
    if (!result) continue;

    analyzeProgram(result.program, sceneName, false, globalSymbols, p3Registry, p3Used);

    // Enqueue referenced scenes
    const sceneOps = result.program.filter(i => i.op === OP.SCENE);
    for (const sceneInstr of sceneOps) {
      const ref     = sceneInstr.file;
      const refPath = resolveScenePath(ref);
      if (!refPath) {
        error(sceneName, sceneInstr.lineNum ?? 0,
          `*scene references '${ref}' but the file cannot be found.`);
      } else if (!visited.has(refPath)) {
        queue.push({ filePath: refPath, sceneName: ref, isStartup: false });
      }
    }
  }

  // Phase 3 "declared but unused" warnings
  checkP3Usage(p3Registry, p3Used);

  report();
}

function report() {
  const errors = issues.filter(i => i.level === 'ERROR');
  const warns  = issues.filter(i => i.level === 'WARN');

  if (jsonMode) {
    console.log(JSON.stringify({ issues, errorCount: errors.length, warnCount: warns.length }, null, 2));
    process.exit(errors.length > 0 ? 1 : 0);
    return;
  }

  if (issues.length === 0) {
    console.log('\n✓ No issues found.\n');
    process.exit(0);
    return;
  }

  console.log('');

  const byFile = new Map();
  for (const issue of issues) {
    if (!byFile.has(issue.file)) byFile.set(issue.file, []);
    byFile.get(issue.file).push(issue);
  }

  for (const [file, fileIssues] of byFile) {
    console.log(`── ${file}`);
    for (const { level, line, msg } of fileIssues) {
      const loc    = line ? `:${line}` : '';
      const prefix = level === 'ERROR' ? '[ERROR]' : '[WARN] ';
      console.log(`  ${prefix} ${file}${loc} — ${msg}`);
    }
    console.log('');
  }

  const summary = `${errors.length} error(s), ${warns.length} warning(s)`;
  if (errors.length > 0) {
    console.log(`✗ ${summary}\n`);
    process.exit(1);
  } else {
    console.log(`⚠ ${summary}\n`);
    process.exit(0);
  }
}

main();
