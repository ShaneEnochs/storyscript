'use strict';

/**
 * Lexer
 * 
 * Reads source text line-by-line and produces a flat array of tokens.
 * Each token: { type, depth, payload, lineNum, file }
 *
 * Types:
 *   'command'       — line begins with * (after tabs)
 *   'choice_option' — line begins with # (after tabs)
 *   'text'          — any other non-blank content
 *   'blank'         — empty or whitespace-only line
 *
 * Indentation: tabs only. Any leading space character is a hard error.
 */

class LexerError extends Error {
  constructor(message, file, lineNum) {
    super(`[StoryScript Lexer] ${file}:${lineNum} — ${message}`);
    this.name = 'LexerError';
    this.file = file;
    this.lineNum = lineNum;
  }
}

/**
 * Tokenize a source string into an array of tokens.
 * @param {string} source  - raw file content
 * @param {string} file    - filename for error messages
 * @returns {Array}        - array of token objects
 */
function tokenize(source, file = '<unknown>') {
  const lines = source.split('\n');
  const tokens = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];

    // Strip trailing carriage return (Windows line endings)
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    // Blank line check (before indentation analysis)
    if (line.trim() === '') {
      tokens.push({ type: 'blank', depth: 0, payload: '', lineNum, file });
      continue;
    }

    // Count and validate leading whitespace
    let depth = 0;
    let pos = 0;

    while (pos < line.length) {
      const ch = line[pos];
      if (ch === '\t') {
        depth++;
        pos++;
      } else if (ch === ' ') {
        throw new LexerError(
          `Indentation error: leading space found. Only tabs are permitted for indentation.`,
          file,
          lineNum
        );
      } else {
        break;
      }
    }

    const content = line.slice(pos);

    // After tabs: check for mixed indentation (space after tabs)
    // (Already caught above, but guard against space-only content that slipped through)
    if (content.length === 0) {
      // Line was only tabs — treat as blank
      tokens.push({ type: 'blank', depth: 0, payload: '', lineNum, file });
      continue;
    }

    // Classify by first character
    const first = content[0];

    if (first === '*') {
      // Strip the leading * and any space after it
      const payload = content.slice(1).trimStart();
      tokens.push({ type: 'command', depth, payload, lineNum, file });

    } else if (first === '#') {
      // Strip the leading # and any space after it
      const payload = content.slice(1).trimStart();
      tokens.push({ type: 'choice_option', depth, payload, lineNum, file });

    } else {
      tokens.push({ type: 'text', depth, payload: content, lineNum, file });
    }
  }

  return tokens;
}

module.exports = { tokenize, LexerError };
