import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testDir: './tests/live',
  timeout: 150000,
  outputDir: 'artifacts/live-browser-results',
  use: { ...base.use, actionTimeout: 15000, baseURL: 'http://127.0.0.1:5173' },
});
