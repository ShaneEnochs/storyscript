'use strict';

/**
 * Phase 1 Compiler Refactor — Test Suite
 *
 * Tests:
 *   - compileFull() returns the full result object (no throw)
 *   - Source maps: every instruction has file + lineNum
 *   - SymbolTable: labels, globals, temps, sceneRefs populated correctly
 *   - Error collection: multiple errors returned, not thrown
 *   - IR structure: nested blocks (if/while/for/choice) parsed correctly
 *   - BYTECODE_VERSION present on result
 *   - Backward-compat: compile() still throws on errors
 *   - All original 27 tests still pass (indirectly, via engine)
 */

const { tokenize }            = require('../src/lexer');
const { parse }               = require('../src/parser');
const { emit, OP }            = require('../src/emitter');
const { IR, SymbolTable, BYTECODE_VERSION } = require('../src/ir');
const { compile, compileFull, CompileError, DiagnosticError } = require('../src/compiler');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => { console.log(`  ✓ ${name}`); passed++; },
        (e) => { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
      );
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    failed++;
  }
}

function assert(cond, msg = 'Assertion failed') {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn, msgContains = null) {
  try {
    fn();
    throw new Error('Expected an error to be thrown');
  } catch (e) {
    if (e.message === 'Expected an error to be thrown') throw e;
    if (msgContains && !e.message.includes(msgContains)) {
      throw new Error(`Expected message to contain "${msgContains}" but got: ${e.message}`);
    }
  }
}

// ─── Lexer / Parser ───────────────────────────────────────────────────────────

console.log('\n── IR / Parser ────────────────────────────────────────────────');

test('parser produces IR nodes (not raw ops)', () => {
  const tokens = tokenize('Hello world\n*finish\n', 'test.txt');
  const { nodes, errors } = parse(tokens, 'test.txt', { startupFile: 'test.txt' });
  assert(errors.length === 0, `Unexpected errors: ${errors.map(e=>e.message).join(', ')}`);
  assert(nodes.some(n => n.kind === IR.TEXT), 'Expected a TEXT node');
  assert(nodes.some(n => n.kind === IR.FINISH), 'Expected a FINISH node');
});

test('parser produces nested IF node', () => {
  const src = '*create x 1\n*if x > 0\nyes\n*else\nno\n*endif\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes, errors } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, `Parse errors: ${errors.map(e=>e.message).join(', ')}`);
  const ifNode = nodes.find(n => n.kind === IR.IF);
  assert(ifNode, 'Expected an IF node');
  assert(ifNode.condition === 'x > 0', 'Wrong condition');
  assert(ifNode.consequent.some(n => n.kind === IR.TEXT), 'Expected TEXT in consequent');
  assert(ifNode.alternate !== null, 'Expected alternate');
  assert(ifNode.alternate.some(n => n.kind === IR.TEXT), 'Expected TEXT in alternate');
});

test('parser produces nested WHILE node', () => {
  const src = '*create n 0\n*while n < 3\n*set n n + 1\n*endwhile\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes, errors } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, `Parse errors: ${errors.map(e=>e.message).join(', ')}`);
  const whileNode = nodes.find(n => n.kind === IR.WHILE);
  assert(whileNode, 'Expected a WHILE node');
  assert(whileNode.condition === 'n < 3');
  assert(whileNode.body.some(n => n.kind === IR.SET));
});

test('parser produces nested FOR node', () => {
  const src = '*list items ["a","b"]\n*for item in items\n— ${item}\n*endfor\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes, errors } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, `Parse errors: ${errors.map(e=>e.message).join(', ')}`);
  const forNode = nodes.find(n => n.kind === IR.FOR);
  assert(forNode, 'Expected a FOR node');
  assert(forNode.var === 'item');
  assert(forNode.list === 'items');
});

