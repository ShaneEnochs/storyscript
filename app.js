// ============================================
//  WWF Helper — app.js  (Phase 9)
//  Bug fixes + WWF offset picker + Apply-to-Board
// ============================================

// ── Constants ────────────────────────────────
const TILE_VALUES = {
  A:1,  B:4,  C:4,  D:2,  E:1,  F:4,  G:3,  H:3,  I:1,
  J:10, K:5,  L:2,  M:4,  N:2,  O:1,  P:4,  Q:10, R:1,
  S:1,  T:1,  U:2,  V:5,  W:4,  X:8,  Y:3,  Z:10, '?':0
};
const TILE_DIST = {
  A:9, B:2, C:2, D:5, E:13, F:2, G:3, H:4, I:8,
  J:1, K:1, L:4, M:2, N:5,  O:8, P:2, Q:1, R:6,
  S:5, T:7, U:4, V:2, W:2,  X:1, Y:2, Z:1, '?':2
};

// Full 15×15 WWF multiplier layout  key = "row,col"  (0-indexed; rows 1-15 → 0-14, cols A-O → 0-14)
// Verified against reference grid — 180° rotationally symmetric
const WWF_LAYOUT = {
  // Row  1: D=TW, G=TL, I=TL, L=TW
  '0,3':'3W','0,6':'3L','0,8':'3L','0,11':'3W',
  // Row  2: C=DL, F=DW, J=DW, M=DL
  '1,2':'2L','1,5':'2W','1,9':'2W','1,12':'2L',
  // Row  3: B=DL, E=DL, K=DL, N=DL
  '2,1':'2L','2,4':'2L','2,10':'2L','2,13':'2L',
  // Row  4: A=TW, D=TL, H=DW, L=TL, O=TW
  '3,0':'3W','3,3':'3L','3,7':'2W','3,11':'3L','3,14':'3W',
  // Row  5: C=DL, G=DL, I=DL, M=DL
  '4,2':'2L','4,6':'2L','4,8':'2L','4,12':'2L',
  // Row  6: B=DW, F=TL, J=TL, N=DW
  '5,1':'2W','5,5':'3L','5,9':'3L','5,13':'2W',
  // Row  7: A=TL, E=DL, K=DL, O=TL
  '6,0':'3L','6,4':'2L','6,10':'2L','6,14':'3L',
  // Row  8: D=DW, H=★(center), L=DW
  '7,3':'2W','7,11':'2W',
  // Row  9: A=TL, E=DL, K=DL, O=TL
  '8,0':'3L','8,4':'2L','8,10':'2L','8,14':'3L',
  // Row 10: B=DW, F=TL, J=TL, N=DW
  '9,1':'2W','9,5':'3L','9,9':'3L','9,13':'2W',
  // Row 11: C=DL, G=DL, I=DL, M=DL
  '10,2':'2L','10,6':'2L','10,8':'2L','10,12':'2L',
  // Row 12: A=TW, D=TL, H=DW, L=TL, O=TW
  '11,0':'3W','11,3':'3L','11,7':'2W','11,11':'3L','11,14':'3W',
  // Row 13: B=DL, E=DL, K=DL, N=DL
  '12,1':'2L','12,4':'2L','12,10':'2L','12,13':'2L',
  // Row 14: C=DL, F=DW, J=DW, M=DL
  '13,2':'2L','13,5':'2W','13,9':'2W','13,12':'2L',
  // Row 15: D=TW, G=TL, I=TL, L=TW
  '14,3':'3W','14,6':'3L','14,8':'3L','14,11':'3W',
};

const ALPHABET    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const BINGO_BONUS = 35;
const MAX_PATTERNS  = 3;
const DEFAULT_CELLS = 4;
const MAX_CELLS     = 15;
const MIN_CELLS     = 2;
const MAX_HISTORY   = 10;
const BOARD_MIN     = 5;
const BOARD_MAX     = 11;
const BOARD_DEFAULT = 9;
const WWF_SIZE      = 15;   // real WWF board is 15×15

// ── App State ─────────────────────────────────
let dictionary      = [];
let dictSet         = new Set();
let currentResults  = [];
let currentSort     = 'score';
let activeMode      = 'pattern';

// Pattern mode
let patterns        = [];
let excludedWords   = new Set();

// Game Log (Phase 10)
let gameTurns = []; // [{ player:'me'|'opp', word, tilesPlaced:[], score, timestamp }]
let glFormPlayer = 'me'; // currently open form player

// Board mode
let boardSize       = 15;              // always full 15×15
let boardGrid       = [];              // boardGrid[r][c] = { letter, multiplier, locked }
let boardHistory    = [];              // undo stack
let boardOffset     = { row: 0, col: 0 };
let wwfPanelOpen    = false;

// Board save slots (5 games)
let boardSlots      = [null,null,null,null,null];
let activeSlot      = 0;

// Board keyboard cursor + typing direction
let boardCursor     = null;            // { r, c } or null when no cell selected
let boardTypingDir  = 'H';             // 'H' = right, 'V' = down

// Pinch-zoom
let boardZoom       = 1.0;

// Picker
let pickerTarget    = null;

// History
let searchHistory   = [];

// ── DOM Refs ──────────────────────────────────
const rackInput       = document.getElementById('rack-input');
const searchBtn       = document.getElementById('search-btn');
const btnCount        = document.getElementById('btn-count');
const dictStatus      = document.getElementById('dict-status');
const tileDisplay     = document.getElementById('tile-display');
const tileProbPanel   = document.getElementById('tile-prob-panel');
const resultsList     = document.getElementById('results-list');
const resultsEmpty    = document.getElementById('results-empty');
const resultsHint     = document.getElementById('results-hint');
const sortControls    = document.getElementById('sort-controls');
const patternSlots    = document.getElementById('pattern-slots');
const addPatternBtn   = document.getElementById('add-pattern-btn');
const filtersToggle   = document.getElementById('filters-toggle');
const filtersBody     = document.getElementById('filters-body');
const minScoreSlider  = document.getElementById('min-score-slider');
const minScoreDisplay = document.getElementById('min-score-display');
const excludeInput    = document.getElementById('exclude-input');
const excludeChips    = document.getElementById('exclude-chips');
// game log
const glToggle        = document.getElementById('gl-toggle');
const glBody          = document.getElementById('gl-body');
const glMyBtn         = document.getElementById('gl-my-btn');
const glOppBtn        = document.getElementById('gl-opp-btn');
const glForm          = document.getElementById('gl-form');
const glFormWho       = document.getElementById('gl-form-who');
const glWordInput     = document.getElementById('gl-word-input');
const glTilesInput    = document.getElementById('gl-tiles-input');
const glScoreInput    = document.getElementById('gl-score-input');
const glSubmit        = document.getElementById('gl-submit');
const glCancel        = document.getElementById('gl-cancel');
const bagCounter      = document.getElementById('bag-counter');
const dangerSection   = document.getElementById('danger-section');
const glTurns         = document.getElementById('gl-turns');
const boardGridEl     = document.getElementById('board-grid');
const boardGridScaler = document.getElementById('board-grid-scaler');
const boardGridWrap   = document.getElementById('board-grid-wrap');
const boardDirBtn     = document.getElementById('board-dir-btn');
const boardSaveBtn    = document.getElementById('board-save-btn');
const boardKeyInput   = document.getElementById('board-key-input');
const boardUndoBtn    = document.getElementById('board-undo-btn');
const boardClearBtn   = document.getElementById('board-clear-btn');
const letterOverlay   = document.getElementById('letter-overlay');
const pickerTitle     = document.getElementById('picker-title');
const alphabetGrid    = document.getElementById('alphabet-grid');
const pickerClear     = document.getElementById('picker-clear');
const multOverlay     = document.getElementById('mult-overlay');
const multCancel      = document.getElementById('mult-cancel');
const defOverlay      = document.getElementById('def-overlay');
const defDrawer       = document.getElementById('def-drawer');
const defWordEl       = document.getElementById('def-word');
const defBody         = document.getElementById('def-body');
const defClose        = document.getElementById('def-close');
const historyBtn      = document.getElementById('history-btn');
const historyOverlay  = document.getElementById('history-overlay');
const historyDrawer   = document.getElementById('history-drawer');
const historyClose    = document.getElementById('history-close');
const historyBody     = document.getElementById('history-body');

// ── Dictionary ────────────────────────────────
async function loadDictionary() {
  try {
    dictStatus.textContent = 'Loading…';
    dictStatus.className = 'status loading';
    const r = await fetch('dictionary.txt');
    if (!r.ok) throw new Error();
    const text = await r.text();
    dictionary = text.split('\n').map(w => w.trim().toUpperCase()).filter(w => w.length >= 2 && /^[A-Z]+$/.test(w));
    dictSet = new Set(dictionary);
    dictStatus.textContent = `✓ ${dictionary.length.toLocaleString()} words`;
    dictStatus.className = 'status ready';
    updateSearchButton();
  } catch {
    dictStatus.textContent = '✗ No dictionary';
    dictStatus.className = 'status error';
  }
}

// ── Mode Tabs ─────────────────────────────────
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeMode = tab.dataset.mode;
    document.getElementById('mode-pattern').style.display = activeMode === 'pattern' ? '' : 'none';
    document.getElementById('mode-board').style.display   = activeMode === 'board'   ? '' : 'none';
    clearResults();
  });
});

// ── Rack / Tile Display ───────────────────────
function updateTileDisplay() {
  const raw = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  tileDisplay.innerHTML = '';
  for (const ch of raw) {
    const tile = document.createElement('div');
    tile.className = 'tile' + (ch === '?' ? ' blank' : '');
    const l = document.createElement('span'); l.textContent = ch === '?' ? '★' : ch;
    const p = document.createElement('span'); p.className = 'tile-points';
    p.textContent = ch === '?' ? '0' : (TILE_VALUES[ch] ?? '');
    tile.appendChild(l); tile.appendChild(p); tileDisplay.appendChild(tile);
  }
}

