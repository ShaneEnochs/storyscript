#!/usr/bin/env node
'use strict';
/**
 * StoryScript build.js — Phase 3 CLI
 *
 * Reads a storyscript.json project file (or the current directory)
 * and produces a single-file HTML player.
 *
 * Usage:
 *   node build.js [--project path/to/storyscript.json] [--out story.html] [--minify]
 *
 * Options:
 *   --project   Path to storyscript.json (default: ./storyscript.json)
 *   --out       Output HTML filename   (default: <project_title>.html)
 *   --minify    Minify JS/HTML output  (basic whitespace collapse)
 *
 * The output file is a completely standalone HTML — no server required.
 * It includes the StoryScript engine, all story files, and the player UI.
 */

const fs   = require('fs');
const path = require('path');

// ─── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}
const minify     = args.includes('--minify');
const projectArg = getArg('--project') ?? './storyscript.json';
const outArg     = getArg('--out');

// ─── Load project ─────────────────────────────────────────────────────────────
const projectPath = path.resolve(projectArg);
if (!fs.existsSync(projectPath)) {
  console.error(`[build] Project file not found: ${projectPath}`);
  process.exit(1);
}

let project;
try {
  project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
} catch(e) {
  console.error(`[build] Failed to parse project file: ${e.message}`);
  process.exit(1);
}

const projectDir  = path.dirname(projectPath);
const startScene  = project.startScene  ?? 'startup.txt';
const title       = project.title       ?? 'Story';
const loopCap     = project.config?.loopCap ?? 100000;
const undoDepth   = project.config?.undoStackDepth ?? 50;

// ─── Collect files ────────────────────────────────────────────────────────────
// project.files may already contain content (exported JSON bundle format)
// or we may need to read them from disk relative to project dir.
const files = {};

if (project.files && Object.keys(project.files).length > 0) {
  // Inline files (exported JSON format)
  Object.assign(files, project.files);
  console.log(`[build] Using ${Object.keys(files).length} inline file(s) from project bundle.`);
} else {
  // Read from disk — look for all .txt files in the project dir
  const txtFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.txt'));
  for (const fname of txtFiles) {
    files[fname] = fs.readFileSync(path.join(projectDir, fname), 'utf8');
  }
  console.log(`[build] Read ${txtFiles.length} .txt file(s) from ${projectDir}`);
}

if (!files[startScene]) {
  console.error(`[build] Start scene not found: ${startScene}`);
  process.exit(1);
}

// ─── Load bundle ──────────────────────────────────────────────────────────────
// Try adjacent storyscript-bundle-p3.js first, then fallback to compiled src/
const bundleCandidates = [
  path.resolve(__dirname, 'storyscript-bundle-p3.js'),
  path.resolve(__dirname, 'storyscript-bundle.js'),
];
let bundleSrc = null;
for (const c of bundleCandidates) {
  if (fs.existsSync(c)) {
    bundleSrc = fs.readFileSync(c, 'utf8');
    console.log(`[build] Using bundle: ${path.basename(c)} (${bundleSrc.length} bytes)`);
    break;
  }
}
if (!bundleSrc) {
  console.error('[build] No engine bundle found. Run node make_bundle.js first.');
  process.exit(1);
}

// ─── Compile validation ────────────────────────────────────────────────────────
// Validate startup compiles correctly before generating output.
// This requires the bundle to run in Node (it uses window.SS pattern).
try {
  const testGlobal = { SS: {} };
  const fn = new Function('global', bundleSrc.replace(/window\./g, 'global.'));
  fn(testGlobal);
  const { compileFull } = testGlobal.SS;
  const result = compileFull(files[startScene], startScene, { startupFile: startScene, loopCap });
  if (result.errors.length > 0) {
    console.error('[build] Compile errors in', startScene + ':');
    for (const e of result.errors) console.error('  ' + e.toString());
    process.exit(1);
  }
  if (result.warnings.length > 0) {
    console.warn('[build] Warnings:');
    for (const w of result.warnings) console.warn('  ' + w.toString());
  }
  console.log(`[build] Compiled OK — ${result.program.length} instructions.`);
} catch(e) {
  console.warn(`[build] Validation skipped (bundle env issue): ${e.message}`);
}

