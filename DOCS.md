# CS·IDE Documentation

A personal ChoiceScript editor that runs in your browser — no install, no server, no account. Open `index.html` and write.

---

## Table of Contents

- [Getting Started](#getting-started)
- [Interface Overview](#interface-overview)
- [Tabs](#tabs)
- [The Editor](#the-editor)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Snippets](#snippets)
- [Find & Replace](#find--replace)
- [The Sidebar](#the-sidebar)
- [Linter](#linter)
- [Syntax Highlighting](#syntax-highlighting)
- [File Management](#file-management)
- [Settings](#settings)
- [ChoiceScript Command Reference](#choicescript-command-reference)

---

## Getting Started

1. Download the project and open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).
2. No internet connection is required after the fonts load.
3. Your work is automatically saved to your browser's localStorage every second after you stop typing. Nothing is ever sent anywhere.
4. To move your work between machines, use **Export** to download a `.txt` file, then **Import** on the other machine.

---

## Interface Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ TOOLBAR  [filename] [Export] [Export All] [Import] [Import→Tab] │
├──────────────────────────────────────────────────────────────────┤
│ TABS  [ startup × ] [ chapter1 × ] [ + ]                        │
├──────────────────────────────────────────────────────────────────┤
│ SNIPPETS  *choice  *fake_choice  *if/*else  …                   │
├──────────────────────────────────────────────────────────────────┤
│ FIND & REPLACE  (hidden until Ctrl+F)                           │
├──────────────────┬──────────────────────────────────────────────┤
│ SIDEBAR          │  GUTTER │ EDITOR                             │
│  Issues   [N]    │  1      │                                    │
│  Labels   [N]    │  2      │ *comment write here                │
│  Variables [N]   │  3      │                                    │
└──────────────────┴─────────┴────────────────────────────────────┘
```

---

## Tabs

Each tab holds one scene file. Tabs are fully independent — separate content, scroll position, cursor position, undo history, and linter state.

### Creating tabs

- Click **+** in the tab strip to open a new blank tab.
- Click **Import → New Tab** in the toolbar to import a `.txt` file directly into a new tab without touching your current work.

### Switching tabs

Click any tab to switch to it. The outgoing tab's content, scroll position, and cursor are saved automatically.

### Renaming tabs

Double-click the tab name to edit it inline. Press **Enter** to confirm or **Escape** to cancel. The filename input in the toolbar and the tab name stay in sync — editing either one updates both.

### Closing tabs

Click the **×** button on any tab. The last remaining tab cannot be closed. If you close the active tab, the adjacent tab becomes active.

### Persistence

All tabs are saved to localStorage whenever content changes. On next open, every tab is restored exactly as you left it, including which tab was active.

### Limits

Up to 10 tabs can be open at once.

---

## The Editor

The editor is a plain-text `contenteditable` div. It behaves like a simple code editor — no rich formatting, just characters.

### Auto-indent

Pressing **Enter** automatically continues indentation from the current line. After a `#option` line or a `*choice`/`*fake_choice` command, indent increases by 4 spaces. After any other line, the current indent level is preserved.

### Tab key

Pressing **Tab** inserts 4 spaces at the cursor position. The browser's default focus-shift behaviour is suppressed.

### Paste

Pasting strips all formatting — only plain text is inserted, regardless of source. HTML, RTF, styled text from Word, etc. all become plain characters.

### Undo / Redo

See [Keyboard Shortcuts](#keyboard-shortcuts). The editor maintains its own undo history because re-rendering syntax highlighting destroys the browser's native undo stack. Each tab has its own independent history of up to 200 snapshots, captured 400ms after you stop typing. Paste and snippet insertion each create an immediate snapshot before the change, so you can always undo them in one step.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+Y` | Redo (Windows alternative) |
| `Ctrl+F` / `Cmd+F` | Open Find & Replace (overrides browser find) |
| `Escape` | Close Find & Replace |
| `Tab` | Insert 4 spaces |
| `Enter` | New line with smart auto-indent |

---

## Snippets

The snippet bar inserts boilerplate at the cursor. Each snippet creates an immediate undo checkpoint so you can remove it cleanly with one Ctrl+Z.

### `*choice`

```choicescript
*choice
    #Option 1
        Text for option 1.
        *goto label_name
    #Option 2
        Text for option 2.
        *goto label_name
```

A standard branching choice. Each option must lead somewhere (`*goto`, `*finish`, etc.) — the linter will flag options that don't.

### `*fake_choice`

```choicescript
*fake_choice
    #Option 1
        Text for option 1.
    #Option 2
        Text for option 2.
```

A cosmetic choice — all options converge and execution continues below the block. No navigation required inside options.

### `*if / *else`

```choicescript
*if (variable)
    Text if true.
*else
    Text if false.
*endif
```

Conditional block. Replace `(variable)` with any boolean expression.

### `*stat_chart`

```choicescript
*stat_chart
    text Stat Name stat_variable
```

Displays a stat on the stats screen. Add one `text` row per stat.

### `*selectable_if`

```choicescript
*choice
    *selectable_if (condition) #Option
        Text.
        *goto label_name
```

An option that is visible but greyed-out unless the condition is true. Must be inside a `*choice` block.

### `*temp`

```choicescript
*temp variable_name value
```

Declares a temporary variable scoped to the current scene.

### `*gosub_scene`

```choicescript
*gosub_scene scene_name label_name
```

Calls a subroutine in another scene file and returns here when it hits `*return`.

---

## Find & Replace

Open with **Ctrl+F** / **Cmd+F**. Close with **Escape** or the × button.

### Searching

Type in the **Find** box to search. Results appear highlighted in the editor — all matches in amber, the current match in brighter gold. The status indicator shows `current / total`.

Navigate between matches with the **↑** / **↓** buttons or by pressing **Enter** (next) / **Shift+Enter** (previous) while the search box is focused.

### Options

| Toggle | Meaning |
|---|---|
| **Aa** | Case sensitive — `Hero` won't match `hero` |
| `.*` | Regex mode — the search query is treated as a regular expression |

### Replacing

Type in the **Replace** box, then:

- **Replace** — replaces the current highlighted match and moves to the next.
- **Replace All** — replaces every match in the file at once.

Both replace operations create an undo checkpoint so they can be reversed with Ctrl+Z.

---

## The Sidebar

The sidebar has three panels that update live as you type.

### Issues

Lists every problem the linter found, coloured by severity:

- **Red** — errors that will likely break the game (unknown `*goto` target, undeclared variable)
- **Yellow** — warnings that probably indicate a problem (unclosed `*if`, no `*finish` in scene)
- **Blue** — informational notices (option with no navigation)

Click any issue to jump to the relevant line. The panel header itself turns red or yellow if any problems exist, so you can see at a glance whether the scene is clean.

### Labels

Lists every `*label` defined in the current scene. Click a label to scroll to it. Useful for navigating long scenes.

### Variables

Lists every `*create` and `*temp` declaration in the current scene, with its initial value shown alongside. Click any variable to jump to its declaration — this is the "jump to definition" feature.

---

## Linter

The linter runs on every keystroke and checks for five categories of problem.

### Error: unknown `*goto` / `*gosub` target

```choicescript
*goto chapter_two   ← error if *label chapter_two doesn't exist in this file
```

The linter scans the entire file for `*label` declarations and flags any `*goto` or `*gosub` that names a label not found. Matching is case-insensitive. Forward references (using a label before it's defined) are fine.

### Error: `*set` on undeclared variable

```choicescript
*set courage 50   ← error if courage wasn't declared with *create or *temp
```

The linter collects all variable names from `*create` and `*temp` lines and flags any `*set` targeting a name not in that list. Matching is case-insensitive.

### Warning: unclosed `*if`

```choicescript
*if courage > 50
    You feel brave.
← warning: no *endif found
```

The linter tracks `*if`/`*endif` depth. If the depth is non-zero at the end of the file, it flags the line where the unmatched `*if` opened.

### Info: option with no navigation

```choicescript
*choice
    #Go north.
        You walk north.   ← blue: this option never goes anywhere
    #Go south.
        *goto south_room
```

Each `#option` body inside a `*choice` or `*fake_choice` block is scanned for any of: `*goto`, `*gosub`, `*finish`, `*ending`, `*return`, `*goto_scene`, `*gosub_scene`. If none are found, the option is flagged. `*fake_choice` options are also checked.

### Warning: no `*finish` or `*ending`

A scene with content but no `*finish` or `*ending` anywhere gets a scene-level warning. This appears as "Scene" rather than a line number in the Issues panel.

### Cross-scene validation

If you have multiple tabs open representing different scene files, `*goto_scene` and `*gosub_scene` commands are validated against the filenames of your open tabs. If you reference a scene file that isn't open as a tab, you get a warning. Open more tabs to extend what the linter can see.

---

## Syntax Highlighting

Lines are coloured based on their first non-whitespace character.

| Colour | What it highlights |
|---|---|
| Pink | Commands: `*choice`, `*goto`, `*set`, `*if`, etc. |
| Blue | Options: `#option text` |
| Gold | Labels: `*label name` |
| Purple | Variable interpolation: `${variable_name}` |
| Grey italic | Comments: `*comment anything` |

Lint underlines appear on top of syntax highlighting:

| Style | Meaning |
|---|---|
| Red dashed underline + red tint | Error |
| Yellow dashed underline + yellow tint | Warning |
| Blue dashed underline + blue tint | Info (orphaned option) |

When Find & Replace is open, search matches add amber highlight marks on top of everything else, with the current match shown brighter.

---

## File Management

### Export

Downloads the current tab's content as `filename.txt`. The filename comes from the toolbar input.

### Export All

Downloads every open tab as a separate `.txt` file, one file per tab, in a single click.

### Import

Replaces the current tab's content with a `.txt` file from your disk. The tab's filename is updated to match the imported file.

### Import → New Tab

Opens a `.txt` file into a brand new tab, leaving your current tab untouched.

### Autosave

Content is saved to localStorage 1 second after you stop typing. The save status indicator in the toolbar shows `Unsaved…` while a save is pending and `Saved HH:MM` once it completes. Nothing is saved to disk automatically — use Export for that.

---

## Settings

### Font size

The `−` / `+` buttons in the toolbar change the editor font size between 10px and 24px. Your preference is saved to localStorage and restored on next open.

### Filename

The filename input in the toolbar sets both the tab name and the filename used when exporting. They stay in sync.

---

## ChoiceScript Command Reference

A reference for the commands the IDE recognises and highlights. This covers the commands most relevant to writing scenes. For the complete ChoiceScript language specification, see the official CSIDE or Choice of Games documentation.

### Navigation

#### `*goto label`

Jumps unconditionally to `*label label` in the current scene. Execution does not return.

```choicescript
*goto end_of_scene

*label end_of_scene
You reach the end.
*finish
```

#### `*label name`

Defines a destination that `*goto` and `*gosub` can jump to. Names are case-insensitive. Must be unique within the scene.

#### `*gosub label`

Jumps to `*label label` in the current scene and returns here when `*return` is hit.

```choicescript
*gosub my_subroutine
Execution continues here after *return.

*label my_subroutine
This is the subroutine.
*return
```

#### `*return`

Returns from a `*gosub` or `*gosub_scene` call. Must be inside a subroutine.

#### `*goto_scene scene_name` / `*goto_scene scene_name label`

Jumps to the beginning of another scene file, or to a specific label within it. Execution does not return.

```choicescript
*goto_scene chapter2
*goto_scene chapter2 start_label
```

#### `*gosub_scene scene_name label`

Like `*goto_scene` but returns here when the other scene hits `*return`.

#### `*finish`

Ends the current scene and moves to the next scene in the startup's scene list.

#### `*ending`

Ends the game entirely. Use for bad endings or definitive conclusions.

---

### Choices

#### `*choice`

Presents a set of options to the player. Execution forks; each option must eventually reach a navigation command.

```choicescript
*choice
    #Do the brave thing.
        You step forward.
        *goto brave_result
    #Run away.
        You flee.
        *goto coward_result
```

Indentation is significant. Options must be indented one level (4 spaces) deeper than `*choice`. Option bodies must be indented one level deeper than the option.

#### `*fake_choice`

Identical syntax to `*choice` but all branches converge — execution continues below the block regardless of which option was chosen. Use for flavour choices that don't affect the story.

```choicescript
*fake_choice
    #Nod.
        You nod.
    #Smile.
        You smile.
You move on.
```

#### `*selectable_if (condition) #Option text`

Used inside a `*choice` block. The option is always visible but only selectable when the condition is true. When false, it appears greyed out.

```choicescript
*choice
    *selectable_if (sword) #Draw your sword.
        You draw it.
        *goto fight
    #Run.
        You run.
        *goto flee
```

---

### Variables

#### `*create variable_name value`

Declares a global variable in `startup.txt`. Must be at the top of the startup scene before any prose. Can hold numbers, strings (in quotes), or booleans (`true`/`false`).

```choicescript
*create player_name "Hero"
*create courage 50
*create has_sword false
```

#### `*temp variable_name value`

Declares a variable that only exists for the current scene. Scoped to the scene, reset each time the scene is entered.

```choicescript
*temp local_score 0
```

#### `*set variable_name value`

Assigns a new value to an existing variable. The variable must have been declared with `*create` or `*temp` — the linter enforces this.

```choicescript
*set courage 75
*set player_name "Aldric"
*set has_sword true
```

Supports arithmetic operators directly:

```choicescript
*set courage +10      ← adds 10
*set courage -5       ← subtracts 5
*set score score*2    ← doubles score
```

---

### Conditionals

#### `*if (condition)`

Conditionally executes the indented block that follows. The condition can use variables, comparisons (`>`, `<`, `>=`, `<=`, `=`, `!=`), and boolean operators (`and`, `or`, `not`).

```choicescript
*if courage > 50
    You feel confident.
```

#### `*elseif (condition)`

Additional condition checked only if all preceding `*if`/`*elseif` conditions were false.

```choicescript
*if courage > 75
    You feel fearless.
*elseif courage > 40
    You feel nervous but capable.
*else
    You feel terrified.
*endif
```

#### `*else`

Executes its block if all preceding conditions were false. Must be the last branch before `*endif`.

#### `*endif`

Closes a conditional block. Every `*if` must have a matching `*endif`. The linter flags unclosed `*if` blocks.

---

### Subroutines & Scenes

#### `*gosub label`

See [Navigation](#navigation) above.

#### `*gosub_scene scene_name label`

See [Navigation](#navigation) above.

#### `*return`

See [Navigation](#navigation) above.

---

### Output & Display

#### `*comment text`

A line the player never sees. Use for notes to yourself. The entire line is treated as a comment regardless of what follows.

```choicescript
*comment TODO: add more options here
```

#### `*line_break`

Inserts a line break in the rendered output without starting a new paragraph.

#### `*page_break`

Inserts a page break — the player must click to continue.

#### `*stat_chart`

Displays a formatted chart of stats on the stats screen. Add one row per stat.

```choicescript
*stat_chart
    text Courage courage
    text Cunning cunning
    percent Health health
```

Row types:
- `text` — shows the variable value as text
- `percent` — shows a percentage bar (variable should be 0–100)
- `opposed_pair` — shows two opposing stats on a single bar

---

### Variable Interpolation

Use `${variable_name}` anywhere in prose to insert a variable's value:

```choicescript
Hello, ${player_name}! Your courage is ${courage}.
```

The IDE highlights interpolations in purple so they're easy to spot.

---

### Indentation Rules

ChoiceScript is indentation-sensitive. The IDE uses **4 spaces** per indent level throughout.

| Context | Indent level |
|---|---|
| Top-level commands and prose | 0 |
| `#options` inside `*choice` | 1 (4 spaces) |
| Option body text and commands | 2 (8 spaces) |
| Nested `*choice` inside option body | 2 |
| Options of nested `*choice` | 3 (12 spaces) |
| Body of conditional (`*if`) | 1 more than the `*if` |

The **Tab** key inserts 4 spaces. **Enter** after a `#option` or `*choice`/`*fake_choice` automatically adds an extra level of indentation.