function updateTileProb() {
  const rack = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  if (!rack) { tileProbPanel.style.display = 'none'; return; }
  const rem = { ...TILE_DIST };
  for (const ch of rack) { if (rem[ch] !== undefined) rem[ch] = Math.max(0, rem[ch] - 1); }
  const html = ['<span class="prob-label">Bag status</span>'];
  const seen = new Set();
  for (const ch of rack) {
    if (ch === '?' || seen.has(ch)) continue; seen.add(ch);
    const left = rem[ch] ?? 0, total = TILE_DIST[ch] ?? 0;
    const pct = total > 0 ? left / total : 0;
    const cls = left === 0 ? 'depleted' : pct <= 0.25 ? 'rare' : pct <= 0.5 ? 'scarce' : 'common';
    html.push(`<div class="prob-chip ${cls}"><span class="pc-letter">${ch}</span><span class="pc-count">${left}/${total}</span></div>`);
  }
  if (rack.length === 7) html.push('<span class="prob-note">⭐ Full rack — bingo possible!</span>');
  tileProbPanel.innerHTML = html.join('');
  tileProbPanel.style.display = 'flex';
}

function updateSearchButton() {
  searchBtn.disabled = !(rackInput.value.trim().length > 0 && dictionary.length > 0);
}

rackInput.addEventListener('input', () => {
  rackInput.value = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '').slice(0, 9);
  updateTileDisplay(); updateTileProb(); updateSearchButton(); clearResults();
});
rackInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchBtn.click(); });

// ── Search Dispatch ───────────────────────────
searchBtn.addEventListener('click', () => {
  if (searchBtn.disabled) return;
  searchBtn.classList.add('searching');
  searchBtn.querySelector('.btn-text').textContent = 'Searching…';
  // Yield to browser for repaint before the blocking search
  setTimeout(() => {
    try {
      if (activeMode === 'board') findBoardPlays();
      else findWords();
      addLeaveToResults();
      renderResults();
    } catch(e) { console.error(e); }
    searchBtn.classList.remove('searching');
    searchBtn.querySelector('.btn-text').textContent = 'Find Words';
  }, 30);
});

// ═══════════════════════════════════════════════
//  CORE HELPERS (shared)
// ═══════════════════════════════════════════════

// Check if rack contains all needed letters (supports blanks as wildcards)
function canMakeWord(needed, rack) {
  const avail = [...rack];
  for (const ch of needed) {
    const i = avail.indexOf(ch);
    if (i !== -1) { avail.splice(i, 1); continue; }
    const b = avail.indexOf('?');
    if (b !== -1) { avail.splice(b, 1); continue; }
    return false;
  }
  return true;
}

// ═══════════════════════════════════════════════
//  PATTERN MODE ENGINE
// ═══════════════════════════════════════════════

function computeScorePattern(word, cells, rack) {
  // cells: array of {letter, multiplier}  (letter !== null → board tile)
  const tempRack = [...rack];
  let tileSum = 0, wordMult = 1, usedBlanks = 0, tilesFromRack = 0;
  const perTile = [];
  for (let i = 0; i < word.length; i++) {
    const ch = word[i], cell = cells[i];
    if (cell.letter !== null) {
      perTile.push({ letter: ch, type: 'board', baseVal: 0, multiplier: '' });
      continue;
    }
    tilesFromRack++;
    const ri = tempRack.indexOf(ch); let isBlank = false;
    if (ri !== -1) tempRack.splice(ri, 1);
    else { const bi = tempRack.indexOf('?'); tempRack.splice(bi, 1); isBlank = true; usedBlanks++; }
    const baseVal = isBlank ? 0 : (TILE_VALUES[ch] || 0), mult = cell.multiplier;
    let tv = baseVal;
    if (!isBlank) { if (mult === '2L') tv = baseVal * 2; if (mult === '3L') tv = baseVal * 3; }
    tileSum += tv;
    if (mult === '2W') wordMult *= 2;
    if (mult === '3W') wordMult *= 3;
    perTile.push({ letter: ch, type: isBlank ? 'blank' : 'rack', baseVal, tileVal: tv, multiplier: mult });
  }
  const isBingo = tilesFromRack === rack.length && rack.length === 7;
  const base = tileSum, final = base * wordMult + (isBingo ? BINGO_BONUS : 0);
  let formula = '';
  if (wordMult > 1 && isBingo) formula = `(${base}×${wordMult}W)+${BINGO_BONUS} bingo=${final}`;
  else if (wordMult > 1)        formula = `${base}×${wordMult}W = ${final}`;
  else if (isBingo)             formula = `${base}+${BINGO_BONUS} bingo = ${final}`;
  return { base, final, formula, usedBlanks, perTile, wordMult, isBingo };
}

function findWords() {
  const rackRaw = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  if (!rackRaw || !dictionary.length) return;
  const rack = [...rackRaw];
  const minScore = parseInt(minScoreSlider.value, 10) || 0;

  // patternResults[pIdx] = array of result objects for that pattern (-1 = no pattern / free search)
  // We'll store: { byPattern: Map<pIdx, result[]>, free: result[] }
  const patternResultsMap = new Map(); // pIdx -> result[]
  const freeResults = [];
  const seenFree = new Set();

  // Gather valid pattern tasks
  const patternTasks = [];
  patterns.forEach((cells, pIdx) => {
    const rs = cells.map(c => c.letter ? c.letter : '[A-Z]').join('');
    let regex; try { regex = new RegExp('^' + rs + '$'); } catch { return; }
    patternTasks.push({ cells, regex, patternIdx: pIdx });
    patternResultsMap.set(pIdx, []);
  });

  for (const word of dictionary) {
    if (excludedWords.has(word)) continue;

    // Check each pattern
    for (const { cells, regex, patternIdx } of patternTasks) {
      if (!regex.test(word)) continue;
      const needed = [];
      for (let i = 0; i < cells.length; i++) if (cells[i].letter === null) needed.push(word[i]);
      if (needed.length > rack.length) continue;
      if (!canMakeWord(needed, rack)) continue;
      const sc = computeScorePattern(word, cells, rack);
      if (sc.final < minScore) continue;
      patternResultsMap.get(patternIdx).push({
        word, score: sc.final, length: word.length,
        blanks: sc.usedBlanks, perTile: sc.perTile,
        wordMult: sc.wordMult, formula: sc.formula,
        isBingo: sc.isBingo, isBoardPlay: false,
        patternIdx, cells, rack
      });
    }

    // Free search (no pattern constraint)
    if (seenFree.has(word)) continue;
    const needed = [...word];
    if (needed.length > rack.length) continue;
    if (!canMakeWord(needed, rack)) continue;
    seenFree.add(word);
    const eff = word.split('').map(() => ({ letter: null, multiplier: '' }));
    const sc = computeScorePattern(word, eff, rack);
    if (sc.final < minScore) continue;
    freeResults.push({
      word, score: sc.final, length: word.length,
      blanks: sc.usedBlanks, perTile: sc.perTile,
      wordMult: sc.wordMult, formula: sc.formula,
      isBingo: sc.isBingo, isBoardPlay: false,
      patternIdx: -1, cells: eff, rack
    });
  }

  // Sort each pattern's results by score desc
  for (const [, arr] of patternResultsMap) arr.sort((a,b) => b.score - a.score || b.length - a.length);

  // For the free list, deduplicate words that are already in a pattern result
  // (we still show them in free, just mark them so we don't double-count in totals)
  const patternWords = new Set();
  for (const [, arr] of patternResultsMap) arr.forEach(r => patternWords.add(r.word));
  const filteredFree = freeResults.filter(r => !patternWords.has(r.word));

  // Store structured results for renderResults
  currentResults = { patternResultsMap, filteredFree, patternTasks };
  saveHistory(rackRaw, filteredFree.length + [...patternResultsMap.values()].reduce((s,a)=>s+a.length,0));
  // renderResults called by search dispatcher after leave annotation
}

// ═══════════════════════════════════════════════
//  BOARD MODE ENGINE
// ═══════════════════════════════════════════════

function makeCell(letter = null, multiplier = '', locked = false) {
  return { letter, multiplier, locked };
}

function initBoard() {
  boardGrid = [];
  for (let r = 0; r < WWF_SIZE; r++) {
    boardGrid[r] = [];
    for (let c = 0; c < WWF_SIZE; c++) {
      const key = `${r},${c}`;
      boardGrid[r][c] = makeCell(null, WWF_LAYOUT[key] || '');
    }
  }
  boardSize = WWF_SIZE;
}

function snapBoardHistory() {
  boardHistory.push(JSON.parse(JSON.stringify(boardGrid)));
  if (boardHistory.length > 40) boardHistory.shift();
}

// ── Save Slots ────────────────────────────────

function saveBoardToSlot(slot) {
  boardSlots[slot] = JSON.parse(JSON.stringify(boardGrid));
  try { localStorage.setItem('wwf_board_slots', JSON.stringify(boardSlots)); } catch(e) {}
  renderSlotBtns();
}

function loadSlotsFromStorage() {
  try {
    const raw = localStorage.getItem('wwf_board_slots');
    if (raw) boardSlots = JSON.parse(raw);
  } catch(e) {}
  renderSlotBtns();
}

function renderSlotBtns() {
  document.querySelectorAll('.board-slot-btn').forEach(btn => {
    const s = +btn.dataset.slot;
    btn.classList.toggle('active', s === activeSlot);
    btn.classList.toggle('has-data', boardSlots[s] !== null);
  });
}

