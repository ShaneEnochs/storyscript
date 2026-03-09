'use strict';

// ─── Project state ────────────────────────────────────────────────────────────
const DB_KEY = 'storyscript_ide_p3';
let project = {
  title: 'The Lantern Road',
  startScene: 'startup.txt',
  files: {},
  config: { loopCap: 100000, undoStackDepth: 50 }
};
let activeFile  = null;
let openTabs    = [];
let dirtyFiles  = new Set();
let compileTimer = null;

const STARTER_SOURCE = "*comment \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n*comment  THE LANTERN ROAD\n*comment  A short demo story for the StoryScript Engine.\n*comment \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n*create name \"traveller\"\n*create lanterns 3\n*create courage 50\n*create coin 10\n*create has_map false\n*create has_lantern true\n*list inventory [\"worn boots\", \"water flask\"]\n*object player {\"hp\": 100, \"maxhp\": 100}\n\n*theme {\"--bg\": \"#f0e6cc\", \"--text\": \"#1c1a14\", \"--choice-bg\": \"#e8dab8\", \"--choice-border\": \"#8a7145\", \"--accent\": \"#5c3d0e\"}\n\nYou wake on a cold road with no memory of how you arrived here.\n\nThe lanterns lining the path ahead flicker. Somewhere in the dark, something breathes.\n\nYou reach into your coat. You have ${lanterns} lanterns left.\n\n*page_break\n\n*choice\n\t#Call out into the dark\n\t\tYou cup your hands. \"Hello?\"\n\t\t\n\t\tThe breathing stops.\n\t\t\n\t\tThen \u2014 footsteps, slow and deliberate, approaching from the tree line.\n\t\t\n\t\tA figure resolves out of the fog: an old woman in a travelling cloak, a lantern swinging from one fist.\n\t\t\n\t\t\"I thought you were a ghost,\" she says. \"You look like one.\"\n\t\t\n\t\t*gosub meet_elder\n\t#Hold perfectly still\n\t\tYou press yourself against a stone wall and wait.\n\t\t\n\t\tThe breathing fades. Whatever was out there moves on.\n\t\t\n\t\tAfter a long minute, your heartbeat settles.\n\t\t\n\t\t*set courage courage + 5\n\t\t\n\t\tYou notice a folded paper on the ground nearby. A map, half-ruined by damp.\n\t\t\n\t\t*set has_map true\n\t\t*push inventory \"damp map\"\n\t\t\n\t\tYou study it as best you can. There is a village, two miles east.\n\t\t\n\t\t*goto road_to_village\n\t#Run\n\t\t*set courage courage - 15\n\t\t\n\t\tYou run blind, boots sliding on wet stone, until your lungs give out.\n\t\t\n\t\tWhen you stop, gasping, you are at a crossroads you do not recognise.\n\t\t\n\t\t*set lanterns lanterns - 1\n\t\t\n\t\tYou burned through a lantern in the panic. ${lanterns} remain.\n\t\t\n\t\t*goto crossroads\n\n*label meet_elder\n\nThe old woman \u2014 she gives her name as Maren \u2014 is matter-of-fact about everything.\n\n\"The road ahead is watched,\" she says. \"Toll-keepers. Not the official kind.\"\n\nShe studies you. \"You look like you've got nothing to lose. That's either brave or stupid.\"\n\n*page_break\n\n*choice\n\t#\"I have ${coin} coin. Is that enough to pass?\"\n\t\tMaren squints. \"For one person, and if you don't linger, maybe.\"\n\t\t\n\t\tShe takes one coin from you and tucks it away. \"Call it advice money.\"\n\t\t\n\t\t*set coin coin - 1\n\t\t\n\t\t\"The toll-keepers want three coin each. You've got enough \u2014 just barely. Don't spend it.\"\n\t\t\n\t\t*set courage courage + 10\n\t\t*goto road_to_village\n\t#\"I'll go around them.\"\n\t\t\"Through the Briar?\" Maren looks unimpressed. \"You'll lose an eye.\"\n\t\t\n\t\tShe sighs and reaches into her pack. \"Here. You'll want this.\"\n\t\t\n\t\tShe hands you a folded map.\n\t\t\n\t\t*set has_map true\n\t\t*push inventory \"Maren's map\"\n\t\t\n\t\t\"The Briar path adds two hours. But no toll-keepers.\"\n\t\t\n\t\t*goto briar_path\n\t#\"What's in it for you?\"\n\t\tMaren smiles. It does not reach her eyes.\n\t\t\n\t\t\"I like to see who makes it through. Consider me curious.\"\n\t\t\n\t\tShe gives you nothing further \u2014 but she does step aside and let you pass without trouble.\n\t\t\n\t\t*set courage courage %+ 20\n\t\t\n\t\t*goto road_to_village\n\n*label briar_path\n\nThe Briar is exactly as unpleasant as advertised.\n\n*gosub spend_lantern\n\nThorns drag at your coat. The path loops back on itself twice before straightening.\n\n*if has_map\n\tYour map \u2014 such as it is \u2014 keeps you oriented. You pick the correct fork without losing much time.\n*else\n\tWithout a map you guess at every fork. You guess wrong twice. You're tired and scratched when you finally emerge.\n\t*set courage courage - 10\n*endif\n\n*page_break\n\nYou come out on the far side of the Briar onto a moonlit road. Ahead: lights. A village.\n\n*goto village_gates\n\n*label road_to_village\n\nThe road is straight and flat and watched.\n\nTwo figures stand at a makeshift gate across the road. One holds a lantern. One holds a club.\n\n\"Three coin,\" says the one with the club. \"Each way. You look like a one-way kind of traveller, so three coin.\"\n\n*page_break\n\n*if coin >= 3\n\t*choice\n\t\t#Pay the toll\n\t\t\t*set coin coin - 3\n\t\t\t\n\t\t\tThe gate swings open. The one with the lantern nods, as if you've passed some kind of test.\n\t\t\t\n\t\t\t\"Smart,\" he says. \"Some people fight us. They don't reach the village.\"\n\t\t\t\n\t\t\t*goto village_gates\n\t\t#[if courage >= 60] Stare them down\n\t\t\tYou hold the toll-keeper's gaze for a long, cold moment.\n\t\t\t\n\t\t\tSomething in your expression gives him pause. He looks at his partner. His partner looks at the ground.\n\t\t\t\n\t\t\t\"...go on then,\" he mutters, and opens the gate.\n\t\t\t\n\t\t\t*set courage courage + 15\n\t\t\t\n\t\t\t*goto village_gates\n\t\t#Double back through the Briar\n\t\t\tYou weigh your coin. You weigh the dark.\n\t\t\t\n\t\t\tYou turn around.\n\t\t\t\n\t\t\t*goto briar_path\n*else\n\tYou don't have enough coin. The toll-keeper can see it on your face.\n\t\n\t\"Briar or back the way you came,\" he says. \"Your choice.\"\n\t\n\t*choice\n\t\t#Into the Briar\n\t\t\t*goto briar_path\n\t\t#Back the way you came\n\t\t\t*set courage courage - 10\n\t\t\t*goto crossroads\n*endif\n\n*label crossroads\n\nYou are at the crossroads. Three roads. No signage.\n\nYou have ${lanterns} lanterns. You have ${coin} coin.\n\n*if has_map\n\tYou check the map. East is the village. West leads back toward wherever you came from. North is unmarked.\n*else\n\tYou have no map. You guess.\n*endif\n\n*page_break\n\n*choice\n\t#Go east\n\t\t*goto road_to_village\n\t#Go north\n\t\t*set lanterns lanterns - 1\n\t\t\n\t\tThe north road climbs. The fog thickens. After an hour you find a ruined waystation.\n\t\t\n\t\tInside: a locked chest, a dead fire, and scratched into the wall: TURN BACK.\n\t\t\n\t\t*set courage courage - 5\n\t\t\n\t\t*if lanterns = 0\n\t\t\tYour last lantern goes out in a gust through the broken roof.\n\t\t\t\n\t\t\tYou sit in the dark for a very long time.\n\t\t\t\n\t\t\tEventually you turn back, feeling your way by touch.\n\t\t\t\n\t\t\t*set courage courage - 15\n\t\t*endif\n\t\t\n\t\t*goto crossroads\n\t#Go west\n\t\tThe west road is familiar in an unsettling way \u2014 as if you've walked it in a dream.\n\t\t\n\t\tYou walk for an hour and arrive back where you started.\n\t\t\n\t\tYou have learned nothing. You have ${coin} coin and ${lanterns} lanterns.\n\t\t\n\t\t*goto crossroads\n\n*label village_gates\n\n*theme {\"--bg\": \"#ede0c0\", \"--accent\": \"#3d6b3a\", \"--choice-border\": \"#5a8a56\"}\n\nThe village is real.\n\nWarm light leaks under doors. Smoke rises from chimneys. A dog barks once and goes quiet.\n\nYou count your inventory as you walk the main street.\n\n*temp item_count 0\n*for item in inventory\n\t*set item_count item_count + 1\n*endfor\n\nYou're carrying ${item_count} item(s):\n\n*for item in inventory\n\t\u2014 ${item}\n*endfor\n\n*page_break\n\nAn inn sits at the end of the street, its sign a painted lantern. Inside: firelight and voices.\n\n*choice\n\t#Go inside\n\t\tThe innkeeper is a broad-shouldered person with a grey braid and a look of professional welcome.\n\t\t\n\t\t\"Travelling alone?\" they ask. \"Road's been strange tonight. You're the third one through.\"\n\t\t\n\t\t*if coin >= 2\n\t\t\t*set coin coin - 2\n\t\t\t\"A room and a meal \u2014 two coin. You look like you need both.\"\n\t\t\t\n\t\t\tYou eat. You sleep. In the morning, the road looks possible again.\n\t\t\t\n\t\t\t*goto ending_rested\n\t\t*else\n\t\t\t\"A room's two coin,\" they say. \"Meal's included.\"\n\t\t\t\n\t\t\tYou show them your purse.\n\t\t\t\n\t\t\tThey look at it for a moment. \"Fireplace is free. I won't charge you for the chair.\"\n\t\t\t\n\t\t\t*goto ending_chair\n\t\t*endif\n\t#Keep walking\n\t\tYou don't know what you're looking for.\n\t\t\n\t\tBut the village falls behind you, and the road opens up, and for the first time tonight the sky is clear.\n\t\t\n\t\t*goto ending_road\n\n*label ending_rested\n\n*theme {\"--bg\": \"#e8eed8\", \"--accent\": \"#3a6632\", \"--choice-border\": \"#5a8a50\"}\n\nYou sleep without dreaming, which is the best kind of sleep.\n\nIn the morning you find a note slipped under your door. No signature. Just an address, three towns east, and one word: come.\n\nYour courage is ${courage}. Your coin is ${coin}.\n\nYou have survived the Lantern Road.\n\n*finish\n\n*label ending_chair\n\n*theme {\"--bg\": \"#e8eed8\", \"--accent\": \"#3a6632\", \"--choice-border\": \"#5a8a50\"}\n\nThe fire is warm enough. The chair is harder than a bed, but you've slept in worse.\n\nAt some point in the night the innkeeper drapes a blanket over you without waking you.\n\nYour courage is ${courage}. Your coin is ${coin}.\n\nYou have survived the Lantern Road.\n\n*finish\n\n*label ending_road\n\n*theme {\"--bg\": \"#f0e6cc\", \"--accent\": \"#5c3d0e\", \"--choice-border\": \"#8a7145\"}\n\nThe road goes on. The lanterns are running low. You don't stop.\n\nSomewhere behind you, the village light fades.\n\nSomewhere ahead, the sky begins to pale.\n\nYour courage is ${courage}. Your coin is ${coin}.\n\nYou have survived the Lantern Road.\n\n*finish\n\n*label spend_lantern\n*if lanterns > 0\n\t*set lanterns lanterns - 1\n*endif\n*return\n";

