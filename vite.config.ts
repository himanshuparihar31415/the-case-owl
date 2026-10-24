import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        // Port 5000 is taken by macOS AirPlay Receiver; backend runs on 5050.
        // ws:true so the voice WebSocket (/api/voice) is proxied too.
        // Set API_PROXY_TARGET in .env.local to use a hosted backend instead.
        // Resume interviews (REST + their voice socket) always run on the local backend,
        // so they can be developed while every other API stays on API_PROXY_TARGET.
        // Must stay ABOVE '/api' (first match wins). Override with RESUME_API_PROXY_TARGET.
        '/api/resume-interviews': {
          target: env.RESUME_API_PROXY_TARGET || 'http://localhost:8000',
          ws: true,
          changeOrigin: true,
        },
        '/api': {
          target: env.API_PROXY_TARGET || 'http://localhost:5050',
          ws: true,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
