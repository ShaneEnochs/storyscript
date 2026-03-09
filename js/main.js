// main.js — global shared state and app initialisation
// Must be loaded last. All other modules are available when this runs.

// ── Shared mutable state ──────────────────────────────────────────────
const State = {
  isComposing: false,
  lastLint: {
    issues:      [],
    errorLines:  new Set(),
    warnLines:   new Set(),
    orphanLines: new Set(),
  },
  activeTabId: null,
};

// ── Starter scene ─────────────────────────────────────────────────────
const STARTER = `*comment Welcome to CS·IDE — your personal ChoiceScript editor.
*temp player_name "Hero"
*temp courage 50

*label start
You stand at the edge of a forest.

*choice
    #Step into the shadows.
        *set courage -10
        The darkness swallows you whole.
        *goto deeper
    #Turn back toward the village.
        *set courage +5
        Some battles aren't worth fighting.
        *goto village

*label deeper
The trees close in around you.
*finish

*label village
The fire in the inn window flickers gold.
*finish
`;

// ── Bootstrap ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  LineNumbers.init();
  Editor.bindEvents();
  Search.bindEvents();
  Reference.init();
  Tabs.init();
  document.getElementById('editor').focus();

  // Ctrl+click on editor: hint cursor when Ctrl/Cmd held
  const editorEl = document.getElementById('editor');
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) editorEl.style.cursor = 'pointer';
  });
  document.addEventListener('keyup', e => {
    if (!e.ctrlKey && !e.metaKey) editorEl.style.cursor = '';
  });
});