// ─── Inspector state ─────────────────────────────────────────────────────────
let inspectorVisible = true;
let inspectorVars    = new Map(); // name → {type, val}
let inspectorPrev    = new Map(); // name → val (to detect changes)

// ─── Storage (multi-project) ──────────────────────────────────────────────────
function saveToStorage() {
  // Alias: save current project (used by Cmd+S, auto-save, etc.)
  saveCurrentProject();
}

function loadFromStorage() {
  // Try to find the most recently saved project and load it
  try {
    const index = getProjIndex();
    if (index.length === 0) return false;
    // Load most recently saved
    index.sort((a,b) => b.saved - a.saved);
    return loadProjectById(index[0].id);
  } catch(e) {}

  // Legacy migration: check old single-project key
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && data.files) {
        data._id = genProjId();
        project = data;
        saveCurrentProject(); // migrate to new system
        localStorage.removeItem(DB_KEY); // clean up old key
        return true;
      }
    }
  } catch(e) {}

  return false;
}

// ─── File ops ─────────────────────────────────────────────────────────────────
function getFileContent(name) { return project.files[name] ?? ''; }
function setFileContent(name, content) {
  project.files[name] = content;
  dirtyFiles.add(name);
  saveToStorage();
}

function createFile(name, content) {
  content = content ?? '';
  if (!name.endsWith('.txt') && name !== 'storyscript.json') name += '.txt';
  project.files[name] = content;
  saveToStorage();
  renderFileList();
  openTab(name);
}

function deleteFile(name) {
  delete project.files[name];
  dirtyFiles.delete(name);
  openTabs = openTabs.filter(t => t !== name);
  if (activeFile === name) activeFile = openTabs[0] ?? Object.keys(project.files)[0] ?? null;
  saveToStorage();
  renderFileList();
  renderTabs();
  if (activeFile) loadFileIntoEditor(activeFile);
  else { /* CM6: editor cleared when no active file */ }
}

// ─── Editor setup ─────────────────────────────────────────────────────────────
// The fallback textarea is created here, immediately, so the editor works
// even before CM6 loads. CM6 will replace it asynchronously if available.

const editorArea = document.getElementById('editor-area');

// Create the fallback textarea right now
editorArea.innerHTML = '<textarea id="editor-textarea-fallback" spellcheck="false" style="position:absolute;inset:0;width:100%;height:100%;font-family:var(--font-mono);font-size:13px;background:var(--bg);color:var(--text);border:none;resize:none;padding:12px 16px;outline:none;tab-size:2;white-space:pre;overflow-wrap:normal;"></textarea>';
const _fallbackTA = document.getElementById('editor-textarea-fallback');

_fallbackTA.addEventListener('input', () => {
  if (!activeFile) return;
  project.files[activeFile] = _fallbackTA.value;
  dirtyFiles.add(activeFile);
  markTabDirty(activeFile, true);
  scheduleCompile();
});

_fallbackTA.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = _fallbackTA.selectionStart, end = _fallbackTA.selectionEnd;
    _fallbackTA.value = _fallbackTA.value.substring(0, s) + '\t' + _fallbackTA.value.substring(end);
    _fallbackTA.selectionStart = _fallbackTA.selectionEnd = s + 1;
    _fallbackTA.dispatchEvent(new Event('input'));
  }
});

// loadFileIntoEditor: var assignment so CM6 can replace it via window.loadFileIntoEditor
window.loadFileIntoEditor = function(name) {
  activeFile = name;
  _fallbackTA.value = getFileContent(name);
  renderTabs();
  renderFileList();
  scheduleCompile();
};

// Ctrl/Cmd+S: save current file (works globally)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
    e.preventDefault();
    saveToStorage();
    dirtyFiles.delete(activeFile);
    markTabDirty(activeFile, false);
    logConsole('ok', 'Saved ' + (activeFile || ''));
  }
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function openTab(name) {
  if (!openTabs.includes(name)) openTabs.push(name);
  loadFileIntoEditor(name);
  renderTabs();
}

function markTabDirty(name, dirty) {
  const el = document.querySelector('.tab[data-name="' + name + '"]');
  if (el) el.classList.toggle('dirty', dirty);
}

function renderTabs() {
  const c = document.getElementById('editor-tabs');
  c.innerHTML = '';
  for (const name of openTabs) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (name === activeFile ? ' active' : '') + (dirtyFiles.has(name) ? ' dirty' : '');
    tab.dataset.name = name;
    tab.innerHTML = '<span class="tab-dot"></span><span>' + escHtml(name) + '</span>';
    tab.addEventListener('click', () => openTab(name));
    c.appendChild(tab);
  }
}

// ─── File list ────────────────────────────────────────────────────────────────
function renderFileList() {
  const list = document.getElementById('file-list');
  list.innerHTML = '';
  const sorted = Object.keys(project.files).sort((a, b) => {
    if (a === project.startScene) return -1;
    if (b === project.startScene) return 1;
    return a.localeCompare(b);
  });
  for (const name of sorted) {
    const item = document.createElement('div');
    item.className = 'file-item' + (name === activeFile ? ' active' : '');
    const isStart = name === project.startScene;
    item.innerHTML =
      '<span class="file-icon">' + (isStart ? '&#9654;' : '&middot;') + '</span>' +
      '<span class="file-name" title="' + escHtml(name) + '">' + escHtml(name) + '</span>' +
      (!isStart ? '<button class="file-del" onclick="confirmDelete(\'' + name.replace(/'/g, "\\'") + '\')" title="Delete">&#215;</button>' : '');
    item.addEventListener('click', (e) => { if (!e.target.classList.contains('file-del')) openTab(name); });
    list.appendChild(item);
  }
}

function confirmDelete(name) {
  if (confirm('Delete "' + name + '"?')) deleteFile(name);
}

// ─── Compilation ──────────────────────────────────────────────────────────────
function scheduleCompile() {
  if (compileTimer) clearTimeout(compileTimer);
  compileTimer = setTimeout(() => window.runCompile(), 320);
}

function runCompile() {
  if (!activeFile) return;
  // Guard: SS may not be ready yet if engine fetch is still in flight
  if (!window.SS || !window.SS.compileFull) return;
  const source = getFileContent(activeFile);
  try {
    const result = SS.compileFull(source, activeFile, {
      loopCap:     project.config.loopCap,
      startupFile: project.startScene,
    });
    const errs = result.errors.length, warns = result.warnings.length;
    updateStatusBadge(errs, warns);
    updateConsole(result.errors, result.warnings);
    if (errs === 0) hotReloadPreview(result);
  } catch(e) {
    updateStatusBadge(1, 0);
    logConsole('err', 'Fatal compile error: ' + e.message);
  }
}

function updateStatusBadge(errs, warns) {
  const b = document.getElementById('status-badge');
  if (errs > 0)      { b.className = 'status-badge err';  b.textContent = 'ERR ' + errs + ' error' + (errs !== 1 ? 's' : ''); }
  else if (warns > 0){ b.className = 'status-badge warn'; b.textContent = 'WARN ' + warns + ' warning' + (warns !== 1 ? 's' : ''); }
  else               { b.className = 'status-badge ok';   b.textContent = 'OK'; }
}

function updateConsole(errors, warnings) {
  const out = document.getElementById('console-output');
  out.innerHTML = '';
  if (!errors.length && !warnings.length) {
    logLine(out, 'ok', activeFile + ' \u2014 compiled successfully (' + (new Date()).toLocaleTimeString() + ')');
    document.getElementById('console-count').textContent = '';
    return;
  }
  for (const e of errors)   logLine(out, 'err',  '[ERROR] ' + (e.file || activeFile) + ':' + (e.lineNum || 0) + ' \u2014 ' + e.message);
  for (const w of warnings) logLine(out, 'warn', '[WARN]  ' + (w.file || activeFile) + ':' + (w.lineNum || 0) + ' \u2014 ' + w.message);
  document.getElementById('console-count').textContent =
    errors.length + ' error' + (errors.length !== 1 ? 's' : '') + ', ' + warnings.length + ' warning' + (warnings.length !== 1 ? 's' : '');
}

function logLine(container, cls, msg) {
  const el = document.createElement('div');
  el.className = 'c-' + cls;
  el.textContent = msg;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}
function logConsole(cls, msg) { logLine(document.getElementById('console-output'), cls, msg); }
function clearConsole() {
  document.getElementById('console-output').innerHTML = '';
  document.getElementById('console-count').textContent = '';
}

// ─── Variable Inspector ───────────────────────────────────────────────────────
function toggleInspector() {
  inspectorVisible = !inspectorVisible;
  document.getElementById('inspector').style.display = inspectorVisible ? '' : 'none';
  document.getElementById('inspector-resize').style.display = inspectorVisible ? '' : 'none';
  document.getElementById('insp-toggle-btn').style.color = inspectorVisible ? 'var(--accent)' : '';
}

function renderInspector() {
  const body   = document.getElementById('inspector-body');
  const filter = (document.getElementById('insp-filter').value || '').toLowerCase();

  if (inspectorVars.size === 0) {
    body.innerHTML = '<div class="insp-empty">Run the preview to see variables</div>';
    return;
  }

  const entries = [...inspectorVars.entries()]
    .filter(([k]) => !filter || k.toLowerCase().includes(filter))
    .sort(([a],[b]) => a.localeCompare(b));

  if (entries.length === 0) {
    body.innerHTML = '<div class="insp-empty">No matches</div>';
    return;
  }

  body.innerHTML = '';
  for (const [name, {type, val}] of entries) {
    const row = document.createElement('div');
    const changed = inspectorPrev.has(name) && JSON.stringify(inspectorPrev.get(name)) !== JSON.stringify(val);
    row.className = 'insp-row' + (changed ? ' changed' : '');

    let valStr, valClass = '';
    if (typeof val === 'string')      { valStr = '"' + val + '"'; valClass = 'str'; }
    else if (typeof val === 'number') { valStr = String(val);     valClass = 'num'; }
    else if (typeof val === 'boolean'){ valStr = String(val);     valClass = 'bool'; }
    else if (Array.isArray(val))      { valStr = '[' + val.map(v=>JSON.stringify(v)).join(', ') + ']'; valClass = 'obj'; }
    else if (val !== null && typeof val === 'object') { valStr = JSON.stringify(val); valClass = 'obj'; }
    else                              { valStr = String(val); }

    const valEl = document.createElement('span');
    valEl.className = 'insp-val ' + valClass;
    valEl.title = String(valStr);
    valEl.textContent = valStr;

    // Double-click to live-edit (only for scalar types, not obj/array)
    const isEditable = (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean');
    if (isEditable) {
      valEl.title += ' — double-click to edit';
      valEl.style.cursor = 'pointer';
      valEl.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.className = 'insp-edit-input';
        input.value = typeof val === 'string' ? val : String(val);
        input.style.cssText = 'font-family:var(--font-mono);font-size:11px;width:80px;background:var(--bg);color:var(--text);border:1px solid var(--accent);border-radius:2px;padding:1px 3px;';
        valEl.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
          let newVal = input.value;
          // coerce type to match original
          if (typeof val === 'number') {
            newVal = isNaN(Number(newVal)) ? val : Number(newVal);
          } else if (typeof val === 'boolean') {
            newVal = newVal === 'true' ? true : newVal === 'false' ? false : val;
          }
          // Send setVar message to preview iframe
          const frame = document.getElementById('preview-frame');
          if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: 'ss:setVar', name, value: newVal }, '*');
          }
          renderInspector();
        };
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
          if (ev.key === 'Escape') { renderInspector(); }
        });
        input.addEventListener('blur', commit);
      });
    }

    row.innerHTML =
      '<span class="insp-name">' + escHtml(name) + '</span>' +
      '<span class="insp-type">' + escHtml(type) + '</span>';
    row.appendChild(valEl);
    body.appendChild(row);
  }
}

