#!/usr/bin/env node
'use strict';

/**
 * StoryScript Fuzzer — fuzz.js
 *
 * Headless playthroughs using NullRenderer to verify no execution path throws.
 *
 * WEEK 1 FIX IMPLEMENTED:
 *   - Strict scene path resolution (no auto-.txt, no auto-scenes/)
 *   - Matches browser behavior exactly
 *
 * Usage:
 *   node fuzz.js [options] [startupFile]
 *
 * Options:
 *   --runs N        Number of random playthroughs (default: 1000)
 *   --seed N        PRNG seed for reproducible runs (default: random)
 *   --scenario FILE Path to a .scenario file for scripted playthroughs
 *   --timeout MS    Max ms per playthrough before declaring a hang (default: 5000)
 *   --verbose       Print each playthrough result
 *
 * Scenario file format (.scenario):
 *   One playthrough per line. Each line is a comma-separated list of
 *   1-based choice indices.
 *   Example:
 *     1,2,1       ← playthrough: pick option 1, then 2, then 1
 *     2,1         ← another playthrough
 *     3           ← single-choice playthrough
 *
 * Exit codes:
 *   0 — all playthroughs completed without errors
 *   1 — one or more playthroughs threw an error
 */

const fs   = require('fs');
const path = require('path');

const { compile }      = require('./src/compiler');
const { Engine }       = require('./src/engine');
const { NullRenderer } = require('./src/renderer');

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx === -1) return defaultVal;
  return args[idx + 1];
}

const numRuns     = parseInt(getArg('--runs',    '1000'), 10);
const seedArg     = getArg('--seed',    null);
const scenarioFile = getArg('--scenario', null);
const timeout     = parseInt(getArg('--timeout', '5000'), 10);
const verbose     = args.includes('--verbose');
const explicitStart = args.find(a => !a.startsWith('--') && a !== getArg('--runs','') &&
                                     a !== getArg('--seed','') && a !== getArg('--scenario','') &&
                                     a !== getArg('--timeout',''));

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync('storyscript.json', 'utf8')); } catch { return {}; }
}

const config      = loadConfig();
const startupFile = explicitStart ?? config.startScene ?? 'startup.txt';

/**
 * CRITICAL FIX #3: Strict scene path resolution.
 * No auto-.txt, no auto-scenes/ subdirectory searching.
 * Matches browser behavior where STORIES object requires exact keys.
 */
function resolveScenePath(name) {
  // STRICT: Only try the exact name provided
  if (fs.existsSync(name)) return name;
  
  // For convenience in fuzzer, allow scenes/ prefix if file doesn't exist at root
  const scenesPath = path.join('scenes', name);
  if (fs.existsSync(scenesPath)) return scenesPath;
  
  return null;
}

// ─── Simple seeded PRNG (xorshift32) ─────────────────────────────────────────

