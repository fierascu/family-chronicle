import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import familyData from './scripts/family-data-plugin';

export default defineConfig({
  // relative asset URLs, so dist/ works from any sub-folder of a web server
  base: './',
  plugins: [preact(), familyData()],
  build: {
    target: 'es2022',
    // the lazily loaded world maps are large on purpose; don't warn about them
    chunkSizeWarningLimit: 1500,
  },
});