document.querySelectorAll('.board-slot-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const s = +btn.dataset.slot;
    if (s === activeSlot) return;
    // Auto-save current before switching
    boardSlots[activeSlot] = JSON.parse(JSON.stringify(boardGrid));
    activeSlot = s;
    if (boardSlots[s]) {
      boardGrid = JSON.parse(JSON.stringify(boardSlots[s]));
      boardSize = boardGrid.length;
    } else {
      initBoard();
    }
    boardCursor = null;
    renderBoardGrid();
    renderSlotBtns();
    clearResults();
  });
});

boardSaveBtn.addEventListener('click', () => {
  saveBoardToSlot(activeSlot);
  boardSaveBtn.textContent = '✓ Saved!';
  setTimeout(() => { boardSaveBtn.textContent = '💾 Save'; }, 1400);
});

// ── Direction button ──────────────────────────

boardDirBtn.addEventListener('click', () => {
  boardTypingDir = boardTypingDir === 'H' ? 'V' : 'H';
  boardDirBtn.textContent = boardTypingDir === 'H' ? '→ Right' : '↓ Down';
  boardDirBtn.classList.toggle('dir-active', boardTypingDir === 'V');
  if (boardCursor) renderBoardGrid();
});

// ── Undo / Clear ──────────────────────────────

boardUndoBtn.addEventListener('click', () => {
  if (!boardHistory.length) return;
  boardGrid = boardHistory.pop();
  boardSize = boardGrid.length;
  boardCursor = null;
  renderBoardGrid(); clearResults();
});
boardClearBtn.addEventListener('click', () => {
  snapBoardHistory(); initBoard(); boardCursor = null; renderBoardGrid(); clearResults();
});

// ── Keyboard cursor + typing ──────────────────

function setCursor(r, c) {
  if (boardCursor && boardCursor.r === r && boardCursor.c === c) {
    // Second tap on same cell → toggle direction
    boardTypingDir = boardTypingDir === 'H' ? 'V' : 'H';
    boardDirBtn.textContent = boardTypingDir === 'H' ? '→ Right' : '↓ Down';
    boardDirBtn.classList.toggle('dir-active', boardTypingDir === 'V');
  } else {
    boardCursor = { r, c };
  }
  renderBoardGrid();
  // Bring up keyboard
  boardKeyInput.value = '';
  boardKeyInput.focus();
}

function advanceCursor() {
  if (!boardCursor) return;
  const { r, c } = boardCursor;
  if (boardTypingDir === 'H' && c + 1 < boardSize) boardCursor = { r, c: c + 1 };
  else if (boardTypingDir === 'V' && r + 1 < boardSize) boardCursor = { r: r + 1, c };
}

function backCursor() {
  if (!boardCursor) return;
  const { r, c } = boardCursor;
  if (boardTypingDir === 'H' && c > 0) boardCursor = { r, c: c - 1 };
  else if (boardTypingDir === 'V' && r > 0) boardCursor = { r: r - 1, c };
}

function placeLetter(ch) {
  if (!boardCursor) return;
  const { r, c } = boardCursor;
  snapBoardHistory();
  boardGrid[r][c].letter = ch;
  boardGrid[r][c].locked = true;
  advanceCursor();
  renderBoardGrid();
}

function deleteLetter() {
  if (!boardCursor) return;
  const { r, c } = boardCursor;
  snapBoardHistory();
  if (boardGrid[r][c].letter) {
    boardGrid[r][c].letter = null;
    boardGrid[r][c].locked = false;
  } else {
    backCursor();
    if (boardCursor) {
      boardGrid[boardCursor.r][boardCursor.c].letter = null;
      boardGrid[boardCursor.r][boardCursor.c].locked = false;
    }
  }
  renderBoardGrid();
}

// Physical keyboard (desktop + Android keydown)
boardKeyInput.addEventListener('keydown', e => {
  if (!boardCursor) return;
  if (e.key === 'Backspace') { e.preventDefault(); deleteLetter(); return; }
  if (e.key === 'Escape')    { boardCursor = null; renderBoardGrid(); boardKeyInput.blur(); return; }
  if (e.key === 'ArrowRight'){ e.preventDefault(); if(boardCursor&&boardCursor.c+1<boardSize){boardCursor.c++;renderBoardGrid();} return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); if(boardCursor&&boardCursor.c>0){boardCursor.c--;renderBoardGrid();} return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); if(boardCursor&&boardCursor.r+1<boardSize){boardCursor.r++;renderBoardGrid();} return; }
  if (e.key === 'ArrowUp')   { e.preventDefault(); if(boardCursor&&boardCursor.r>0){boardCursor.r--;renderBoardGrid();} return; }
  const ch = e.key.toUpperCase();
  if (/^[A-Z]$/.test(ch)) { e.preventDefault(); placeLetter(ch); }
});

// Mobile soft keyboard: capture via input event
boardKeyInput.addEventListener('input', () => {
  if (!boardCursor) { boardKeyInput.value = ''; return; }
  const val = boardKeyInput.value;
  if (val === '') {
    deleteLetter();
  } else {
    const ch = val.slice(-1).toUpperCase();
    boardKeyInput.value = '';
    if (/^[A-Z]$/.test(ch)) placeLetter(ch);
  }
});

// Dismiss cursor when tapping outside the grid
document.addEventListener('pointerdown', e => {
  if (!boardCursor) return;
  if (!e.target.closest('#board-grid')) {
    boardCursor = null;
    renderBoardGrid();
  }
}, true);

// ── Pinch-to-Zoom ─────────────────────────────
// Zooms from the midpoint between the two fingers

(function() {
  let p0, p1, startZoom, startMidX, startMidY, startScrollLeft, startScrollTop;

  boardGridWrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      p0 = e.touches[0];
      p1 = e.touches[1];
      startZoom = boardZoom;

      // Midpoint in page coords
      startMidX = (p0.clientX + p1.clientX) / 2;
      startMidY = (p0.clientY + p1.clientY) / 2;

      // Scroll offset at gesture start
      startScrollLeft = boardGridWrap.scrollLeft;
      startScrollTop  = boardGridWrap.scrollTop;

      e.preventDefault();
    }
  }, { passive: false });

  boardGridWrap.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !p0) return;
    e.preventDefault();

    const t0 = e.touches[0], t1 = e.touches[1];

    const dist0 = Math.hypot(p0.clientX - p1.clientX, p0.clientY - p1.clientY);
    const dist1 = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
    const newZoom = Math.max(0.4, Math.min(2.5, startZoom * (dist1 / dist0)));

    // Where was the pinch midpoint relative to the wrap element's top-left?
    const wrapRect = boardGridWrap.getBoundingClientRect();
    // Point in the *scaled content* that should stay fixed
    const originX = (startScrollLeft + startMidX - wrapRect.left) / startZoom;
    const originY = (startScrollTop  + startMidY - wrapRect.top ) / startZoom;

    // Apply scale with origin at top-left (we'll correct scroll)
    boardGridScaler.style.transformOrigin = 'top left';
    boardGridScaler.style.transform = `scale(${newZoom})`;
    boardZoom = newZoom;

    // Adjust scroll so the pinch origin stays under the fingers
    const currentMidX = (t0.clientX + t1.clientX) / 2;
    const currentMidY = (t0.clientY + t1.clientY) / 2;
    boardGridWrap.scrollLeft = originX * newZoom - (currentMidX - wrapRect.left);
    boardGridWrap.scrollTop  = originY * newZoom - (currentMidY - wrapRect.top);

    // Expand scroll container height to fit scaled content
    boardGridWrap.style.minHeight = (boardGridScaler.offsetHeight * newZoom) + 'px';
  }, { passive: false });

  boardGridWrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) p0 = null;
  });
  boardGridWrap.addEventListener('touchcancel', () => { p0 = null; });
})();

// ── Board Rendering ───────────────────────────
function renderBoardGrid() {
  boardGridEl.style.gridTemplateColumns = `repeat(${boardSize}, 34px)`;
  boardGridEl.style.gridTemplateRows    = `repeat(${boardSize}, 34px)`;
  boardGridEl.innerHTML = '';

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const cell = boardGrid[r][c];
      const el   = document.createElement('div');
      el.className = 'bg-cell';
      el.dataset.r = r;
      el.dataset.c = c;

      if (cell.letter) {
        el.classList.add('gc-locked');
        const span = document.createElement('span');
        span.textContent = cell.letter;
        el.appendChild(span);
        const pts = document.createElement('span');
        pts.className = 'gc-pts';
        pts.textContent = TILE_VALUES[cell.letter] ?? '';
        el.appendChild(pts);
      } else if (r === 7 && c === 7) {
        el.classList.add('gc-center');
        el.textContent = '★';
      } else if (cell.multiplier) {
        const map = { '2L':'gc-2l','3L':'gc-3l','2W':'gc-2w','3W':'gc-3w' };
        const lbl = { '2L':'DL','3L':'TL','2W':'DW','3W':'TW' };
        el.classList.add(map[cell.multiplier] || '');
        el.textContent = lbl[cell.multiplier] || cell.multiplier;
      } else {
        el.classList.add('gc-empty');
      }

      // Cursor highlight
      if (boardCursor && boardCursor.r === r && boardCursor.c === c) {
        el.classList.add(boardTypingDir === 'H' ? 'gc-cursor-h' : 'gc-cursor-v');
      }

      // Tap = set cursor; long press on letter cell = word popup
      let holdFired = false;
      let holdTimer = null;
      el.addEventListener('pointerdown', () => {
        holdFired = false;
        if (cell.letter) {
          holdTimer = setTimeout(() => {
            holdFired = true;
            openBoardCellWordPopup(r, c);
          }, 500);
        }
      });
      el.addEventListener('pointerup',    () => { clearTimeout(holdTimer); });
      el.addEventListener('pointerleave', () => { clearTimeout(holdTimer); });
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (!holdFired) setCursor(r, c);
      });
      el.addEventListener('contextmenu', e => { e.preventDefault(); if (cell.letter) openBoardCellWordPopup(r, c); });

      boardGridEl.appendChild(el);
    }
  }
}