test('parser produces nested CHOICE node with options', () => {
  const src = '*create x 0\n*choice\n\t#A\n\t\t*set x 1\n\t#B\n\t\t*set x 2\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes, errors } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, `Parse errors: ${errors.map(e=>e.message).join(', ')}`);
  const choice = nodes.find(n => n.kind === IR.CHOICE);
  assert(choice, 'Expected a CHOICE node');
  assert(choice.options.length === 2, `Expected 2 options, got ${choice.options.length}`);
  assert(choice.options[0].text === 'A');
  assert(choice.options[1].text === 'B');
  assert(choice.options[0].body.some(n => n.kind === IR.SET));
});

test('parser collects errors without throwing', () => {
  const src = '*create x 0\n*endwhile\n*endif\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes, errors } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length >= 2, `Expected >=2 errors, got ${errors.length}`);
  assert(errors.some(e => e.message.includes('endwhile')));
  assert(errors.some(e => e.message.includes('endif')));
});

test('parser enforces *create in startup only', () => {
  const src = '*create x 0\n*finish\n';
  const tokens = tokenize(src, 'chapter.txt');
  const { errors } = parse(tokens, 'chapter.txt', { startupFile: 'startup.txt' });
  assert(errors.length > 0, 'Expected error for *create in non-startup file');
  assert(errors[0].message.includes('only allowed in startup.txt'));
});

test('parser includes source locations on nodes', () => {
  const src = 'Hello\n*finish\n';
  const tokens = tokenize(src, 'test.txt');
  const { nodes } = parse(tokens, 'test.txt', { startupFile: 'test.txt' });
  const textNode = nodes.find(n => n.kind === IR.TEXT);
  assert(textNode.file === 'test.txt', `Expected file 'test.txt', got '${textNode.file}'`);
  assert(textNode.lineNum === 1, `Expected lineNum 1, got ${textNode.lineNum}`);
  const finishNode = nodes.find(n => n.kind === IR.FINISH);
  assert(finishNode.lineNum === 2, `Expected lineNum 2, got ${finishNode.lineNum}`);
});

// ─── SymbolTable ──────────────────────────────────────────────────────────────

console.log('\n── SymbolTable ────────────────────────────────────────────────');

test('SymbolTable captures globals from *create', () => {
  const src = '*create hp 100\n*create name "hero"\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  const st = new SymbolTable();
  st.populate(nodes, 'startup.txt');
  assert(st.globals.has('hp'), "Expected 'hp' in globals");
  assert(st.globals.has('name'), "Expected 'name' in globals");
  assert(st.globals.get('hp').type === 'scalar');
});

test('SymbolTable captures list and object globals', () => {
  const src = '*list items ["a","b"]\n*object player {"hp":100}\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  const st = new SymbolTable();
  st.populate(nodes, 'startup.txt');
  assert(st.globals.get('items').type === 'list');
  assert(st.globals.get('player').type === 'object');
});

test('SymbolTable captures labels', () => {
  const src = '*label start\n*label end\n*finish\n';
  const tokens = tokenize(src, 'test.txt');
  const { nodes } = parse(tokens, 'test.txt', { startupFile: 'test.txt' });
  const st = new SymbolTable();
  st.populate(nodes, 'test.txt');
  assert(st.labels.has('start'));
  assert(st.labels.has('end'));
  assert(st.labels.get('start').file === 'test.txt');
});

test('SymbolTable captures label targets from goto', () => {
  const src = '*label start\n*goto start\n*finish\n';
  const tokens = tokenize(src, 'test.txt');
  const { nodes } = parse(tokens, 'test.txt', { startupFile: 'test.txt' });
  const st = new SymbolTable();
  st.populate(nodes, 'test.txt');
  assert(st.labelTargets.has('start'), "Expected 'start' in labelTargets");
});

test('SymbolTable captures scene references', () => {
  const src = '*scene chapter_two.txt\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  const st = new SymbolTable();
  st.populate(nodes, 'startup.txt');
  assert(st.sceneRefs.has('startup.txt'));
  assert(st.sceneRefs.get('startup.txt').includes('chapter_two.txt'));
});

