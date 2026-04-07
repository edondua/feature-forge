import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

// Standalone config — no Module Federation, plain React
// Used for local preview AND production Railway deployment
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    minify: true,
  },
  server: {
    port: 5175,
    cors: true,
  },
});
