// caret.js — character-offset based caret save/restore
// Needed because re-rendering innerHTML resets the cursor to position 0.

const Caret = (() => {

  function getOffset(el) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    return { start, end: start + range.toString().length };
  }

  function setOffset(el, start, end) {
    const sel = window.getSelection();
    if (!sel) return;

    let cc = 0, sn = null, so = 0, en = null, eo = 0;

    function walk(node) {
      if (sn && en) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent.length;
        if (!sn && cc + len >= start) { sn = node; so = start - cc; }
        if (!en && cc + len >= end)   { en = node; eo = end   - cc; }
        cc += len;
      } else {
        for (const child of node.childNodes) walk(child);
      }
    }
    walk(el);

    if (!sn) { sn = el; so = 0; }
    if (!en) { en = sn; eo = so; }

    try {
      const r = document.createRange();
      r.setStart(sn, so);
      r.setEnd(en, eo);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch (e) { /* ignore edge cases at document boundaries */ }
  }

  return { getOffset, setOffset };
})();
