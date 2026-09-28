import { defineConfig } from '@playwright/test';

// ai-engineering: cada jornada grava vídeo como evidência para o dono.
// Se o projeto já tinha um playwright.config, mescle o bloco `use` nele.
export default defineConfig({
  testDir: './tests/journeys',
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:4173',
    video: 'on',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'node server.js', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30_000 },
});
