// undo.js — manual undo/redo history stack
// Required because re-rendering innerHTML destroys the browser's native undo stack.
// Strategy: snapshot plain text on every change, debounced to avoid per-keystroke bloat.

const Undo = (() => {
  const MAX_HISTORY  = 200;   // max snapshots kept
  const DEBOUNCE_MS  = 400;   // ms of inactivity before a new snapshot is committed

  // Each tab gets its own independent stack, keyed by tab id
  const stacks = {};  // { [tabId]: { history: string[], cursor: number } }

  let debounceTimer = null;
  let pendingSnapshot = null;

  function getStack() {
    const id = State.activeTabId;
    if (!id) return null;
    if (!stacks[id]) stacks[id] = { history: [], cursor: -1 };
    return stacks[id];
  }

  // ── Push a new snapshot (debounced) ───────────────────────────────────
  // Call this on every content change. The actual push is deferred so rapid
  // typing doesn't create hundreds of identical-or-near-identical entries.
  function push(plain) {
    clearTimeout(debounceTimer);
    pendingSnapshot = plain;
    debounceTimer = setTimeout(() => {
      commitSnapshot(pendingSnapshot);
      pendingSnapshot = null;
    }, DEBOUNCE_MS);
  }

  function commitSnapshot(plain) {
    const stack = getStack();
    if (!stack) return;

    // Ignore if identical to current top
    if (stack.history[stack.cursor] === plain) return;

    // Truncate forward history if we're mid-stack
    stack.history = stack.history.slice(0, stack.cursor + 1);
    stack.history.push(plain);

    // Trim to MAX_HISTORY
    if (stack.history.length > MAX_HISTORY) {
      stack.history = stack.history.slice(stack.history.length - MAX_HISTORY);
    }

    stack.cursor = stack.history.length - 1;
  }

  // Force an immediate snapshot (e.g. before a snippet insert or paste)
  function pushNow(plain) {
    clearTimeout(debounceTimer);
    commitSnapshot(plain);
  }

  // ── Undo ──────────────────────────────────────────────────────────────
  function undo() {
    // Flush any pending snapshot first
    if (pendingSnapshot !== null) {
      commitSnapshot(pendingSnapshot);
      pendingSnapshot = null;
      clearTimeout(debounceTimer);
    }

    const stack = getStack();
    if (!stack || stack.cursor <= 0) return false;

    stack.cursor--;
    return stack.history[stack.cursor];
  }

  // ── Redo ──────────────────────────────────────────────────────────────
  function redo() {
    const stack = getStack();
    if (!stack || stack.cursor >= stack.history.length - 1) return false;
    stack.cursor++;
    return stack.history[stack.cursor];
  }

  // ── Init stack for a new tab ──────────────────────────────────────────
  function initTab(tabId, initialContent) {
    stacks[tabId] = { history: [initialContent], cursor: 0 };
  }

  // ── Delete stack when tab is closed ──────────────────────────────────
  function deleteTab(tabId) {
    delete stacks[tabId];
  }

  // ── Seed a stack if it doesn't exist yet (for restored tabs) ─────────
  function ensureTab(tabId, content) {
    if (!stacks[tabId]) {
      stacks[tabId] = { history: [content], cursor: 0 };
    }
  }

  return { push, pushNow, undo, redo, initTab, deleteTab, ensureTab };
})();
