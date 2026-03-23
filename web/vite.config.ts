import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import cesium from 'vite-plugin-cesium'

export default defineConfig({
  plugins: [react(), tailwindcss(), cesium()],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:8889',
        ws: true,
      },
    },
  },
})
