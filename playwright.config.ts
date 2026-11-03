import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  reporter: 'list',
  outputDir: 'artifacts/browser-results',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 1440, height: 1000 },
    headless: true,
    launchOptions: {
      executablePath: existsSync(edge) ? edge : existsSync(chrome) ? chrome : undefined,
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
