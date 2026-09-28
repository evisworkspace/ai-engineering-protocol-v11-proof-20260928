import { defineConfig } from '@playwright/test';

// ai-engineering: cada jornada grava vídeo como evidência para o dono.
// Se o projeto já tinha um playwright.config, mescle o bloco `use` nele.
export default defineConfig({
  testDir: './tests/journeys',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000', // ADAPTAR
    video: 'on',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // ADAPTAR: suba a aplicação antes dos testes.
  // webServer: { command: 'npm run start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
});
