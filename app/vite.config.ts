import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../assets', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  optimizeDeps: { exclude: ['recast-navigation', '@recast-navigation/core', '@recast-navigation/three', '@recast-navigation/wasm'] },
  build: {
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { output: { advancedChunks: { groups: [{ name: 'three', test: /node_modules[\/]three[\/]/ }, { name: 'recast', test: /node_modules[\/]@?recast-navigation/ }] } } },
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true } } },
});
