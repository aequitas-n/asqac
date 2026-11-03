import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/three|react-three/.test(id)) return 'orientation';
            if (/html5-qrcode/.test(id)) return 'scanner';
            if (/recharts|d3-/.test(id)) return 'charts';
          }
        },
      },
    },
  },
});
