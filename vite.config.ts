import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Vite'ın Rust derleme dosyalarını izlemesini engeller (EBUSY hatasını çözer)
      ignored: ['**/src-tauri/**'],
    },
  },
});