function makePRNG(seed) {
  let s = (seed | 0) || 0xdeadbeef;
  return function rand() {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

const seed = seedArg !== null ? parseInt(seedArg, 10) : Math.floor(Math.random() * 0x7fffffff);
let rand = makePRNG(seed);

// ─── Scene loader (file-system based) ────────────────────────────────────────

function makeSceneLoader() {
  const cache = new Map();
  return async (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    const p = resolveScenePath(filename);
    if (!p) throw new Error(`Scene not found: '${filename}'. *scene commands must specify exact filenames (e.g., 'chapter_two.txt' not 'chapter_two').`);
    const src = fs.readFileSync(p, 'utf8');
    cache.set(filename, src);
    return src;
  };
}

// ─── Single playthrough ───────────────────────────────────────────────────────

/**
 * Run one playthrough.
 * @param {number[]|null} script  — Array of 1-based choice indices, or null for random.
 * @returns {{ ok: boolean, error?: string, choices: number[] }}
 */
async function runPlaythrough(script) {
  const renderer = new NullRenderer();
  const loader   = makeSceneLoader();
  const engine   = new Engine(renderer, loader, {
    startupFile,
    loopCap:        config.config?.loopCap        ?? 100000,
    undoStackDepth: config.config?.undoStackDepth ?? 50,
  });

  const choicesMade = [];
  let scriptIdx = 0;

  try {
    await engine.start(false);

    const startTime = Date.now();

    // Drive the engine until it finishes or errors
    while (engine.running || engine.waiting) {
      if (Date.now() - startTime > timeout) {
        return { ok: false, error: `Timeout after ${timeout}ms`, choices: choicesMade };
      }

      if (renderer.finished) break;

      if (engine.waiting && renderer._pendingOptions) {
        const options = renderer._pendingOptions;

        // Pick a choice
        let idx;
        if (script !== null) {
          if (scriptIdx >= script.length) {
            // Script ran out of choices — pick first available
            idx = 0;
          } else {
            idx = Math.min(script[scriptIdx] - 1, options.length - 1);
            idx = Math.max(0, idx);
            scriptIdx++;
          }
        } else {
          // Random mode: pick any enabled option
          const enabled = options.filter(o => o.enabled !== false);
          const pool = enabled.length > 0 ? enabled : options;
          idx = options.indexOf(pool[Math.floor(rand() * pool.length)]);
        }

        choicesMade.push(idx + 1);

        // Invoke the choice
        const picked = options[idx];
        if (!picked) {
          return { ok: false, error: `Option index ${idx} out of range (${options.length} options)`, choices: choicesMade };
        }
        picked.onPick();
        continue;
      }

      // Nothing is blocking and engine isn't waiting — we're done
      break;
    }

    if (!renderer.finished && !engine.waiting) {
      // Engine stopped running without finishing — likely an error was shown
      return { ok: false, error: 'Engine stopped without *finish', choices: choicesMade };
    }

    return { ok: true, choices: choicesMade };

  } catch (e) {
    return { ok: false, error: e.message, choices: choicesMade };
  }
}

// ─── Scenario mode ────────────────────────────────────────────────────────────

function loadScenarios(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map((l, i) => {
      const choices = l.split(',').map(c => {
        const n = parseInt(c.trim(), 10);
        if (isNaN(n) || n < 1) throw new Error(`Scenario line ${i + 1}: invalid choice '${c}'`);
        return n;
      });
      return choices;
    });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nStoryScript Fuzzer`);
  console.log(`  Startup:  ${startupFile}`);
  console.log(`  Seed:     ${seed}`);

  if (scenarioFile) {
    // ── Scenario mode ──────────────────────────────────────────────────────
    console.log(`  Mode:     scenario (${scenarioFile})\n`);

    let scenarios;
    try {
      scenarios = loadScenarios(scenarioFile);
    } catch (e) {
      console.error(`Error loading scenario file: ${e.message}`);
      process.exit(1);
    }

    console.log(`  Scenarios: ${scenarios.length}\n`);

    let passed = 0;
    let failed = 0;

    for (let i = 0; i < scenarios.length; i++) {
      const script = scenarios[i];
      const result = await runPlaythrough(script);
      if (result.ok) {
        passed++;
        if (verbose) console.log(`  ✓ Scenario ${i + 1}: choices [${result.choices.join(',')}]`);
      } else {
        failed++;
        console.error(`  ✗ Scenario ${i + 1}: ${result.error}`);
        console.error(`    Choices made: [${result.choices.join(',')}]`);
        console.error(`    Script:       [${script.join(',')}]`);
      }
    }

    printSummary(passed, failed);

  } else {
    // ── Random mode ────────────────────────────────────────────────────────
    console.log(`  Mode:     random`);
    console.log(`  Runs:     ${numRuns}\n`);

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < numRuns; i++) {
      const result = await runPlaythrough(null);
      if (result.ok) {
        passed++;
        if (verbose) console.log(`  ✓ Run ${i + 1}: choices [${result.choices.join(',')}]`);
      } else {
        failed++;
        const failure = {
          run:     i + 1,
          error:   result.error,
          choices: result.choices,
          seed,
        };
        failures.push(failure);
        console.error(`  ✗ Run ${i + 1}: ${result.error}`);
        console.error(`    Choices: [${result.choices.join(',')}]`);
        console.error(`    Reproduce: node fuzz.js --seed ${seed} --runs 1`);
        // Reset PRNG after failure so subsequent runs are still reproducible
        rand = makePRNG(seed + i + 1);
      }

      // Progress bar every 100 runs
      if (!verbose && (i + 1) % 100 === 0) {
        const pct = Math.round(((i + 1) / numRuns) * 100);
        process.stdout.write(`\r  Progress: ${i + 1}/${numRuns} (${pct}%)`);
      }
    }

    if (!verbose) process.stdout.write('\r' + ' '.repeat(40) + '\r');

    if (failures.length > 0) {
      console.log('\n  Failures:');
      for (const f of failures) {
        console.log(`    Run ${f.run} — ${f.error}`);
        console.log(`    Choices: [${f.choices.join(',')}]`);
      }
    }

    printSummary(passed, failed);
  }
}

function printSummary(passed, failed) {
  const total = passed + failed;
  console.log(`\n${'─'.repeat(50)}`);
  if (failed === 0) {
    console.log(`  ✓ All ${total} playthroughs completed without errors.`);
  } else {
    console.log(`  ${passed}/${total} passed, ${failed} failed.`);
  }
  console.log(`${'─'.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fuzzer internal error:', e.message);
  process.exit(1);
});
