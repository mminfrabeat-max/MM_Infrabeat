import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,

    // The proxy is the reason the frontend code can simply call fetch('/api/health').
    // The browser thinks it is talking to the Vite dev server on port 5173; Vite quietly
    // forwards anything starting with /api to the backend on port 3001.
    // This avoids CORS - the browser rule that blocks a page on one port from calling
    // a different port - and it means the frontend never hardcodes a backend address.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