function updateInspectorFromState(stateData) {
  inspectorPrev = new Map(inspectorVars);
  inspectorVars.clear();

  if (stateData.globals) {
    for (const [k, v] of stateData.globals) {
      const type = Array.isArray(v) ? 'list' : (v !== null && typeof v === 'object') ? 'obj' : typeof v;
      inspectorVars.set(k, { type, val: v });
    }
  }
  if (stateData.temps) {
    for (const [k, v] of stateData.temps) {
      const type = Array.isArray(v) ? 'list' : (v !== null && typeof v === 'object') ? 'obj' : typeof v;
      inspectorVars.set('~' + k, { type: 'temp', val: v });
    }
  }
  renderInspector();
}

// Inspector resize drag
(function() {
  const resize = document.getElementById('inspector-resize');
  const insp   = document.getElementById('inspector');
  let dragging = false, startY, startH;
  resize.addEventListener('mousedown', (e) => {
    dragging = true; startY = e.clientY; startH = insp.offsetHeight;
    document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY;
    insp.style.height = Math.max(80, Math.min(500, startH + delta)) + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
})();

// ─── Preview ──────────────────────────────────────────────────────────────────
let prevStructure = null;

function getBundleSource() {
  // Vite build: engine was fetched by main.js and cached on window._SS_ENGINE_SRC
  return window._SS_ENGINE_SRC || '';
}

function buildPreviewHTML() {
  const filesJson  = JSON.stringify(project.files);
  const startScene = JSON.stringify(project.startScene);
  const storyTitle = JSON.stringify(project.title || 'Story');
  const loopCap    = project.config.loopCap;
  const bundleSrc  = getBundleSource();

  // Parchment palette — light warm cream, WCAG AA compliant for body text
  // --bg          #F8F3E8  very light warm cream (lighter than old #f0e6cc)
  // --text        #2C2416  near-black warm brown  (contrast ratio ~11:1 on bg)
  // --choice-bg   #EDE5D0  slightly deeper cream for cards/buttons
  // --choice-border #9B8560 muted warm tan for borders
  // --accent      #5C3D0E  dark warm brown for links, headings, bars

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>` + (project.title || 'Story') + `</title>
<style>
/* ── Design tokens — topbar is FIXED; story root may override its own vars ── */
:root {
  --bg:            #F8F3E8;
  --text:          #2C2416;
  --choice-bg:     #EDE5D0;
  --choice-border: #9B8560;
  --accent:        #5C3D0E;
  --bar-track:     rgba(0,0,0,0.10);
  --shadow:        rgba(92,61,14,0.12);
}
* { box-sizing:border-box; margin:0; padding:0; }

/* ── Body — always uses root vars (topbar immune to *theme changes) ── */
body {
  font-family: Georgia, 'Times New Roman', serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

/* ── Sticky top bar — pinned to root vars, never changes with *theme ── */
#ss-topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 200;
  background: rgba(248,243,232,0.96);
  border-bottom: 1px solid #9B8560;
  backdrop-filter: blur(6px);
  display: flex; align-items: center;
  padding: 0 20px; height: 46px; gap: 8px;
}
#ss-topbar-title {
  flex: 1; font-size: 14px; font-weight: 700; letter-spacing: 0.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #5C3D0E;
}
.ss-topbar-btn {
  background: transparent;
  border: 1px solid #9B8560;
  color: #2C2416;
  padding: 5px 12px; border-radius: 4px; cursor: pointer;
  font-family: Georgia, serif; font-size: 12px;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}
.ss-topbar-btn:hover { background: #EDE5D0; border-color: #5C3D0E; }

/* ── Story root — vars here are the ones *theme overrides ── */
#storyscript-root {
  --bg:            #F8F3E8;
  --text:          #2C2416;
  --choice-bg:     #EDE5D0;
  --choice-border: #9B8560;
  --accent:        #5C3D0E;
  max-width: 640px; margin: 0 auto;
  padding: 70px 28px 80px;
  /* Inherit overridden vars for background */
  background: var(--bg);
  min-height: 100vh;
  transition: background 0.6s ease, color 0.4s ease;
}

/* ── Prose ── */
.ss-text  { margin: 0.6em 0; font-size: 16px; line-height: 1.8; color: var(--text); }
.ss-blank { height: 0.8em; }
.ss-divider {
  text-align: center; margin: 2em 0;
  color: var(--accent); opacity: 0.45;
  font-size: 14px; letter-spacing: 0.5em;
}
.ss-divider::before { content: "* * *"; }

/* ── Choices ── */
.ss-choices { margin-top: 1.6em; display: flex; flex-direction: column; gap: 10px; }
.ss-choice-btn {
  background: var(--choice-bg);
  border: 1px solid var(--choice-border);
  color: var(--text);
  padding: 11px 18px; border-radius: 5px;
  cursor: pointer; font-family: inherit; font-size: 15px;
  text-align: left; line-height: 1.5;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.ss-choice-btn:hover:not(:disabled) {
  background: var(--accent); color: #FFF8EE; border-color: var(--accent);
}
.ss-choice-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── Back/undo ── */
.ss-undo-btn {
  background: transparent; border: 1px solid var(--choice-border);
  color: var(--accent); padding: 6px 14px; border-radius: 4px;
  cursor: pointer; font-family: inherit; font-size: 12px; margin-top: 10px;
}
.ss-undo-btn:hover { background: var(--choice-bg); }

/* ── Finish ── */
.ss-finish {
  font-style: italic; text-align: center;
  margin-top: 2.5em; opacity: 0.55; font-size: 15px;
  color: var(--text);
}

/* ── Error ── */
.ss-error {
  color: #8B0000; background: #FDE8E8; padding: 12px;
  border-radius: 4px; margin: 10px 0;
  font-family: monospace; font-size: 12px;
  border: 1px solid #F5C6C6;
}

/* ── Input ── */
.ss-input-wrap { margin: 1.6em 0; }
.ss-input-label { font-size: 13px; color: var(--text); margin-bottom: 6px; opacity: 0.75; }
.ss-input-field {
  width: 100%; padding: 9px 13px; font-family: inherit; font-size: 15px;
  background: var(--choice-bg); border: 1px solid var(--choice-border);
  color: var(--text); border-radius: 4px; outline: none;
}
.ss-input-field:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(92,61,14,0.12); }
.ss-input-submit {
  margin-top: 9px; padding: 9px 20px;
  background: var(--accent); color: #FFF8EE;
  border: none; border-radius: 4px; cursor: pointer;
  font-family: inherit; font-size: 14px;
}
.ss-input-submit:hover { opacity: 0.88; }

/* ── Skills display ── */
.ss-skills {
  margin: 1em 0; border: 1px solid var(--choice-border); border-radius: 5px;
  background: var(--choice-bg); padding: 12px 16px;
}
.ss-skill-row { display: flex; align-items: center; gap: 10px; margin: 5px 0; font-size: 14px; }
.ss-skill-label { min-width: 100px; color: var(--text); }
.ss-skill-bar { flex: 1; height: 8px; background: var(--bar-track); border-radius: 4px; overflow: hidden; }
.ss-skill-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s; }
.ss-skill-val { min-width: 32px; text-align: right; font-size: 12px; opacity: 0.65; color: var(--text); }

/* ── Achievements ── */
.ss-achievements { margin: 1em 0; }
.ss-ach-row {
  display: flex; align-items: center; gap: 10px; margin: 4px 0;
  font-size: 14px; padding: 7px 12px;
  background: var(--choice-bg); border-radius: 5px; color: var(--text);
}
.ss-ach-icon { font-size: 16px; }
.ss-ach-title { font-weight: 700; }
.ss-ach-desc { font-size: 12px; opacity: 0.65; }

/* ── Skill Check Card ── */
.ss-check-card {
  display: flex; align-items: center; gap: 10px;
  margin: 1.2em 0; padding: 11px 16px; border-radius: 6px;
  font-size: 13px; font-family: Georgia, serif;
  border-left: 4px solid;
}
.ss-check-success {
  background: rgba(60,120,60,0.10); border-color: #4a8a4a; color: var(--text);
}
.ss-check-failure {
  background: rgba(140,50,50,0.10); border-color: #8a4a4a; color: var(--text);
}
.ss-check-icon { font-size: 16px; flex-shrink: 0; }
.ss-check-success .ss-check-icon { color: #3a7a3a; }
.ss-check-failure .ss-check-icon { color: #7a3a3a; }
.ss-check-label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0; }
.ss-check-detail { opacity: 0.7; font-size: 12px; }

/* ── Toast ── */
.ss-toast {
  position: fixed; bottom: 28px; right: 28px;
  background: var(--accent); color: #FFF8EE;
  padding: 11px 18px; border-radius: 8px;
  font-size: 13px; font-family: Georgia, serif;
  box-shadow: 0 6px 18px var(--shadow);
  animation: toastIn 0.3s ease; z-index: 400;
}
@keyframes toastIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* ── Phase 6e: Dialogue ── */
.ss-dialogue {
  border-left: 3px solid var(--npc-color, #888);
  padding-left: 14px;
  margin: 10px 0 10px 0;
}
.ss-dialogue-speaker {
  font-weight: bold;
  font-size: 0.88em;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 3px;
  color: var(--npc-color, #888);
  opacity: 0.85;
}
.ss-dialogue-mood {
  font-style: italic;
  font-size: 0.85em;
  font-weight: normal;
  opacity: 0.7;
  text-transform: none;
  letter-spacing: 0;
}

/* ── Phase 6f: Clue discovery toast ── */
.ss-discover-toast {
  display: flex; align-items: center; gap: 8px;
  background: #faf6ec; border: 1px solid #bda96e;
  border-radius: 8px; padding: 9px 15px;
  font-size: 13px; font-family: Georgia, serif;
  box-shadow: 0 4px 12px rgba(44,36,22,0.12);
  animation: toastIn 0.3s ease;
  margin: 10px 0;
  opacity: 1; transition: opacity 0.6s ease;
}
.ss-discover-toast.ss-discover-toast-hide { opacity: 0; }
.ss-discover-icon { font-size: 1.1em; }

/* ── Phase 6g: Transitions ── */
.ss-transition-out-fade { opacity: 0; transition: opacity var(--t-dur, 0.5s) ease; }
@keyframes ss-fadein { from { opacity: 0; } to { opacity: 1; } }
.ss-transition-in-fade { animation: ss-fadein var(--t-dur, 0.5s) ease forwards; }

.ss-transition-out-slideLeft { transform: translateX(-100%); transition: transform var(--t-dur, 0.5s) ease; }
@keyframes ss-slideinright { from { transform: translateX(100%); } to { transform: translateX(0); } }
.ss-transition-in-slideLeft { animation: ss-slideinright var(--t-dur, 0.5s) ease forwards; }

.ss-transition-out-slideRight { transform: translateX(100%); transition: transform var(--t-dur, 0.5s) ease; }
@keyframes ss-slideinleft { from { transform: translateX(-100%); } to { transform: translateX(0); } }
.ss-transition-in-slideRight { animation: ss-slideinleft var(--t-dur, 0.5s) ease forwards; }

.ss-transition-out-dissolve { opacity: 0; filter: blur(4px); transition: opacity var(--t-dur, 0.5s) ease, filter var(--t-dur, 0.5s) ease; }
@keyframes ss-dissolvein { from { opacity: 0; filter: blur(4px); } to { opacity: 1; filter: blur(0); } }
.ss-transition-in-dissolve { animation: ss-dissolvein var(--t-dur, 0.5s) ease forwards; }

#storyscript-ui { margin-top: 1em; }

/* ── Overlay ── */
#ss-overlay {
  display: none; position: fixed; inset: 0; z-index: 300;
  background: rgba(44,36,22,0.40);
  align-items: flex-start; justify-content: center;
  padding-top: 66px;
}
#ss-overlay.open { display: flex; }
#ss-overlay-panel {
  background: #F8F3E8;
  border: 1px solid #9B8560;
  border-radius: 10px;
  padding: 24px 28px;
  width: 400px; max-width: 92vw; max-height: 72vh;
  overflow-y: auto;
  box-shadow: 0 12px 32px rgba(44,36,22,0.18);
}

/* ── Overlay header ── */
.ss-overlay-hdr {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 18px;
  padding-bottom: 10px;
  border-bottom: 1px solid #9B8560;
}
.ss-overlay-hdr h2 {
  font-size: 17px; font-weight: 700; color: #5C3D0E; margin: 0;
}
.ss-overlay-close {
  background: none; border: none; cursor: pointer;
  font-size: 20px; line-height: 1; padding: 2px 6px;
  color: #9B8560; border-radius: 4px;
  transition: background 0.12s, color 0.12s;
}
.ss-overlay-close:hover { background: #EDE5D0; color: #5C3D0E; }

/* ── Stat rows ── */
.ss-stat-row {
  display: flex; align-items: center; gap: 10px;
  margin: 8px 0; font-size: 14px; color: #2C2416;
}
.ss-stat-label { min-width: 110px; font-weight: 600; color: #5C3D0E; }
.ss-stat-val { flex: 1; color: #2C2416; }
.ss-stat-bar-wrap { flex: 1; height: 7px; background: rgba(0,0,0,0.10); border-radius: 4px; overflow: hidden; }
.ss-stat-bar { height: 100%; background: #5C3D0E; border-radius: 4px; }
.ss-bool-yes { background: #C8E6C9; color: #1B5E20; border-radius: 3px; padding: 1px 7px; font-size: 12px; font-weight: 600; }
.ss-bool-no  { background: #FFCCBC; color: #BF360C; border-radius: 3px; padding: 1px 7px; font-size: 12px; font-weight: 600; }
.ss-overlay-empty { color: #9B8560; font-style: italic; font-size: 14px; margin: 12px 0; }

/* ── Menu button inside overlay ── */
.ss-menu-btn {
  display: block; width: 100%; margin: 8px 0; padding: 11px 16px;
  background: #EDE5D0; border: 1px solid #9B8560; border-radius: 5px;
  font-family: Georgia, serif; font-size: 15px; color: #2C2416;
  cursor: pointer; text-align: left;
  transition: background 0.12s, border-color 0.12s;
}
.ss-menu-btn:hover { background: #5C3D0E; color: #FFF8EE; border-color: #5C3D0E; }

/* ── Phase 6f: Journal CSS ── */
.ss-journal-cat {
  font-size: 11px; font-weight: bold; letter-spacing: 0.08em;
  text-transform: uppercase; color: #8a7145; margin: 14px 0 6px 0;
  border-bottom: 1px solid #e0d4b0; padding-bottom: 4px;
}
.ss-journal-entry {
  background: #faf6ec; border: 1px solid #ddd0a8; border-radius: 5px;
  padding: 10px 13px; margin: 6px 0;
}
.ss-journal-resolved { opacity: 0.6; }
.ss-journal-title { font-weight: bold; font-size: 14px; margin-bottom: 4px; }
.ss-journal-text { font-size: 13px; line-height: 1.6; color: #4a3f2f; }
</style>
</head>
<body>

<!-- Sticky top bar — uses hardcoded colors, immune to *theme -->
<div id="ss-topbar">
  <div id="ss-topbar-title">` + (project.title || 'Story') + `</div>
  <button class="ss-topbar-btn" onclick="ssOpenOverlay('stats')">Stats</button>
  <button class="ss-topbar-btn" onclick="ssOpenOverlay('inventory')">Inventory</button>
  <button class="ss-topbar-btn" onclick="ssOpenOverlay('achievements')">Achievements</button>
  <button class="ss-topbar-btn" onclick="ssOpenOverlay('journal')">Journal</button>
  <button class="ss-topbar-btn" onclick="ssOpenOverlay('menu')">Menu</button>
</div>

<!-- Overlay — close by clicking backdrop OR X button -->
<div id="ss-overlay" onclick="if(event.target===this)ssCloseOverlay()">
  <div id="ss-overlay-panel">
    <div id="ss-overlay-content"></div>
  </div>
</div>

<div id="storyscript-root">
  <div id="storyscript-page"></div>
  <div id="storyscript-ui"></div>
</div>

<script>
` + bundleSrc + `
var _files = ` + filesJson + `;
var _start = ` + startScene + `;
var _title = ` + storyTitle + `;
var _engine = null;

(function() {
  var renderer = new SS.DOMRenderer('storyscript-root');

  renderer.renderInput = function(type, prompt, onSubmit) {
    var wrap  = document.createElement('div'); wrap.className = 'ss-input-wrap';
    var lbl   = document.createElement('div'); lbl.className  = 'ss-input-label';
    lbl.textContent = prompt;
    var field = document.createElement('input');
    field.type      = (type === 'number') ? 'number' : 'text';
    field.className = 'ss-input-field';
    var btn   = document.createElement('button'); btn.className = 'ss-input-submit';
    btn.textContent = 'Continue ->';
    var submit = function() {
      var v = field.value.trim(); if (!v) return;
      wrap.remove(); onSubmit(v);
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
      var range = Math.max(1, sk.max - sk.min);
      var pct = Math.max(0, Math.min(100, (sk.value - sk.min) / range * 100)).toFixed(1);
      row.innerHTML = '<span class="ss-skill-label">' + escH(sk.label||id) + '</span>' +
        '<div class="ss-skill-bar"><div class="ss-skill-fill" style="width:'+pct+'%"></div></div>' +
        '<span class="ss-skill-val">' + sk.value + '</span>';
      div.appendChild(row);
    }
    this.page.appendChild(div);
  };

  renderer.renderAchievementUnlock = function(id, schema) {
    var toast = document.createElement('div'); toast.className = 'ss-toast';
    toast.textContent = 'Achievement: ' + (schema.title || id);
    document.body.appendChild(toast);
    setTimeout(function(){ toast.remove(); }, 3500);
  };

  renderer.renderAchievements = function(list) {
    var div = document.createElement('div'); div.className = 'ss-achievements';
    for (var i=0; i<list.length; i++) {
      var a = list[i];
      var row = document.createElement('div'); row.className = 'ss-ach-row';
      row.innerHTML = '<div><div class="ss-ach-title">' + escH(a.schema && a.schema.title ? a.schema.title : a.id) + '</div>' +
        (a.unlocked && a.schema && a.schema.desc ? '<div class="ss-ach-desc">' + escH(a.schema.desc) + '</div>' : '') + '</div>';
      div.appendChild(row);
    }
    this.page.appendChild(div);
  };

  function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  var engine = new SS.Engine(renderer, function(name) {
    return Promise.resolve(_files[name] || _files[name+'.txt'] || '');
  }, { startupFile: _start, loopCap: ` + loopCap + `, undoStackDepth: 50, allowSave: false, previewMode: true });

  _engine = engine;
  engine.start(false);

  // Event-driven state push after every engine step
  function postState() {
    try {
      var s = engine.state;
      var globals = [];
      s.globals.forEach(function(v,k){ globals.push([k,v]); });
      var temps = [];
      s.temps.forEach(function(v,k){ temps.push([k,v]); });
      parent.postMessage({ type:'ss:state', scene:s.scene, ip:s.ip, globals:globals, temps:temps }, '*');
    } catch(e) {}
  }
  var _origRun = engine._run.bind(engine);
  engine._run = function() { _origRun.apply(this, arguments); postState(); };
  postState();

  // Live variable editor: listen for setVar messages from the IDE inspector
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'ss:setVar') return;
    try {
      var name = e.data.name;
      var val  = e.data.value;
      // Remove the ~ prefix used by inspector for temp vars display
      var realName = (name.charAt(0) === '~') ? name.slice(1) : name;
      engine.state.set(realName, val);
      postState();
    } catch(err) {}
  });
})();

/* ────────────────────────────────────────────────
   Overlay system — all empty states use createElement
   so that the X button's onclick attribute always works
   ──────────────────────────────────────────────── */

function ssEmpty(msg) {
  var p = document.createElement('p');
  p.className = 'ss-overlay-empty';
  p.textContent = msg;
  return p;
}

function ssOverlayHeader(title) {
  var hdr = document.createElement('div'); hdr.className = 'ss-overlay-hdr';
  var h2  = document.createElement('h2'); h2.textContent = title;
  // Use onclick ATTRIBUTE so it survives any future innerHTML operations
  var btn = document.createElement('button');
  btn.className = 'ss-overlay-close';
  btn.setAttribute('onclick', 'ssCloseOverlay()');
  btn.setAttribute('aria-label', 'Close');
  btn.textContent = 'x';
  hdr.appendChild(h2); hdr.appendChild(btn);
  return hdr;
}

function ssOpenOverlay(panel) {
  var content = document.getElementById('ss-overlay-content');
  // Clear completely before rebuilding — no innerHTML +=
  while (content.firstChild) content.removeChild(content.firstChild);

  if (panel === 'stats') {
    content.appendChild(ssOverlayHeader('Stats'));
    if (!_engine) {
      content.appendChild(ssEmpty('No data yet.'));
    } else {
      var shown = 0;
      _engine.state.globals.forEach(function(val, key) {
        if (key.startsWith('__')) return;
        var t = typeof val;
        // Skip objects and arrays — they clutter stats
        if (t === 'object') return;
        var row = document.createElement('div'); row.className = 'ss-stat-row';
        var lbl = document.createElement('span'); lbl.className = 'ss-stat-label'; lbl.textContent = key;
        row.appendChild(lbl);
        if (t === 'number') {
          // Progress bar capped at 100 for display; actual value shown on right
          var pct = Math.max(0, Math.min(100, val));
          var wrap = document.createElement('div'); wrap.className = 'ss-stat-bar-wrap';
          var bar  = document.createElement('div'); bar.className = 'ss-stat-bar';
          bar.style.width = pct + '%';
          wrap.appendChild(bar); row.appendChild(wrap);
          var numSpan = document.createElement('span'); numSpan.className = 'ss-stat-val';
          numSpan.textContent = val; row.appendChild(numSpan);
        } else if (t === 'boolean') {
          var pill = document.createElement('span');
          pill.className = val ? 'ss-bool-yes' : 'ss-bool-no';
          pill.textContent = val ? 'yes' : 'no';
          row.appendChild(pill);
        } else {
          var valSpan = document.createElement('span'); valSpan.className = 'ss-stat-val';
          valSpan.textContent = String(val); row.appendChild(valSpan);
        }
        content.appendChild(row);
        shown++;
      });
      if (!shown) content.appendChild(ssEmpty('No stats to display.'));
    }

  } else if (panel === 'inventory') {
    content.appendChild(ssOverlayHeader('Inventory'));
    var hasItems = _engine && _engine.state.inventory && _engine.state.inventory.size > 0;
    if (!hasItems) {
      content.appendChild(ssEmpty('Your inventory is empty.'));
    } else {
      _engine.state.inventory.forEach(function(qty, id) {
        var schema = (_engine.state.itemRegistry && _engine.state.itemRegistry.get(id)) || {};
        var row = document.createElement('div'); row.className = 'ss-stat-row';
        var lbl = document.createElement('span'); lbl.className = 'ss-stat-label';
        lbl.textContent = schema.name || id; row.appendChild(lbl);
        var val = document.createElement('span'); val.className = 'ss-stat-val';
        val.textContent = (qty > 1 ? 'x' + qty + '  ' : '') + (schema.desc || '');
        row.appendChild(val);
        content.appendChild(row);
      });
    }

  } else if (panel === 'achievements') {
    content.appendChild(ssOverlayHeader('Achievements'));
    var hasAch = _engine && _engine.state.achievementRegistry && _engine.state.achievementRegistry.size > 0;
    if (!hasAch) {
      content.appendChild(ssEmpty('No achievements defined in this story.'));
    } else {
      _engine.state.achievementRegistry.forEach(function(schema, id) {
        var unlocked = _engine.state.achievements && _engine.state.achievements.has(id);
        var row = document.createElement('div'); row.className = 'ss-stat-row';
        var lbl = document.createElement('span'); lbl.className = 'ss-stat-label';
        lbl.textContent = (unlocked ? '' : '[locked] ') + (schema.title || id);
        row.appendChild(lbl);
        if (unlocked && schema.desc) {
          var val = document.createElement('span'); val.className = 'ss-stat-val';
          val.textContent = schema.desc; row.appendChild(val);
        }
        content.appendChild(row);
      });
    }

  } else if (panel === 'menu') {
    content.appendChild(ssOverlayHeader('Menu'));
    var restartBtn = document.createElement('button');
    restartBtn.className = 'ss-menu-btn';
    restartBtn.textContent = 'Restart Story';
    restartBtn.onclick = function() { ssCloseOverlay(); if (_engine) _engine.restart(); };
    content.appendChild(restartBtn);

  } else if (panel === 'journal') {
    content.appendChild(ssOverlayHeader('Journal'));
    var hasClues = _engine && _engine.state.discoveredClues && _engine.state.discoveredClues.size > 0;
    if (!hasClues) {
      content.appendChild(ssEmpty('No journal entries yet.'));
    } else {
      // Group by category
      var byCategory = {};
      _engine.state.discoveredClues.forEach(function(id) {
        var schema = (_engine.state.clueRegistry && _engine.state.clueRegistry.get(id)) || { title: id, text: '', category: 'General' };
        var cat = schema.category || 'General';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push({ id: id, schema: schema });
      });
      Object.keys(byCategory).sort().forEach(function(cat) {
        var catHdr = document.createElement('div'); catHdr.className = 'ss-journal-cat';
        catHdr.textContent = cat; content.appendChild(catHdr);
        byCategory[cat].forEach(function(entry) {
          var resolved = _engine.state.resolvedClues && _engine.state.resolvedClues.has(entry.id);
          var card = document.createElement('div'); card.className = 'ss-journal-entry' + (resolved ? ' ss-journal-resolved' : '');
          var title = document.createElement('div'); title.className = 'ss-journal-title';
          title.textContent = (resolved ? '✓ ' : '') + (entry.schema.title || entry.id);
          card.appendChild(title);
          if (entry.schema.text) {
            var text = document.createElement('div'); text.className = 'ss-journal-text';
            text.textContent = entry.schema.text; card.appendChild(text);
          }
          content.appendChild(card);
        });
      });
    }
  }

  document.getElementById('ss-overlay').classList.add('open');
}

function ssCloseOverlay() {
  document.getElementById('ss-overlay').classList.remove('open');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') ssCloseOverlay();
});
<\/script>
</body>
</html>`;
}


function hotReloadPreview(result) {
  const st  = result.symbolTable;
  const sig = JSON.stringify({ l: [...st.labels.keys()].sort(), g: [...st.globals.keys()].sort() });
  prevStructure = sig;
  reloadPreview();
}

function reloadPreview() {
  const frame = document.getElementById('preview-frame');
  try {
    const html = buildPreviewHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    frame.src  = url;
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  } catch(e) { console.error('Preview error:', e); }
}

function restartPreview() { prevStructure = null; runCompile(); }

window.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'ss:state') {
    document.getElementById('preview-scene').textContent =
      (e.data.scene || '?') + ' @' + (e.data.ip || 0);
    updateInspectorFromState(e.data);
  }
});

// ─── Export HTML ──────────────────────────────────────────────────────────────
function exportHTML() {
  const defaultName = (project.title || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html';
  openModal('Export HTML', 'Enter a filename for the exported story (players can open this file directly in a browser).', defaultName, 'Export', async (name) => {
    const filename = name.endsWith('.html') ? name : name + '.html';
    const html = buildPreviewHTML();
    const blob = new Blob([html], { type: 'text/html' });
    // Try File System Access API (Chrome/Edge) for folder picker
    if (window.showSaveFilePicker) {
      try {
        const fh = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'HTML File', accept: { 'text/html': ['.html'] } }],
        });
        const writable = await fh.createWritable();
        await writable.write(blob);
        await writable.close();
        logConsole('ok', 'Exported: ' + filename);
        return;
      } catch(e) {
        if (e.name === 'AbortError') return; // user cancelled
        // fall through to download link
      }
    }
    // Fallback: standard download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    logConsole('ok', 'Exported: ' + filename);
  });
}

function exportProject() {
  const defaultName = (project.title || 'my-story').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.storyscript.json';
  openModal('Export Project JSON', 'Enter a filename for the project file.', defaultName, 'Export', async (name) => {
    const filename = name.endsWith('.json') ? name : name + '.storyscript.json';
    saveCurrentProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    if (window.showSaveFilePicker) {
      try {
        const fh = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'StoryScript Project', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await fh.createWritable();
        await writable.write(blob);
        await writable.close();
        logConsole('ok', 'Exported: ' + filename);
        return;
      } catch(e) {
        if (e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    logConsole('ok', 'Exported: ' + filename);
  });
}// ─── Quick File Open (Cmd+P) ──────────────────────────────────────────────────
let qoSelected = -1;

function openQuickOpen() {
  document.getElementById('quickopen-bg').classList.add('open');
  const input = document.getElementById('quickopen-input');
  input.value = '';
  qoSelected = -1;
  renderQuickOpenResults('');
  setTimeout(() => input.focus(), 50);
}
function closeQuickOpen() {
  document.getElementById('quickopen-bg').classList.remove('open');
}

function renderQuickOpenResults(query) {
  const container = document.getElementById('quickopen-results');
  const files = Object.keys(project.files);
  const q = query.toLowerCase().trim();

  let matches;
  if (!q) {
    matches = files.map(f => ({ name: f, score: 0 }));
  } else {
    matches = files
      .map(f => {
        const idx = f.toLowerCase().indexOf(q);
        if (idx === -1) return null;
        return { name: f, score: idx === 0 ? 100 : 50 - idx };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }

  if (matches.length === 0) {
    container.innerHTML = '<div class="qo-empty">No files match</div>';
    qoSelected = -1;
    return;
  }

  container.innerHTML = '';
  matches.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'qo-item' + (i === qoSelected ? ' selected' : '');
    const q2 = q;
    const name = m.name;
    let label = escHtml(name);
    if (q2) {
      const idx = name.toLowerCase().indexOf(q2);
      if (idx !== -1) {
        label = escHtml(name.slice(0, idx)) +
                '<span class="qo-match">' + escHtml(name.slice(idx, idx + q2.length)) + '</span>' +
                escHtml(name.slice(idx + q2.length));
      }
    }
    div.innerHTML = '[f] ' + label;
    div.addEventListener('click', () => { openTab(m.name); closeQuickOpen(); });
    container.appendChild(div);
  });
  qoSelected = Math.min(qoSelected, matches.length - 1);
  return matches;
}

document.getElementById('quickopen-input').addEventListener('input', (e) => {
  qoSelected = 0;
  renderQuickOpenResults(e.target.value);
  // Highlight first
  const items = document.querySelectorAll('.qo-item');
  items.forEach((el, i) => el.classList.toggle('selected', i === 0));
});

document.getElementById('quickopen-input').addEventListener('keydown', (e) => {
  const items = document.querySelectorAll('.qo-item');
  if (e.key === 'Escape') { closeQuickOpen(); return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    qoSelected = Math.min(qoSelected + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle('selected', i === qoSelected));
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    qoSelected = Math.max(qoSelected - 1, 0);
    items.forEach((el, i) => el.classList.toggle('selected', i === qoSelected));
  }
  if (e.key === 'Enter') {
    const sel = document.querySelector('.qo-item.selected');
    if (sel) { sel.click(); }
  }
});

document.getElementById('quickopen-bg').addEventListener('click', (e) => {
  if (e.target === document.getElementById('quickopen-bg')) closeQuickOpen();
});

// Cmd+P global handler
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
    e.preventDefault();
    if (document.getElementById('quickopen-bg').classList.contains('open')) {
      closeQuickOpen();
    } else {
      openQuickOpen();
    }
  }
});

// ─── Resizer (editor/preview drag handle) ────────────────────────────────────
(function() {
  const resizer = document.getElementById('resizer');
  const rightPane = document.getElementById('right-pane');
  const layout = document.getElementById('layout');
  let dragging = false, startX, startW;

  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = rightPane.offsetWidth;
    document.body.style.userSelect = 'none';
    resizer.classList.add('dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    // Available width = layout container minus sidebar, outline pane, resizer bar
    const layoutW = layout.offsetWidth;
    const MIN_RIGHT = 220;
    const MIN_EDITOR = 200;
    const maxRight = layoutW - MIN_EDITOR;
    const delta = startX - e.clientX;
    const newW = Math.max(MIN_RIGHT, Math.min(maxRight, startW + delta));
    rightPane.style.width = newW + 'px';
    rightPane.style.flexShrink = '0';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    resizer.classList.remove('dragging');
  });
})();

// ─── Project Library (multi-story management) ────────────────────────────────
// Each project is stored under its own key: 'ss_proj_<id>'
// The library index is stored under 'ss_proj_index'
// The currently loaded project's ID is tracked in 'ss_active_proj'

const PROJ_INDEX_KEY = 'ss_proj_index';
const PROJ_PREFIX    = 'ss_proj_';

function getProjIndex() {
  try {
    const raw = localStorage.getItem(PROJ_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function setProjIndex(index) {
  try { localStorage.setItem(PROJ_INDEX_KEY, JSON.stringify(index)); } catch(e) {}
}

function genProjId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Save current project to its own localStorage slot.
 *  Creates a new slot if this project has no ID yet. */
function saveCurrentProject() {
  if (!project._id) project._id = genProjId();
  project.title = document.getElementById('project-title').value || project.title || 'Untitled';
  try {
    localStorage.setItem(PROJ_PREFIX + project._id, JSON.stringify(project));
  } catch(e) {
    logConsole('warn', 'Could not save to browser storage: ' + e.message);
    return false;
  }
  // Update index
  const index = getProjIndex();
  const existing = index.find(e => e.id === project._id);
  if (existing) {
    existing.title = project.title;
    existing.saved = Date.now();
  } else {
    index.push({ id: project._id, title: project.title, saved: Date.now() });
  }
  setProjIndex(index);
  logConsole('ok', 'Project "' + project.title + '" saved.');
  return true;
}

/** Load a project from the library by ID. Warns if unsaved changes. */
function loadProjectById(id) {
  try {
    const raw = localStorage.getItem(PROJ_PREFIX + id);
    if (!raw) { logConsole('err', 'Project not found in storage.'); return false; }
    const data = JSON.parse(raw);
    if (!data.files) { logConsole('err', 'Invalid project data.'); return false; }
    project = data;
    openTabs = [project.startScene || 'startup.txt'];
    for (const n of Object.keys(project.files)) {
      if (!openTabs.includes(n)) openTabs.push(n);
    }
    openTabs = openTabs.slice(0, 6);
    activeFile = openTabs[0] || null;
    dirtyFiles.clear();
    document.getElementById('project-title').value = project.title || '';
    renderFileList(); renderTabs();
    if (activeFile) loadFileIntoEditor(activeFile);
    logConsole('ok', 'Opened project: ' + (project.title || 'Untitled'));
    return true;
  } catch(e) {
    logConsole('err', 'Failed to open project: ' + e.message);
    return false;
  }
}

/** Delete a project from the library. */
function deleteProjectById(id) {
  try { localStorage.removeItem(PROJ_PREFIX + id); } catch(e) {}
  const index = getProjIndex().filter(e => e.id !== id);
  setProjIndex(index);
}

// ─── Project Library Modal ────────────────────────────────────────────────────
function openProjectLibrary() {
  // Save current state first (silently)
  if (project.files && Object.keys(project.files).length > 0) {
    saveCurrentProject();
  }

  const index = getProjIndex();
  const modal = document.getElementById('proj-library-modal');
  const body  = document.getElementById('proj-library-body');
  body.innerHTML = '';

  if (index.length === 0) {
    body.innerHTML = '<p style="color:var(--text-dim);padding:8px 0;">No saved projects yet.</p>';
  } else {
    index.sort((a,b) => b.saved - a.saved);
    for (const entry of index) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);';
      const isCurrent = entry.id === project._id;
      const date = new Date(entry.saved).toLocaleString();
      row.innerHTML =
        '<span style="flex:1;font-size:13px;font-weight:' + (isCurrent ? '700' : '400') + ';color:' + (isCurrent ? 'var(--accent)' : 'var(--text)') + ';">' +
          escHtml(entry.title || 'Untitled') +
        '</span>' +
        '<span style="font-size:10px;color:var(--text-dim);white-space:nowrap;">' + escHtml(date) + '</span>' +
        (isCurrent
          ? '<span style="font-size:10px;color:var(--accent);padding:2px 6px;border:1px solid var(--accent);border-radius:4px;">current</span>'
          : '<button class="tb-btn" onclick="confirmLoadProject(\'' + entry.id + '\')">Open</button>') +
        (!isCurrent
          ? '<button class="tb-btn" style="color:var(--error);border-color:var(--error);" onclick="confirmDeleteProject(\'' + entry.id + '\',\'' + escHtml(entry.title||'Untitled').replace(/'/g,"\\'") + '\')">Delete</button>'
          : '');
      body.appendChild(row);
    }
  }

  modal.classList.add('open');
}

function closeProjectLibrary() {
  document.getElementById('proj-library-modal').classList.remove('open');
}

function confirmLoadProject(id) {
  closeProjectLibrary();
  if (dirtyFiles.size > 0) {
    if (!confirm('You have unsaved changes. Open this project anyway? (Your current project is already saved to the library.)')) return;
  }
  loadProjectById(id);
}

function confirmDeleteProject(id, title) {
  if (!confirm('Permanently delete "' + title + '"? This cannot be undone.')) return;
  deleteProjectById(id);
  openProjectLibrary(); // refresh
}

// ─── New Project (creates a fresh project without destroying others) ──────────
function newProject() {
  // Save current project before creating a new one
  if (project.files && Object.keys(project.files).length > 0) {
    saveCurrentProject();
  }
  openModal('New Story', 'Enter a title for your new story.', 'My New Story', 'Create', (name) => {
    project = {
      _id: genProjId(),
      title: name || 'My New Story',
      startScene: 'startup.txt',
      files: { 'startup.txt': STARTER_SOURCE },
      config: { loopCap: 100000, undoStackDepth: 50 }
    };
    openTabs = ['startup.txt']; activeFile = 'startup.txt'; dirtyFiles.clear();
    document.getElementById('project-title').value = project.title;
    saveCurrentProject();
    renderFileList(); renderTabs(); loadFileIntoEditor('startup.txt');
    logConsole('ok', 'New project "' + project.title + '" created. Previous project saved to library.');
  });
}

// ─── Save As (rename and save current project) ────────────────────────────────
function saveProjectAs() {
  openModal('Save Project As', 'Enter a name for this project.', project.title || 'My Story', 'Save', (name) => {
    project.title = name;
    document.getElementById('project-title').value = name;
    if (!project._id) project._id = genProjId();
    saveCurrentProject();
  });
}

function importProject() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.files) throw new Error('Invalid project file (missing "files")');
        // Save current project first
        if (project.files && Object.keys(project.files).length > 0) saveCurrentProject();
        // Give imported project a fresh ID (avoid clobbering an existing slot)
        data._id = genProjId();
        project = data;
        openTabs = Object.keys(project.files).slice(0, 5);
        activeFile = project.startScene || openTabs[0];
        dirtyFiles.clear();
        document.getElementById('project-title').value = project.title || '';
        saveCurrentProject();
        renderFileList(); renderTabs();
        if (activeFile) loadFileIntoEditor(activeFile);
        logConsole('ok', 'Imported: ' + file.name);
      } catch(ex) { logConsole('err', 'Import failed: ' + ex.message); }
    };
    reader.readAsText(file);
  });
  input.click();
}

// ─── Modal ────────────────────────────────────────────────────────────────────
let modalCallback = null;
function openModal(title, desc, placeholder, okLabel, cb) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-desc').textContent  = desc;
  document.getElementById('modal-input').value = '';
  document.getElementById('modal-input').placeholder = placeholder;
  document.getElementById('modal-ok').textContent = okLabel;
  modalCallback = cb;
  document.getElementById('modal-bg').classList.add('open');
  setTimeout(() => document.getElementById('modal-input').focus(), 50);
}
function closeModal() { document.getElementById('modal-bg').classList.remove('open'); modalCallback = null; }
function confirmModal() {
  const val = document.getElementById('modal-input').value.trim();
  if (!val) return;
  if (modalCallback) modalCallback(val);
  closeModal();
}
document.getElementById('modal-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmModal();
  if (e.key === 'Escape') closeModal();
});
document.getElementById('modal-bg').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-bg')) closeModal();
});

function newFile() {
  openModal('New Scene File', 'Enter a name for the new scene file (.txt will be added). Or press Cmd+P to open an existing file.', 'scene_name', 'Create', (name) => {
    const full = name.endsWith('.txt') ? name : name + '.txt';
    if (project.files[full] !== undefined) { logConsole('warn', 'File already exists: ' + full); return; }
    createFile(full, '');
    logConsole('ok', 'Created: ' + full);
  });
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  const restored = loadFromStorage();
  if (!restored) {
    project._id = genProjId();
    project.files['startup.txt'] = STARTER_SOURCE;
    saveCurrentProject();
    logConsole('info', 'Welcome to StoryScript IDE! Loaded the Lantern Road starter.');
  } else {
    logConsole('info', 'Restored project: ' + (project.title || 'Untitled'));
  }
  document.getElementById('project-title').value = project.title || '';
  document.getElementById('project-title').addEventListener('input', (e) => {
    project.title = e.target.value; saveToStorage();
  });

  openTabs = [];
  const start = project.startScene || 'startup.txt';
  if (project.files[start]) openTabs.push(start);
  for (const n of Object.keys(project.files)) {
    if (!openTabs.includes(n)) openTabs.push(n);
  }
  openTabs = openTabs.slice(0, 6);
  activeFile = openTabs[0] || null;

  renderFileList();
  renderTabs();
  if (activeFile) loadFileIntoEditor(activeFile);
  else scheduleCompile();

  logConsole('info', 'Tip: Cmd+S = save | Cmd+P = quick open | Cmd+Shift+O = toggle outline | Cmd+. = go to definition');
})();

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4: CodeMirror 6 Integration, Symbol Outline, Go-to-Definition,
//          Context-Aware Autocomplete, Inline Diagnostics, Event-Driven Inspector
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Global CM6 state ─────────────────────────────────────────────────────────
let cmView = null;          // The CodeMirror EditorView instance
let cmLintCompartment = null;
let cmDiagnostics = [];     // Current set of diagnostics (updated after each compile)
let lastSymbolTable = null; // From most recent successful compile
let outlineVisible = true;

// ─── Symbol Outline ───────────────────────────────────────────────────────────

function toggleOutlinePane() {
  outlineVisible = !outlineVisible;
  document.getElementById('outline-pane').classList.toggle('collapsed', !outlineVisible);
}

function toggleOutline() {
  toggleOutlinePane();
}

function renderOutline(symbolTable, fileName) {
  const list = document.getElementById('outline-list');
  list.innerHTML = '';
  if (!symbolTable) {
    list.innerHTML = '<div class="outline-item" style="color:var(--text-dim);font-family:var(--font-ui);font-size:11px;padding:12px;">No symbol data.</div>';
    return;
  }

  let hasItems = false;

  // Labels
  const labels = [...symbolTable.labels.entries()]
    .filter(([, info]) => !fileName || info.file === fileName)
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (labels.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'outline-section';
    sec.textContent = 'Labels';
    list.appendChild(sec);
    for (const [name, info] of labels) {
      const item = document.createElement('div');
      item.className = 'outline-item type-label';
      item.textContent = '[L] ' + name;
      item.title = info.file + ':' + info.lineNum;
      item.addEventListener('click', () => jumpToLine(info.lineNum));
      list.appendChild(item);
      hasItems = true;
    }
  }

  // Globals (from startup only)
  const globals = [...(symbolTable.globals?.entries() ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
  if (globals.length > 0) {
    const sec = document.createElement('div');
    sec.className = 'outline-section';
    sec.textContent = 'Variables';
    list.appendChild(sec);
    for (const [name, info] of globals) {
      const item = document.createElement('div');
      item.className = 'outline-item type-global';
      item.textContent = '[V] ' + name;
      item.title = info.type + ' — ' + info.file + ':' + info.lineNum;
      item.addEventListener('click', () => {
        if (info.file && info.file !== activeFile) {
          openTab(info.file);
        }
        jumpToLine(info.lineNum);
      });
      list.appendChild(item);
      hasItems = true;
    }
  }

  // Phase 3 constructs from symbolTable extensions
  const skillMap = symbolTable.skills ?? new Map();
  const itemMap  = symbolTable.items  ?? new Map();
  const achMap   = symbolTable.achievements ?? new Map();
  const titleMap = symbolTable.titles ?? new Map();

  function addP3Section(map, sectionName, typeClass, icon) {
    if (map.size === 0) return;
    const sec = document.createElement('div');
    sec.className = 'outline-section';
    sec.textContent = sectionName;
    list.appendChild(sec);
    for (const [id, info] of map) {
      const item = document.createElement('div');
      item.className = 'outline-item ' + typeClass;
      item.textContent = icon + ' ' + id;
      item.title = (info.label || info.name || id) + ' — line ' + (info.lineNum || '?');
      item.addEventListener('click', () => {
        if (info.file && info.file !== activeFile) openTab(info.file);
        jumpToLine(info.lineNum || 0);
      });
      list.appendChild(item);
      hasItems = true;
    }
  }

  addP3Section(skillMap, 'Skills',       'type-skill', '[S]');
  addP3Section(itemMap,  'Items',        'type-item',  '[I]');
  addP3Section(achMap,   'Achievements', 'type-ach',   '[A]');
  addP3Section(titleMap, 'Titles',       'type-title', '[T]');

  // Phase 6a: Flags
  const flagSet = symbolTable.flags ?? new Set();
  if (flagSet.size > 0) {
    const sec = document.createElement('div');
    sec.className = 'outline-section';
    sec.textContent = 'Flags';
    list.appendChild(sec);
    for (const id of [...flagSet].sort()) {
      const item = document.createElement('div');
      item.className = 'outline-item type-flag';
      item.textContent = '🚩 ' + id;
      item.title = 'Flag — ' + id;
      list.appendChild(item);
      hasItems = true;
    }
  }

  // Phase 6e: NPCs
  const npcMap = symbolTable.npcs ?? new Map();
  if (npcMap.size > 0) {
    const sec = document.createElement('div');
    sec.className = 'outline-section';
    sec.textContent = 'NPCs';
    list.appendChild(sec);
    for (const [id, info] of npcMap) {
      const item = document.createElement('div');
      item.className = 'outline-item type-npc';
      item.textContent = '👤 ' + (info.schema?.name || id);
      item.title = 'NPC — line ' + (info.lineNum || '?');
      item.addEventListener('click', () => {
        if (info.file && info.file !== activeFile) openTab(info.file);
        jumpToLine(info.lineNum || 0);
      });
      list.appendChild(item);
      hasItems = true;
    }
  }

  // Phase 6f: Clues
  const clueMap = symbolTable.clues ?? new Map();
  if (clueMap.size > 0) {
    const sec = document.createElement('div');
    sec.className = 'outline-section';
    sec.textContent = 'Clues';
    list.appendChild(sec);
    for (const [id, info] of clueMap) {
      const item = document.createElement('div');
      item.className = 'outline-item type-clue';
      item.textContent = '📋 ' + (info.schema?.title || id);
      item.title = 'Clue — line ' + (info.lineNum || '?');
      item.addEventListener('click', () => {
        if (info.file && info.file !== activeFile) openTab(info.file);
        jumpToLine(info.lineNum || 0);
      });
      list.appendChild(item);
      hasItems = true;
    }
  }

  // Phase 5g: Chapters
  const chapterMap = symbolTable.chapters ?? new Map();
  if (chapterMap.size > 0) {
    const sec = document.createElement('div');
    sec.className = 'outline-section';
    sec.textContent = 'Chapters';
    list.appendChild(sec);
    for (const [id, info] of chapterMap) {
      const item = document.createElement('div');
      item.className = 'outline-item type-chapter';
      item.textContent = (info.icon ? info.icon + ' ' : '📖 ') + info.title;
      item.title = 'Chapter — line ' + (info.lineNum || '?');
      item.addEventListener('click', () => {
        if (info.file && info.file !== activeFile) openTab(info.file);
        jumpToLine(info.lineNum || 0);
      });
      list.appendChild(item);
      hasItems = true;
    }
  }

  if (!hasItems) {
    list.innerHTML = '<div class="outline-item" style="color:var(--text-dim);font-family:var(--font-ui);font-size:11px;padding:12px;">No symbols in this file.</div>';
  }
}

function jumpToLine(lineNum) {
  if (!cmView || !lineNum) return;
  const doc = cmView.state.doc;
  if (lineNum > doc.lines) return;
  const line = doc.line(lineNum);
  cmView.dispatch({
    selection: { anchor: line.from },
    effects: window._CM?.EditorView?.scrollIntoView(line.from, { y: 'center' }),
    scrollIntoView: true,
  });
  cmView.focus();
}

// ─── CodeMirror 6 Setup ───────────────────────────────────────────────────────

// ── Custom CM6 tags for StoryScript tokens ────────────────────────────────────
// Tag.define() creates unique tag objects that HighlightStyle.define() maps to
// CSS. This is the correct CM6 approach — returning plain strings from token()
// and injecting raw CSS classes does NOT work in CM6 StreamLanguage.
const SS_TAG = {
  COMMAND: null, LABEL_DEF: null, LABEL_NAME: null, CHOICE_OPT: null,
  STRING: null,  NUMBER: null,    COMMENT: null,    INTERP: null,
};

function initSSTags(Tag) {
  SS_TAG.COMMAND    = Tag.define();
  SS_TAG.LABEL_DEF  = Tag.define();
  SS_TAG.LABEL_NAME = Tag.define();
  SS_TAG.CHOICE_OPT = Tag.define();
  SS_TAG.STRING     = Tag.define();
  SS_TAG.NUMBER     = Tag.define();
  SS_TAG.COMMENT    = Tag.define();
  SS_TAG.INTERP     = Tag.define();
}

// Build the StreamLanguage mode — token() returns Tag objects, not strings.
function buildStoryscriptMode() {
  return {
    name: 'storyscript',
    token(stream, state) {
      if (stream.sol()) {
        state.expectLabelDef  = false;
        state.expectLabelName = false;
        state.inChoiceOpt     = false;
        // Choice option: tab(s) then #
        if (stream.match(/^\t+#/)) {
          stream.skipToEnd();
          return SS_TAG.CHOICE_OPT;
        }
        // Command line: *word
        if (stream.match(/^\*\w+/)) {
          const cmd = stream.current().slice(1).toLowerCase();
          state.currentCmd = cmd;
          if (cmd === 'comment') { stream.skipToEnd(); return SS_TAG.COMMENT; }
          if (cmd === 'label')   { state.expectLabelDef  = true; }
          if (cmd === 'goto' || cmd === 'gosub') { state.expectLabelName = true; }
          return SS_TAG.COMMAND;
        }
        state.currentCmd = null;
      }

      // Label definition: *label <name>
      if (state.expectLabelDef) {
        stream.eatSpace();
        if (stream.match(/\w+/)) { state.expectLabelDef = false; return SS_TAG.LABEL_DEF; }
      }
      // Label reference: *goto/*gosub <name>
      if (state.expectLabelName) {
        stream.eatSpace();
        if (stream.match(/\w+/)) { state.expectLabelName = false; return SS_TAG.LABEL_NAME; }
      }

      // Variable interpolation ${...}
      if (stream.match('${')) { state.inInterp = true; return SS_TAG.INTERP; }
      if (state.inInterp) {
        if (stream.match('}')) { state.inInterp = false; return SS_TAG.INTERP; }
        stream.next(); return SS_TAG.INTERP;
      }

      // Number literals
      if (stream.match(/^-?\d+(\.\d+)?/)) return SS_TAG.NUMBER;
      // String literals
      if (stream.match(/^"[^"]*"/)) return SS_TAG.STRING;
      if (stream.match(/^'[^']*'/)) return SS_TAG.STRING;

      stream.next();
      return null;
    },
    startState() {
      return { inInterp: false, currentCmd: null,
               expectLabelDef: false, expectLabelName: false, inChoiceOpt: false };
    },
    copyState(s) { return { ...s }; },
  };
}

// Build the CodeMirror theme matching GitHub Light
function buildSSTheme(CM) {
  const { EditorView } = CM;
  return EditorView.theme({
    '&': { background: 'var(--bg)', color: 'var(--text)' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-gutters': {
      background: 'var(--panel)',
      borderRight: '1px solid var(--border)',
      color: 'var(--text-dim)',
    },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '36px', padding: '0 8px 0 4px' },
    '.cm-activeLineGutter': { background: 'rgba(9,105,218,0.06)' },
    '.cm-activeLine': { background: 'rgba(9,105,218,0.04)' },
    '.cm-selectionBackground, ::selection': { background: 'rgba(9,105,218,0.15) !important' },
    '.cm-matchingBracket': {
      background: 'rgba(9,105,218,0.15)',
      outline: '1px solid rgba(9,105,218,0.4)',
    },
  }, { dark: false });
}

// Build language + highlight style extensions.
// Returns an array: [StreamLanguage extension, syntaxHighlighting extension]
function buildSSHighlight(CM) {
  const { StreamLanguage, HighlightStyle, syntaxHighlighting, Tag } = CM;

  // Initialise custom tags now that we have Tag available
  initSSTags(Tag);

  const ssHighlightStyle = HighlightStyle.define([
    { tag: SS_TAG.COMMAND,    color: '#0969da', fontWeight: '600' },
    { tag: SS_TAG.LABEL_DEF,  color: '#8250df', fontWeight: '600' },
    { tag: SS_TAG.LABEL_NAME, color: '#8250df' },
    { tag: SS_TAG.CHOICE_OPT, color: '#8250df' },
    { tag: SS_TAG.STRING,     color: '#116329' },
    { tag: SS_TAG.NUMBER,     color: '#cf222e' },
    { tag: SS_TAG.COMMENT,    color: '#93a1a1', fontStyle: 'italic' },
    { tag: SS_TAG.INTERP,     color: '#953800' },
  ]);

  return [
    StreamLanguage.define(buildStoryscriptMode()),
    syntaxHighlighting(ssHighlightStyle),
  ];
}

// SS Linter: maps compileFull diagnostics to CM6 Diagnostic objects
function buildSSLinter(CM) {
  const { linter } = CM;
  return linter(view => {
    // cmDiagnostics is updated by runCompile()
    return cmDiagnostics;
  }, { delay: 200 });
}

// SS Autocomplete
function buildSSAutocomplete(CM) {
  const { autocompletion } = CM;
  return autocompletion({
    override: [ssCompletionSource],
    activateOnTyping: true,
    maxRenderedOptions: 30,
  });
}

function ssCompletionSource(context) {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const lineText = line.text;
  const lineFrom = line.from;
  const posInLine = pos - lineFrom;
  const beforeCursor = lineText.slice(0, posInLine);

  // Detect if we're after a command keyword
  const cmdMatch = beforeCursor.match(/^\*(\w+)\s+(\S*)$/);
  if (!cmdMatch) {
    // Suggest command names if we just typed *
    const starMatch = beforeCursor.match(/^\*(\w*)$/);
    if (starMatch) {
      const partial = starMatch[1].toLowerCase();
      const commands = [
        'create','temp','set','list','object','obj_set','push','pop',
        'if','elseif','else','endif','while','endwhile','for','endfor',
        'choice','label','goto','gosub','return','finish','page_break','new_page',
        'scene','theme','theme_push','theme_pop','comment',
        'skill','item','achievement','title',
        'improve','reduce','set_skill','show_skills','show_skill',
        'give','take','show_achievements','unlock',
        'grant','revoke','show_title',
        'random','input_text','input_number',
        // Phase 5c/5g
        'check','success','failure','endcheck','chapter',
        // Phase 6a
        'flag','raise','lower',
        // Phase 6b
        'once','endonce',
        // Phase 6c
        'switch','case','default','endswitch',
        // Phase 6d
        'delay',
        // Phase 6e
        'npc','dialogue','enddialogue',
        // Phase 6f
        'clue','discover','resolve',
        // Phase 6g
        'transition',
      ];
      const options = commands
        .filter(c => c.startsWith(partial))
        .map(c => ({ label: '*' + c, type: 'keyword', apply: '*' + c + ' ', detail: 'command' }));
      if (!options.length) return null;
      return {
        from: lineFrom + beforeCursor.lastIndexOf('*'),
        options,
        validFor: /^\*\w*$/,
      };
    }
    return null;
  }

  const cmd = cmdMatch[1].toLowerCase();
  const partial = cmdMatch[2].toLowerCase();
  const from = lineFrom + beforeCursor.lastIndexOf(cmdMatch[2]);

  if (!lastSymbolTable) return null;

  let options = [];

  // After *goto / *gosub → suggest labels
  if (cmd === 'goto' || cmd === 'gosub') {
    options = [...lastSymbolTable.labels.keys()]
      .filter(l => l.startsWith(partial) && !l.startsWith('__'))
      .map(l => ({
        label: l,
        type: 'variable',
        detail: 'label',
        info: () => {
          const info = lastSymbolTable.labels.get(l);
          return 'Defined in ' + (info?.file || '?') + ':' + (info?.lineNum || '?');
        }
      }));
  }

  // After *scene → suggest filenames
  else if (cmd === 'scene') {
    options = Object.keys(project.files)
      .filter(f => f.startsWith(partial))
      .map(f => ({ label: f, type: 'class', detail: 'scene file' }));
  }

  // After *set / *create → suggest variables
  else if (cmd === 'set' || cmd === 'create') {
    options = [...lastSymbolTable.globals.keys()]
      .filter(v => v.startsWith(partial))
      .map(v => ({
        label: v,
        type: 'variable',
        detail: (lastSymbolTable.globals.get(v)?.type || 'scalar'),
      }));
  }

  // After *improve / *reduce / *set_skill / *show_skill → suggest skills
  else if (['improve','reduce','set_skill','show_skill'].includes(cmd)) {
    const skills = lastSymbolTable.skills ?? new Map();
    options = [...skills.keys()]
      .filter(id => id.startsWith(partial))
      .map(id => ({ label: id, type: 'variable', detail: 'skill' }));
  }

  // After *give / *take → suggest items
  else if (cmd === 'give' || cmd === 'take') {
    const items = lastSymbolTable.items ?? new Map();
    options = [...items.keys()]
      .filter(id => id.startsWith(partial))
      .map(id => ({ label: id, type: 'class', detail: 'item' }));
  }

  // After *unlock → suggest achievements
  else if (cmd === 'unlock') {
    const achs = lastSymbolTable.achievements ?? new Map();
    options = [...achs.keys()]
      .filter(id => id.startsWith(partial))
      .map(id => ({ label: id, type: 'variable', detail: 'achievement' }));
  }

  // After *grant / *revoke → suggest titles
  else if (cmd === 'grant' || cmd === 'revoke') {
    const titles = lastSymbolTable.titles ?? new Map();
    options = [...titles.keys()]
      .filter(id => id.startsWith(partial))
      .map(id => ({ label: id, type: 'variable', detail: 'title' }));
  }

  if (!options.length) return null;
  return { from, options, validFor: /^\w*$/ };
}

// ─── Initialize CodeMirror ────────────────────────────────────────────────────

function initCodeMirror(CM) {
  const {
    EditorView, keymap, highlightActiveLine, lineNumbers, highlightActiveLineGutter,
    EditorState, defaultKeymap, history, historyKeymap, indentWithTab,
    syntaxHighlighting, StreamLanguage, bracketMatching, Compartment,
    lintGutter, completionKeymap, drawSelection, highlightSpecialChars,
  } = CM;

  cmLintCompartment = new Compartment();

  // buildSSHighlight returns [StreamLanguage extension, syntaxHighlighting extension]
  const ssHighlightExts = buildSSHighlight(CM);
  const ssTheme = buildSSTheme(CM);
  const ssLinter = buildSSLinter(CM);
  const ssAutocomp = buildSSAutocomplete(CM);

  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    highlightActiveLine(),
    bracketMatching(),
    ...ssHighlightExts,
    ssTheme,
    cmLintCompartment.of([ssLinter, lintGutter()]),
    ssAutocomp,
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      // Cmd+P shortcut (handled globally, but intercept in editor too)
      { key: 'Mod-p', run: () => { openQuickOpen(); return true; } },
      // Cmd+Shift+O: toggle outline
      { key: 'Mod-Shift-o', run: () => { toggleOutlinePane(); return true; } },
      // F12 / Cmd+click substitute: Mod-. to jump to definition
      { key: 'Mod-.', run: gotoDefinitionAtCursor },
    ]),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        // Update project state
        if (activeFile) {
          const newContent = update.state.doc.toString();
          project.files[activeFile] = newContent;
          dirtyFiles.add(activeFile);
          markTabDirty(activeFile, true);
          scheduleCompile();
        }
      }
    }),
    EditorView.lineWrapping,
  ];

  const editorHost = document.getElementById('editor-area');
  editorHost.innerHTML = ''; // Remove the fallback textarea

  cmView = new EditorView({
    state: EditorState.create({ doc: '', extensions }),
    parent: editorHost,
  });

  // Patch loadFileIntoEditor to use CM6
  const origLoad = loadFileIntoEditor;
  window.loadFileIntoEditor = function(name) {
    activeFile = name;
    const content = getFileContent(name);
    if (cmView) {
      cmView.dispatch({
        changes: { from: 0, to: cmView.state.doc.length, insert: content },
        selection: { anchor: 0 },
      });
    }
    renderTabs();
    renderFileList();
    // Phase 5h: Instantly re-render outline from existing symbol table on tab
    // switch — don't wait for the 320ms compile debounce to finish.
    if (lastSymbolTable) {
      renderOutline(lastSymbolTable, name);
    }
    scheduleCompile();
  };

  logConsole('ok', 'CodeMirror 6 loaded — syntax highlighting and autocomplete active.');
}

// ─── Go-to-definition ─────────────────────────────────────────────────────────

function gotoDefinitionAtCursor() {
  if (!cmView || !lastSymbolTable) return false;
  const { state } = cmView;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const lineText = line.text;
  const posInLine = pos - line.from;

  // Find word under cursor
  let start = posInLine, end = posInLine;
  while (start > 0 && /\w/.test(lineText[start - 1])) start--;
  while (end < lineText.length && /\w/.test(lineText[end])) end++;
  const word = lineText.slice(start, end);
  if (!word) return false;

  // Check if it's a label
  if (lastSymbolTable.labels.has(word)) {
    const info = lastSymbolTable.labels.get(word);
    if (info.file && info.file !== activeFile) {
      openTab(info.file);
    }
    setTimeout(() => jumpToLine(info.lineNum), info.file !== activeFile ? 100 : 0);
    return true;
  }

  // Check if it's a scene filename
  if (lastSymbolTable.sceneRefs) {
    const allRefs = [...lastSymbolTable.sceneRefs.values()].flat();
    if (allRefs.includes(word) || allRefs.includes(word + '.txt')) {
      const fname = project.files[word] ? word : (project.files[word + '.txt'] ? word + '.txt' : null);
      if (fname) { openTab(fname); return true; }
    }
  }

  return false;
}

// ─── Update runCompile to send diagnostics to CM6 ────────────────────────────

const _origRunCompile = window.runCompile;

window.runCompile = function() {
  if (!activeFile) return;
  // Guard: SS may not be ready yet if engine fetch is still in flight
  if (!window.SS || !window.SS.compileFull) return;
  const source = getFileContent(activeFile);
  try {
    const result = SS.compileFull(source, activeFile, {
      loopCap:     project.config.loopCap,
      startupFile: project.startScene,
    });
    const errs = result.errors.length, warns = result.warnings.length;
    updateStatusBadge(errs, warns);
    updateConsole(result.errors, result.warnings);

    // Update symbol table for autocomplete and outline
    lastSymbolTable = result.symbolTable;
    renderOutline(result.symbolTable, activeFile);

    // Build CM6 diagnostics
    cmDiagnostics = [];
    const doc = cmView?.state?.doc;
    if (doc) {
      function addDiag(items, severity) {
        for (const item of items) {
          const lineNum = item.lineNum || 0;
          if (lineNum < 1 || lineNum > doc.lines) continue;
          const line = doc.line(lineNum);
          cmDiagnostics.push({
            from: line.from,
            to: line.to,
            severity,
            message: item.message,
            source: item.file || activeFile,
          });
        }
      }
      addDiag(result.errors, 'error');
      addDiag(result.warnings, 'warning');
    }

    // Force the CM6 linter to re-run
    if (cmView && window._CM?.forceLinting) {
      window._CM.forceLinting(cmView);
    }

    if (errs === 0) hotReloadPreview(result);
  } catch(e) {
    updateStatusBadge(1, 0);
    logConsole('err', 'Fatal compile error: ' + e.message);
  }
};

// Note: event-driven inspector is inlined directly in buildPreviewHTML above.
// No patching needed here.

// ─── CM6 + Engine init (Vite build) ──────────────────────────────────────────
// main.js has already set window._CM synchronously (CM6 from npm).
// window._ssReady is a Promise that resolves once the engine IIFE is fetched
// and executed (setting window.SS). We await it, then initialise CM6.

(async () => {
  // Wait for engine fetch + execute (window.SS must be populated before IDE uses it)
  await (window._ssReady || Promise.resolve());

  if (window._CM) {
    try {
      // CM6 loaded — replace textarea with CM6 editor
      initCodeMirror(window._CM);
      if (activeFile) {
        const content = getFileContent(activeFile);
        if (cmView) {
          cmView.dispatch({
            changes: { from: 0, to: cmView.state.doc.length, insert: content },
            selection: { anchor: 0 },
          });
          scheduleCompile();
        }
      }
    } catch(e) {
      // CM6 initialization failed — restore the fallback textarea
      console.error('CodeMirror 6 init failed, restoring fallback textarea:', e);
      cmView = null;
      const editorHost = document.getElementById('editor-area');
      editorHost.innerHTML = '<textarea id="editor-textarea-fallback" spellcheck="false" style="position:absolute;inset:0;width:100%;height:100%;font-family:var(--font-mono);font-size:13px;background:var(--bg);color:var(--text);border:none;resize:none;padding:12px 16px;outline:none;tab-size:2;white-space:pre;overflow-wrap:normal;"></textarea>';
      const ta = document.getElementById('editor-textarea-fallback');
      ta.addEventListener('input', () => {
        if (!activeFile) return;
        project.files[activeFile] = ta.value;
        dirtyFiles.add(activeFile);
        markTabDirty(activeFile, true);
        scheduleCompile();
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const s = ta.selectionStart, end = ta.selectionEnd;
          ta.value = ta.value.substring(0, s) + '\t' + ta.value.substring(end);
          ta.selectionStart = ta.selectionEnd = s + 1;
          ta.dispatchEvent(new Event('input'));
        }
      });
      window.loadFileIntoEditor = function(name) {
        activeFile = name;
        ta.value = getFileContent(name);
        renderTabs();
        renderFileList();
        scheduleCompile();
      };
      if (activeFile) ta.value = getFileContent(activeFile);
      logConsole('warn', 'CodeMirror 6 unavailable — using plain text editor.');
    }
  } else {
    logConsole('warn', 'CodeMirror 6 unavailable — using plain text editor.');
    // Trigger initial compile now that engine is ready
    scheduleCompile();
  }
})();

logConsole('info', 'StoryScript IDE ready. Ctrl+S = save | Ctrl+P = quick open | Ctrl+Shift+O = outline | Ctrl+. = go to definition');

// Keyboard shortcut: Cmd+Shift+O = toggle outline
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'O') {
    e.preventDefault();
    toggleOutlinePane();
  }
});

// (Fallback textarea is set up earlier, before init() runs.)

// ── Phase 5f: beforeunload prompt ────────────────────────────────────────────
// Warn the author before closing the tab if there are unsaved changes.
// dirtyFiles tracks which files have been edited since last save/export.
window.addEventListener('beforeunload', (e) => {
  if (dirtyFiles.size > 0) {
    e.preventDefault();
    // Modern browsers show their own message; returnValue triggers the dialog.
    e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    return e.returnValue;
  }
});


// ── Expose globals needed by HTML onclick="" and oninput="" attributes ────────
// type="module" scripts run in strict module scope — functions aren't on window
// automatically. The IDE HTML uses inline event attributes that call these fns.
Object.assign(window, {
  // Toolbar buttons
  newProject,
  newFile,
  openProjectLibrary,
  closeProjectLibrary,
  saveProjectAs,
  exportHTML,
  exportProject,
  importProject,
  // Editor / preview controls
  restartPreview,
  toggleOutline,
  toggleOutlinePane,
  toggleInspector,
  clearConsole,
  renderInspector,
  openQuickOpen,
  closeQuickOpen,
  // Modal controls
  closeModal,
  confirmModal,
  // File/project management (dynamically injected onclick attrs)
  confirmDelete,
  confirmLoadProject,
  confirmDeleteProject,
});
