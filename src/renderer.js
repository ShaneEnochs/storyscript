'use strict';

/**
 * DOMRenderer
 *
 * The browser-facing renderer. Uses event delegation — a single click
 * listener on a permanent container, identified by data attributes.
 * No individual listeners to remove on screen clear.
 *
 * Expected HTML structure:
 *   <div id="storyscript-root">
 *     <div id="storyscript-page"></div>
 *     <div id="storyscript-ui"></div>
 *   </div>
 *
 * PAGE_BREAK model (Session 2):
 *   *page_break appends a decorative divider and keeps running — no pause.
 *   Choices appear inline below accumulated text.
 *   Picking a choice calls clearChoices() — only the UI area is cleared,
 *   page text is preserved.
 *   clearScreen() still exists for restart only.
 */

class DOMRenderer {
  constructor(rootId = 'storyscript-root') {
    this.root = document.getElementById(rootId);
    if (!this.root) throw new Error(`[StoryScript] Root element #${rootId} not found`);

    this.page = document.getElementById('storyscript-page')
                ?? this._createElement('div', { id: 'storyscript-page' });
    this.ui   = document.getElementById('storyscript-ui')
                ?? this._createElement('div', { id: 'storyscript-ui' });

    if (!this.page.parentNode) this.root.appendChild(this.page);
    if (!this.ui.parentNode)   this.root.appendChild(this.ui);

    // Single delegated listener on the UI area
    this.ui.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this._handleAction(btn.dataset.action, btn.dataset.id);
    });

    this._callbacks = new Map(); // id → callback function
    this._nextId    = 0;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  _id()    { return `ss-${this._nextId++}`; }
  _reg(cb) { const id = this._id(); this._callbacks.set(id, cb); return id; }

  _handleAction(action, id) {
    const cb = this._callbacks.get(id);
    if (cb) { this._callbacks.delete(id); cb(); }
  }

  _createElement(tag, attrs = {}, text = null) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== null) el.textContent = text;
    return el;
  }

  // ── Public API (called by Engine) ──────────────────────────────────────────

  appendText(text) {
    const p = this._createElement('p', { class: 'ss-text' });
    p.textContent = text;
    this.page.appendChild(p);
  }

  appendBlank() {
    this.page.appendChild(this._createElement('div', { class: 'ss-blank' }));
  }

  /**
   * Append a decorative section divider (the ✦ rule).
   * Called by PAGE_BREAK — does NOT pause execution.
   */
  appendDivider() {
    this.page.appendChild(this._createElement('div', { class: 'ss-divider' }));
  }

  /**
   * Clear only the UI area (choice buttons, undo button).
   * Leaves all page text intact. Called after a choice is picked.
   */
  clearChoices() {
    this.ui.innerHTML = '';
    this._callbacks.clear();
  }

  /**
   * Clear both page and UI completely. Used by restart only.
   */
  clearScreen() {
    this.page.innerHTML = '';
    this.ui.innerHTML   = '';
    this._callbacks.clear();
  }

  renderChoices(options) {
    const container = this._createElement('div', { class: 'ss-choices' });
    for (const opt of options) {
      const id  = this._reg(opt.onPick);
      const btn = this._createElement('button', {
        class:         'ss-choice-btn',
        'data-action': 'choice',
        'data-id':     id,
      });
      btn.textContent = opt.text;
      if (!opt.enabled) {
        btn.disabled = true;
        btn.classList.add('ss-choice-disabled');
      }
      container.appendChild(btn);
    }
    this.ui.appendChild(container);
  }

  renderUndo(onUndo) {
    const id  = this._reg(onUndo);
    const btn = this._createElement('button', {
      class:         'ss-undo-btn',
      'data-action': 'undo',
      'data-id':     id,
    }, '← Back');
    this.ui.appendChild(btn);
  }

  /**
   * @deprecated PAGE_BREAK no longer pauses. Kept for any external callers.
   */
  renderContinue(onContinue) {
    const id  = this._reg(onContinue);
    const btn = this._createElement('button', {
      class:         'ss-continue-btn',
      'data-action': 'continue',
      'data-id':     id,
    }, 'Continue');
    this.ui.appendChild(btn);
  }

  renderFinish() {
    const el = this._createElement('p', { class: 'ss-finish' }, '— The End —');
    this.page.appendChild(el);
    this.ui.innerHTML = '';
  }

  /**
   * Render a text or number input field, pausing execution until submitted.
   * @param {'text'|'number'} type
   * @param {string} prompt
   * @param {function} onSubmit
   */
  renderInput(type, prompt, onSubmit) {
    const container = this._createElement('div', { class: 'ss-input-block' });

    if (prompt) {
      const label = this._createElement('p', { class: 'ss-input-prompt' });
      label.textContent = prompt;
      container.appendChild(label);
    }

    const wrap = this._createElement('div', { class: 'ss-input-row' });
    const input = this._createElement('input', {
      type: type === 'number' ? 'number' : 'text',
      class: 'ss-input-field',
      placeholder: type === 'number' ? '0' : '…',
    });
    const btn = this._createElement('button', { class: 'ss-input-btn' }, 'Confirm');

    const submit = () => {
      const val = input.value.trim();
      if (type === 'number' && val === '') return;
      this.ui.innerHTML = '';
      this._callbacks.clear();
      onSubmit(val);
    };

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    btn.addEventListener('click', submit);

    wrap.appendChild(input);
    wrap.appendChild(btn);
    container.appendChild(wrap);
    this.ui.appendChild(container);
    setTimeout(() => input.focus(), 0);
  }

  /**
   * Render player inventory as a panel.
   */
  renderInventory(items) {
    if (items.length === 0) {
      const p = this._createElement('p', { class: 'ss-panel-empty' }, 'Your inventory is empty.');
      this.page.appendChild(p);
      return;
    }
    const panel = this._createElement('div', { class: 'ss-panel ss-inventory' });
    const hdr = this._createElement('div', { class: 'ss-panel-hdr' }, 'Inventory');
    panel.appendChild(hdr);
    for (const item of items) {
      const row = this._createElement('div', { class: 'ss-panel-row' });
      const nameEl = this._createElement('span', { class: 'ss-panel-label' });
      nameEl.textContent = item.name;
      const qtyEl = this._createElement('span', { class: 'ss-panel-value' });
      qtyEl.textContent = item.qty > 1 ? `×${item.qty}` : '';
      row.appendChild(nameEl);
      row.appendChild(qtyEl);
      if (item.desc) {
        const desc = this._createElement('span', { class: 'ss-panel-desc' });
        desc.textContent = item.desc;
        row.appendChild(desc);
      }
      panel.appendChild(row);
    }
    this.page.appendChild(panel);
  }

  /**
   * Render skill bars.
   */
  renderSkills(skills) {
    const panel = this._createElement('div', { class: 'ss-panel ss-skills' });
    const hdr = this._createElement('div', { class: 'ss-panel-hdr' }, 'Skills');
    panel.appendChild(hdr);
    for (const skill of skills) {
      const row = this._createElement('div', { class: 'ss-panel-row ss-skill-row' });
      const label = this._createElement('span', { class: 'ss-panel-label' });
      label.textContent = skill.label;
      const barWrap = this._createElement('div', { class: 'ss-skill-bar-wrap' });
      const bar = this._createElement('div', { class: 'ss-skill-bar' });
      const pct = Math.round(((skill.value - skill.min) / Math.max(1, skill.max - skill.min)) * 100);
      bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
      barWrap.appendChild(bar);
      const val = this._createElement('span', { class: 'ss-panel-value' });
      val.textContent = String(skill.value);
      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(val);
      panel.appendChild(row);
    }
    this.page.appendChild(panel);
  }

  /**
   * Show a brief achievement unlock toast.
   */
  renderAchievementUnlock(id, schema) {
    const toast = this._createElement('div', { class: 'ss-achievement-toast' });
    const icon = schema.icon ?? '🏅';
    const title = schema.title ?? id;
    toast.textContent = `${icon} Achievement Unlocked: ${title}`;
    if (schema.desc) {
      const desc = this._createElement('div', { class: 'ss-achievement-desc' });
      desc.textContent = schema.desc;
      toast.appendChild(desc);
    }
    this.page.appendChild(toast);
  }

  /**
   * Render achievement list panel.
   */
  renderAchievements(list) {
    const panel = this._createElement('div', { class: 'ss-panel ss-achievements' });
    const hdr = this._createElement('div', { class: 'ss-panel-hdr' }, 'Achievements');
    panel.appendChild(hdr);
    for (const { id, schema, unlocked } of list) {
      const row = this._createElement('div', { class: `ss-panel-row ss-achievement-row${unlocked ? ' unlocked' : ' locked'}` });
      const icon = this._createElement('span', { class: 'ss-achievement-icon' });
      icon.textContent = unlocked ? (schema.icon ?? '🏅') : '🔒';
      const nameEl = this._createElement('span', { class: 'ss-panel-label' });
      nameEl.textContent = (unlocked || !schema.hidden) ? (schema.title ?? id) : '???';
      row.appendChild(icon);
      row.appendChild(nameEl);
      if (unlocked && schema.desc) {
        const desc = this._createElement('span', { class: 'ss-panel-desc' });
        desc.textContent = schema.desc;
        row.appendChild(desc);
      }
      panel.appendChild(row);
    }
    this.page.appendChild(panel);
  }

  showError(message) {
    const el = this._createElement('div', { class: 'ss-error' });
    el.textContent = message;
    this.page.appendChild(el);
    this.ui.innerHTML = '';
    console.error(message);
  }

  setTheme(vars) {
    for (const [key, val] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, val);
    }
  }

  snapshotTheme() {
    const style    = document.documentElement.style;
    const snapshot = {};
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      if (prop.startsWith('--')) snapshot[prop] = style.getPropertyValue(prop);
    }
    return snapshot;
  }
}

