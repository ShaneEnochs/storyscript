# StoryScript IDE

## GitHub Pages deployment (current setup)
The `dist/` folder is built for `shaneenochs.github.io/storyscript/`.
Push the contents of `dist/` to the `gh-pages` branch (or `docs/` folder).

## Deploying to a different path
If you host at a root domain or a different subdirectory, change `base` in
`vite.config.js`, then rebuild:
```js
base: '/storyscript/',   // ← change this
```
```bash
npm install && npm run build
```

## Local development
```bash
npm install
npm run dev        # http://localhost:5173  (hot reload)
npm run build      # production build → dist/
npm run preview    # preview built output at http://localhost:4173
```

## Updating the engine
```bash
# After rebuilding storyscript-bundle-p3.js in the TS repo:
cp storyscript-bundle-p3.js public/storyscript-engine.js
npm run build
```
