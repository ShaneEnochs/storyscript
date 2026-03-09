// reference.js — command reference modal
// Self-contained: no external dependencies beyond the CSS variables already defined.

const Reference = (() => {

  // ── Data ────────────────────────────────────────────────────────────
  // Each entry: { cmd, args, summary, desc, lint?, example }
  // example is a string; use <span class="cmd"> etc. for inline highlighting.

  const SECTIONS = [
    {
      id: 'navigation',
      title: 'Navigation',
      entries: [
        {
          cmd: '*label',
          args: 'name',
          summary: 'Define a jump destination',
          desc: 'Marks a point in the scene that *goto and *gosub can jump to. Names are case-insensitive and must be unique within the scene. Labels are not shown to the player.',
          example:
`<span class="cmd">*label</span> <span class="label">forest_path</span>
You step onto the forest path.
<span class="cmd">*finish</span>`,
        },
        {
          cmd: '*goto',
          args: 'label',
          summary: 'Jump to a label (no return)',
          desc: 'Transfers execution unconditionally to *label in the current scene. Execution does not return to the line after *goto.',
          lint: { type: 'error', text: 'linted — target label must exist in this file' },
          example:
`<span class="cmd">*goto</span> <span class="label">end_scene</span>

<span class="cmd">*label</span> <span class="label">end_scene</span>
The chapter ends here.
<span class="cmd">*finish</span>`,
        },
        {
          cmd: '*gosub',
          args: 'label',
          summary: 'Call a label, then return',
          desc: 'Jumps to *label in the current scene and returns to the line after *gosub when *return is hit. Useful for reusable blocks of text or logic.',
          lint: { type: 'error', text: 'linted — target label must exist in this file' },
          example:
`<span class="cmd">*gosub</span> <span class="label">describe_room</span>
You continue exploring.

<span class="cmd">*label</span> <span class="label">describe_room</span>
The room smells of pine and old books.
<span class="cmd">*return</span>`,
        },
        {
          cmd: '*return',
          args: '',
          summary: 'Return from a gosub',
          desc: 'Ends a subroutine and returns execution to the line after the *gosub or *gosub_scene that called it. Must be inside a subroutine.',
          example:
`<span class="cmd">*label</span> <span class="label">my_sub</span>
Some reusable text.
<span class="cmd">*return</span>`,
        },
        {
          cmd: '*goto_scene',
          args: 'scene_name [label]',
          summary: 'Jump to another scene file',
          desc: 'Transfers execution to the beginning of another scene file, or to a specific *label within it if provided. Execution does not return. The scene name matches the filename without .txt.',
          lint: { type: 'warn', text: 'linted — scene name checked against open tabs' },
          example:
`<span class="cmd">*goto_scene</span> chapter2
<span class="cmd">*goto_scene</span> chapter2 forest_path`,
        },
        {
          cmd: '*gosub_scene',
          args: 'scene_name label',
          summary: 'Call a label in another scene',
          desc: 'Like *goto_scene, but returns to the current position when the target scene hits *return. Both the scene name and the label are required.',
          lint: { type: 'warn', text: 'linted — scene name checked against open tabs' },
          example:
`<span class="cmd">*gosub_scene</span> shared_subs describe_setting
The setting has been described.`,
        },
        {
          cmd: '*finish',
          args: '',
          summary: 'End scene, advance to next',
          desc: 'Ends the current scene and moves to the next scene in the startup scene list. If this is the last scene, the game ends. Every scene should have at least one *finish or *ending.',
          lint: { type: 'warn', text: 'linted — scene with no *finish or *ending gets a warning' },
          example: `<span class="cmd">*finish</span>`,
        },
        {
          cmd: '*ending',
          args: '',
          summary: 'End the game entirely',
          desc: 'Ends the game. Use for definitive conclusions and bad endings. Unlike *finish, it does not advance to the next scene.',
          lint: { type: 'warn', text: 'linted — satisfies the no-*finish warning' },
          example: `You were never seen again.\n<span class="cmd">*ending</span>`,
        },
      ],
    },
    {
      id: 'choices',
      title: 'Choices',
      entries: [
        {
          cmd: '*choice',
          args: '',
          summary: 'Branching player choice',
          desc: 'Presents the player with a set of options. Each option begins with # and its body must include a navigation command (*goto, *finish, etc.). The linter flags options with no navigation.',
          lint: { type: 'info', text: 'linted — each option body checked for navigation' },
          example:
`<span class="cmd">*choice</span>
    <span class="option">#</span>Step into the darkness.
        You can barely see your hand.
        <span class="cmd">*goto</span> <span class="label">cave_interior</span>
    <span class="option">#</span>Turn back.
        Some risks aren't worth taking.
        <span class="cmd">*finish</span>`,
        },
        {
          cmd: '*fake_choice',
          args: '',
          summary: 'Cosmetic choice, no branching',
          desc: 'Identical syntax to *choice but all options converge — execution continues below the block regardless of which option is chosen. Use for flavour and characterisation that doesn\'t affect the plot.',
          example:
`<span class="cmd">*fake_choice</span>
    <span class="option">#</span>Nod in agreement.
        You nod.
    <span class="option">#</span>Give a small smile.
        You smile quietly.
    <span class="option">#</span>Say nothing.
        You stay silent.
The conversation moves on.`,
        },
        {
          cmd: '*selectable_if',
          args: '(condition) #Option text',
          summary: 'Conditionally greyed-out option',
          desc: 'Used inside a *choice block instead of a plain #. The option is always visible to the player but only selectable when the condition is true. When false, it appears greyed out with a reason.',
          example:
`<span class="cmd">*choice</span>
    <span class="cmd">*selectable_if</span> (has_sword) <span class="option">#</span>Draw your sword.
        Steel flashes in the light.
        <span class="cmd">*goto</span> <span class="label">fight</span>
    <span class="option">#</span>Run.
        You bolt for the exit.
        <span class="cmd">*goto</span> <span class="label">flee</span>`,
        },
        {
          cmd: '#',
          args: 'option text',
          summary: 'An option inside *choice',
          desc: 'Defines one selectable option within a *choice or *fake_choice block. Must be indented one level deeper than the *choice command. The body of the option (its text and commands) must be indented one further level.',
          example:
`<span class="cmd">*choice</span>
    <span class="option">#</span>This is the first option.
        Body of the first option.
        <span class="cmd">*finish</span>
    <span class="option">#</span>This is the second option.
        Body of the second option.
        <span class="cmd">*finish</span>`,
        },
      ],
    },
    {
      id: 'variables',
      title: 'Variables',
      entries: [
        {
          cmd: '*create',
          args: 'variable_name value',
          summary: 'Declare a global variable',
          desc: 'Declares a global variable in startup.txt. Must appear before any prose or commands in the startup scene. Can hold a number, a quoted string, or a boolean (true/false). Global variables persist across all scenes.',
          lint: { type: 'error', text: 'linted — *set on undeclared variables is an error' },
          example:
`<span class="cmd">*create</span> player_name <span class="str">"Hero"</span>
<span class="cmd">*create</span> courage 50
<span class="cmd">*create</span> has_sword <span class="str">false</span>`,
        },
        {
          cmd: '*temp',
          args: 'variable_name value',
          summary: 'Declare a scene-local variable',
          desc: 'Declares a variable that only exists for the current scene. It is reset each time the scene is entered. Use for calculations or state you only need locally. Appears in the Variables sidebar.',
          lint: { type: 'error', text: 'linted — *set on undeclared variables is an error' },
          example:
`<span class="cmd">*temp</span> local_score 0
<span class="cmd">*temp</span> greeting <span class="str">"Hello"</span>`,
        },
        {
          cmd: '*set',
          args: 'variable_name value',
          summary: 'Assign a value to a variable',
          desc: 'Assigns a new value to an existing variable. The variable must have been declared with *create or *temp — the linter flags assignments to undeclared names. Supports arithmetic operators directly.',
          lint: { type: 'error', text: 'linted — variable must be declared with *create or *temp' },
          example:
`<span class="cmd">*set</span> courage 75
<span class="cmd">*set</span> courage +10      <span class="comment">*comment add 10</span>
<span class="cmd">*set</span> courage -5       <span class="comment">*comment subtract 5</span>
<span class="cmd">*set</span> courage courage*2 <span class="comment">*comment double it</span>
<span class="cmd">*set</span> player_name <span class="str">"Aldric"</span>`,
        },
        {
          cmd: '${variable}',
          args: '',
          summary: 'Interpolate a variable into prose',
          desc: 'Inserts the current value of a variable directly into prose or option text. The IDE highlights interpolations in purple so they\'re easy to spot. Can appear anywhere in a line of text.',
          example:
`Hello, <span class="varref">\${player_name}</span>. Your courage is <span class="varref">\${courage}</span>.

<span class="cmd">*choice</span>
    <span class="option">#</span>Tell <span class="varref">\${npc_name}</span> the truth.
        You speak plainly.
        <span class="cmd">*finish</span>`,
        },
      ],
    },
    {
      id: 'conditionals',
      title: 'Conditionals',
      entries: [
        {
          cmd: '*if',
          args: '(condition)',
          summary: 'Execute block if condition is true',
          desc: 'Conditionally executes the indented block that follows. Conditions can use variables, comparisons (>, <, >=, <=, =, !=), and boolean operators (and, or, not). Every *if must be closed with *endif.',
          lint: { type: 'warn', text: 'linted — unclosed *if without *endif is a warning' },
          example:
`<span class="cmd">*if</span> courage > 50
    You feel confident.
<span class="cmd">*endif</span>`,
        },
        {
          cmd: '*elseif',
          args: '(condition)',
          summary: 'Additional condition branch',
          desc: 'A condition checked only if all preceding *if and *elseif branches were false. Must follow an *if or another *elseif. Multiple *elseif branches are allowed.',
          example:
`<span class="cmd">*if</span> courage > 75
    You feel fearless.
<span class="cmd">*elseif</span> courage > 40
    You feel nervous but capable.
<span class="cmd">*elseif</span> courage > 20
    You feel quite frightened.
<span class="cmd">*else</span>
    You are paralysed with fear.
<span class="cmd">*endif</span>`,
        },
        {
          cmd: '*else',
          args: '',
          summary: 'Fallback if all conditions false',
          desc: 'Executes its block if all preceding *if and *elseif conditions were false. Must be the last branch before *endif. Optional — *if/*endif is valid without *else.',
          example:
`<span class="cmd">*if</span> has_sword
    You grip your sword.
<span class="cmd">*else</span>
    You ball your fists.
<span class="cmd">*endif</span>`,
        },
        {
          cmd: '*endif',
          args: '',
          summary: 'Close a conditional block',
          desc: 'Closes an *if/*elseif/*else block. Every *if must have exactly one matching *endif. The linter flags unclosed *if blocks.',
          lint: { type: 'warn', text: 'linted — missing *endif is flagged as a warning' },
          example:
`<span class="cmd">*if</span> courage > 50
    You feel brave.
<span class="cmd">*endif</span>`,
        },
      ],
    },
    {
      id: 'output',
      title: 'Output & Display',
      entries: [
        {
          cmd: '*comment',
          args: 'text',
          summary: 'A note the player never sees',
          desc: 'The entire line is treated as a comment. Nothing after *comment is shown to the player or executed. Use for notes, section markers, TODO items, and anything else you want to say to yourself.',
          example:
`<span class="comment">*comment ── Chapter 3: The Forest ──────────────────</span>
<span class="comment">*comment TODO: add alternate path for high courage</span>
You enter the forest.`,
        },
        {
          cmd: '*line_break',
          args: '',
          summary: 'Insert a line break in output',
          desc: 'Inserts a single line break in the rendered text without starting a new paragraph. Useful for poetry, addresses, or any formatting that needs explicit line breaks.',
          example:
`The letter read:
<span class="cmd">*line_break</span>
<span class="str">"Meet me at midnight."</span>`,
        },
        {
          cmd: '*page_break',
          args: '',
          summary: 'Insert a page break',
          desc: 'Inserts a "Next" button in the rendered output. The player must click to continue reading. Use to create dramatic pauses or chapter breaks.',
          example:
`The door swings open.
<span class="cmd">*page_break</span>
Beyond it lies the throne room.`,
        },
        {
          cmd: '*stat_chart',
          args: '',
          summary: 'Display stats on the stats screen',
          desc: 'Defines how variables are displayed on the stats/inventory screen. Each row specifies the display type, a label, and the variable. Should be placed in a stats scene.',
          example:
`<span class="cmd">*stat_chart</span>
    text Name player_name
    percent Courage courage
    percent Cunning cunning
    opposed_pair Bold boldness Cautious caution`,
        },
      ],
    },
    {
      id: 'indentation',
      title: 'Indentation Guide',
      entries: [
        {
          cmd: 'Indentation rules',
          args: '',
          summary: '4 spaces per level',
          desc: 'ChoiceScript is indentation-sensitive. The IDE uses 4 spaces per indent level. The Tab key inserts 4 spaces. Enter after a *choice/*fake_choice or #option automatically increases indentation.',
          example:
`<span class="comment">*comment Level 0 — top level</span>
<span class="cmd">*choice</span>
    <span class="option">#</span>Option (level 1 — 4 spaces)
        Option body (level 2 — 8 spaces)
        <span class="cmd">*if</span> courage > 50
            Conditional body (level 3 — 12 spaces)
        <span class="cmd">*endif</span>
        <span class="cmd">*goto</span> <span class="label">somewhere</span>`,
        },
        {
          cmd: 'Operators',
          args: '',
          summary: 'Comparisons and logic',
          desc: 'Use these in *if and *selectable_if conditions. String comparisons use the same operators as numbers.',
          example:
`<span class="comment">*comment Comparisons</span>
<span class="cmd">*if</span> courage > 50      <span class="comment">*comment greater than</span>
<span class="cmd">*if</span> courage >= 50     <span class="comment">*comment greater than or equal</span>
<span class="cmd">*if</span> courage = 50      <span class="comment">*comment equal (single =)</span>
<span class="cmd">*if</span> courage != 50     <span class="comment">*comment not equal</span>

<span class="comment">*comment Boolean logic</span>
<span class="cmd">*if</span> courage > 50 and has_sword
<span class="cmd">*if</span> courage > 50 or cunning > 50
<span class="cmd">*if</span> not has_sword

<span class="comment">*comment Parentheses for grouping</span>
<span class="cmd">*if</span> (courage > 50) and (cunning > 30)`,
        },
      ],
    },
  ];

  // ── Build HTML ──────────────────────────────────────────────────────
  function buildModal() {
    const overlay = document.createElement('div');
    overlay.id = 'ref-overlay';
    overlay.innerHTML = `
      <div id="ref-modal" role="dialog" aria-modal="true" aria-label="Command Reference">
        <div id="ref-header">
          <h2>CS Reference</h2>
          <input id="ref-search" type="text" placeholder="Search commands…" spellcheck="false" autocomplete="off" />
          <button id="ref-close" title="Close (Esc)">×</button>
        </div>
        <div id="ref-body">
          <nav id="ref-nav">${buildNav()}</nav>
          <div id="ref-content">
            ${SECTIONS.map(buildSection).join('')}
            <div id="ref-no-results">No commands match your search.</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  function buildNav() {
    return SECTIONS.map((s, i) =>
      `<div class="ref-nav-item${i === 0 ? ' active' : ''}" data-section="${s.id}">${s.title}</div>`
    ).join('');
  }

  function buildSection(s) {
    return `<div class="ref-section" id="ref-sec-${s.id}">
      <div class="ref-section-title">${s.title}</div>
      ${s.entries.map(buildCard).join('')}
    </div>`;
  }

  function buildCard(entry) {
    const lintBadge = entry.lint
      ? `<span class="ref-lint-badge ${entry.lint.type}">${entry.lint.text}</span>`
      : '';
    const argsHtml = entry.args
      ? `<span class="ref-cmd-arg">${escHtml(entry.args)}</span>`
      : '';
    const cmdDisplay = entry.cmd.startsWith('*') || entry.cmd === '#'
      ? `<span class="ref-cmd">${escHtml(entry.cmd)}</span>`
      : `<span class="ref-cmd" style="color:var(--text);font-size:12px">${escHtml(entry.cmd)}</span>`;

    return `<div class="ref-card" data-search="${escHtml((entry.cmd + ' ' + entry.args + ' ' + entry.summary + ' ' + entry.desc).toLowerCase())}">
      <div class="ref-card-header" onclick="Reference._toggleCard(this.closest('.ref-card'))">
        ${cmdDisplay}${argsHtml}
        <span class="ref-summary">${escHtml(entry.summary)}</span>
        <span class="ref-toggle">▾</span>
      </div>
      <div class="ref-card-body">
        <div class="ref-desc">${escHtml(entry.desc)}${lintBadge}</div>
        <div class="ref-example">${entry.example}</div>
      </div>
    </div>`;
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Open / Close ────────────────────────────────────────────────────
  function open() {
    document.getElementById('ref-overlay').classList.add('open');
    document.getElementById('ref-search').focus();
  }

  function close() {
    document.getElementById('ref-overlay').classList.remove('open');
    document.getElementById('editor').focus();
  }

  // ── Card expand/collapse ────────────────────────────────────────────
  function _toggleCard(card) {
    card.classList.toggle('expanded');
  }

  // ── Search / filter ─────────────────────────────────────────────────
  function filterCards(query) {
    const q = query.toLowerCase().trim();
    let anyVisible = false;

    SECTIONS.forEach(s => {
      const section = document.getElementById(`ref-sec-${s.id}`);
      const cards = section.querySelectorAll('.ref-card');
      let sectionVisible = false;
      cards.forEach(card => {
        const match = !q || card.dataset.search.includes(q);
        card.classList.toggle('hidden', !match);
        if (match) { sectionVisible = true; anyVisible = true; }
      });
      section.style.display = sectionVisible ? '' : 'none';
    });

    document.getElementById('ref-no-results').style.display = anyVisible ? 'none' : 'block';
    // Reset nav active state
    if (q) {
      document.querySelectorAll('.ref-nav-item').forEach(el => el.classList.remove('active'));
    } else {
      activateNavItem(document.querySelector('.ref-nav-item'));
    }
  }

  // ── Nav highlight on scroll ─────────────────────────────────────────
  function activateNavItem(item) {
    document.querySelectorAll('.ref-nav-item').forEach(el => el.classList.remove('active'));
    if (item) item.classList.add('active');
  }

  // ── Event binding ───────────────────────────────────────────────────
  function bindEvents() {
    // Close on overlay backdrop click
    document.getElementById('ref-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('ref-overlay')) close();
    });

    document.getElementById('ref-close').addEventListener('click', close);

    // Escape key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('ref-overlay').classList.contains('open')) {
        e.stopPropagation();
        close();
      }
    });

    // Search filter
    document.getElementById('ref-search').addEventListener('input', e => {
      filterCards(e.target.value);
    });
    document.getElementById('ref-search').addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (e.target.value) {
          e.target.value = '';
          filterCards('');
        } else {
          close();
        }
      }
    });

    // Nav clicks — scroll to section
    document.getElementById('ref-nav').addEventListener('click', e => {
      const item = e.target.closest('.ref-nav-item');
      if (!item) return;
      const sectionId = item.dataset.section;
      const section = document.getElementById(`ref-sec-${sectionId}`);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        activateNavItem(item);
      }
      // Clear search so all sections are visible
      const searchEl = document.getElementById('ref-search');
      if (searchEl.value) { searchEl.value = ''; filterCards(''); }
    });

    // Track scroll position to highlight active nav item
    document.getElementById('ref-content').addEventListener('scroll', () => {
      const content = document.getElementById('ref-content');
      const scrollTop = content.scrollTop;
      let activeSection = null;

      SECTIONS.forEach(s => {
        const el = document.getElementById(`ref-sec-${s.id}`);
        if (el && el.offsetTop - 40 <= scrollTop) activeSection = s.id;
      });

      if (activeSection) {
        const navItem = document.querySelector(`.ref-nav-item[data-section="${activeSection}"]`);
        activateNavItem(navItem);
      }
    });

    // Toolbar button
    document.getElementById('ref-open-btn').addEventListener('click', open);
  }

  // ── Init ────────────────────────────────────────────────────────────
  function init() {
    buildModal();
    bindEvents();
  }

  return { init, open, close, _toggleCard };
})();
