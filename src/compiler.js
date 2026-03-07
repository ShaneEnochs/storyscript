'use strict';

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

const { tokenize }           = require('./lexer');
const { parse }              = require('./parser');
const { emit, OP, BYTECODE_VERSION } = require('./emitter');
const { SymbolTable }        = require('./ir');

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

module.exports = {
  compile,
  compileFull,
  Compiler,
  CompileError,
  DiagnosticError,
  DiagnosticWarning,
  OP,
  BYTECODE_VERSION,
};
