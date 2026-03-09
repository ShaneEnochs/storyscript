// linenumbers.js — line number gutter
// Renders a fixed gutter to the left of the editor.
// Stays in sync with the editor's scroll position.

const LineNumbers = (() => {
  let lineCount = 0;

  function init() {
    const editorEl = document.getElementById('editor');
    const gutter   = document.getElementById('line-gutter');

    // Keep scroll positions in sync
    editorEl.addEventListener('scroll', () => {
      gutter.scrollTop = editorEl.scrollTop;
    });
  }

  function update(count, force) {
    if (count === lineCount && !force) return;
    lineCount = count;
    const gutter = document.getElementById('line-gutter');
    let html = '';
    for (let i = 1; i <= count; i++) {
      html += `<div class="ln">${i}</div>`;
    }
    gutter.innerHTML = html;
  }

  // Force a full re-render even if line count hasn't changed.
  // Called by FontSize after changing the editor font size.
  function forceUpdate() {
    if (typeof Folding !== 'undefined') {
      // Folding owns the gutter — trigger a full re-render via Highlight
      const editorEl = document.getElementById('editor');
      if (editorEl) Highlight.apply(editorEl);
      return;
    }
    const editorEl = document.getElementById('editor');
    const count = editorEl ? editorEl.innerHTML.split('<br>').length : lineCount;
    update(count, true);
  }

  return { init, update, forceUpdate };
})();
