import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
