import { test, expect } from '@playwright/test';

test('@J-0002 Venda aparece no caixa', async ({ page, request }) => {
  await request.post('/reset');
  await page.goto('/');
  await page.getByTestId('buy').click();
  await page.goto('/cashier');
  await expect(page.getByTestId('sales')).toHaveText('1');
});