test('SymbolTable walks into nested blocks', () => {
  const src = '*create flag false\n*if flag\n*label inner\n*endif\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  const st = new SymbolTable();
  st.populate(nodes, 'startup.txt');
  assert(st.globals.has('flag'), "Expected 'flag' in globals");
  assert(st.labels.has('inner'), "Expected 'inner' label (nested in if)");
});

test('SymbolTable.globalNames() returns a Set', () => {
  const src = '*create x 0\n*create y 1\n*finish\n';
  const tokens = tokenize(src, 'startup.txt');
  const { nodes } = parse(tokens, 'startup.txt', { startupFile: 'startup.txt' });
  const st = new SymbolTable();
  st.populate(nodes, 'startup.txt');
  const names = st.globalNames();
  assert(names instanceof Set);
  assert(names.has('x') && names.has('y'));
});

// ─── Emitter / Source Maps ────────────────────────────────────────────────────

console.log('\n── Emitter / Source Maps ──────────────────────────────────────');

test('every instruction has file and lineNum', () => {
  const src = '*create x 0\n*if x > 0\nyes\n*else\nno\n*endif\n*finish\n';
  const result = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(result.errors.length === 0, `Errors: ${result.errors.map(e=>e.message).join(', ')}`);
  for (let i = 0; i < result.program.length; i++) {
    const instr = result.program[i];
    assert(typeof instr.file === 'string', `Instruction ${i} (${instr.op}) missing .file`);
    assert(typeof instr.lineNum === 'number', `Instruction ${i} (${instr.op}) missing .lineNum`);
  }
});

test('sourceMap is parallel to program and has same length', () => {
  const src = '*create x 0\n*set x 5\n*finish\n';
  const result = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(result.program.length === result.sourceMap.length,
    `program.length=${result.program.length} sourceMap.length=${result.sourceMap.length}`);
  for (const entry of result.sourceMap) {
    assert(typeof entry.file === 'string', 'sourceMap entry missing file');
    assert(typeof entry.lineNum === 'number', 'sourceMap entry missing lineNum');
  }
});

test('sourceMap has correct line numbers', () => {
  const src = 'Line one text\nLine two text\n*finish\n';
  const result = compileFull(src, 'test.txt', { startupFile: 'test.txt' });
  const printInstrs = result.program
    .map((instr, i) => ({ instr, map: result.sourceMap[i] }))
    .filter(x => x.instr.op === OP.PRINT);
  assert(printInstrs.length >= 2, 'Expected at least 2 PRINT instructions');
  assert(printInstrs[0].map.lineNum === 1, `Expected lineNum 1, got ${printInstrs[0].map.lineNum}`);
  assert(printInstrs[1].map.lineNum === 2, `Expected lineNum 2, got ${printInstrs[1].map.lineNum}`);
});

// ─── compileFull API ──────────────────────────────────────────────────────────

console.log('\n── compileFull API ────────────────────────────────────────────');

test('compileFull returns all required fields', () => {
  const result = compileFull('*finish\n', 'test.txt', { startupFile: 'test.txt' });
  assert(Array.isArray(result.program),      'Missing program');
  assert(Array.isArray(result.sourceMap),    'Missing sourceMap');
  assert(result.symbolTable instanceof SymbolTable, 'Missing symbolTable');
  assert(Array.isArray(result.errors),       'Missing errors');
  assert(Array.isArray(result.warnings),     'Missing warnings');
  assert(typeof result.version === 'number', 'Missing version');
});

test('compileFull never throws — returns errors array instead', () => {
  // Would throw in old compiler
  const result = compileFull('*goto nonexistent_label\n', 'test.txt', { startupFile: 'test.txt' });
  assert(Array.isArray(result.errors), 'Expected errors array');
  assert(result.errors.length > 0, 'Expected at least one error');
});

test('compileFull collects multiple errors', () => {
  const src = '*endwhile\n*endif\n*endfor\n';
  const result = compileFull(src, 'test.txt', { startupFile: 'test.txt' });
  assert(result.errors.length >= 3, `Expected >=3 errors, got ${result.errors.length}`);
});

