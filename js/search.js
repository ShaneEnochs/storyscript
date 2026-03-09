// search.js — Find & Replace panel
// Opens with Ctrl+F / Cmd+F (prevents browser find).
// Highlights all matches inline, navigates between them, and supports replace.

const Search = (() => {
  let matches       = [];   // array of {start, end} in the plain text
  let currentMatch  = -1;
  let isOpen        = false;

  // ── Open / close ──────────────────────────────────────────────────────
  function open() {
    const panel = document.getElementById('search-panel');
    panel.classList.add('open');
    isOpen = true;
    const input = document.getElementById('search-input');
    input.focus();
    input.select();
    runSearch();
  }

  function close() {
    const panel = document.getElementById('search-panel');
    panel.classList.remove('open');
    isOpen = false;
    clearHighlights();
    document.getElementById('editor').focus();
  }

  function toggle() { isOpen ? close() : open(); }

  // ── Search ────────────────────────────────────────────────────────────
  function runSearch() {
    const query     = document.getElementById('search-input').value;
    const caseSens  = document.getElementById('search-case').checked;
    const useRegex  = document.getElementById('search-regex').checked;
    const editorEl  = document.getElementById('editor');
    const plain     = Editor.getPlainText(editorEl);

    matches      = [];
    currentMatch = -1;

    if (!query) {
      updateStatus();
      clearHighlights();
      return;
    }

    try {
      let pattern;
      if (useRegex) {
        pattern = new RegExp(query, caseSens ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, caseSens ? 'g' : 'gi');
      }

      let m;
      while ((m = pattern.exec(plain)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
        if (pattern.lastIndex === m.index) pattern.lastIndex++; // avoid infinite loop on zero-length match
      }
    } catch(e) {
      // Invalid regex — just show no matches
    }

    if (matches.length > 0) currentMatch = 0;
    updateStatus();
    applySearchHighlights(plain);
    scrollToMatch();
  }

  function next() {
    if (!matches.length) return;
    currentMatch = (currentMatch + 1) % matches.length;
    updateStatus();
    _rerenderAndScroll();
  }

  function prev() {
    if (!matches.length) return;
    currentMatch = (currentMatch - 1 + matches.length) % matches.length;
    updateStatus();
    _rerenderAndScroll();
  }

  // Re-render the editor with updated .current marker, then scroll to it.
  function _rerenderAndScroll() {
    const editorEl = document.getElementById('editor');
    const plain    = Editor.getPlainText(editorEl);
    applySearchHighlights(plain);
    requestAnimationFrame(() => {
      const el = editorEl.querySelector('.search-match.current');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  // ── Replace ───────────────────────────────────────────────────────────
  function replaceCurrent() {
    if (!matches.length || currentMatch < 0) return;
    const editorEl   = document.getElementById('editor');
    const plain      = Editor.getPlainText(editorEl);
    const replacement = document.getElementById('replace-input').value;
    const match      = matches[currentMatch];

    const newPlain = plain.slice(0, match.start) + replacement + plain.slice(match.end);
    Undo.pushNow(plain);
    editorEl.textContent = newPlain;
    // Highlight.apply will trigger reapplyIfOpen -> runSearch automatically
    Highlight.apply(editorEl);
  }

  function replaceAll() {
    const query     = document.getElementById('search-input').value;
    if (!query) return;
    const caseSens  = document.getElementById('search-case').checked;
    const useRegex  = document.getElementById('search-regex').checked;
    const replacement = document.getElementById('replace-input').value;
    const editorEl  = document.getElementById('editor');
    const plain     = Editor.getPlainText(editorEl);

    try {
      let pattern;
      if (useRegex) {
        pattern = new RegExp(query, caseSens ? 'g' : 'gi');
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escaped, caseSens ? 'g' : 'gi');
      }
      Undo.pushNow(plain);
      const newPlain = plain.replace(pattern, replacement);
      editorEl.textContent = newPlain;
      // Highlight.apply will trigger reapplyIfOpen -> runSearch automatically
      Highlight.apply(editorEl);
    } catch(e) {}
  }

  // ── Highlight matches in the editor ───────────────────────────────────
  // We rebuild the innerHTML with match spans injected.
  // This cooperates with Highlight.apply: after a search, Highlight.apply
  // re-renders syntax AND re-injects search highlights on top.

  function applySearchHighlights(plain) {
    if (!matches.length) return;
    // Store matches on State so highlight.js can access them during render
    State.searchMatches  = matches;
    State.currentMatch   = currentMatch;
    // Re-apply highlight which will pick up State.searchMatches
    const editorEl = document.getElementById('editor');
    const caret    = Caret.getOffset(editorEl);
    // Rebuild HTML with search marks
    const html = buildHighlightedHTML(plain);
    editorEl.innerHTML = html;
    Caret.setOffset(editorEl, caret.start, caret.end);
  }

  function clearHighlights() {
    State.searchMatches = [];
    State.currentMatch  = -1;
    const editorEl = document.getElementById('editor');
    Highlight.apply(editorEl);
  }

  // Build complete editor HTML with syntax + search highlights merged.
  // Called only when search is active; otherwise Highlight.apply handles it.
  function buildHighlightedHTML(plain) {
    const lines = plain.split('\n');

    // Build a flat character map: for each char index, what class to apply
    // We'll overlay match spans on top of syntax
    // Strategy: build per-line HTML from Highlight, then inject mark spans

    // Build offset map: line i starts at offset lineOffsets[i]
    const lineOffsets = [];
    let off = 0;
    for (const line of lines) {
      lineOffsets.push(off);
      off += line.length + 1; // +1 for \n
    }

    return lines.map((rawLine, i) => {
      const lineStart = lineOffsets[i];
      const lineEnd   = lineStart + rawLine.length;

      // Find matches that overlap this line
      const lineMatches = matches.map((m, idx) => ({
        start: m.start, end: m.end,
        isCurrent: idx === currentMatch,
      })).filter(m => m.end > lineStart && m.start < lineEnd);

      if (!lineMatches.length) {
        // No matches on this line — standard syntax highlight
        return Highlight.line(rawLine, i);
      }

      // Build character-level annotated string for this line
      // We'll split rawLine into segments based on match boundaries
      const segments = [];
      let cursor = 0;
      for (const m of lineMatches) {
        const mStart = Math.max(0, m.start - lineStart);
        const mEnd   = Math.min(rawLine.length, m.end - lineStart);
        if (cursor < mStart) segments.push({ text: rawLine.slice(cursor, mStart), mark: false });
        segments.push({ text: rawLine.slice(mStart, mEnd), mark: true, current: m.isCurrent });
        cursor = mEnd;
      }
      if (cursor < rawLine.length) segments.push({ text: rawLine.slice(cursor), mark: false });

      // Build HTML: escape each segment, wrap marks
      const html = segments.map(seg => {
        const escaped = Highlight.esc(seg.text);
        if (seg.mark) {
          const cls = seg.current ? 'search-match current' : 'search-match';
          return `<mark class="${cls}">${escaped}</mark>`;
        }
        return escaped;
      }).join('');

      // Apply lint wrapper if needed
      const lint = State.lastLint;
      let wrapClass = '';
      if      (lint.errorLines.has(i))  wrapClass = 'hl-err-line';
      else if (lint.warnLines.has(i))   wrapClass = 'hl-warn-line';
      else if (lint.orphanLines.has(i)) wrapClass = 'hl-orphan';

      return wrapClass ? `<span class="${wrapClass}">${html}</span>` : html;
    }).join('<br>');
  }

  function scrollToMatch() {
    if (currentMatch < 0 || !matches.length) return;
    // Just scroll — applySearchHighlights was already called by runSearch
    requestAnimationFrame(() => {
      const editorEl = document.getElementById('editor');
      const el = editorEl.querySelector('.search-match.current');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  // ── Status text ───────────────────────────────────────────────────────
  function updateStatus() {
    const el = document.getElementById('search-status');
    if (!el) return;
    if (!document.getElementById('search-input').value) {
      el.textContent = '';
    } else if (!matches.length) {
      el.textContent = 'No matches';
      el.className = 'search-status no-match';
    } else {
      el.textContent = `${currentMatch + 1} / ${matches.length}`;
      el.className = 'search-status';
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────
  function bindEvents() {
    // Trap Ctrl+F / Cmd+F globally
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        open();
        return;
      }
      if (e.key === 'Escape' && isOpen) {
        close();
        return;
      }
    });

    document.getElementById('search-input').addEventListener('input', runSearch);
    document.getElementById('search-case').addEventListener('change', runSearch);
    document.getElementById('search-regex').addEventListener('change', runSearch);

    document.getElementById('search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.shiftKey ? prev() : next(); }
    });

    document.getElementById('search-next').addEventListener('click', next);
    document.getElementById('search-prev').addEventListener('click', prev);
    document.getElementById('search-close').addEventListener('click', close);
    document.getElementById('search-replace-btn').addEventListener('click', replaceCurrent);
    document.getElementById('search-replace-all').addEventListener('click', replaceAll);
  }

  // Called after Highlight.apply to re-apply search highlights if panel is open.
  // Re-runs the full search so match positions are correct against the new content.
  function reapplyIfOpen() {
    if (!isOpen) return;
    // runSearch rebuilds matches against current content and re-renders highlights
    runSearch();
  }

  return { open, close, toggle, runSearch, next, prev, replaceCurrent, replaceAll, bindEvents, reapplyIfOpen };
})();
