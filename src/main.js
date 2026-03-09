/**
 * src/main.js — StoryScript IDE entry point (Vite build)
 *
 * This module replaces the old <script type="module" id="cm6-loader"> block
 * that loaded CodeMirror 6 from the esm.sh CDN, plus it handles the engine
 * fetch that was previously done by reading <script id="ss-bundle">.
 *
 * What this does:
 *   1. Imports all CM6 packages from npm (no network, no CDN, bundled by Vite).
 *   2. Exposes them on window._CM (same shape the old CDN loader used) so that
 *      ide-core.js can call initCodeMirror(window._CM) unchanged.
 *   3. Fetches /storyscript-engine.js (the engine IIFE, served from public/).
 *      - Caches the source text as window._SS_ENGINE_SRC for buildPreviewHTML().
 *      - Executes it so window.SS is populated for IDE-side compileFull() calls.
 *   4. Exposes window._ssReady (a Promise) so ide-core.js can await engine load.
 *
 * ide-core.js is loaded as a separate <script type="module"> in index.html.
 * It awaits window._ssReady before initialising CM6, avoiding the event-based
 * ordering problem that would arise if we used dispatchEvent('cm6ready').
 */

// ── Import all CM6 packages from npm ─────────────────────────────────────────
// Vite tree-shakes and bundles these; no CDN request at runtime.

import { EditorState, Compartment, RangeSetBuilder }    from '@codemirror/state';

import {
  EditorView,
  ViewPlugin,
  Decoration,
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  highlightActiveLineGutter,
} from '@codemirror/view';

import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';

import {
  StreamLanguage,
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
  indentUnit,
} from '@codemirror/language';

import { Tag } from '@lezer/highlight';

import {
  linter,
  lintGutter,
  forceLinting,
} from '@codemirror/lint';

import {
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';

// ── Expose CM6 on window._CM ──────────────────────────────────────────────────
// ide-core.js calls initCodeMirror(window._CM) and destructures these keys.
// Keeping the same shape as the old CDN loader means ide-core.js needs no changes.
window._CM = {
  // state
  EditorState,
  Compartment,
  RangeSetBuilder,
  // view
  EditorView,
  ViewPlugin,
  Decoration,
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  highlightActiveLineGutter,
  // commands
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  // language
  StreamLanguage,
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
  indentUnit,
  Tag,
  // lint
  linter,
  lintGutter,
  forceLinting,
  // autocomplete
  autocompletion,
  completionKeymap,
};

// ── Fetch and execute the engine IIFE ─────────────────────────────────────────
// storyscript-engine.js is the (function(global){ ... })(window) IIFE that
// defines window.SS — the compiler, engine, and renderer the IDE calls directly.
//
// We fetch the raw text for two reasons:
//   a) buildPreviewHTML() needs to embed it verbatim in the preview iframe's srcdoc.
//   b) Importing it as an ES module would run it in module scope, where "global"
//      may not be window — so we eval it explicitly to guarantee window.SS is set.
//
// _ssReady is exposed on window so ide-core.js can `await window._ssReady` before
// calling SS.compileFull() or initialising CM6.
window._ssReady = (async () => {
  try {
    // In dev:  served from publicDir (/storyscript-engine.js)
    // In prod: Vite copies public/ to dist/, so the URL is the same
    // import.meta.env.BASE_URL is injected by Vite at build time.
    // In dev it's '/', in prod it's the configured base (e.g. '/storyscript/').
    // This ensures the fetch works whether deployed at root or a subdirectory.
    const res = await fetch(import.meta.env.BASE_URL + 'storyscript-engine.js');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const src = await res.text();

    // Cache the source text for buildPreviewHTML()
    window._SS_ENGINE_SRC = src;

    // Execute so window.SS is populated for direct IDE calls.
    // The engine IIFE uses: (typeof window !== 'undefined' ? window : ...)
    // In a browser context (or a browser-like module scope), window is defined
    // in the outer scope — so new Function(src)() correctly picks it up.
    // eslint-disable-next-line no-new-func
    new Function(src)();

  } catch (e) {
    console.error('[StoryScript] Engine failed to load:', e);
    window._SS_ENGINE_SRC = '';
  }
})();