function highlightPlay(play) {
  clearHighlights();
  const cls = play.direction === 'H' ? 'gc-highlight-h' : 'gc-highlight-v';
  for (let i = 0; i < play.word.length; i++) {
    const r = play.direction === 'H' ? play.row : play.row + i;
    const c = play.direction === 'H' ? play.col + i : play.col;
    const el = boardGridEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (el) el.classList.add(cls);
  }
}
function clearHighlights() {
  boardGridEl.querySelectorAll('.gc-highlight-h,.gc-highlight-v').forEach(el => {
    el.classList.remove('gc-highlight-h', 'gc-highlight-v');
  });
}

// Apply a found play back onto the board grid
function applyPlayToBoard(play) {
  snapBoardHistory();
  for (let i = 0; i < play.word.length; i++) {
    const r = play.direction === 'H' ? play.row : play.row + i;
    const c = play.direction === 'H' ? play.col + i : play.col;
    if (!boardGrid[r][c].letter) {
      boardGrid[r][c].letter = play.word[i];
      boardGrid[r][c].locked = true;
    }
  }
  renderBoardGrid();
  clearResults();
  closeDefinition();
}


// ── 2D Board Scoring ──────────────────────────
//
// BUG FIX vs Phase 8:
//   scoreWordOnBoard now takes the *remaining* rack (after placing the word)
//   when scoring cross-words, so we don't double-consume tiles.
//   Cross-word scoring only needs to know which of the new tile's letter
//   is a blank — we determine that during the main placement pass and
//   pass a `placedBlanks` set to cross-word scoring.
//
// Each cell in `cells`:  { letter, isNew, multiplier, isBlank? }

function scoreMainWord(cells) {
  // cells already know isNew and isBlank (set by caller)
  let tileSum = 0, wordMult = 1, usedBlanks = 0;
  const perTile = [];
  for (const cell of cells) {
    if (!cell.isNew) {
      perTile.push({ letter: cell.letter, type: 'board', baseVal: 0, multiplier: '' });
      continue;
    }
    const isBlank = cell.isBlank;
    if (isBlank) usedBlanks++;
    const baseVal = isBlank ? 0 : (TILE_VALUES[cell.letter] || 0);
    const mult = cell.multiplier;
    let tv = baseVal;
    if (!isBlank) { if (mult === '2L') tv = baseVal * 2; if (mult === '3L') tv = baseVal * 3; }
    tileSum += tv;
    if (mult === '2W') wordMult *= 2;
    if (mult === '3W') wordMult *= 3;
    perTile.push({ letter: cell.letter, type: isBlank ? 'blank' : 'rack', baseVal, tileVal: tv, multiplier: mult });
  }
  return { tileSum, wordMult, score: tileSum * wordMult, usedBlanks, perTile };
}

// Score a cross-word. crossCells are as returned by getCrossWord.
// isBlankAt: Set of "r,c" keys for positions where the new tile is a blank.
function scoreCrossWord(crossCells, isBlankAt) {
  let tileSum = 0, wordMult = 1;
  for (const cell of crossCells) {
    if (!cell.isNew) {
      // existing board tile — contributes its face value, no multiplier
      tileSum += TILE_VALUES[cell.letter] || 0;
      continue;
    }
    const key = `${cell.r},${cell.c}`;
    const isBlank = isBlankAt.has(key);
    const baseVal = isBlank ? 0 : (TILE_VALUES[cell.letter] || 0);
    const mult = cell.multiplier;
    let tv = baseVal;
    if (!isBlank) { if (mult === '2L') tv = baseVal * 2; if (mult === '3L') tv = baseVal * 3; }
    tileSum += tv;
    if (mult === '2W') wordMult *= 2;
    if (mult === '3W') wordMult *= 3;
  }
  return tileSum * wordMult;
}

// Build cross-word cells at (r,c) when placing `letter` there, scanning perpendicularly
function getCrossWord(r, c, dr, dc, letter) {
  const before = [];
  let br = r - dr, bc = c - dc;
  while (br >= 0 && br < boardSize && bc >= 0 && bc < boardSize && boardGrid[br][bc].letter) {
    before.unshift({ r: br, c: bc, letter: boardGrid[br][bc].letter, isNew: false, multiplier: '' });
    br -= dr; bc -= dc;
  }
  const mid = [{ r, c, letter, isNew: true, multiplier: boardGrid[r][c].multiplier }];
  const after = [];
  let ar = r + dr, ac = c + dc;
  while (ar >= 0 && ar < boardSize && ac >= 0 && ac < boardSize && boardGrid[ar][ac].letter) {
    after.push({ r: ar, c: ac, letter: boardGrid[ar][ac].letter, isNew: false, multiplier: '' });
    ar += dr; ac += dc;
  }
  const all = [...before, ...mid, ...after];
  return all.length >= 2 ? all : null;
}

function hasAnyLockedTile() {
  for (let r = 0; r < boardSize; r++)
    for (let c = 0; c < boardSize; c++)
      if (boardGrid[r][c].letter) return true;
  return false;
}

function getAnchors() {
  const anchors = new Set();
  if (!hasAnyLockedTile()) {
    const mid = Math.floor(boardSize / 2);
    anchors.add(`${mid},${mid}`);
    return anchors;
  }
  const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (boardGrid[r][c].letter) continue;
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && boardGrid[nr][nc].letter) {
          anchors.add(`${r},${c}`); break;
        }
      }
    }
  }
  return anchors;
}

function findBoardPlays() {
  const rackRaw = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  if (!rackRaw || !dictionary.length) return;
  const rack = [...rackRaw];
  const anchors = getAnchors();
  const seenKey = new Set();
  const results = [];

  for (const anchorKey of anchors) {
    const [ar, ac] = anchorKey.split(',').map(Number);

    for (const dir of ['H', 'V']) {
      const [dr, dc] = dir === 'H' ? [0,1] : [1,0];
      const [pr, pc] = dir === 'H' ? [1,0] : [0,1]; // perpendicular

      for (let len = 2; len <= rack.length + boardSize; len++) {
        for (let startOffset = 0; startOffset < len; startOffset++) {
          const startR = ar - startOffset * dr;
          const startC = ac - startOffset * dc;
          const endR   = startR + (len - 1) * dr;
          const endC   = startC + (len - 1) * dc;
          if (startR < 0 || startC < 0 || endR >= boardSize || endC >= boardSize) continue;

          // Build line pattern
          const linePattern = [];
          let neededFromRack = 0;
          for (let i = 0; i < len; i++) {
            const r = startR + i * dr, c = startC + i * dc;
            const L = boardGrid[r][c].letter;
            linePattern.push(L || null);
            if (!L) neededFromRack++;
          }
          if (neededFromRack === 0 || neededFromRack > rack.length) continue;

          // Word boundary: cell before start and after end must be empty
          const bR = startR - dr, bC = startC - dc;
          const aR = endR + dr,   aC = endC + dc;
          if (bR >= 0 && bR < boardSize && bC >= 0 && bC < boardSize && boardGrid[bR][bC].letter) continue;
          if (aR >= 0 && aR < boardSize && aC >= 0 && aC < boardSize && boardGrid[aR][aC].letter)  continue;

          // Build regex
          const regexStr = linePattern.map(l => l ? l : '[A-Z]').join('');
          let regex; try { regex = new RegExp('^' + regexStr + '$'); } catch { continue; }

          for (const word of dictionary) {
            if (word.length !== len) continue;
            if (!regex.test(word)) continue;

            // Letters needed from rack
            const needed = [];
            for (let i = 0; i < len; i++) if (linePattern[i] === null) needed.push(word[i]);
            if (!canMakeWord(needed, rack)) continue;

            // Determine which positions get blanks
            // We greedily use real tiles first, then blanks
            const tempR = [...rack];
            const isBlankAt = new Set();
            for (let i = 0; i < len; i++) {
              if (linePattern[i] !== null) continue;
              const ch = word[i];
              const ri = tempR.indexOf(ch);
              if (ri !== -1) { tempR.splice(ri, 1); continue; }
              // must use blank
              const bi = tempR.indexOf('?');
              if (bi !== -1) {
                tempR.splice(bi, 1);
                isBlankAt.add(`${startR + i * dr},${startC + i * dc}`);
              }
            }

            // Build main cells
            const mainCells = [];
            for (let i = 0; i < len; i++) {
              const r = startR + i * dr, c = startC + i * dc;
              const isNew = linePattern[i] === null;
              mainCells.push({
                r, c,
                letter: word[i],
                isNew,
                isBlank: isNew && isBlankAt.has(`${r},${c}`),
                multiplier: boardGrid[r][c].multiplier
              });
            }

            // Validate and score cross-words
            let crossValid = true;
            const crossWords = [];
            for (let i = 0; i < len; i++) {
              if (linePattern[i] !== null) continue; // existing tile — no perpendicular cross-word from this position
              const r = startR + i * dr, c = startC + i * dc;
              const cwCells = getCrossWord(r, c, pr, pc, word[i]);
              if (!cwCells) continue;
              const cwStr = cwCells.map(x => x.letter).join('');
              if (!dictSet.has(cwStr)) { crossValid = false; break; }
              crossWords.push({ word: cwStr, cells: cwCells });
            }
            if (!crossValid) continue;

            const key = `${word}|${startR}|${startC}|${dir}`;
            if (seenKey.has(key)) continue;
            seenKey.add(key);

            // Score main word
            const mainSc = scoreMainWord(mainCells);

            // Score cross-words using isBlankAt (correctly — no double-counting)
            let crossTotal = 0;
            const scoredCrossWords = [];
            for (const cw of crossWords) {
              const pts = scoreCrossWord(cw.cells, isBlankAt);
              crossTotal += pts;
              scoredCrossWords.push({ word: cw.word, score: pts });
            }

            const isBingo = neededFromRack === rack.length && rack.length === 7;
            const totalScore = mainSc.score + crossTotal + (isBingo ? BINGO_BONUS : 0);

            let formula = '';
            if (mainSc.wordMult > 1) formula = `${mainSc.tileSum}×${mainSc.wordMult}W`;
            if (crossTotal > 0) formula += (formula ? ' + ' : '') + `${crossTotal} cross`;
            if (isBingo) formula += ` + ${BINGO_BONUS} bingo`;
            if (formula) formula += ` = ${totalScore}`;

            results.push({
              word, score: totalScore, length: word.length,
              row: startR, col: startC, direction: dir,
              mainCells, crossWords: scoredCrossWords,
              blanks: mainSc.usedBlanks, perTile: mainSc.perTile,
              wordMult: mainSc.wordMult, formula, isBingo, isBoardPlay: true,
              patternIdx: -1, rack
            });
          }
        }
      }
    }
  }

  // Deduplicate by word+pos+dir, keep highest score
  const best = new Map();
  for (const r of results) {
    const k = `${r.word}|${r.row}|${r.col}|${r.direction}`;
    const ex = best.get(k); if (!ex || r.score > ex.score) best.set(k, r);
  }
  currentResults = [...best.values()];
  saveHistory(rackRaw, currentResults.length);
  // renderResults called by search dispatcher after leave annotation
}

