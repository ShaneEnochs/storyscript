// folding.js — *if block and *choice block folding
// Adds clickable fold icons in the line gutter.
// Folded ranges are stored per-tab in foldedRanges map.
// Depends on: State, Editor, Highlight, Caret, LineNumbers

const Folding = (() => {
  // { [tabId]: Set of startLine indices that are folded }
  const foldedRanges = {};

  function getSet() {
    const id = State.activeTabId;
    if (!id) return new Set();
    if (!foldedRanges[id]) foldedRanges[id] = new Set();
    return foldedRanges[id];
  }

  // ── Find foldable ranges in the current file ──────────────────────
  // Returns array of { start, end, type } where start/end are line indices
  function findRanges(lines) {
    const ranges = [];

    // *if ... *endif pairs (tracks nesting depth)
    const ifStack = [];
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (/^\*if\b/.test(t)) {
        ifStack.push({ line: i, type: 'if' });
      } else if (/^\*(elseif|else)\b/.test(t)) {
        // Treat *elseif/*else as ending the previous block and starting new
        // For folding we only fold the *if...first-branch, not the whole chain
      } else if (/^\*endif\b/.test(t)) {
        if (ifStack.length > 0) {
          const top = ifStack.pop();
          if (i > top.line + 1) {
            ranges.push({ start: top.line, end: i, type: 'if' });
          }
        }
      }
    });

    // *choice/*fake_choice blocks — fold to next unindented non-blank line
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (/^\*(choice|fake_choice)\b/.test(t)) {
        const choiceIndent = line.match(/^(\s*)/)[1].length;
        let end = i + 1;
        while (end < lines.length) {
          const lt = lines[end].trimStart();
          const li = lines[end].match(/^(\s*)/)[1].length;
          if (lt.length > 0 && li <= choiceIndent) break;
          end++;
        }
        if (end > i + 1) {
          ranges.push({ start: i, end: end - 1, type: 'choice' });
        }
      }
    });

    return ranges;
  }

  // ── Build the gutter with fold icons ──────────────────────────────
  function updateGutter(lines) {
    const gutter  = document.getElementById('line-gutter');
    if (!gutter) return;

    const ranges  = findRanges(lines);
    const folded  = getSet();

    // Map: startLine -> range
    const startMap = {};
    ranges.forEach(r => { startMap[r.start] = r; });

    // Which lines are hidden (inside a folded range)?
    const hiddenLines = new Set();
    folded.forEach(startLine => {
      const r = ranges.find(r => r.start === startLine);
      if (r) {
        for (let l = startLine + 1; l <= r.end; l++) hiddenLines.add(l);
      }
    });

    // Rebuild gutter divs
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      if (hiddenLines.has(i)) continue;
      const r = startMap[i];
      let icon = '';
      if (r) {
        const isFolded = folded.has(i);
        icon = `<span class="fold-icon${isFolded ? ' folded' : ''}" data-line="${i}" title="${isFolded ? 'Expand' : 'Fold'}">${isFolded ? '▶' : '▼'}</span>`;
      } else {
        icon = '<span class="fold-spacer"></span>';
      }
      html += `<div class="ln" data-line="${i}">${icon}${i + 1}</div>`;
    }
    gutter.innerHTML = html;

    // Bind click handlers on fold icons
    gutter.querySelectorAll('.fold-icon').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        toggleFold(parseInt(el.dataset.line));
      });
    });
  }

  // ── Toggle a fold ──────────────────────────────────────────────────
  function toggleFold(startLine) {
    const folded = getSet();
    if (folded.has(startLine)) {
      folded.delete(startLine);
    } else {
      folded.add(startLine);
    }
    // Re-render with folded state
    const editorEl = document.getElementById('editor');
    Highlight.apply(editorEl);
  }

  // ── Get set of lines that should be hidden ─────────────────────────
  function getHiddenLines(lines) {
    const folded = getSet();
    const ranges = findRanges(lines);
    const hidden = new Set();
    folded.forEach(startLine => {
      const r = ranges.find(r => r.start === startLine);
      if (r) {
        for (let l = startLine + 1; l <= r.end; l++) hidden.add(l);
      }
    });
    return hidden;
  }

  // ── Called when switching tabs — reset fold state for new tab ─────
  function initTab(tabId) {
    if (!foldedRanges[tabId]) foldedRanges[tabId] = new Set();
  }

  // ── Clear folds for a closed tab ──────────────────────────────────
  function deleteTab(tabId) {
    delete foldedRanges[tabId];
  }

  return { updateGutter, getHiddenLines, findRanges, initTab, deleteTab, toggleFold };
})();
