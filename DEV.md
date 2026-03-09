# CS·IDE Developer Documentation

Architecture overview, module reference, integration patterns, and lessons learned from building and extending this editor.

---

## Table of Contents

- [Architecture](#architecture)
- [Module Reference](#module-reference)
- [Data Flow](#data-flow)
- [Adding New Features](#adding-new-features)
- [Testing Strategy](#testing-strategy)
- [Lessons Learned](#lessons-learned)

---

## Architecture

CS·IDE is a single-page vanilla JavaScript application with no build step, no bundler, and no framework. Everything runs in the browser from static files. All state lives either in JavaScript module closures or in `localStorage`.

### Design Principles

**No innerHTML for user data.** The editor's `contenteditable` div is the single source of truth for content. `Editor.getPlainText()` extracts plain text from it; `Highlight.apply()` rebuilds its `innerHTML` from that plain text. Never inject user-authored text directly into HTML attributes or innerHTML without escaping — use `Highlight.esc()` or `escHtml()`.

**Every module is an IIFE returning a public API.** `const Foo = (() => { ... return { method1, method2 }; })();` — nothing leaks to global scope except the module name itself. Cross-module calls happen via the returned object only.

**State flows down, events flow up.** `Highlight.apply()` is the central pump. It runs the linter, rebuilds editor HTML, updates the sidebar, updates the gutter, triggers autosave, and calls `Undo.push()`. Everything downstream of a content change is triggered by calling `Highlight.apply()`.

**No async in the critical path.** The editor, linter, highlighter, and sidebar all run synchronously. File I/O (import/export) and autosave use `FileReader` and `setTimeout` but never block rendering.

### File Structure

```
cside2/
  index.html          ← Shell, toolbar, tab strip, editor, sidebar, script tags
  css/
    base.css          ← CSS variables (:root), reset, body
    layout.css        ← Toolbar, snippet bar, main layout
    tabs.css          ← Tab strip, tab drag states
    editor.css        ← Editor div, syntax span colours, lint underlines
    linenumbers.css   ← Gutter layout, fold icon styles
    sidebar.css       ← All four sidebar panels
    search.css        ← Find & replace panel
    reference.css     ← Command reference modal
  js/
    caret.js          ← Character-offset cursor save/restore
    linter.js         ← Static analysis (5 checks)
    crossscene.js     ← Cross-tab *goto_scene validation
    undo.js           ← Per-tab undo/redo history
    linenumbers.js    ← Line gutter rendering, scroll sync
    folding.js        ← *if/*choice block folding
    highlight.js      ← Syntax highlighting + linter orchestration
    sidebar.js        ← Issues, Sections, Labels, Variables panels + WordCount
    filemanager.js    ← Export, import, autosave
    snippets.js       ← Boilerplate insertion
    search.js         ← Find & replace
    editor.js         ← Key handling, paste, Cmd+click, event binding
    tabs.js           ← Multi-tab management, drag reorder, Ctrl+Tab
    project.js        ← Project manifest export/import
    reference.js      ← Command reference modal
    main.js           ← State object, STARTER content, DOMContentLoaded init
```

### Script Load Order

Order matters because modules reference each other at call time (not parse time), but `main.js` must be last since it calls everything:

```
caret → linter → crossscene → undo → linenumbers → folding →
highlight → sidebar → filemanager → snippets → search →
editor → tabs → [FontSize inline] → project → reference → main
```

**Rule:** if module A's functions call module B, A can be loaded before or after B as long as both are loaded before `DOMContentLoaded` fires. The only hard constraint is `main.js` last.

---

## Module Reference

### `State` (main.js)

Global mutable state shared across modules. Never add to this unless a value is genuinely needed by multiple unrelated modules.

```js
const State = {
  isComposing: false,        // IME composition in progress
  lastLint: {                // Most recent linter result
    issues:      [],
    errorLines:  new Set(),
    warnLines:   new Set(),
    orphanLines: new Set(),
  },
  activeTabId: null,         // Currently active tab ID
};
```

---

### `Caret` (caret.js)

Character-offset cursor management. The browser's native cursor position is destroyed every time `innerHTML` is set, so we save/restore it manually using character offsets from the start of the editor's text.

```js
Caret.getOffset(el)              // → { start, end } character offsets
Caret.setOffset(el, start, end)  // Restore cursor to character positions
```

**Why character offsets?** Tree-walker-based approaches using DOM node + offset break when `innerHTML` is rebuilt (the nodes are replaced). Character offsets into the plain text string are stable across re-renders.

---

### `Linter` (linter.js)

```js
Linter.run(lines)
// → { issues, errorLines, warnLines, orphanLines }
// issues: [{ line, type, msg }]
// *Lines: Set of line indices
```

Five checks: unknown `*goto`/`*gosub` targets, `*set` on undeclared variables, unclosed `*if`, orphaned `#options` (no navigation in body), no `*finish`/`*ending` in scene.

---

### `CrossScene` (crossscene.js)

```js
CrossScene.getSceneNames()               // → Set of filenames from all open tabs
CrossScene.lintCrossScene(lines, names)  // → { issues, errorLines }
CrossScene.update()                      // Triggers Highlight.apply() on active editor
```

Validates `*goto_scene` and `*gosub_scene` targets against open tab filenames. Only knows about scenes that are open as tabs — the linter badge in the Reference panel communicates this limitation.

---

### `Undo` (undo.js)

Per-tab undo/redo. Each tab gets its own history stack keyed by tab ID. Snapshots are debounced (400ms) so rapid typing creates one snapshot, not hundreds.

```js
Undo.push(plain)        // Debounced snapshot (every keystroke)
Undo.pushNow(plain)     // Immediate snapshot (before paste, snippet, replace)
Undo.undo()             // → plain text string or false
Undo.redo()             // → plain text string or false
Undo.initTab(id, text)  // Seed a new stack
Undo.deleteTab(id)      // Clean up when tab closed
Undo.ensureTab(id, text)// Seed if not already present
```

**Critical:** always call `Undo.pushNow(plain)` before any destructive bulk change (paste, snippet insert, replace all). The debounced `push()` is for incremental typing only.

---

### `Folding` (folding.js)

Block folding for `*if`/`*endif` and `*choice`/`*fake_choice` blocks. The gutter div is entirely owned by Folding when this module is loaded — `LineNumbers.update()` is bypassed in favour of `Folding.updateGutter()`.

```js
Folding.findRanges(lines)        // → [{ start, end, type }] foldable regions
Folding.getHiddenLines(lines)    // → Set of line indices to hide
Folding.updateGutter(lines)      // Rebuild gutter with fold icons
Folding.toggleFold(startLine)    // Flip fold state for a region
Folding.initTab(tabId)           // Create empty fold set for new tab
Folding.deleteTab(tabId)         // Clean up on tab close
```

**Integration point:** `Highlight.apply()` calls `Folding.getHiddenLines()` to skip hidden lines when building editor HTML, then calls `Folding.updateGutter()` instead of `LineNumbers.update()`.

---

### `Highlight` (highlight.js)

The central orchestrator. Called on every content change.

```js
Highlight.apply(editorEl)   // Full re-render: lint → highlight → gutter → sidebar → save → undo
Highlight.esc(str)          // HTML escape (& < >)
Highlight.line(raw, index)  // Returns HTML for one line
```

**Pipeline inside `apply()`:**
1. Save caret position
2. Extract plain text
3. Run `Linter.run()` + `CrossScene.lintCrossScene()` — merge results into `State.lastLint`
4. Get `Folding.getHiddenLines()` — skip hidden lines
5. Build `innerHTML` from visible lines
6. Restore caret
7. Call `Folding.updateGutter()` (or `LineNumbers.update()` as fallback)
8. Call `Sidebar.update()`, `WordCount.update()`, `FileManager.scheduleSave()`, `Undo.push()`
9. Call `Search.reapplyIfOpen()`

---

### `Sidebar` (sidebar.js)

```js
Sidebar.update(lines, issues)   // Refresh all four panels
WordCount.update(plain)         // Update scene + total word counts
```

Four panels: Issues (linter output), Sections (heading-style `*comment` lines), Labels (`*label` declarations), Variables (`*create`/`*temp` with scope-tracked current values).

**Scope-aware variable tracking:** `updateVars()` does a linear walk of `*set` statements after collecting declarations, updating `current` for each matched variable. This is intentionally approximate — it ignores branching — but useful as a quick sanity check.

**Section detection rules:** a `*comment` line is treated as a section marker if its text starts with `──`, `===`, `---`, `###`, `▸`, or `►`, or if it matches `^[A-Z][A-Z\s]{3,}$` (all-caps phrases).

---

### `Tabs` (tabs.js)

```js
Tabs.init()
Tabs.newTab(filename, content)   // → tab ID or null if at limit
Tabs.closeTab(id)
Tabs.renameTab(id)               // Starts inline contenteditable rename
Tabs.syncFilename(name)          // Called from filename input's input event
Tabs.flushContent(plain)         // Called by FileManager autosave
Tabs.getAllTabs()                 // → shallow copy of tab array
Tabs.getActiveId()               // → active tab ID string
```

**Drag reorder:** each tab div gets `draggable="true"` and dragstart/dragover/drop listeners. On drop, the `tabs` array is spliced and `renderStrip()` + `save()` are called.

**Ctrl+Tab:** bound in `init()` via `document.addEventListener('keydown')`. Cycles the `tabs` array by index with modular arithmetic.

**Persistence:** `save()` JSON-serialises the `tabs` array to `localStorage`. It always flushes the active tab's current content from the editor before saving, so the stored content is never stale.

---

### `Project` (project.js)

```js
Project.exportProject()           // Prompts for name, downloads .cside.json
Project.importProject(event)      // Reads manifest, chains file pickers per scene
```

The project manifest is a simple JSON structure:
```json
{
  "version": 1,
  "name": "My Game",
  "scenes": ["startup", "chapter1", "chapter2"],
  "created": "2025-01-01T00:00:00.000Z"
}
```

File pickers are chained sequentially using recursion (`_pickSceneFiles`) because browsers don't allow opening multiple file dialogs simultaneously.

---

### `Search` (search.js)

```js
Search.open() / Search.close() / Search.toggle()
Search.runSearch()          // Recompute matches from current editor content
Search.next() / Search.prev()
Search.replaceCurrent() / Search.replaceAll()
Search.bindEvents()
Search.reapplyIfOpen()      // Called from Highlight.apply — reruns search if panel open
```

**State machine:** `isOpen` guards all Escape handlers. `reapplyIfOpen()` calls `runSearch()` (not a DOM rebuild directly) so match positions are always recomputed against fresh content. `next()`/`prev()` call `_rerenderAndScroll()` which calls `applySearchHighlights()` before scrolling, ensuring the `.current` DOM marker moves before `querySelector` tries to find it.

---

### `Reference` (reference.js)

Self-contained modal. All content is defined in the `SECTIONS` data array inside the module. `buildModal()` renders everything into a new DOM node appended to `<body>`. No dependencies on other CS·IDE modules except that it calls `document.getElementById('editor').focus()` on close.

---

## Data Flow

### Keystroke → render cycle

```
User types
  └→ input event on #editor
       └→ Highlight.apply(editorEl)
            ├→ Caret.getOffset()              [save cursor]
            ├→ Editor.getPlainText()          [extract plain text]
            ├→ Linter.run() + CrossScene…     [lint]
            ├→ Folding.getHiddenLines()       [which lines to skip]
            ├→ build innerHTML                [syntax HTML]
            ├→ Caret.setOffset()              [restore cursor]
            ├→ Folding.updateGutter()         [rebuild gutter]
            ├→ Sidebar.update()               [issues/sections/labels/vars]
            ├→ WordCount.update()             [scene + total count]
            ├→ FileManager.scheduleSave()     [debounced autosave]
            ├→ Undo.push()                    [debounced snapshot]
            └→ Search.reapplyIfOpen()         [recompute search if open]
```

### Tab switch

```
User clicks tab
  └→ activateTab(newId)
       ├→ flush outgoing tab (content, scroll, caret → tabs array)
       ├→ set activeId, State.activeTabId
       ├→ editorEl.textContent = newTab.content
       ├→ Highlight.apply()                   [full render of new tab]
       ├→ requestAnimationFrame: restore scroll + caret
       ├→ update filename-input
       ├→ renderStrip()
       ├→ save()
       └→ CrossScene.update()
```

### Autosave

```
Highlight.apply()
  └→ FileManager.scheduleSave(plain)
       └→ setTimeout(1000)
            └→ Tabs.flushContent(plain)
                 └→ Tabs.save()               [localStorage.setItem]
```

---

## Adding New Features

### Adding a new linter check

1. Open `linter.js` and add your check inside `run(lines)`. It must produce `{ line, type, msg }` objects pushed to `issues`, and add line indices to the appropriate Set (`errorLines`, `warnLines`, or `orphanLines`).
2. Add tests to `test.js` following the existing pattern.
3. The sidebar and gutter highlighting update automatically — no other changes needed.

### Adding a new sidebar panel

1. Add a `<div class="panel">` block in `index.html` with a unique `id` for header and body.
2. Add CSS for any new item type in `sidebar.css`.
3. Add an `updateMyPanel(lines)` function in `sidebar.js` and call it from `Sidebar.update()`.

### Adding a new snippet

In `snippets.js`, add a key-value pair to the `LIBRARY` object, then add a `<button>` in the snippet bar in `index.html`:

```html
<button onclick="Snippets.insert('my_key')">*mycommand</button>
```

### Adding a new keyboard shortcut

Keyboard shortcuts that modify editor content belong in `editor.js` inside `handleKeydown()`. Application-level shortcuts (tab switching, panels) belong in `tabs.js` or `main.js` DOMContentLoaded handlers. Always call `e.preventDefault()` for shortcuts you handle.

### Adding a new modal

Follow the `Reference` module pattern: build the DOM in JS, append to `<body>`, guard Escape with `classList.contains('open')`, use `e.stopPropagation()` on Escape so other Escape handlers don't fire.

---

## Testing Strategy

Tests run in Node.js with no test framework — just `assert`/`assertEqual` helpers and `try/catch`. The test files import nothing; all logic under test is either inlined or extracted from source files via `eval` after stripping IIFE wrappers.

```
node test.js           # 69 tests — linter, undo, search, highlight, auto-indent, font size
node test_features.js  # 44 tests — all 8 new features
```

**What gets tested:** pure functions that transform data. `findRanges`, `getHiddenLines`, `extractSections`, `trackVars`, `countProse`, `cycleTab`, `reorderTabs` — all testable without a browser.

**What doesn't get tested:** anything that touches the DOM (`renderStrip`, `Highlight.apply`, `Sidebar.update`). These are tested manually by opening `index.html` in a browser.

**Rule for new features:** extract the core logic into a pure function, test that function, then call it from the DOM-touching wrapper.

---

## Lessons Learned

### 1. `innerHTML` kills the browser's native undo stack

The single biggest architectural decision. The moment you set `editorEl.innerHTML = ...`, the browser forgets every keypress that led to that state. We rebuild the entire editor HTML on every keystroke (for syntax highlighting), so we had to implement our own undo history (`undo.js`). The custom stack debounces at 400ms so rapid typing creates one snapshot, not one per character. Key insight: call `Undo.pushNow()` before any bulk destructive change (paste, snippet, replace) to create an immediate checkpoint.

### 2. Caret position requires character offsets, not DOM node references

After every `innerHTML` rebuild, all DOM nodes are replaced — any `Range` or `Node` reference you saved is invalid. The only stable reference is a character index into the plain text string. `Caret.getOffset()` walks the DOM to compute this; `Caret.setOffset()` walks it again to find the right node/offset pair. This is O(n) per keystroke but imperceptible for typical scene lengths.

### 3. Search and highlight need to cooperate, not interleave

Early design had search highlighting injected directly into the editor DOM, then `Highlight.apply()` would wipe it. The fix: `Search.reapplyIfOpen()` is called at the very end of `Highlight.apply()`, so search always wins. But `reapplyIfOpen()` must recompute match positions from fresh content (not use stale offsets from the last search), because the content may have changed since the panel was last focused. Always call `runSearch()` from `reapplyIfOpen()`, not a cheaper "re-render from cached matches" function.

### 4. `next()`/`prev()` in search must re-render before scrolling

`scrollToMatch()` uses `querySelector('.search-match.current')` to find the element to scroll to. If you update `currentMatch` (the index) without re-rendering the HTML, the `.current` CSS class is still on the old element and the scroll goes to the wrong place. Always rebuild the HTML (updating which element has `.current`) before calling `scrollIntoView`.

### 5. `escHtml()` must escape double-quotes in HTML attributes

Standard HTML escaping covers `&`, `<`, `>`. But if you're putting escaped content into a double-quoted HTML attribute (like `data-search="..."`), any literal `"` in the content will close the attribute early and produce malformed HTML. Add `.replace(/"/g, '&quot;')` to your escape function, or use single-quoted attributes throughout. This was a real bug: the `*page_break` card's search text contained `"Next"` and broke the card's searchability until the escaper was fixed.

### 6. Two `document.addEventListener('keydown')` handlers for the same key don't conflict via `stopPropagation`

`stopPropagation()` stops an event from bubbling *up* the DOM tree, but when both listeners are on `document` (the root), the event is already at its destination — all listeners fire. Use `stopImmediatePropagation()` to prevent sibling listeners from firing, or (simpler) just guard each handler with its own state flag: the Search Escape handler checks `isOpen`, the Reference Escape handler checks `classList.contains('open')`. They don't interfere because only one can be open at a time.

### 7. Folding must own the gutter, not share it with LineNumbers

When folding is active, the gutter needs to render fold icons, skip hidden lines, and maintain a mapping from visual row to logical line number. `LineNumbers.update(count)` just renders 1..N with no such awareness. The cleanest solution: when `folding.js` is loaded, it takes over the gutter entirely. `Highlight.apply()` calls `Folding.updateGutter()` instead of `LineNumbers.update()`. The `LineNumbers.update()` call remains as a fallback for environments where folding isn't loaded. This "module presence" pattern (`if (typeof Folding !== 'undefined')`) avoids hard coupling.

### 8. Tab drag reorder requires careful `splice` ordering

To move a tab from index `src` to index `dest`: `splice(src, 1)` removes the element and shifts all subsequent indices down by 1. If `dest > src`, the target index is now `dest - 1` (because removal shifted it). The simplest solution: save the element first (`const [moved] = tabs.splice(srcIdx, 1)`), then `tabs.splice(destIdx, 0, moved)`. Since `destIdx` was computed before the splice, it's the correct pre-removal index for the drop target — which, after removal and reinsertion, lands the element exactly where the user dropped it. The naive approach of computing `destIdx` after `srcIdx` removal causes off-by-one errors on forward moves.

### 9. Project file loading can't open multiple file dialogs at once

Browsers block multiple simultaneous `<input type="file">` dialogs. The only way to load several scene files is to chain them sequentially — open one picker, wait for selection (or skip), then open the next. The recursive `_pickSceneFiles(scenes, index)` pattern handles this cleanly. Each call creates a fresh `<input>` element, clicks it programmatically, and recursively calls itself for the next scene in the `onchange` handler. The user gets one dialog per scene, in order.

### 10. Scope-aware variable tracking is deliberately approximate

The Variables panel shows estimated "current" values by doing a linear walk of `*set` statements. This ignores branching (`*if`/`*else` blocks may set different values). The `~` indicator signals "this has been modified but the value shown is only one possible current state." Trying to do full flow analysis would require building a control-flow graph and is far out of scope for a lightweight sidebar widget. Communicating the approximation to the user (via the `~` badge and tooltip showing the initial value) is more honest than hiding it.

### 11. Pure functions are the key to testability without a browser

Every feature that would be painful to test with a real DOM was extracted into a pure function first: `findRanges(lines)`, `getHiddenLines(lines)`, `extractSections(lines)`, `trackVars(lines)`, `countProse(plain)`, `cycleTab(tabs, activeId, direction)`, `reorderTabs(tabs, srcId, destId)`. These take plain arrays and strings, return plain arrays and strings, and have no dependencies on `document` or `window`. The DOM-touching wrappers call these functions and are tested manually. This discipline kept the new feature test suite at 44 tests with zero DOM stubs needed for the logic tests.

### 12. localStorage keys must use named constants

Using string literals like `'cs-ide-tabs'` in two places means a typo in one is invisible until runtime. Define `const STORAGE_KEY = 'cs-ide-tabs'` once, use the constant everywhere. When we added migration code to read old v1 keys (`cs-ide-content`, `cs-ide-filename`), having the new keys as constants made it easy to verify there were no collisions and no hardcoded duplicates.