test('compileFull errors are DiagnosticError instances with message/file/lineNum', () => {
  const src = '*create x 0\n*goto missing_label\n';
  const result = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(result.errors.length > 0);
  const err = result.errors[0];
  assert(typeof err.message === 'string', 'Missing message');
  assert(typeof err.file === 'string',    'Missing file');
  assert(typeof err.lineNum === 'number', 'Missing lineNum');
});

test('compileFull version matches BYTECODE_VERSION', () => {
  const result = compileFull('*finish\n', 'test.txt', { startupFile: 'test.txt' });
  assert(result.version === BYTECODE_VERSION,
    `Expected version ${BYTECODE_VERSION}, got ${result.version}`);
});

test('compileFull success: errors array is empty and program is non-empty', () => {
  const src = '*create hp 100\n*set hp 80\n*finish\n';
  const result = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(result.errors.length === 0, `Unexpected errors: ${result.errors.map(e=>e.message)}`);
  assert(result.program.length > 0);
});

test('compileFull includes symbolTable with globals from *create', () => {
  const src = '*create hp 100\n*create name "hero"\n*finish\n';
  const result = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(result.symbolTable.globals.has('hp'));
  assert(result.symbolTable.globals.has('name'));
});

test('compileFull handles lex errors gracefully', () => {
  // Leading spaces cause a LexerError — compileFull should catch it
  const src = '  *goto bad\n';
  const result = compileFull(src, 'test.txt', { startupFile: 'test.txt' });
  assert(result.errors.length > 0, 'Expected error for leading spaces');
  assert(result.program.length === 0, 'Program should be empty on lex error');
});

// ─── Backward-compatible compile() ───────────────────────────────────────────

console.log('\n── Backward-compatible compile() ──────────────────────────────');

test('compile() still returns program array on success', () => {
  const program = compile('*finish\n', 'test.txt', { startupFile: 'test.txt' });
  assert(Array.isArray(program));
  assert(program.some(i => i.op === OP.FINISH));
});

test('compile() throws CompileError on error', () => {
  assertThrows(
    () => compile('*goto nonexistent\n', 'test.txt', { startupFile: 'test.txt' }),
    'Unresolved label'
  );
});

test('compile() throws CompileError (not generic Error)', () => {
  try {
    compile('*create x 0\n*goto missing\n', 'startup.txt', { startupFile: 'startup.txt' });
    throw new Error('Expected throw');
  } catch (e) {
    assert(e.name === 'CompileError', `Expected CompileError, got ${e.name}`);
  }
});

test('compile() enforces *create in startup only (throws)', () => {
  assertThrows(
    () => compile('*create hp 100\n', 'chapter.txt', { startupFile: 'startup.txt' }),
    'only allowed in startup.txt'
  );
});

test('compile() allows *create in startup file (no throw)', () => {
  const p = compile('*create hp 100\n*finish\n', 'startup.txt', { startupFile: 'startup.txt' });
  assert(p[0].op === OP.CREATE);
});

// ─── Emitter structural correctness ──────────────────────────────────────────

console.log('\n── Bytecode structural correctness ────────────────────────────');

test('while loop: WHILE + LOOP_GUARD + ENDWHILE all present', () => {
  const src = '*create n 0\n*while n < 3\n*set n n + 1\n*endwhile\n*finish\n';
  const { program, errors } = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, errors.map(e=>e.message).join(', '));
  assert(program.some(i => i.op === OP.WHILE));
  assert(program.some(i => i.op === OP.LOOP_GUARD));
  assert(program.some(i => i.op === OP.ENDWHILE));
});

test('for loop: FOR + LOOP_GUARD + ENDFOR all present', () => {
  const src = '*list xs ["a","b"]\n*for x in xs\n— ${x}\n*endfor\n*finish\n';
  const { program, errors } = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, errors.map(e=>e.message).join(', '));
  assert(program.some(i => i.op === OP.FOR));
  assert(program.some(i => i.op === OP.ENDFOR));
});

