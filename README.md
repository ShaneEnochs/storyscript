# StoryScript IDE

## GitHub Pages Setup (one-time)

1. Push this entire repo to GitHub (including the `docs/` folder)
2. Go to **Settings → Pages**
3. Set Source: **Deploy from branch → main → /docs**
4. Save — your IDE will be live at `https://shaneenochs.github.io/storyscript/`

The `docs/` folder contains the pre-built production output.
GitHub Pages serves it directly — no build step needed on the server.

## Rebuilding after changes

```bash
npm install          # first time only
npm run dev          # dev server at http://localhost:5173
npm run build        # rebuilds docs/ — then commit and push
```

## Deploying to a different path

Change `base` in `vite.config.js`, then rebuild:
```js
base: '/storyscript/',   // ← change to match your repo name / path
```

## Updating the engine

```bash
cp path/to/storyscript-bundle-p3.js public/storyscript-engine.js
npm run build        # rebuilds docs/
```
