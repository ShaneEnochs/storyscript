// sidebar.js — sidebar panels: Issues, Labels, Variables
// Depends on: highlight.js (Highlight.esc), editor.js (Editor.scrollToLine)

const Sidebar = (() => {

  function updateIssues(issues) {
    const header = document.getElementById('issues-header');
    const list   = document.getElementById('issue-list');
    document.getElementById('issue-count').textContent = issues.length;

    const hasErrors = issues.some(x => x.type === 'error');
    const hasWarns  = issues.some(x => x.type === 'warn');
    header.className = 'panel-header' +
      (hasErrors ? ' has-errors' : hasWarns ? ' has-warns' : '');

    if (!issues.length) {
      list.innerHTML = '<div class="empty-state">No issues found</div>';
      return;
    }

    list.innerHTML = issues.map(iss => {
      const where   = iss.line >= 0 ? `Line ${iss.line + 1}` : 'Scene';
      const onclick = iss.line >= 0 ? `Editor.scrollToLine(${iss.line})` : '';
      return `<div class="issue-item ${iss.type}" onclick="${onclick}">
        ${Highlight.esc(iss.msg)}
        <span class="issue-where">${where}</span>
      </div>`;
    }).join('');
  }

  function updateLabels(lines) {
    const labels = [];
    lines.forEach((l, i) => {
      const m = l.trimStart().match(/^\*label\s+(\S+)/);
      if (m) labels.push({ name: m[1], line: i });
    });

    document.getElementById('label-count').textContent = labels.length;
    document.getElementById('label-list').innerHTML = labels.length
      ? labels.map(l =>
          `<div class="label-item" onclick="Editor.scrollToLine(${l.line})">${Highlight.esc(l.name)}</div>`
        ).join('')
      : '<div class="empty-state">No labels found</div>';

    // ── Section markers: *comment lines that look like headings ──────
    // Match: *comment followed by ──, ===, ---, or ALL CAPS word(s)
    const sections = [];
    lines.forEach((l, i) => {
      const m = l.trimStart().match(/^\*comment\s+(.+)/);
      if (!m) return;
      const text = m[1].trim();
      if (/^(──|===|---|###|▸|►)/.test(text) || /^[A-Z][A-Z\s]{3,}$/.test(text)) {
        sections.push({ text: text.replace(/^[─=\-#▸►\s]+|[─=\-#▸►\s]+$/g, '').trim() || text, line: i });
      }
    });

    const sectEl = document.getElementById('section-list');
    const sectCount = document.getElementById('section-count');
    if (sectEl && sectCount) {
      sectCount.textContent = sections.length;
      sectEl.innerHTML = sections.length
        ? sections.map(s =>
            `<div class="section-item" onclick="Editor.scrollToLine(${s.line})">${Highlight.esc(s.text)}</div>`
          ).join('')
        : '<div class="empty-state">No sections found</div>';
    }
  }

  function updateVars(lines) {
    const vars = [];
    const seen = new Set();
    lines.forEach(l => {
      const m = l.trimStart().match(/^\*(create|temp)\s+(\w+)(?:\s+(.+))?/);
      if (m && !seen.has(m[2])) {
        seen.add(m[2]);
        vars.push({ name: m[2], type: m[1], val: m[3] || '', current: m[3] || '' });
      }
    });

    // Scope-aware: do a linear walk of *set to estimate current value
    // (ignores branching — this is intentionally approximate)
    lines.forEach(l => {
      const m = l.trimStart().match(/^\*set\s+(\w+)\s+(.+)/);
      if (!m) return;
      const v = vars.find(v => v.name.toLowerCase() === m[1].toLowerCase());
      if (v) v.current = m[2].trim();
    });

    document.getElementById('var-count').textContent = vars.length;
    document.getElementById('var-list').innerHTML = vars.length
      ? vars.map(v => {
          const jumpLine = lines.findIndex(l => {
            const mm = l.trimStart().match(/^\*(create|temp)\s+(\w+)/);
            return mm && mm[2] === v.name;
          });
          const onclick = jumpLine >= 0 ? `Editor.scrollToLine(${jumpLine})` : '';
          const changed  = v.current !== v.val;
          const valDisp  = changed
            ? `<span title="Initial: ${Highlight.esc(v.val)}">${Highlight.esc(v.current)} <em>~</em></span>`
            : `<span>${Highlight.esc(v.val)}</span>`;
          return `<div class="var-item" onclick="${onclick}" style="cursor:pointer" title="Jump to declaration">
            ${Highlight.esc(v.name)} ${valDisp}
          </div>`;
        }).join('')
      : '<div class="empty-state">No variables found</div>';
  }

  function update(lines, issues) {
    updateIssues(issues);
    updateLabels(lines);
    updateVars(lines);
  }

  return { update };
})();

// ── Word count ─────────────────────────────────────────────────────────
const WordCount = (() => {
  function countProse(plain) {
    const prose = plain.split('\n').filter(l => {
      const t = l.trimStart();
      return t.length > 0 && !t.startsWith('*') && !t.startsWith('#');
    }).join(' ');
    return prose.trim() ? prose.trim().split(/\s+/).length : 0;
  }

  function update(plain) {
    const sceneCount = countProse(plain);
    // Total across all tabs
    let total = 0;
    Tabs.getAllTabs().forEach(tab => {
      const tabPlain = tab.id === State.activeTabId ? plain : (tab.content || '');
      total += countProse(tabPlain);
    });
    const el = document.getElementById('wc-num');
    if (el) {
      el.textContent = sceneCount.toLocaleString();
      el.title = `This scene: ${sceneCount.toLocaleString()} words\nAll scenes: ${total.toLocaleString()} words`;
    }
    const totalEl = document.getElementById('wc-total');
    if (totalEl) totalEl.textContent = total.toLocaleString();
  }
  return { update };
})();