// ─── Build output HTML ────────────────────────────────────────────────────────
const filesJson   = JSON.stringify(files);
const startJson   = JSON.stringify(startScene);

const playerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>
:root { --bg:#f0e6cc; --text:#1c1a14; --choice-bg:#e8dab8; --choice-border:#8a7145; --accent:#5c3d0e; }
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Georgia,serif; background:var(--bg); color:var(--text); min-height:100vh; }
#storyscript-root { max-width:640px; margin:0 auto; padding:40px 24px 80px; }
.ss-text  { margin:.6em 0; font-size:16px; line-height:1.8; }
.ss-blank { height:.8em; }
.ss-divider { text-align:center; margin:1.8em 0; color:var(--accent); opacity:.45; }
.ss-divider::before { content:"\u2726   \u2726   \u2726"; letter-spacing:.4em; }
.ss-choices { margin-top:1.8em; display:flex; flex-direction:column; gap:8px; }
.ss-choice-btn { background:var(--choice-bg); border:1px solid var(--choice-border); color:var(--text);
  padding:11px 18px; border-radius:4px; cursor:pointer; font-family:inherit; font-size:15px; text-align:left;
  transition:background 0.15s, color 0.15s; }
.ss-choice-btn:hover:not(:disabled) { background:var(--accent); color:#fff; border-color:var(--accent); }
.ss-choice-btn:disabled { opacity:.3; cursor:not-allowed; }
.ss-undo-btn { background:transparent; border:1px solid var(--choice-border); color:var(--accent);
  padding:7px 14px; border-radius:4px; cursor:pointer; font-family:inherit; font-size:13px; margin-top:10px; }
.ss-finish { font-style:italic; text-align:center; margin-top:2.5em; opacity:.55; font-size:15px; }
.ss-error { color:#a00; background:#fee; padding:14px; border-radius:4px; margin:10px 0; font-family:monospace; font-size:13px; border:1px solid #f5c5c5; }
.ss-input-wrap { margin:1.8em 0; }
.ss-input-label { font-size:14px; margin-bottom:8px; opacity:.8; }
.ss-input-field { width:100%; padding:10px 14px; font-family:inherit; font-size:15px;
  background:var(--choice-bg); border:1px solid var(--choice-border); color:var(--text);
  border-radius:4px; outline:none; }
.ss-input-field:focus { border-color:var(--accent); }
.ss-input-submit { margin-top:8px; padding:9px 20px; background:var(--accent); color:#fff;
  border:none; border-radius:4px; cursor:pointer; font-family:inherit; font-size:14px; }
.ss-input-submit:hover { opacity:.85; }
.ss-skills { margin:1.2em 0; border:1px solid var(--choice-border); border-radius:4px;
             background:var(--choice-bg); padding:12px 16px; }
.ss-skill-row { display:flex; align-items:center; gap:10px; margin:5px 0; font-size:14px; }
.ss-skill-label { min-width:100px; }
.ss-skill-bar { flex:1; height:8px; background:rgba(0,0,0,0.12); border-radius:4px; overflow:hidden; }
.ss-skill-fill { height:100%; background:var(--accent); border-radius:4px; transition:width .4s; }
.ss-skill-val { min-width:32px; text-align:right; font-size:12px; opacity:.65; }
.ss-achievements { margin:1.2em 0; }
.ss-ach-row { display:flex; align-items:center; gap:10px; margin:4px 0; font-size:14px;
              padding:8px 12px; background:var(--choice-bg); border-radius:4px; }
.ss-ach-icon { font-size:18px; }
.ss-ach-title { font-weight:600; }
.ss-ach-desc { font-size:12px; opacity:.65; }
.ss-toast { position:fixed; bottom:24px; right:24px; background:var(--accent); color:#fff;
            padding:10px 18px; border-radius:8px; font-size:14px; font-family:inherit;
            box-shadow:0 4px 16px rgba(0,0,0,.2); animation:toastIn .3s ease; z-index:9999; }
@keyframes toastIn { from{transform:translateY(24px);opacity:0} to{transform:translateY(0);opacity:1} }
#storyscript-ui { margin-top:1.2em; }
</style>
</head>
<body>
<div id="storyscript-root">
  <div id="storyscript-page"></div>
  <div id="storyscript-ui"></div>
</div>
<script>
${bundleSrc}
var _files = ${filesJson};
var _start = ${startJson};
(function() {
  var renderer = new SS.DOMRenderer('storyscript-root');

  renderer.renderInput = function(type, prompt, onSubmit) {
    var wrap = document.createElement('div'); wrap.className = 'ss-input-wrap';
    var lbl = document.createElement('div'); lbl.className = 'ss-input-label'; lbl.textContent = prompt;
    var field = document.createElement('input');
    field.type = (type === 'number') ? 'number' : 'text'; field.className = 'ss-input-field';
    var btn = document.createElement('button'); btn.className = 'ss-input-submit'; btn.textContent = 'Continue \u2192';
    var submit = function() {
      var v = field.value.trim(); if (!v) return; wrap.remove(); onSubmit(v);
    };
    btn.addEventListener('click', submit);
    field.addEventListener('keydown', function(e){ if(e.key==='Enter') submit(); });
    wrap.appendChild(lbl); wrap.appendChild(field); wrap.appendChild(btn);
    this.ui.appendChild(wrap);
    setTimeout(function(){ field.focus(); }, 50);
  };

  renderer.renderSkills = function(skills) {
    var div = document.createElement('div'); div.className = 'ss-skills';
    for (var id in skills) {
      var sk = skills[id];
      var row = document.createElement('div'); row.className = 'ss-skill-row';
      var pct = ((sk.value - sk.min) / (sk.max - sk.min) * 100).toFixed(1);
      row.innerHTML = '<span class="ss-skill-label">' + (sk.label||id) + '</span>' +
        '<div class="ss-skill-bar"><div class="ss-skill-fill" style="width:'+pct+'%"></div></div>' +
        '<span class="ss-skill-val">' + sk.value + '</span>';
      div.appendChild(row);
    }
    this.page.appendChild(div);
  };

  renderer.renderAchievementUnlock = function(id, schema) {
    var toast = document.createElement('div'); toast.className = 'ss-toast';
    toast.innerHTML = (schema.icon||'\ud83c\udfc5') + ' Achievement: <strong>' + (schema.title||id) + '</strong>';
    document.body.appendChild(toast);
    setTimeout(function(){ toast.remove(); }, 3500);
  };

  renderer.renderAchievements = function(list) {
    var div = document.createElement('div'); div.className = 'ss-achievements';
    for (var i=0;i<list.length;i++) {
      var a=list[i]; var row=document.createElement('div'); row.className='ss-ach-row';
      row.innerHTML='<span class="ss-ach-icon">'+(a.icon||'\ud83c\udfc5')+'</span>'+
        '<div><div class="ss-ach-title">'+(a.title||a.id)+'</div>'+
        '<div class="ss-ach-desc">'+(a.desc||'')+'</div></div>';
      div.appendChild(row);
    }
    this.page.appendChild(div);
  };

  var engine = new SS.Engine(renderer, function(name) {
    return Promise.resolve(_files[name] || _files[name+'.txt'] || '');
  }, { startupFile: _start, loopCap: ${loopCap}, undoStackDepth: ${undoDepth} });
  engine.start(false);

  // Auto-scroll to new content after each choice
  var page = document.getElementById('storyscript-page');
  var observer = new MutationObserver(function() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
  observer.observe(page, { childList: true });
})();
<\/script>
</body>
</html>`;

// ─── Write output ──────────────────────────────────────────────────────────────
const outFile = outArg ?? (title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html');
fs.writeFileSync(outFile, playerHTML);
const kb = Math.round(fs.statSync(outFile).size / 1024);
console.log(`[build] Written: ${outFile} (${kb} KB)`);
console.log(`[build] Open ${outFile} in any browser to play — no server needed.`);

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