// ── NullRenderer (for fuzzer / headless testing) ────────────────────────────

class NullRenderer {
  constructor() {
    this._pendingOptions = null;
    this._undoCb         = null;
    this.finished        = false;
  }

  appendText()    {}
  appendBlank()   {}

  /** PAGE_BREAK no longer pauses; this is intentionally a no-op. */
  appendDivider() {}

  /** Clear choice buttons only. Called after a choice is picked. */
  clearChoices() {
    this._pendingOptions = null;
    this._undoCb         = null;
  }

  /** Full reset — used by restart. */
  clearScreen() {
    this._pendingOptions = null;
    this._undoCb         = null;
    this.finished        = false;
  }

  renderChoices(options) {
    this._pendingOptions = options;
  }

  renderUndo(cb) {
    this._undoCb = cb;
  }

  /** @deprecated PAGE_BREAK no longer calls this. No-op for compatibility. */
  renderContinue(cb) {}

  renderFinish() {
    this.finished = true;
  }

  renderInput(type, prompt, onSubmit) {
    // In headless mode, auto-submit a default value
    onSubmit(type === 'number' ? '0' : 'test');
  }

  renderInventory(items) {}
  renderSkills(skills) {}
  renderAchievements(list) {}
  renderAchievementUnlock(id, schema) {}

  showError(msg) {
    throw new Error(msg);
  }

  setTheme()      {}
  snapshotTheme() { return {}; }
}

if (typeof module !== 'undefined') {
  module.exports = { DOMRenderer, NullRenderer };
}
