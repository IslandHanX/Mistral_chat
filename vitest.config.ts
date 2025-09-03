import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],            // ✅ 让 JSX 走 React 自动运行时
  test: {
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    restoreMocks: true,
    mockReset: true,
    clearMocks: true,
  },
  esbuild: {
    jsx: 'automatic',            // 双保险
  },
});
