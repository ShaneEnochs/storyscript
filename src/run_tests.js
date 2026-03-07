'use strict';
/**
 * StoryScript Test Suite - WEEK 1 FIX #4: Summary at end
 */
const { tokenize } = require('../src/lexer');
const { evaluate, substituteVars } = require('../src/evaluator');
const { compile, OP } = require('../src/compiler');
const { StoryState } = require('../src/state');
const { Engine } = require('../src/engine');
const { NullRenderer } = require('../src/renderer');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function assert(cond, msg = 'Assertion failed') { if (!cond) throw new Error(msg); }
function assertThrows(fn, msgContains = null) {
  try { fn(); throw new Error('Expected error'); }
  catch (e) { if (msgContains && !e.message.includes(msgContains)) throw new Error(`Expected "${msgContains}" but got: ${e.message}`); }
}
const makeState = (vars = {}) => { const s = new StoryState(); for (const [k, v] of Object.entries(vars)) s.createGlobal(k, v); return s; };
function makeEngine(source) {
  const renderer = new NullRenderer();
  const loader = async () => source;
  return { engine: new Engine(renderer, loader, { startupFile: 'test.txt' }), renderer };
}

console.log('\n── Lexer ──────────────────────────────────────────────────────');
test('tokenizes plain text', () => { const t = tokenize('Hello!', 'test.txt'); assert(t[0].type === 'text'); });
test('tokenizes commands', () => { const t = tokenize('*goto fight', 'test.txt'); assert(t[0].type === 'command'); });
test('rejects leading spaces', () => { assertThrows(() => tokenize('  *goto bad', 'test.txt'), 'leading space'); });

console.log('\n── Evaluator ──────────────────────────────────────────────────');
test('evaluates numbers', () => { assert(evaluate('42') === 42); });
test('evaluates arithmetic', () => { assert(evaluate('2 + 3') === 5); });
test('evaluates variables', () => { assert(evaluate('hp', makeState({ hp: 80 })) === 80); });
test('FairMath %+', () => { assert(evaluate('stat %+ 50', makeState({ stat: 70 })) === 85); });
test('substituteVars', () => { assert(substituteVars('HP: ${hp}', makeState({ hp: 80 })) === 'HP: 80'); });

console.log('\n── Compiler ───────────────────────────────────────────────────');
test('compiles text', () => { assert(compile('Hello')[0].op === OP.PRINT); });
test('compiles *finish', () => { assert(compile('*finish').some(i => i.op === OP.FINISH)); });
test('compiles *goto', () => { const p = compile('*label start\n*goto start\n'); assert(p.find(i => i.op === OP.GOTO).target === p.findIndex(i => i.op === OP.LABEL)); });
test('WEEK 1 FIX #2: *create outside startup throws', () => { assertThrows(() => compile('*create hp 100', 'chapter.txt', { startupFile: 'startup.txt' }), 'only allowed in startup.txt'); });
test('WEEK 1 FIX #2: *create in startup OK', () => { const p = compile('*create hp 100', 'startup.txt', { startupFile: 'startup.txt' }); assert(p[0].op === OP.CREATE); });
test('compiles *choice', () => { const p = compile('*create x 0\n*choice\n\t#A\n\t\t*set x 1\n\t#B\n\t\t*set x 2\n', 'startup.txt', { startupFile: 'startup.txt' }); assert(p.find(i => i.op === OP.CHOICE_END).options.length === 2); });

console.log('\n── State ──────────────────────────────────────────────────────');
test('globals get/set', () => { const s = new StoryState(); s.createGlobal('hp', 100); assert(s.get('hp') === 100); s.set('hp', 80); assert(s.get('hp') === 80); });
test('temps shadow globals', () => { const s = makeState({ power: 10 }); s.createTemp('power', 99); assert(s.get('power') === 99); });
test('undo stack', () => { const s = makeState({ hp: 100 }); s.ip = 5; s.pushUndo(); s.set('hp', 50); s.popUndo(); assert(s.get('hp') === 100 && s.ip === 5); });
test('serialization', () => { const s = makeState({ hp: 100 }); s.scene = 'ch.txt'; const s2 = new StoryState(); assert(s2.deserialize(s.serialize()) && s2.get('hp') === 100); });

console.log('\n── Engine ─────────────────────────────────────────────────────');
test('runs to finish', async () => { const { engine, renderer } = makeEngine('*finish\n'); await engine.start(false); assert(renderer.finished); });
test('executes *set', async () => { const { engine } = makeEngine('*create hp 100\n*set hp 80\n*finish\n'); await engine.start(false); assert(engine.state.get('hp') === 80); });
test('runs *while', async () => { const { engine } = makeEngine('*create n 0\n*while n < 3\n*set n n + 1\n*endwhile\n*finish\n'); await engine.start(false); assert(engine.state.get('n') === 3); });
test('presents choices', async () => { const { engine, renderer } = makeEngine('*create r "none"\n*choice\n\t#A\n\t\t*set r "A"\n\t#B\n\t\t*set r "B"\n*finish\n'); await engine.start(false); assert(engine.waiting && renderer._pendingOptions.length === 2); renderer._pendingOptions[1].onPick(); assert(engine.state.get('r') === 'B'); });

console.log('\n── Renderer ───────────────────────────────────────────────────');
test('has appendDivider', () => { const r = new NullRenderer(); assert(typeof r.appendDivider === 'function'); r.appendDivider(); });
test('has clearChoices', () => { const r = new NullRenderer(); r.renderChoices([{ text: 'A', enabled: true, onPick: () => {} }]); r.clearChoices(); assert(r._pendingOptions === null); });

console.log('\n── PAGE_BREAK ─────────────────────────────────────────────────');
test('page_break non-blocking', async () => { const { engine, renderer } = makeEngine('*create x 0\n*page_break\n*set x 99\n*finish\n'); await engine.start(false); assert(renderer.finished && engine.state.get('x') === 99); });
test('calls appendDivider', async () => { const r = new NullRenderer(); let called = false; r.appendDivider = () => { called = true; }; const e = new Engine(r, async () => '*page_break\n*finish\n', { startupFile: 'test.txt' }); await e.start(false); assert(called); });

console.log('\n── clearChoices ───────────────────────────────────────────────');
test('choice picks call clearChoices', async () => { const r = new NullRenderer(); let cc = 0; r.clearChoices = () => { cc++; }; const e = new Engine(r, async () => '*create x 0\n*choice\n\t#A\n\t\t*set x 1\n*finish\n', { startupFile: 'test.txt' }); await e.start(false); r._pendingOptions[0].onPick(); assert(cc >= 1); });

// CRITICAL FIX #4: Summary at the very end
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(60)}\n`);
if (failed > 0) process.exit(1);
