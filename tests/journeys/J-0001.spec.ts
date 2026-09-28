import { test, expect } from '@playwright/test';

test('@J-0001 @critica Comprar uma peça reduz estoque', async ({ page, request }) => {
  await request.post('/reset');
  await page.goto('/');
  await expect(page.getByTestId('stock')).toHaveText('3');
  await page.getByTestId('buy').click();
  await expect(page.getByTestId('stock')).toHaveText('2');
});
