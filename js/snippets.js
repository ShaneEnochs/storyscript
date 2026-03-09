// snippets.js — boilerplate snippet insertion
// Depends on: caret.js, editor.js, highlight.js, undo.js

const Snippets = (() => {

  const LIBRARY = {
    choice: [
      `*choice`,
      `    #Option 1`,
      `        Text for option 1.`,
      `        *goto label_name`,
      `    #Option 2`,
      `        Text for option 2.`,
      `        *goto label_name`,
      ``,
    ].join('\n'),

    fake_choice: [
      `*fake_choice`,
      `    #Option 1`,
      `        Text for option 1.`,
      `    #Option 2`,
      `        Text for option 2.`,
      ``,
    ].join('\n'),

    if: [
      `*if (variable)`,
      `    Text if true.`,
      `*else`,
      `    Text if false.`,
      `*endif`,
      ``,
    ].join('\n'),

    stat_chart: [
      `*stat_chart`,
      `    text Stat Name stat_variable`,
      ``,
    ].join('\n'),

    selectable_if: [
      `*choice`,
      `    *selectable_if (condition) #Option`,
      `        Text.`,
      `        *goto label_name`,
      ``,
    ].join('\n'),

    temp:  `*temp variable_name value\n`,
    gosub: `*gosub_scene scene_name label_name\n`,
  };

  function insert(key) {
    const snippet = LIBRARY[key];
    if (!snippet) return;

    const editorEl = document.getElementById('editor');
    editorEl.focus();

    const plain = Editor.getPlainText(editorEl);
    Undo.pushNow(plain);

    const caret    = Caret.getOffset(editorEl);
    const newPlain = plain.slice(0, caret.start) + snippet + plain.slice(caret.end);
    editorEl.textContent = newPlain;

    const newPos = caret.start + snippet.length;
    Highlight.apply(editorEl);
    Caret.setOffset(editorEl, newPos, newPos);
  }

  return { insert };
})();
