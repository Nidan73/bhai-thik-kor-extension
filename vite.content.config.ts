import { defineConfig } from 'vite';
import { resolve } from 'path';

// The content script is built alone so Rollup inlines every import into one
// flat file. dist/content.js must stay a classic script — see
// scripts/check-content-script.mjs.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: { content: resolve(__dirname, 'src/content/index.ts') },
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'content.js',
      },
    },
    target: 'es2022',
    minify: false,
    sourcemap: process.env.NODE_ENV !== 'production' ? 'inline' : false,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  publicDir: false,
});
