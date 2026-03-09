# StoryScript IDE

A self-contained interactive fiction authoring tool with a full compiler pipeline
and CodeMirror 6-powered editor.

## Quick Start (no build needed)

The `dist/` folder contains a pre-built, ready-to-deploy version.
Serve it from any static web server:

```bash
# Using Python (built-in)
cd dist && python3 -m http.server 8080
# Then open http://localhost:8080

# Using Node.js npx serve
cd dist && npx serve .

# Using VS Code Live Server extension
# Right-click dist/index.html → Open with Live Server
```

> **Note:** You must serve over HTTP, not by opening `dist/index.html` directly
> in a browser. This is because `main.js` fetches `storyscript-engine.js` at
> runtime, which requires HTTP (not `file://`).

## Development

```bash
npm install        # install dependencies (first time only)
npm run dev        # start dev server at http://localhost:5173
npm run build      # production build → dist/
npm run preview    # preview production build at http://localhost:4173
```

## Project Structure

```
storyscript-ide/
├── index.html                    ← HTML shell
├── package.json                  ← npm deps: vite + @codemirror/*
├── vite.config.js                ← build config
├── src/
│   ├── main.js                   ← Entry: imports CM6 from npm, fetches engine
│   ├── ide-core.js               ← IDE application logic (2300 lines)
│   └── ide.css                   ← IDE styles
├── public/
│   └── storyscript-engine.js     ← StoryScript engine IIFE (Phase 6)
└── dist/                         ← Pre-built production output
    ├── index.html
    ├── storyscript-engine.js
    └── assets/
        ├── index.[hash].js       ← CM6 + IDE, minified (~135 KB gzipped)
        └── index.[hash].css      ← IDE styles, minified
```

## Updating the Engine

If the StoryScript engine source (`src/*.ts` in the repo) changes:

```bash
# In the storyscript TypeScript repo:
npm run build:ts && npm run bundle

# Then copy the new bundle here:
cp path/to/storyscript-bundle-p3.js public/storyscript-engine.js
npm run build
```
