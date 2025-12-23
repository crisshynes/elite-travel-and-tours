// vite.config.js
import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// Recursively collect all .html files under a given directory
function collectHtmlEntries(rootDir) {
  const entries = {};

  function walk(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile() && item.name.endsWith('.html')) {
        // Create a stable name based on relative path without ".html"
        const rel = path.relative(rootDir, full).replace(/\\/g, '/');
        const name = rel.replace(/\.html$/i, '').replace(/\s+/g, '-');
        entries[name] = full;
      }
    }
  }

  walk(rootDir);
  return entries;
}

// Collect all HTML files under ./views
const viewsDir = path.resolve(__dirname, 'views');
const viewEntries = fs.existsSync(viewsDir) ? collectHtmlEntries(viewsDir) : {};

export default defineConfig({
  root: '.',              // project root is trav/
  publicDir: 'public',    // serve static assets from /public
  server: {
    port: 5173,
    open: true
  },
  build: {
    rollupOptions: {
      input: {
        // Root SPA entry
        main: path.resolve(__dirname, 'index.html'),
        // All discovered views/*.html
        ...viewEntries,
      },
    },
  },
});
