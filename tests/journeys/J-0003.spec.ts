import { test, expect } from '@playwright/test';

test('@J-0003 @critica @pos-deploy Visitante não vê área administrativa', async ({ page }) => {
  const response = await page.goto('/admin');
  expect(response?.status()).toBe(403);
  await expect(page.locator('body')).toHaveText('Acesso negado');
});
