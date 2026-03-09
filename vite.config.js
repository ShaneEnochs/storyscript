import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',   // storyscript-engine.js lives here; Vite copies to dist/

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: true,

    rollupOptions: {
      input: 'index.html',

      output: {
        // Put everything in one chunk — the IDE needs CM6 on first paint anyway.
        // Two modules (main + ide-core) will be preserved as separate chunks by
        // Rollup's natural module splitting; that's fine.
        manualChunks: undefined,
      },
    },

    // CM6 (≈ 250 KB min) + IDE JS (≈ 80 KB min) will exceed the default 500 KB
    // warning. Raising to 700 KB to avoid noise; the gzipped size is ~115 KB.
    chunkSizeWarningLimit: 700,
  },

  server: {
    port: 5173,
    open: true,
  },

  // Ensure @codemirror packages share the same module instance.
  // Vite does this automatically for npm packages; this is a belt-and-suspenders
  // guard against any future workspace / monorepo setup.
  optimizeDeps: {
    include: [
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lint',
      '@codemirror/autocomplete',
      '@lezer/highlight',
    ],
  },
});
