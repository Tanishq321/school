import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = process.env.VITE_DEV_BACKEND || 'http://127.0.0.1:4000';

export default defineConfig(({ mode }) => {
  // The Android/iOS build must know where the server is; fail early instead of shipping a dead app.
  if (mode === 'app' && !loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL) {
    throw new Error('App build: copy env.app.example to .env.app and set VITE_API_URL / VITE_SOCKET_URL.');
  }
  return {
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/socket.io': { target: backend, ws: true, changeOrigin: false },
    },
  },
  build: { sourcemap: mode !== 'app', target: 'es2022' },
  };
});
