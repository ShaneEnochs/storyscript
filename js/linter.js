// linter.js — static analysis for ChoiceScript
// Returns: { issues, errorLines, warnLines, orphanLines }
//
// Checks:
//   1. *goto / *gosub pointing to a label not declared in this file
//   2. *set on a variable not declared with *create or *temp
//   3. Unclosed *if (unmatched *if / *endif depth)
//   4. #option inside *choice with no navigation (*goto/*finish/etc.) in its body
//   5. Scene has no *finish or *ending at all

const Linter = (() => {

  function run(lines) {
    const issues      = [];
    const errorLines  = new Set();
    const warnLines   = new Set();
    const orphanLines = new Set();

    // ── Collect declared labels ──────────────────────────────────────
    const declaredLabels = new Set();
    lines.forEach(l => {
      const m = l.trimStart().match(/^\*label\s+(\S+)/);
      if (m) declaredLabels.add(m[1].toLowerCase());
    });

    // ── Collect declared variables (*create / *temp) ─────────────────
    const declaredVars = new Set();
    lines.forEach(l => {
      const m = l.trimStart().match(/^\*(create|temp)\s+(\w+)/);
      if (m) declaredVars.add(m[2].toLowerCase());
    });

    // ── Check 1: *goto / *gosub to unknown label ─────────────────────
    lines.forEach((line, i) => {
      const m = line.trimStart().match(/^\*(goto|gosub)\s+(\S+)/);
      if (m && !declaredLabels.has(m[2].toLowerCase())) {
        issues.push({ line: i, type: 'error', msg: `*${m[1]} "${m[2]}" — label not found` });
        errorLines.add(i);
      }
    });

    // ── Check 2: *set on undeclared variable ─────────────────────────
    lines.forEach((line, i) => {
      const m = line.trimStart().match(/^\*set\s+(\w+)/);
      if (m && !declaredVars.has(m[1].toLowerCase())) {
        issues.push({ line: i, type: 'error', msg: `*set "${m[1]}" — variable not declared` });
        errorLines.add(i);
      }
    });

    // ── Check 3: unclosed *if ────────────────────────────────────────
    let ifDepth = 0, ifOpenLine = -1;
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (/^\*if\b/.test(t)) {
        if (ifDepth === 0) ifOpenLine = i;
        ifDepth++;
      }
      if (/^\*endif\b/.test(t)) {
        ifDepth = Math.max(0, ifDepth - 1);
      }
    });
    if (ifDepth > 0 && ifOpenLine >= 0) {
      issues.push({ line: ifOpenLine, type: 'warn', msg: `*if opened here — no matching *endif` });
      warnLines.add(ifOpenLine);
    }

    // ── Check 4: orphaned #options ───────────────────────────────────
    // Walk the file looking for *choice / *fake_choice blocks.
    // For each #option found inside, scan its indented body for any
    // navigation command. Flag options whose bodies have none.

    const getIndent = l => l.match(/^(\s*)/)[1].length;

    // Navigation commands that satisfy an option
    const NAV_RE = /^\*(goto|gosub|finish|ending|return|goto_scene|gosub_scene)\b/;

    let idx = 0;
    while (idx < lines.length) {
      const t = lines[idx].trimStart();
      if (/^\*(choice|fake_choice)\b/.test(t)) {
        const choiceIndent = getIndent(lines[idx]);
        idx++;

        while (idx < lines.length) {
          const li         = lines[idx];
          const lt         = li.trimStart();
          const lineIndent = getIndent(li);

          // Back at or above choice level on a non-blank, non-option line → end of block
          if (lt.length > 0 && lineIndent <= choiceIndent && !/^#/.test(lt)) break;

          if (/^#/.test(lt) && lineIndent > choiceIndent) {
            const optionLine   = idx;
            const optionIndent = lineIndent;
            idx++;

            let hasNav = false;
            while (idx < lines.length) {
              const bl = lines[idx];
              const bt = bl.trimStart();
              // Body ends when we return to option indent level or shallower
              if (bt.length > 0 && getIndent(bl) <= optionIndent) break;
              if (NAV_RE.test(bt)) hasNav = true;
              idx++;
            }

            if (!hasNav) {
              orphanLines.add(optionLine);
              issues.push({ line: optionLine, type: 'info', msg: `Option leads nowhere — add *goto or *finish` });
            }
            continue; // idx already advanced by inner loop
          }
          idx++;
        }
        continue;
      }
      idx++;
    }

    // ── Check 5: no *finish / *ending in scene ───────────────────────
    const hasFinish = lines.some(l => /^\s*\*(finish|ending)\b/.test(l));
    if (!hasFinish && lines.some(l => l.trim().length > 0)) {
      issues.push({ line: -1, type: 'warn', msg: `No *finish or *ending found in scene` });
    }

    issues.sort((a, b) => a.line - b.line);
    return { issues, errorLines, warnLines, orphanLines };
  }

  return { run };
})();
