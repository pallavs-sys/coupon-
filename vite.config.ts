import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // Point Vite dev proxy to your Apps Script exec URL so browser can read responses (no CORS in dev)
    const scriptExecPath = '/macros/s/AKfycby5m3KdHSbpxS2fMYxk6olQpH8MD4324tWlUozy7F4OQll3l0Dpzli405uRKoY-lOjd/exec';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          '/apps-script': {
            target: 'https://script.google.com',
            changeOrigin: true,
            secure: true,
            rewrite: () => scriptExecPath,
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