// ═══════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════

function sortResults(results, mode) {
  const copy = [...results];
  if (mode === 'score')  copy.sort((a,b) => b.score - a.score || b.length - a.length);
  else if (mode === 'length') copy.sort((a,b) => b.length - a.length || b.score - a.score);
  else copy.sort((a,b) => a.word.localeCompare(b.word));
  return copy;
}

function clearResults() {
  currentResults = activeMode === 'board' ? [] : { patternResultsMap: new Map(), filteredFree: [], patternTasks: [] };
  resultsList.innerHTML = '';
  resultsEmpty.style.display = '';
  resultsEmpty.innerHTML = `<div class="empty-icon">🎯</div><p>Enter your tiles and tap <strong>Find Words</strong></p>`;
  sortControls.style.display = 'none';
  resultsHint.style.display = 'none';
  btnCount.textContent = '';
  if (activeMode === 'board') clearHighlights();
}

// Build a single result card element
function buildResultCard(r, i, topScore) {
  const item = document.createElement('div');
  let cls = 'result-item';
  if (r.isBoardPlay && r.isBingo)   cls += ' board-play bingo';
  else if (r.isBoardPlay)           cls += ' board-play';
  else if (r.isBingo)               cls += ' bingo';
  else if (r.score === topScore && i < 3) cls += ' top-word';
  item.className = cls;
  item.style.animationDelay = `${Math.min(i, 30) * 12}ms`;

  const blankBadge = r.blanks > 0 ? `<span class="result-blank-indicator">${r.blanks}★</span>` : '';
  const bingoBadge = r.isBingo ? `<span class="bingo-badge">BINGO ⭐</span>` : '';
  const boardTag   = r.isBoardPlay ? `<span class="board-play-tag">${r.direction} R${r.row+1}C${r.col+1}</span>` : '';
  const bd = buildInlineBreakdown(r);

  // Leave quality badge (Phase 10)
  const leaveBadge = r.leaveBadge ? `<span class="leave-badge leave-${r.leaveTier}">${r.leaveBadge}</span>` : '';

  let cwHtml = '';
  if (r.crossWords?.length) {
    cwHtml = '<div class="cross-words">' +
      r.crossWords.map(cw => `<span class="cross-word-chip">${cw.word}<span class="cw-score">+${cw.score}</span></span>`).join('') +
      '</div>';
  }

  item.innerHTML = `
    <div class="result-top-row">
      <div class="result-word">${r.word}</div>
      <div class="result-meta">${boardTag}${bingoBadge}${blankBadge}${leaveBadge}
        <span class="result-length">${r.length}L</span>
        <div class="result-score">${r.score}</div>
      </div>
    </div>
    <div class="result-breakdown">${bd.chips}
      ${bd.formula ? `<span class="result-formula">${bd.formula}</span>` : ''}
    </div>
    ${cwHtml}
  `;

  item.addEventListener('click', () => {
    if (r.isBoardPlay) highlightPlay(r);
    openDefinition(r);
  });
  return item;
}

function renderResults() {
  resultsList.innerHTML = '';

  // ── Board mode ──────────────────────────────
  if (activeMode === 'board') {
    const plays = Array.isArray(currentResults) ? currentResults : [];
    if (!plays.length) {
      resultsEmpty.style.display = '';
      resultsEmpty.innerHTML = `<div class="empty-icon">😬</div><p>No plays found.<br>Add existing tiles to the board first, or try a different rack.</p>`;
      sortControls.style.display = 'none'; resultsHint.style.display = 'none'; btnCount.textContent = ''; return;
    }
    resultsEmpty.style.display = 'none';
    sortControls.style.display = 'flex';
    resultsHint.style.display = '';
    btnCount.textContent = plays.length;
    const sorted = sortResults(plays, currentSort);
    const topScore = sorted[0]?.score ?? 0;
    const bingoCount = sorted.filter(r => r.isBingo).length;
    const countEl = document.createElement('div');
    countEl.className = 'results-count';
    countEl.textContent = `${sorted.length} play${sorted.length !== 1 ? 's' : ''}` +
      (bingoCount ? ` · ${bingoCount} bingo${bingoCount !== 1 ? 's' : ''} ⭐` : '');
    resultsList.appendChild(countEl);
    sorted.forEach((r, i) => resultsList.appendChild(buildResultCard(r, i, topScore)));
    return;
  }

  // ── Pattern mode ────────────────────────────
  const { patternResultsMap, filteredFree, patternTasks } = currentResults;
  const totalCount = filteredFree.length + [...patternResultsMap.values()].reduce((s,a) => s+a.length, 0);

  if (totalCount === 0 && patternTasks.length === 0) {
    resultsEmpty.style.display = '';
    resultsEmpty.innerHTML = `<div class="empty-icon">😬</div><p>No words found.<br>Try fewer tiles or lower the min score filter.</p>`;
    sortControls.style.display = 'none'; resultsHint.style.display = 'none'; btnCount.textContent = ''; return;
  }

  resultsEmpty.style.display = 'none';
  sortControls.style.display = 'flex';
  resultsHint.style.display = '';
  btnCount.textContent = totalCount;

  const allFree = sortResults(filteredFree, currentSort);
  const topScore = Math.max(
    allFree[0]?.score ?? 0,
    ...[...patternResultsMap.values()].map(a => a[0]?.score ?? 0)
  );
  const bingoCount = [...filteredFree, ...[...patternResultsMap.values()].flat()].filter(r => r.isBingo).length;

  const countEl = document.createElement('div');
  countEl.className = 'results-count';
  countEl.textContent = `${totalCount} word${totalCount !== 1 ? 's' : ''}` +
    (bingoCount ? ` · ${bingoCount} bingo${bingoCount !== 1 ? 's' : ''} ⭐` : '');
  resultsList.appendChild(countEl);

  // ── Per-pattern sections at top ─────────────
  patternTasks.forEach(({ patternIdx }) => {
    const patResults = patternResultsMap.get(patternIdx) ?? [];
    const section = document.createElement('div');
    section.className = 'pattern-results-section';

    const header = document.createElement('div');
    header.className = 'pattern-results-header';
    // Render mini visual of the pattern
    const patCells = patterns[patternIdx] || [];
    const visual = patCells.map(c => c.letter ? `<span class="pr-fixed">${c.letter}</span>` : '<span class="pr-blank">_</span>').join('');
    header.innerHTML = `<span class="pr-label">Pattern ${patternIdx + 1}</span><span class="pr-visual">${visual}</span><span class="pr-count">${patResults.length} word${patResults.length !== 1 ? 's' : ''}</span>`;
    section.appendChild(header);

    if (patResults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pattern-results-empty';
      empty.textContent = 'No words match this pattern with your tiles.';
      section.appendChild(empty);
    } else {
      const sorted = sortResults(patResults, currentSort);
      sorted.forEach((r, i) => section.appendChild(buildResultCard(r, i, sorted[0].score)));
    }
    resultsList.appendChild(section);
  });

  // ── Divider between pattern sections and free results ──
  if (patternTasks.length > 0 && allFree.length > 0) {
    const div = document.createElement('div');
    div.className = 'results-divider';
    div.innerHTML = `<span>All other words (${allFree.length})</span>`;
    resultsList.appendChild(div);
  }

  // ── Free results ────────────────────────────
  allFree.forEach((r, i) => resultsList.appendChild(buildResultCard(r, i, topScore)));
}

function buildInlineBreakdown(r) {
  let chips = '';
  for (const t of r.perTile) {
    const cls = t.type === 'board' ? 'rc-board' : t.type === 'blank' ? 'rc-blank' : 'rc-rack';
    const pts = t.type === 'board' ? '★' : (t.baseVal ?? 0);
    const mb  = (t.multiplier && t.type !== 'board') ? `<span class="rc-mult-badge rc-${t.multiplier.toLowerCase()}">${t.multiplier}</span>` : '';
    chips += `<div class="rc ${cls}">${mb}<span class="rc-l">${t.letter}</span><span class="rc-p">${pts}</span></div>`;
  }
  return { chips, formula: r.formula };
}

