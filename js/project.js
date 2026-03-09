// project.js — lightweight project file (scene list + tab order)
// A project is a JSON file listing scene filenames in order.
// Export: downloads cside-project.json  
// Import: opens all listed scenes from the user's file selection
// Depends on: Tabs, FileManager

const Project = (() => {

  // ── Export project manifest ────────────────────────────────────────
  function exportProject() {
    const tabs = Tabs.getAllTabs();
    const project = {
      version: 1,
      name: prompt('Project name:', 'My Game') || 'My Game',
      scenes: tabs.map(t => t.filename),
      created: new Date().toISOString(),
    };
    const json = JSON.stringify(project, null, 2);
    const url  = URL.createObjectURL(
      new Blob([json], { type: 'application/json;charset=utf-8' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = (project.name.replace(/\s+/g, '-').toLowerCase() || 'project') + '.cside.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Import project manifest ────────────────────────────────────────
  // Shows a file picker; reads the .json and tells user which scenes to load.
  function importProject(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const project = JSON.parse(e.target.result);
        if (!project.scenes || !Array.isArray(project.scenes)) {
          alert('Invalid project file.');
          return;
        }
        const msg = `Project: "${project.name || 'Untitled'}"\n\nScenes:\n` +
          project.scenes.map((s, i) => `  ${i + 1}. ${s}`).join('\n') +
          '\n\nThis will open a file picker for each scene. Continue?';
        if (!confirm(msg)) return;

        // Queue sequential file picks for each scene
        _pickSceneFiles(project.scenes, 0);
      } catch(err) {
        alert('Could not read project file: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
  }

  // Chain file pickers for each scene in order
  function _pickSceneFiles(scenes, index) {
    if (index >= scenes.length) return;
    const sceneName = scenes[index];
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) { _pickSceneFiles(scenes, index + 1); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        Tabs.newTab(sceneName, ev.target.result);
        _pickSceneFiles(scenes, index + 1);
      };
      reader.readAsText(file, 'UTF-8');
    };
    input.click();
  }

  return { exportProject, importProject };
})();
