'use strict';
/**
 * Phase 3 bundle builder — reads from src/, produces storyscript-bundle-p3.js
 */
const fs = require('fs');
const path = require('path');

function convertModule(name, src, exportNames) {
  let s = src;
  s = s.replace(/^'use strict';\n?/gm, '');
  // Handle require('./modulename')
  s = s.replace(/const\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/([^'"]+)['"]\)\s*;/g, (m, imports, modPath) => {
    const mod = modPath.replace(/\//g, '_');
    const names = imports.split(',').map(n => n.trim()).filter(Boolean);
    return `const {${names.join(',')}} = SS._${mod};`;
  });
  // Remove module.exports block (multi-line)
  s = s.replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/m, '');
  // Remove browser check for module
  s = s.replace(/\nif\s*\(typeof module[^}]+\}\s*$/m, '');

  const exports = exportNames.join(', ');
  return `// ─── ${name} ${'─'.repeat(Math.max(0, 55 - name.length))}\nSS._${name} = (function() {\n${s.trim()}\nreturn { ${exports} };\n})();\n`;
}

const srcDir = path.join(__dirname, 'dist');
const mods = [
  ['lexer',     ['tokenize', 'LexerError']],
  ['evaluator', ['evaluate', 'substituteVars', 'EvalError', 'tokenizeExpr', 'TOKEN']],
  ['ir',        ['IR', 'SymbolTable', 'BYTECODE_VERSION']],
  ['state',     ['StoryState', 'SAVE_VERSION']],
  ['renderer',  ['DOMRenderer', 'NullRenderer']],
  ['emitter',   ['emit', 'OP', 'BYTECODE_VERSION', 'Emitter']],
  ['parser',    ['parse', 'ParseError', 'ParseWarning']],
  ['compiler',  ['compile', 'compileFull', 'Compiler', 'CompileError', 'DiagnosticError', 'DiagnosticWarning', 'OP', 'BYTECODE_VERSION']],
  ['engine',    ['Engine', 'RuntimeError']],
];

const bundle = mods.map(([name, exports]) => {
  const src = fs.readFileSync(path.join(srcDir, `${name}.js`), 'utf8');
  return convertModule(name, src, exports);
}).join('\n');

const publicExports = `
// ─── Public API ───────────────────────────────────────────────────────────────
SS.tokenize         = SS._lexer.tokenize;
SS.compileFull      = SS._compiler.compileFull;
SS.compile          = SS._compiler.compile;
SS.OP               = SS._compiler.OP;
SS.BYTECODE_VERSION = SS._compiler.BYTECODE_VERSION;
SS.IR               = SS._ir.IR;
SS.SymbolTable      = SS._ir.SymbolTable;
SS.Engine           = SS._engine.Engine;
SS.RuntimeError     = SS._engine.RuntimeError;
SS.StoryState       = SS._state.StoryState;
SS.DOMRenderer      = SS._renderer.DOMRenderer;
SS.NullRenderer     = SS._renderer.NullRenderer;
`;

const fullBundle = `(function(global) {
'use strict';
const SS = global.SS = global.SS || {};

${bundle}
${publicExports}
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));`;

// Validate via Node
const testGlobal = {};
try {
  const fn = new Function('global', fullBundle);
  fn(testGlobal);
  console.log('Bundle valid. Public exports:', Object.keys(testGlobal.SS).filter(k=>!k.startsWith('_')).join(', '));
} catch(e) {
  console.error('Bundle validation error:', e.message);
  process.exit(1);
}

fs.writeFileSync(path.join(__dirname, 'storyscript-bundle-p3.js'), fullBundle);
console.log('Written storyscript-bundle-p3.js (' + fullBundle.length + ' bytes)');

// Quick compile test
const {compileFull} = testGlobal.SS;
const testSrc = `*skill courage {"label":"Courage","value":50,"min":0,"max":100}
*item lantern {"name":"Brass Lantern","stackable":true,"qty":1}
*random roll 1 6
You rolled \${roll}.
*finish`;
const r = compileFull(testSrc, 'startup.txt', {startupFile:'startup.txt'});
if (r.errors.length > 0) {
  console.error('Compile test errors:', r.errors.map(e=>e.toString()));
} else {
  console.log('Compile test OK. Ops:', r.program.map(i=>i.op).join(', '));
}
