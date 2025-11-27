import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Servimos todo bajo /static/frontend/
  base: '/static/frontend/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    manifest: true, // útil si luego integras por template/manifest de Django
    rollupOptions: {
      output: {
        // Divide dependencias grandes en chunks separados
        manualChunks: {
          vendor: ['react', 'react-dom'],
          motion: ['framer-motion'],
          toast: ['react-toastify'],
          charts: ['recharts'],
        },
        // ⚠️ IMPORTANTE: usar hash para evitar que el SW/Cache mezclen versiones
        entryFileNames: 'assets/app-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: (asset) => {
          if (asset.name && asset.name.endsWith('.css')) return 'assets/app-[hash].css'
          return 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
})
