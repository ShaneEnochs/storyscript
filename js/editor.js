// editor.js — core editor behaviour
// Plain text extraction, loadText, key handling, paste, scrollToLine, fold.
// Depends on: caret.js, highlight.js, undo.js, State

const Editor = (() => {

  // ── Plain text extraction ─────────────────────────────────────────────
  function getPlainText(el) {
    let text = '';
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeName === 'BR') {
        text += '\n';
      } else {
        for (const child of node.childNodes) walk(child);
        if (['DIV', 'P'].includes(node.nodeName) && node !== el) text += '\n';
      }
    }
    walk(el);
    return text;
  }

  // ── Load text into editor ─────────────────────────────────────────────
  function loadText(text) {
    const editorEl = document.getElementById('editor');
    editorEl.textContent = text;
    Highlight.apply(editorEl);
    editorEl.focus();
  }

  // ── Scroll to a given line index ──────────────────────────────────────
  function scrollToLine(lineIndex) {
    const editorEl = document.getElementById('editor');
    const plain    = getPlainText(editorEl);
    const lines    = plain.split('\n');

    const offset = lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0);
    Caret.setOffset(editorEl, offset, offset);
    editorEl.focus();

    let brCount = 0;
    for (const node of editorEl.childNodes) {
      if (node.nodeName === 'BR') {
        brCount++;
        if (brCount === lineIndex) {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
          break;
        }
      }
    }
  }

  // ── Keyboard ──────────────────────────────────────────────────────────
  function handleKeydown(e) {
    const editorEl = document.getElementById('editor');

    // Undo: Ctrl+Z / Cmd+Z
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      const snapshot = Undo.undo();
      if (snapshot !== false) {
        const caret = Caret.getOffset(editorEl);
        editorEl.textContent = snapshot;
        Highlight.apply(editorEl);
        Caret.setOffset(editorEl, Math.min(caret.start, snapshot.length), Math.min(caret.start, snapshot.length));
      }
      return;
    }

    // Redo: Ctrl+Shift+Z / Cmd+Shift+Z  or  Ctrl+Y
    if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
      e.preventDefault();
      const snapshot = Undo.redo();
      if (snapshot !== false) {
        const caret = Caret.getOffset(editorEl);
        editorEl.textContent = snapshot;
        Highlight.apply(editorEl);
        Caret.setOffset(editorEl, Math.min(caret.start, snapshot.length), Math.min(caret.start, snapshot.length));
      }
      return;
    }

    // Tab → insert 4 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const caret = Caret.getOffset(editorEl);
      const plain = getPlainText(editorEl);
      editorEl.textContent = plain.slice(0, caret.start) + '    ' + plain.slice(caret.end);
      Highlight.apply(editorEl);
      Caret.setOffset(editorEl, caret.start + 4, caret.start + 4);
      return;
    }

    // Enter → smart auto-indent
    if (e.key === 'Enter') {
      e.preventDefault();
      const caret    = Caret.getOffset(editorEl);
      const plain    = getPlainText(editorEl);
      const lastLine = plain.slice(0, caret.start).split('\n').pop();
      const trimmed  = lastLine.trimStart();
      const base     = lastLine.match(/^(\s*)/)[1];

      const indent = (
        /^#/.test(trimmed) ||
        /^\*(choice|fake_choice)\b/.test(trimmed)
      ) ? base + '    ' : base;

      editorEl.textContent =
        plain.slice(0, caret.start) + '\n' + indent + plain.slice(caret.end);

      const newPos = caret.start + 1 + indent.length;
      Highlight.apply(editorEl);
      Caret.setOffset(editorEl, newPos, newPos);
      return;
    }
  }

  // ── Paste ──────────────────────────────────────────────────────────────
  function handlePaste(e) {
    e.preventDefault();
    const editorEl = document.getElementById('editor');
    const text     = e.clipboardData.getData('text/plain');
    const caret    = Caret.getOffset(editorEl);
    const plain    = getPlainText(editorEl);

    Undo.pushNow(plain);
    editorEl.textContent = plain.slice(0, caret.start) + text + plain.slice(caret.end);
    const newPos = caret.start + text.length;
    Highlight.apply(editorEl);
    Caret.setOffset(editorEl, newPos, newPos);
  }

  // ── Cmd/Ctrl+click on *goto/*gosub → jump to that label ──────────────
  function handleClick(e) {
    if (!e.metaKey && !e.ctrlKey) return;
    // Walk up to find text content of the clicked element
    const editorEl = document.getElementById('editor');
    const plain    = getPlainText(editorEl);
    const lines    = plain.split('\n');

    // Find which line was clicked using caret position
    const offset = Caret.getOffset(editorEl).start;
    let charCount = 0, clickedLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount + lines[i].length >= offset) { clickedLine = i; break; }
      charCount += lines[i].length + 1;
    }

    const line = lines[clickedLine];
    const m    = line.trimStart().match(/^\*(goto|gosub)\s+(\S+)/);
    if (!m) return;

    const targetLabel = m[2].toLowerCase();
    const labelLine   = lines.findIndex(l => {
      const lm = l.trimStart().match(/^\*label\s+(\S+)/);
      return lm && lm[1].toLowerCase() === targetLabel;
    });

    if (labelLine >= 0) {
      e.preventDefault();
      scrollToLine(labelLine);
    }
  }

  // ── Bind all editor event listeners ───────────────────────────────────
  function bindEvents() {
    const editorEl = document.getElementById('editor');

    editorEl.addEventListener('keydown', handleKeydown);
    editorEl.addEventListener('paste',   handlePaste);
    editorEl.addEventListener('click',   handleClick);

    editorEl.addEventListener('compositionstart', () => { State.isComposing = true; });
    editorEl.addEventListener('compositionend', () => {
      State.isComposing = false;
      Highlight.apply(editorEl);
    });

    editorEl.addEventListener('input', () => {
      if (!State.isComposing) Highlight.apply(editorEl);
    });

    // Sync filename input → tab name
    document.getElementById('filename-input').addEventListener('input', e => {
      Tabs.syncFilename(e.target.value);
    });
  }

  return { getPlainText, loadText, scrollToLine, bindEvents };
})();