// Board preview mini-grid in the definition drawer
function buildBoardPreview(play) {
  const minR = Math.max(0, play.row - 1);
  const maxR = Math.min(boardSize - 1, (play.direction === 'V' ? play.row + play.word.length - 1 : play.row) + 1);
  const minC = Math.max(0, play.col - 1);
  const maxC = Math.min(boardSize - 1, (play.direction === 'H' ? play.col + play.word.length - 1 : play.col) + 1);
  const cols = maxC - minC + 1;

  const playSet = new Set();
  for (let i = 0; i < play.word.length; i++) {
    const r = play.direction === 'H' ? play.row : play.row + i;
    const c = play.direction === 'H' ? play.col + i : play.col;
    playSet.add(`${r},${c}`);
  }

  let grid = `<div class="board-preview-grid" style="grid-template-columns:repeat(${cols},30px)">`;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const cell = boardGrid[r][c];
      const key = `${r},${c}`;
      let cls = 'bp-cell', content = '';
      if (cell.letter) { cls += ' bp-locked'; content = cell.letter; }
      else if (playSet.has(key)) {
        const idx = play.direction === 'H' ? c - play.col : r - play.row;
        cls += play.direction === 'H' ? ' bp-play-h' : ' bp-play-v';
        content = play.word[idx] ?? '';
      } else if (cell.multiplier) {
        cls += ` gc-${cell.multiplier.toLowerCase()}`; content = cell.multiplier;
      }
      grid += `<div class="${cls}">${content}</div>`;
    }
  }
  return grid + '</div>';
}

// Sort buttons
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentSort = btn.dataset.sort; renderResults();
  });
});

// ═══════════════════════════════════════════════
//  PICKERS  (shared, mode-aware)
// ═══════════════════════════════════════════════

function openLetterPickerBoard(r, c) {
  pickerTarget = { mode: 'board', row: r, col: c };
  pickerTitle.textContent = boardGrid[r][c].letter ? `Change (${boardGrid[r][c].letter})` : 'Set board letter';
  letterOverlay.classList.add('visible');
}
function openLetterPicker(pIdx, cIdx) {
  pickerTarget = { mode: 'pattern', pIdx, cIdx };
  pickerTitle.textContent = 'Set board letter';
  letterOverlay.classList.add('visible');
}
function closeLetterPicker() { letterOverlay.classList.remove('visible'); pickerTarget = null; }

ALPHABET.forEach(ch => {
  const btn = document.createElement('button'); btn.className = 'alpha-btn'; btn.textContent = ch;
  btn.addEventListener('click', () => {
    if (!pickerTarget) return;
    if (pickerTarget.mode === 'board') {
      snapBoardHistory();
      boardGrid[pickerTarget.row][pickerTarget.col].letter = ch;
      boardGrid[pickerTarget.row][pickerTarget.col].locked = true;
      renderBoardGrid();
    } else {
      patterns[pickerTarget.pIdx][pickerTarget.cIdx].letter = ch;
      renderPatterns();
    }
    closeLetterPicker();
  });
  alphabetGrid.appendChild(btn);
});

pickerClear.addEventListener('click', () => {
  if (!pickerTarget) return;
  if (pickerTarget.mode === 'board') {
    snapBoardHistory();
    boardGrid[pickerTarget.row][pickerTarget.col].letter = null;
    boardGrid[pickerTarget.row][pickerTarget.col].locked = false;
    renderBoardGrid();
  } else {
    patterns[pickerTarget.pIdx][pickerTarget.cIdx].letter = null;
    renderPatterns();
  }
  closeLetterPicker();
});
letterOverlay.addEventListener('click', e => { if (e.target === letterOverlay) closeLetterPicker(); });

function openMultPickerBoard(r, c) { pickerTarget = { mode: 'board', row: r, col: c }; multOverlay.classList.add('visible'); }
function openMultPicker(pIdx, cIdx) { pickerTarget = { mode: 'pattern', pIdx, cIdx }; multOverlay.classList.add('visible'); }
function closeMultPicker() { multOverlay.classList.remove('visible'); pickerTarget = null; }

document.querySelectorAll('.mult-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!pickerTarget) return;
    if (pickerTarget.mode === 'board') {
      snapBoardHistory();
      boardGrid[pickerTarget.row][pickerTarget.col].multiplier = btn.dataset.mult;
      renderBoardGrid();
    } else {
      patterns[pickerTarget.pIdx][pickerTarget.cIdx].multiplier = btn.dataset.mult;
      renderPatterns();
    }
    closeMultPicker();
  });
});
multCancel.addEventListener('click', closeMultPicker);
multOverlay.addEventListener('click', e => { if (e.target === multOverlay) closeMultPicker(); });

// ═══════════════════════════════════════════════
//  PATTERN MODE UI
// ═══════════════════════════════════════════════

function makeCells(n) { return Array.from({length:n}, () => ({letter:null, multiplier:''})); }
function addPattern()   { if (patterns.length >= MAX_PATTERNS) return; patterns.push(makeCells(DEFAULT_CELLS)); renderPatterns(); updateAddBtn(); }
function removePattern(idx) { patterns.splice(idx,1); renderPatterns(); updateAddBtn(); }
function updateAddBtn() { addPatternBtn.disabled = patterns.length >= MAX_PATTERNS; }

function renderPatterns() {
  patternSlots.innerHTML = '';
  patterns.forEach((cells, pIdx) => {
    if (pIdx > 0) { const d = document.createElement('div'); d.className = 'pattern-divider'; patternSlots.appendChild(d); }
    const slot = document.createElement('div'); slot.className = 'pattern-slot';
    const hdr = document.createElement('div'); hdr.className = 'pattern-slot-header';
    hdr.innerHTML = `<span class="pattern-slot-label">Pattern ${pIdx+1}</span>
      ${patterns.length > 1 ? `<button class="remove-pattern-btn" data-pidx="${pIdx}">Remove</button>` : ''}`;
    slot.appendChild(hdr);
    const wrap = document.createElement('div'); wrap.className = 'cell-row-wrap';
    const mb = document.createElement('button'); mb.className='cell-size-btn'; mb.textContent='−'; mb.disabled=cells.length<=MIN_CELLS;
    mb.addEventListener('click', () => { if (patterns[pIdx].length > MIN_CELLS) { patterns[pIdx].pop(); renderPatterns(); } });
    const cr = document.createElement('div'); cr.className = 'cell-row';
    cells.forEach((cell, cIdx) => cr.appendChild(buildCellEl(pIdx, cIdx, cell)));
    const pb = document.createElement('button'); pb.className='cell-size-btn'; pb.textContent='+'; pb.disabled=cells.length>=MAX_CELLS;
    pb.addEventListener('click', () => { if (patterns[pIdx].length < MAX_CELLS) { patterns[pIdx].push({letter:null,multiplier:''}); renderPatterns(); } });
    wrap.appendChild(mb); wrap.appendChild(cr); wrap.appendChild(pb); slot.appendChild(wrap); patternSlots.appendChild(slot);
  });
  patternSlots.querySelectorAll('.remove-pattern-btn').forEach(btn =>
    btn.addEventListener('click', () => removePattern(+btn.dataset.pidx)));
}

function buildCellEl(pIdx, cIdx, cell) {
  const el = document.createElement('div'); el.className = 'board-cell';
  const isBoard = cell.letter !== null;
  el.classList.add(isBoard ? 'cell-board' : 'cell-open');
  if (cell.multiplier) el.classList.add(`has-${cell.multiplier.toLowerCase()}`);
  const ls = document.createElement('span'); ls.className = 'cell-letter'; ls.textContent = isBoard ? cell.letter : '?';
  const ps = document.createElement('span'); ps.className = 'cell-pts'; if (isBoard) ps.textContent = TILE_VALUES[cell.letter] ?? '';
  el.appendChild(ls); el.appendChild(ps);
  if (cell.multiplier) { const b = document.createElement('span'); b.className=`cell-mult mult-${cell.multiplier.toLowerCase()}-badge`; b.textContent=cell.multiplier; el.appendChild(b); }
  el.addEventListener('click', e => { e.stopPropagation(); openLetterPicker(pIdx, cIdx); });
  return el;
}

addPatternBtn.addEventListener('click', addPattern);

// Filters
filtersToggle.addEventListener('click', () => {
  const open = filtersBody.style.display !== 'none';
  filtersBody.style.display = open ? 'none' : 'flex';
  filtersToggle.textContent = open ? 'Show ▾' : 'Hide ▴';
});
minScoreSlider.addEventListener('input', () => { minScoreDisplay.textContent = minScoreSlider.value; });
excludeInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addExclude(excludeInput.value.trim()); excludeInput.value = ''; }
});
excludeInput.addEventListener('blur', () => { if (excludeInput.value.trim()) { addExclude(excludeInput.value.trim()); excludeInput.value = ''; } });
function addExclude(raw) { const w = raw.toUpperCase().replace(/[^A-Z]/g,''); if (!w) return; excludedWords.add(w); renderExcludeChips(); }
function renderExcludeChips() {
  excludeChips.innerHTML = '';
  for (const word of excludedWords) {
    const chip = document.createElement('span'); chip.className = 'exclude-chip';
    chip.innerHTML = `${word}<button data-word="${word}">✕</button>`;
    chip.querySelector('button').addEventListener('click', () => { excludedWords.delete(word); renderExcludeChips(); });
    excludeChips.appendChild(chip);
  }
}




// ═══════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════

