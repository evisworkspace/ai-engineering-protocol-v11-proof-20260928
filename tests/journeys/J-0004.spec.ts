import { test, expect } from '@playwright/test';

test('@J-0004 Restaurar backup recupera venda e estoque', async ({ page, request }) => {
  await request.post('/reset');
  await page.goto('/');
  await page.getByTestId('buy').click();
  await expect(page.getByTestId('stock')).toHaveText('2');
  const backup = await (await request.get('/backup')).text();
  await request.post('/reset');
  const restored = await request.post('/restore', { data: backup, headers: { 'content-type': 'application/json' } });
  expect(restored.ok()).toBeTruthy();
  expect(await restored.json()).toEqual({ stock: 2, sales: 1 });
  await page.reload();
  await expect(page.getByTestId('stock')).toHaveText('2');
  await page.goto('/cashier');
  await expect(page.getByTestId('sales')).toHaveText('1');
});
