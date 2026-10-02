import AxeBuilder from '@axe-core/playwright';
import { test } from '@playwright/test';

/** TEMPORÁRIO — diagnóstico da mutação de contraste. APAGAR. */
test('diagnóstico', async ({ page }) => {
  await page.goto('/');

  const dados = await page.locator('#ef-aparencia').evaluate((el) => {
    const estilo = getComputedStyle(el);
    return {
      cor: estilo.color,
      tamanho: estilo.fontSize,
      fundoProprio: estilo.backgroundColor,
      fundoBody: getComputedStyle(document.body).backgroundColor,
      fundoHtml: getComputedStyle(document.documentElement).backgroundColor,
      classe: el.className,
      variavel: getComputedStyle(document.documentElement).getPropertyValue('--background'),
    };
  });

  console.log('[DIAG]', JSON.stringify(dados));

  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  console.log(
    '[DIAG] violations:',
    JSON.stringify(resultado.violations.map((v) => ({ id: v.id, impact: v.impact }))),
  );
  console.log(
    '[DIAG] incomplete:',
    JSON.stringify(
      resultado.incomplete.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          alvo: n.target.map(String).join(' '),
          resumo: n.any.map((c) => `${c.id}: ${c.message}`).concat(
            n.all.map((c) => `${c.id}: ${c.message}`),
          ),
        })),
      })),
    ),
  );
  console.log(
    '[DIAG] passes color-contrast:',
    JSON.stringify(
      resultado.passes
        .filter((v) => v.id === 'color-contrast')
        .map((v) => v.nodes.map((n) => n.target.map(String).join(' '))),
    ),
  );
});
