import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('xlsx')) return 'xlsx';
          if (id.includes('jspdf')) return 'jspdf';
          if (id.includes('socket.io')) return 'socket';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('react-router')) return 'router';
          if (id.includes('react-dom') || id.includes('/react/') || id.endsWith('\\react\\index.js')) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