test('if/else/endif: IF + ELSE + ENDIF all present', () => {
  const src = '*create x 1\n*if x > 0\nyes\n*else\nno\n*endif\n*finish\n';
  const { program, errors } = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, errors.map(e=>e.message).join(', '));
  assert(program.some(i => i.op === OP.IF));
  assert(program.some(i => i.op === OP.ELSE));
  assert(program.some(i => i.op === OP.ENDIF));
});

test('choice: CHOICE_PUSH + CHOICE_END with correct option count', () => {
  const src = '*create x 0\n*choice\n\t#A\n\t\t*set x 1\n\t#B\n\t\t*set x 2\n\t#C\n\t\t*set x 3\n*finish\n';
  const { program, errors } = compileFull(src, 'startup.txt', { startupFile: 'startup.txt' });
  assert(errors.length === 0, errors.map(e=>e.message).join(', '));
  const choiceEnd = program.find(i => i.op === OP.CHOICE_END);
  assert(choiceEnd, 'Expected CHOICE_END instruction');
  assert(choiceEnd.options.length === 3, `Expected 3 options, got ${choiceEnd.options.length}`);
});

test('goto target is a valid instruction index', () => {
  const src = '*label start\n*goto start\n*finish\n';
  const { program, errors } = compileFull(src, 'test.txt', { startupFile: 'test.txt' });
  assert(errors.length === 0, errors.map(e=>e.message).join(', '));
  const gotoInstr = program.find(i => i.op === OP.GOTO);
  assert(typeof gotoInstr.target === 'number', 'GOTO target should be a number');
  assert(gotoInstr.target >= 0 && gotoInstr.target < program.length, 'GOTO target out of range');
  assert(program[gotoInstr.target].op === OP.LABEL, 'GOTO should target a LABEL instruction');
});

test('BYTECODE_VERSION is an integer >= 1', () => {
  assert(Number.isInteger(BYTECODE_VERSION) && BYTECODE_VERSION >= 1,
    `BYTECODE_VERSION should be int >= 1, got ${BYTECODE_VERSION}`);
});

// ─── Full story compilation ───────────────────────────────────────────────────

console.log('\n── Full story compilation ─────────────────────────────────────');

test('The Lantern Road compiles without errors', () => {
  const fs = require('fs');
  const src = fs.readFileSync(__dirname + '/../examples/startup.txt', 'utf8');
  const result = compileFull(src, 'examples/startup.txt', { startupFile: 'examples/startup.txt' });
  const compileErrors = result.errors;
  assert(compileErrors.length === 0,
    `Unexpected errors:\n${compileErrors.map(e => `  ${e.file}:${e.lineNum} — ${e.message}`).join('\n')}`);
  assert(result.program.length > 50, 'Expected substantial program output');
});

test('Lantern Road: all instructions have source maps', () => {
  const fs = require('fs');
  const src = fs.readFileSync(__dirname + '/../examples/startup.txt', 'utf8');
  const result = compileFull(src, 'examples/startup.txt', { startupFile: 'examples/startup.txt' });
  for (let i = 0; i < result.program.length; i++) {
    const instr = result.program[i];
    assert(typeof instr.file === 'string' && instr.file.length > 0,
      `Instruction ${i} (${instr.op}) has empty/missing file`);
    assert(typeof instr.lineNum === 'number',
      `Instruction ${i} (${instr.op}) missing lineNum`);
  }
});

test('Lantern Road: symbolTable has expected globals', () => {
  const fs = require('fs');
  const src = fs.readFileSync(__dirname + '/../examples/startup.txt', 'utf8');
  const result = compileFull(src, 'examples/startup.txt', { startupFile: 'examples/startup.txt' });
  const globals = result.symbolTable.globalNames();
  for (const name of ['name', 'lanterns', 'courage', 'coin', 'has_map', 'inventory', 'player']) {
    assert(globals.has(name), `Expected global '${name}' in symbolTable`);
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────────

// Small async delay to let any async test() promises resolve
setTimeout(() => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(60)}\n`);
  if (failed > 0) process.exit(1);
}, 100);
