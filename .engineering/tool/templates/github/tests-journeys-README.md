# Testes das jornadas

Um arquivo por jornada, por exemplo `J-0001.spec.ts`. O título do teste contém a
marca da jornada (e `@pos-deploy` só se for seguro rodar contra produção):

```ts
import { test, expect } from '@playwright/test';

test('@J-0001 Vender uma peça', async ({ page }) => {
  await page.goto('/estoque/peca-azul');
  await expect(page.getByTestId('estoque')).toHaveText('3');
  await page.getByRole('button', { name: 'Vender' }).click();
  await expect(page.getByTestId('estoque')).toHaveText('2');
});
```

Regras:
- O teste reproduz a jornada como uma pessoa faria e verifica o resultado visível.
- Um teste de jornada aprovada nunca é alterado para "passar". Se a jornada estiver
  errada, a IA propõe a mudança do texto ao dono.
- Dados de teste são criados pelo próprio teste ou por carga de ensaio; nunca dados reais.
- O vídeo (`video: 'on'` no playwright.config) é a evidência que o dono assiste.