function saveHistory(rack, count) {
  if (searchHistory.length && searchHistory[0].rack === rack) return;
  searchHistory.unshift({ rack, count, timestamp: Date.now() });
  if (searchHistory.length > MAX_HISTORY) searchHistory.pop();
}
function formatAge(ts) {
  const s = Math.floor((Date.now()-ts)/1000);
  return s<60?'just now':s<3600?`${Math.floor(s/60)}m ago`:`${Math.floor(s/3600)}h ago`;
}
function openHistory() {
  historyBody.innerHTML = '';
  if (!searchHistory.length) historyBody.innerHTML='<div class="history-empty">No searches yet this session</div>';
  else searchHistory.forEach(h => {
    const item = document.createElement('div'); item.className='history-item';
    item.innerHTML=`<span class="history-rack">${h.rack}</span><span class="history-meta">${h.count} results<br>${formatAge(h.timestamp)}</span>`;
    item.addEventListener('click', () => { rackInput.value=h.rack; updateTileDisplay(); updateTileProb(); updateSearchButton(); closeHistory(); searchBtn.click(); });
    historyBody.appendChild(item);
  });
  historyOverlay.style.display='block';
  requestAnimationFrame(()=>{ historyOverlay.classList.add('visible'); historyDrawer.classList.add('open'); });
}
function closeHistory() { historyOverlay.classList.remove('visible'); historyDrawer.classList.remove('open'); setTimeout(()=>{historyOverlay.style.display='none';},300); }
historyBtn.addEventListener('click', openHistory);
historyClose.addEventListener('click', closeHistory);
historyOverlay.addEventListener('click', closeHistory);

// ═══════════════════════════════════════════════
//  DEFINITION DRAWER
// ═══════════════════════════════════════════════

