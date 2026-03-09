// filemanager.js — export, import, autosave
// Depends on: editor.js, tabs.js

const FileManager = (() => {
  let saveTimer = null;

  // ── Export current tab ────────────────────────────────────────────────
  function exportFile() {
    const editorEl = document.getElementById('editor');
    const plain    = Editor.getPlainText(editorEl);
    const rawName  = document.getElementById('filename-input').value || 'scene';
    const filename = rawName.replace(/\.txt$/, '') + '.txt';
    _download(plain, filename);
  }

  // ── Export all tabs as individual downloads ───────────────────────────
  function exportAll() {
    // Flush active tab
    const editorEl = document.getElementById('editor');
    const plain    = Editor.getPlainText(editorEl);
    const activeTab = Tabs.getAllTabs().find(t => t.id === Tabs.getActiveId());
    if (activeTab) activeTab.content = plain;

    Tabs.getAllTabs().forEach(tab => {
      const fname = (tab.filename || 'scene').replace(/\.txt$/, '') + '.txt';
      _download(tab.content || '', fname);
    });
  }

  function _download(content, filename) {
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/plain;charset=utf-8' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import into current tab ────────────────────────────────────────────
  function importFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      Undo.pushNow(Editor.getPlainText(document.getElementById('editor')));
      Editor.loadText(e.target.result);
      const name = file.name.replace(/\.txt$/, '');
      document.getElementById('filename-input').value = name;
      Tabs.syncFilename(name);
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  }

  // ── Import into a NEW tab ─────────────────────────────────────────────
  function importAsNewTab(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const name = file.name.replace(/\.txt$/, '');
      Tabs.newTab(name, e.target.result);
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  }

  // ── Autosave ───────────────────────────────────────────────────────────
  function scheduleSave(plain) {
    clearTimeout(saveTimer);
    const st = document.getElementById('save-status');
    st.textContent = 'Unsaved…';
    st.className   = '';

    saveTimer = setTimeout(() => {
      Tabs.flushContent(plain);
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      st.textContent = `Saved ${t}`;
      st.className   = 'saved';
    }, 1000);
  }

  // restoreSession is now handled by Tabs.init — kept as no-op for compatibility
  function restoreSession() { return false; }

  return { exportFile, exportAll, importFile, importAsNewTab, scheduleSave, restoreSession };
})();
