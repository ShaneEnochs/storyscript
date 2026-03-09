// tabs.js — multi-file tab management
// Each tab has: { id, filename, content, scrollTop, caretOffset }
// All tabs persisted to localStorage as JSON under 'cs-ide-tabs' and 'cs-ide-active-tab'.

const Tabs = (() => {
  const STORAGE_KEY      = 'cs-ide-tabs';
  const ACTIVE_KEY       = 'cs-ide-active-tab';
  const MAX_TABS         = 10;

  let tabs     = [];   // array of tab objects
  let activeId = null;

  // ── Persistence ───────────────────────────────────────────────────────
  function save() {
    // Flush current editor content into the active tab before saving
    if (activeId) {
      const editorEl = document.getElementById('editor');
      const tab = tabs.find(t => t.id === activeId);
      if (tab) {
        tab.content    = Editor.getPlainText(editorEl);
        tab.scrollTop  = editorEl.scrollTop;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    localStorage.setItem(ACTIVE_KEY,  activeId || '');
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        tabs = JSON.parse(raw);
        // Ensure every tab has required fields
        tabs = tabs.map(t => ({
          id:          t.id       || uid(),
          filename:    t.filename || 'scene',
          content:     t.content  || '',
          scrollTop:   t.scrollTop || 0,
          caretOffset: t.caretOffset || 0,
        }));
      }
      activeId = localStorage.getItem(ACTIVE_KEY) || null;
      // Validate activeId
      if (!tabs.find(t => t.id === activeId)) {
        activeId = tabs.length ? tabs[0].id : null;
      }
    } catch(e) {
      tabs = [];
      activeId = null;
    }
  }

  // ── UID ───────────────────────────────────────────────────────────────
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ── Render tab strip ──────────────────────────────────────────────────
  function renderStrip() {
    const strip = document.getElementById('tab-strip');
    strip.innerHTML = tabs.map(tab => {
      const active = tab.id === activeId ? ' active' : '';
      const name   = Highlight.esc(tab.filename || 'scene');
      return `<div class="tab${active}" data-id="${tab.id}" draggable="true">
        <span class="tab-name" ondblclick="Tabs.renameTab('${tab.id}')" title="Double-click to rename">${name}</span>
        <button class="tab-close" onclick="Tabs.closeTab('${tab.id}')" title="Close tab">×</button>
      </div>`;
    }).join('');

    // New tab button
    strip.innerHTML += `<button class="tab-new" onclick="Tabs.newTab()" title="New tab">+</button>`;

    // Click to activate
    strip.querySelectorAll('.tab').forEach(el => {
      el.addEventListener('click', e => {
        if (!e.target.classList.contains('tab-close') && !e.target.classList.contains('tab-name')) {
          activateTab(el.dataset.id);
        }
      });
    });
    strip.querySelectorAll('.tab-name').forEach(el => {
      el.addEventListener('click', e => {
        const id = el.closest('.tab').dataset.id;
        activateTab(id);
      });
    });

    // Drag-to-reorder
    _bindDrag(strip);
  }

  // ── Drag-to-reorder implementation ────────────────────────────────────
  let dragSrcId = null;

  function _bindDrag(strip) {
    strip.querySelectorAll('.tab').forEach(el => {
      el.addEventListener('dragstart', e => {
        dragSrcId = el.dataset.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        strip.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
        dragSrcId = null;
      });
      el.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        strip.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
        if (el.dataset.id !== dragSrcId) el.classList.add('drag-over');
      });
      el.addEventListener('drop', e => {
        e.preventDefault();
        if (!dragSrcId || dragSrcId === el.dataset.id) return;
        const srcIdx  = tabs.findIndex(t => t.id === dragSrcId);
        const destIdx = tabs.findIndex(t => t.id === el.dataset.id);
        if (srcIdx < 0 || destIdx < 0) return;
        // Reorder array
        const [moved] = tabs.splice(srcIdx, 1);
        tabs.splice(destIdx, 0, moved);
        renderStrip();
        save();
      });
    });
  }

  // ── Activate a tab ────────────────────────────────────────────────────
  function activateTab(id) {
    if (id === activeId) return;

    // Stash current editor state into the outgoing tab
    if (activeId) {
      const editorEl = document.getElementById('editor');
      const outgoing = tabs.find(t => t.id === activeId);
      if (outgoing) {
        outgoing.content    = Editor.getPlainText(editorEl);
        outgoing.scrollTop  = editorEl.scrollTop;
        outgoing.caretOffset = Caret.getOffset(editorEl).start;
      }
    }

    activeId = id;
    State.activeTabId = id;

    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    // Load new tab content
    const editorEl = document.getElementById('editor');
    editorEl.textContent = tab.content;
    Highlight.apply(editorEl);

    // Restore scroll and caret
    requestAnimationFrame(() => {
      editorEl.scrollTop = tab.scrollTop || 0;
      Caret.setOffset(editorEl, tab.caretOffset || 0, tab.caretOffset || 0);
    });

    // Update filename input
    document.getElementById('filename-input').value = tab.filename;

    renderStrip();
    save();

    // Update cross-scene linting
    CrossScene.update();
  }

  // ── New tab ───────────────────────────────────────────────────────────
  function newTab(filename, content) {
    if (tabs.length >= MAX_TABS) {
      alert(`Maximum of ${MAX_TABS} tabs reached.`);
      return null;
    }
    const tab = {
      id:          uid(),
      filename:    filename || `scene${tabs.length + 1}`,
      content:     content  || '',
      scrollTop:   0,
      caretOffset: 0,
    };
    tabs.push(tab);
    activateTab(tab.id);
    return tab.id;
  }

  // ── Close tab ─────────────────────────────────────────────────────────
  function closeTab(id) {
    if (tabs.length === 1) return; // always keep at least one tab
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    tabs.splice(idx, 1);

    if (activeId === id) {
      const newActive = tabs[Math.min(idx, tabs.length - 1)];
      activeId = newActive.id;
      // Force full load of the new tab
      const prevActive = activeId;
      activeId = null;
      activateTab(prevActive);  // activateTab calls CrossScene.update() internally
    } else {
      renderStrip();
      save();
      CrossScene.update();  // only needed when closing a non-active tab
    }
  }

  // ── Rename tab (inline) ───────────────────────────────────────────────
  function renameTab(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const el = document.querySelector(`.tab[data-id="${id}"] .tab-name`);
    if (!el) return;

    const old = tab.filename;
    el.contentEditable = 'true';
    el.focus();
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);

    function commit() {
      el.contentEditable = 'false';
      const newName = el.textContent.trim() || old;
      tab.filename = newName;
      el.textContent = newName;
      document.getElementById('filename-input').value = newName;
      save();
      CrossScene.update();
    }
    el.addEventListener('blur',    commit, { once: true });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { el.textContent = old; el.blur(); }
    }, { once: true });
  }

  // ── Called by FileManager when filename input changes ─────────────────
  function syncFilename(name) {
    const tab = tabs.find(t => t.id === activeId);
    if (tab) {
      tab.filename = name;
      renderStrip();
      save();
      CrossScene.update();
    }
  }

  // ── Called by FileManager.scheduleSave to flush content ──────────────
  function flushContent(plain) {
    const tab = tabs.find(t => t.id === activeId);
    if (tab) {
      tab.content = plain;
      save();
    }
  }

  // ── Get all tab contents (for cross-scene linting) ────────────────────
  function getAllTabs() { return tabs.slice(); }
  function getActiveId() { return activeId; }

  // ── Init ──────────────────────────────────────────────────────────────
  function init() {
    load();

    if (tabs.length === 0) {
      // Fresh start — migrate old single-file session if present
      const oldContent  = localStorage.getItem('cs-ide-content');
      const oldFilename = localStorage.getItem('cs-ide-filename');
      if (oldContent) {
        tabs = [{
          id:       uid(),
          filename: oldFilename || 'scene',
          content:  oldContent,
          scrollTop: 0, caretOffset: 0,
        }];
        // Clean up old keys
        localStorage.removeItem('cs-ide-content');
        localStorage.removeItem('cs-ide-filename');
      } else {
        tabs = [{
          id: uid(), filename: 'scene', content: STARTER, scrollTop: 0, caretOffset: 0,
        }];
      }
      activeId = tabs[0].id;
    }

    State.activeTabId = activeId;

    // Load active tab into editor
    const tab = tabs.find(t => t.id === activeId);
    const editorEl = document.getElementById('editor');
    editorEl.textContent = tab ? tab.content : '';
    document.getElementById('filename-input').value = tab ? tab.filename : 'scene';

    Highlight.apply(editorEl);
    renderStrip();
    CrossScene.update();

    // Ctrl+Tab / Ctrl+Shift+Tab to cycle tabs
    document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeId);
        if (tabs.length < 2) return;
        const next = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
        activateTab(tabs[next].id);
      }
    });
  }

  return { init, newTab, closeTab, renameTab, syncFilename, flushContent, getAllTabs, getActiveId };
})();