const defCache = {};
async function fetchDefinition(word) {
  const key = word.toLowerCase(); if (key in defCache) return defCache[key];
  try { const res=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${key}`); defCache[key]=res.ok?await res.json():null; } catch { defCache[key]=null; }
  return defCache[key];
}

function openDefinition(r) {
  defWordEl.textContent = r.word;

  let chipHtml = '';
  for (const t of r.perTile) {
    const cls = t.type==='board'?'chip-board':t.type==='blank'?'chip-blank':'chip-rack';
    const pts = t.type==='board'?'★':(t.baseVal??0);
    const mb  = (t.multiplier&&t.type!=='board')?`<span class="chip-mult-badge cbm-${t.multiplier.toLowerCase()}">${t.multiplier}</span>`:'';
    chipHtml += `<div class="def-tile-chip ${cls}">${mb}<span class="chip-letter">${t.letter}</span><span class="chip-pts">${pts}</span></div>`;
  }

  const bingoRow = r.isBingo ? `<div class="bingo-row">⭐ Bingo! All 7 tiles used — +${BINGO_BONUS} pts included</div>` : '';

  let crossSection = '';
  if (r.crossWords?.length) {
    crossSection = `<div class="cross-word-section">
      <div class="cross-word-section-label">Cross-words formed</div>
      <div class="cross-word-list">
        ${r.crossWords.map(cw=>`<div class="cw-row"><span class="cw-word">${cw.word}</span><span class="cw-pts">+${cw.score} pts</span></div>`).join('')}
      </div>
    </div>`;
  }

  let previewHtml = '';
  let applyBtn    = '';
  if (r.isBoardPlay) {
    previewHtml = `<div class="board-preview"><div class="board-preview-label">Board placement — ${r.direction === 'H' ? 'Horizontal' : 'Vertical'}, R${r.row+1} C${r.col+1}</div>${buildBoardPreview(r)}</div>`;
    applyBtn    = `<button class="apply-in-drawer-btn" id="apply-in-drawer">✓ Apply play to board</button>`;
  }

  defBody.innerHTML = `
    <div class="def-score-row">
      <div class="def-score-num">${r.score}</div>
      <div>
        <div class="def-score-label">pts${r.wordMult>1?` (${r.wordMult}× word bonus)`:''}</div>
        ${r.formula?`<div class="def-formula">${r.formula}</div>`:''}
      </div>
    </div>
    ${bingoRow}
    ${previewHtml}
    ${applyBtn}
    ${crossSection}
    <div class="def-chip-row">${chipHtml}</div>
    <div class="def-loading"><div class="spinner"></div><span>Looking up definition…</span></div>
  `;

  // Wire apply button
  const applyEl = defBody.querySelector('#apply-in-drawer');
  if (applyEl) applyEl.addEventListener('click', () => applyPlayToBoard(r));

  defOverlay.style.display='block';
  requestAnimationFrame(()=>{ defOverlay.classList.add('visible'); defDrawer.classList.add('open'); });

  fetchDefinition(r.word).then(data => {
    const loading = defBody.querySelector('.def-loading'); if (loading) loading.remove();
    if (!data?.length) { defBody.insertAdjacentHTML('beforeend','<div class="def-error">No definition found — still a valid WWF word!</div>'); return; }
    let html='';
    for (let i=0; i<Math.min(data[0].meanings.length,3); i++) {
      const m=data[0].meanings[i], d=m.definitions?.[0]; if (!d) continue;
      html+=`<div class="def-section"><span class="def-pos">${m.partOfSpeech}</span><div class="def-meaning">${d.definition}</div>${d.example?`<div class="def-example">"${d.example}"</div>`:''}</div>`;
    }
    defBody.insertAdjacentHTML('beforeend', html||'<div class="def-error">No definition text available.</div>');
  });
}

function closeDefinition() { defOverlay.classList.remove('visible'); defDrawer.classList.remove('open'); setTimeout(()=>{defOverlay.style.display='none';},300); }
defClose.addEventListener('click', closeDefinition);
defOverlay.addEventListener('click', closeDefinition);

// ═══════════════════════════════════════════════
//  BOARD CELL LONG-PRESS WORD POPUP
// ═══════════════════════════════════════════════

// Find the full word(s) that pass through a given cell on the board
function getWordsAtCell(r, c) {
  const words = [];
  // Horizontal word
  let startC = c;
  while (startC > 0 && boardGrid[r][startC - 1]?.letter) startC--;
  let endC = c;
  while (endC < boardSize - 1 && boardGrid[r][endC + 1]?.letter) endC++;
  if (endC > startC) {
    const word = Array.from({length: endC - startC + 1}, (_, i) => boardGrid[r][startC + i].letter).join('');
    words.push({ word, direction: 'H', row: r, col: startC });
  }
  // Vertical word
  let startR = r;
  while (startR > 0 && boardGrid[startR - 1]?.[c]?.letter) startR--;
  let endR = r;
  while (endR < boardSize - 1 && boardGrid[endR + 1]?.[c]?.letter) endR++;
  if (endR > startR) {
    const word = Array.from({length: endR - startR + 1}, (_, i) => boardGrid[startR + i][c].letter).join('');
    words.push({ word, direction: 'V', row: startR, col: c });
  }
  return words;
}

// The small popup element
let cellPopup = null;
function closeCellPopup() {
  if (cellPopup) { cellPopup.remove(); cellPopup = null; }
}

function openBoardCellWordPopup(r, c) {
  closeCellPopup();
  const words = getWordsAtCell(r, c);
  const letter = boardGrid[r][c].letter;

  const popup = document.createElement('div');
  popup.className = 'cell-word-popup';

  // Single letter info
  let html = `<div class="cwp-cell-label">${letter} <span class="cwp-pts">${TILE_VALUES[letter] ?? 0} pts</span></div>`;

  if (words.length === 0) {
    html += `<div class="cwp-no-words">No adjacent word</div>`;
  } else {
    html += `<div class="cwp-words-list">`;
    words.forEach((w, idx) => {
      html += `<button class="cwp-word-btn" data-widx="${idx}">${w.word} <span class="cwp-dir">${w.direction === 'H' ? '→' : '↓'}</span></button>`;
    });
    html += `</div>`;
  }

  html += `<div class="cwp-actions">
    <button class="cwp-delete-btn" id="cwp-delete">🗑 Delete tile</button>
  </div>`;

  popup.innerHTML = html;

  // Position popup near the cell
  const cellEl = boardGridEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  const wrapRect = boardGridWrap.getBoundingClientRect();
  const cellRect = cellEl ? cellEl.getBoundingClientRect() : { top: wrapRect.top + 40, left: wrapRect.left + 40, width: 34, height: 34 };

  document.body.appendChild(popup);

  // Position after render
  requestAnimationFrame(() => {
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    let top = cellRect.bottom + 8;
    let left = cellRect.left + cellRect.width / 2 - pw / 2;
    if (top + ph > window.innerHeight - 10) top = cellRect.top - ph - 8;
    if (left < 8) left = 8;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    popup.style.top  = top  + 'px';
    popup.style.left = left + 'px';
    popup.classList.add('visible');
  });

  cellPopup = popup;

  // Word buttons → show definition
  popup.querySelectorAll('.cwp-word-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const w = words[+btn.dataset.widx];
      closeCellPopup();
      // Build a minimal result object for openDefinition
      const perTile = [...w.word].map(ch => ({ letter: ch, type: 'board', baseVal: 0, multiplier: '' }));
      const score = [...w.word].reduce((s, ch) => s + (TILE_VALUES[ch] ?? 0), 0);
      openDefinition({ word: w.word, score, length: w.word.length, perTile, formula: '', isBingo: false, isBoardPlay: false, blanks: 0, leaveBadge: '', cells: perTile });
    });
  });

  // Delete button
  popup.querySelector('#cwp-delete').addEventListener('click', () => {
    snapBoardHistory();
    boardGrid[r][c].letter = null;
    boardGrid[r][c].locked = false;
    closeCellPopup();
    renderBoardGrid();
    clearResults();
  });

  // Dismiss on outside tap
  setTimeout(() => {
    document.addEventListener('pointerdown', function onOut(e) {
      if (!popup.contains(e.target)) { closeCellPopup(); document.removeEventListener('pointerdown', onOut); }
    }, { capture: true });
  }, 50);
}

// ═══════════════════════════════════════════════
//  HELP SCREEN
// ═══════════════════════════════════════════════

const helpBtn     = document.getElementById('help-btn');
const helpOverlay = document.getElementById('help-overlay');
const helpClose   = document.getElementById('help-close');

function openHelp() {
  helpOverlay.style.display = 'flex';
  requestAnimationFrame(() => helpOverlay.classList.add('visible'));
}
function closeHelp() {
  helpOverlay.classList.remove('visible');
  setTimeout(() => { helpOverlay.style.display = 'none'; }, 300);
}

helpBtn.addEventListener('click', openHelp);
helpClose.addEventListener('click', closeHelp);
helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) closeHelp(); });

// ═══════════════════════════════════════════════
//  PHASE 10 — GAME LOG + BAG COUNTER + LEAVE
// ═══════════════════════════════════════════════

// Leave quality scores per tile (simplified equity table)
const LEAVE_VALUE = {
  A:0.5, B:-0.3, C:-0.2, D:-0.1, E:0.7, F:-0.4, G:-0.3, H:0.1,
  I:0.3, J:-0.8, K:-0.1, L:0.4, M:-0.1, N:0.6, O:0.1, P:-0.3,
  Q:-2.8, R:0.7, S:1.5, T:0.5, U:-0.3, V:-0.6, W:-0.3, X:0.4,
  Y:0.0, Z:-0.2, '?':3.5
};

function computeBagState() {
  const bag = { ...TILE_DIST };
  for (const turn of gameTurns) {
    for (const ch of turn.tilesPlaced) {
      if (bag[ch] !== undefined) bag[ch] = Math.max(0, bag[ch] - 1);
    }
  }
  return bag;
}

function computeLeave(rack, word, cells) {
  // Figure out which tiles get placed from rack
  const rackArr = [...rack];
  const placed = [];
  for (let i = 0; i < word.length; i++) {
    if (cells[i].letter !== null) continue; // board tile, not from rack
    const ch = word[i];
    const ri = rackArr.indexOf(ch);
    if (ri !== -1) { placed.push(ch); rackArr.splice(ri, 1); }
    else {
      const bi = rackArr.indexOf('?');
      if (bi !== -1) { placed.push('?'); rackArr.splice(bi, 1); }
    }
  }
  // rackArr now = remaining tiles (the leave)
  const lv = rackArr.reduce((s, ch) => s + (LEAVE_VALUE[ch] ?? 0), 0);
  let tier, badge;
  if (lv >= 2.0)       { tier = 'great'; badge = '🟢'; }
  else if (lv >= 0.5)  { tier = 'ok';    badge = '🟡'; }
  else                 { tier = 'poor';  badge = '🔴'; }
  return { leaveTiles: rackArr, leaveScore: lv, tier, badge };
}

function addLeaveToResults() {
  const rackRaw = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  if (!rackRaw) return;
  // Annotate all results with leave quality
  function annotate(r) {
    const lv = computeLeave(rackRaw, r.word, r.cells || r.word.split('').map(()=>({letter:null,multiplier:''})));
    r.leaveBadge = lv.badge;
    r.leaveTier  = lv.tier;
  }
  if (activeMode === 'board') {
    if (Array.isArray(currentResults)) currentResults.forEach(annotate);
  } else if (currentResults.filteredFree) {
    currentResults.filteredFree.forEach(annotate);
    for (const [, arr] of currentResults.patternResultsMap) arr.forEach(annotate);
  }
}

// ── Game Log UI ───────────────────────────────
glToggle.addEventListener('click', () => {
  const open = glBody.style.display !== 'none';
  glBody.style.display = open ? 'none' : '';
  glToggle.textContent = open ? 'Show ▾' : 'Hide ▴';
  if (!open) renderGameLog();
});

glMyBtn.addEventListener('click', () => {
  glFormPlayer = 'me';
  glFormWho.textContent = 'My Play';
  glForm.style.display = '';
  glWordInput.value = '';
  glTilesInput.value = '';
  glScoreInput.value = '';
  glWordInput.focus();
  if (glBody.style.display === 'none') {
    glBody.style.display = '';
    glToggle.textContent = 'Hide ▴';
    renderGameLog();
  }
});
glOppBtn.addEventListener('click', () => {
  glFormPlayer = 'opp';
  glFormWho.textContent = 'Opp Play';
  glForm.style.display = '';
  glWordInput.value = '';
  glTilesInput.value = '';
  glScoreInput.value = '';
  glWordInput.focus();
  if (glBody.style.display === 'none') {
    glBody.style.display = '';
    glToggle.textContent = 'Hide ▴';
    renderGameLog();
  }
});
glCancel.addEventListener('click', () => { glForm.style.display = 'none'; });
glSubmit.addEventListener('click', () => {
  const word   = glWordInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  const tiles  = glTilesInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  const score  = parseInt(glScoreInput.value, 10) || 0;
  if (!word && !tiles) return;
  gameTurns.push({ player: glFormPlayer, word, tilesPlaced: [...tiles], score, timestamp: Date.now() });
  glForm.style.display = 'none';
  renderGameLog();
});
// Allow Enter to submit
[glWordInput, glTilesInput, glScoreInput].forEach(inp => {
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') glSubmit.click(); });
});

function renderGameLog() {
  const bag = computeBagState();

  // ── Bag counter ──────────────────────────────
  const totalInBag = Object.values(bag).reduce((s,v) => s+v, 0);
  let bagHtml = `<div class="bag-label">Bag · ${totalInBag} tiles left</div><div class="bag-grid">`;
  for (const ch of [...ALPHABET, '?']) {
    const left = bag[ch] ?? 0, total = TILE_DIST[ch] ?? 0;
    const pct = total > 0 ? left / total : 0;
    const cls = left === 0 ? 'depleted' : pct <= 0.25 ? 'rare' : pct <= 0.5 ? 'scarce' : 'common';
    bagHtml += `<div class="bag-tile ${cls}"><span class="bt-letter">${ch === '?' ? '★' : ch}</span><span class="bt-count">${left}</span></div>`;
  }
  bagHtml += '</div>';
  bagCounter.innerHTML = bagHtml;

  // ── Danger tiles ─────────────────────────────
  const myRack = rackInput.value.toUpperCase().replace(/[^A-Z?]/g, '');
  const DANGER = ['Q','Z','J','X','?'];
  const totalPlaced = gameTurns.reduce((s,t) => s + t.tilesPlaced.length, 0);
  const tilesInHands = (7 * 2) - totalPlaced; // rough: 2 players × 7 tiles initial
  const bagTotal = Object.values(bag).reduce((s,v) => s+v, 0);
  const dangerItems = [];
  for (const ch of DANGER) {
    const inBag    = bag[ch] ?? 0;
    const onMyRack = [...myRack].filter(c => c === ch).length;
    const unaccounted = (TILE_DIST[ch] ?? 0) - [...gameTurns].reduce((s,t)=>s+t.tilesPlaced.filter(c=>c===ch).length,0) - onMyRack;
    if (unaccounted <= 0) continue;
    const label = ch === '?' ? 'Blank' : ch;
    // Simple estimate: if unaccounted > 0 and bag still has tiles, some fraction is in opponent's hand
    const oppProb = bagTotal > 0 ? Math.round((unaccounted / (inBag + Math.max(0, tilesInHands - myRack.length))) * 100) : 100;
    const pctClamped = Math.min(99, Math.max(1, oppProb));
    dangerItems.push(`<div class="danger-item"><span class="danger-tile">${label}</span><span class="danger-prob">${pctClamped}% chance opp has it</span></div>`);
  }
  if (dangerItems.length) {
    dangerSection.innerHTML = `<div class="danger-label">⚠ Danger tiles unaccounted for</div>${dangerItems.join('')}`;
    dangerSection.style.display = '';
  } else {
    dangerSection.style.display = 'none';
  }

  // ── Turn list ─────────────────────────────────
  if (!gameTurns.length) {
    glTurns.innerHTML = '<div class="gl-empty">No turns logged yet. Use the buttons above to track plays.</div>';
    return;
  }
  glTurns.innerHTML = '';
  [...gameTurns].reverse().forEach((turn, revIdx) => {
    const realIdx = gameTurns.length - 1 - revIdx;
    const row = document.createElement('div');
    row.className = 'gl-turn ' + (turn.player === 'me' ? 'gl-me' : 'gl-opp');
    row.innerHTML = `
      <div class="gl-turn-left">
        <span class="gl-player">${turn.player === 'me' ? 'Me' : 'Opp'}</span>
        <span class="gl-turn-word">${turn.word || '—'}</span>
        <span class="gl-turn-tiles">[${turn.tilesPlaced.join('')}]</span>
      </div>
      <div class="gl-turn-right">
        <span class="gl-turn-score">${turn.score > 0 ? '+'+turn.score : ''}</span>
        <button class="gl-delete-btn" data-idx="${realIdx}">✕</button>
      </div>
    `;
    glTurns.appendChild(row);
  });
  glTurns.querySelectorAll('.gl-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      gameTurns.splice(+btn.dataset.idx, 1);
      renderGameLog();
    });
  });
}

// ── Wire leave badges into search ────────────────
// After any search completes, annotate with leave and re-render
const _origFindWords = findWords;
// (We call addLeaveToResults inside the search dispatchers instead)

// ── Boot ──────────────────────────────────────
addPattern();
loadSlotsFromStorage();
initBoard();
renderBoardGrid();
loadDictionary();
