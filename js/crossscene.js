// crossscene.js — cross-scene linting
// Validates *goto_scene and *gosub_scene references across all open tabs.
// Also provides scene name list for linter.js to use.

const CrossScene = (() => {

  // Returns a Set of all scene filenames currently open as tabs
  function getSceneNames() {
    return new Set(Tabs.getAllTabs().map(t => t.filename.toLowerCase()));
  }

  // Lint a specific set of lines against all known scene names
  function lintCrossScene(lines, sceneNames) {
    const issues     = [];
    const errorLines = new Set();

    lines.forEach((line, i) => {
      const m = line.trimStart().match(/^\*(goto_scene|gosub_scene)\s+(\S+)/);
      if (m) {
        const target = m[2].toLowerCase();
        if (!sceneNames.has(target)) {
          issues.push({ line: i, type: 'warn', msg: `*${m[1]} "${m[2]}" — scene not found in project` });
          errorLines.add(i);
        }
      }
    });

    return { issues, errorLines };
  }

  // Re-run cross-scene lint and merge into State.lastLint
  // Called whenever tabs change (add/remove/rename) or content changes
  function update() {
    // Trigger a re-highlight of the active editor, which will re-run all linting
    const editorEl = document.getElementById('editor');
    if (editorEl) Highlight.apply(editorEl);
  }

  return { getSceneNames, lintCrossScene, update };
})();
