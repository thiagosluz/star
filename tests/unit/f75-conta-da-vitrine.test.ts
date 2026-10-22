/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — a conta da pessoa na vitrine da plataforma
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A raiz `/` deixou de redirecionar quem tem sessão e passou a mostrar um botão
 *  "Minha área". O perigo desta mudança não é visual: é o DESTINO. Ele era decidido
 *  por dois `redirect()` no corpo da página — com instituição ativa, o painel dela;
 *  sem vínculo, o seletor de instituição. Se o `href` do botão passasse a ser
 *  calculado de outro jeito, a pessoa logada cairia num lugar diferente do que caía
 *  antes, e nenhum teste de navegador notaria a diferença enquanto a página
 *  abrisse.
 *
 *  Aqui a matriz é provada SEM banco e SEM navegador: só a função pura recebendo o
 *  fato já apurado (há sessão? qual é a instituição ativa?).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  E O RÓTULO É CATRACA, NÃO PROMESSA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O texto "Minha área" já existia no cabeçalho público da instituição. O pedido foi
 *  REUSAR a fonte, e não escrever uma segunda string — porque duas cópias do mesmo
 *  rótulo divergem no primeiro ajuste de linguagem, e aí a mesma pessoa lê dois nomes
 *  para o mesmo lugar dependendo da tela. O último caso lê os três arquivos que
 *  desenham este botão e reprova quem escrever o literal fora do domínio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  MINHA_AREA_LABEL,
  SELECT_INSTITUTION_PATH,
  resolveVitrineAccountAction,
} from '../../src/domain/platform/vitrine-account-rules';

describe('cabeçalho da vitrine: com sessão × sem sessão', () => {
  it('sem sessão, os DOIS convites de sempre — e nenhum caminho de conta', () => {
    const action = resolveVitrineAccountAction({
      isAuthenticated: false,
      activeTenantSlug: null,
    });

    expect(action).toEqual({
      kind: 'guest',
      loginHref: '/login',
      signupHref: '/signup',
    });
  });

  it('com sessão e instituição ativa, UM botão que leva ao painel DELA', () => {
    const action = resolveVitrineAccountAction({
      isAuthenticated: true,
      activeTenantSlug: 'ufba-demo',
    });

    expect(action).toEqual({
      kind: 'account',
      label: MINHA_AREA_LABEL,
      href: '/t/ufba-demo/dashboard',
    });
  });

  it('com sessão e SEM vínculo, o destino é o seletor de instituição (não o login)', () => {
    const action = resolveVitrineAccountAction({
      isAuthenticated: true,
      activeTenantSlug: null,
    });

    expect(action).toEqual({
      kind: 'account',
      label: MINHA_AREA_LABEL,
      href: SELECT_INSTITUTION_PATH,
    });
  });

  /**
   * O destino é o MESMO que o redirect dava.
   *
   * A prova não é o texto do caminho: é que ele sai de `tenantPath`, a função que o
   * redirect usava. Um slug com hífen (o formato que o produto aceita) e a barra
   * final mostram que nada foi concatenado à mão.
   */
  it('o caminho do painel é o canônico `/t/<slug>/dashboard` — sem barra sobrando', () => {
    for (const slug of ['ufba-demo', 'fiocruz', 'a1']) {
      expect(
        resolveVitrineAccountAction({ isAuthenticated: true, activeTenantSlug: slug }),
      ).toMatchObject({ href: `/t/${slug}/dashboard` });
    }
  });

  it('sem sessão, o rótulo da conta não vaza para o visitante', () => {
    const action = resolveVitrineAccountAction({
      isAuthenticated: false,
      activeTenantSlug: 'ufba-demo',
    });

    expect(action.kind).toBe('guest');
    expect(JSON.stringify(action)).not.toContain(MINHA_AREA_LABEL);
  });
});

describe('o rótulo "Minha área" tem UMA fonte', () => {
  /**
   * Os três arquivos que desenham o botão. Comentário é ignorado de propósito: o
   * que se prende é a STRING que chega à tela, não a menção em prosa.
   */
  const ARQUIVOS = [
    'src/domain/platform/vitrine-account-rules.ts',
    'src/components/shell/account-block.tsx',
    'src/app/page.tsx',
  ] as const;

  function ocorrenciasForaDeComentario(arquivo: string): number {
    return readFileSync(arquivo, 'utf8')
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => !linha.startsWith('*') && !linha.startsWith('//') && !linha.startsWith('/*'))
      .filter((linha) => linha.includes(MINHA_AREA_LABEL)).length;
  }

  it('o literal vive SÓ no domínio — o cabeçalho da instituição e a vitrine o importam', () => {
    const porArquivo = ARQUIVOS.map((arquivo) => [arquivo, ocorrenciasForaDeComentario(arquivo)] as const);

    expect(porArquivo.filter(([, total]) => total > 0)).toEqual([
      ['src/domain/platform/vitrine-account-rules.ts', 1],
    ]);
  });

  it('a fonte é a frase que a pessoa lê (e não uma chave técnica)', () => {
    expect(MINHA_AREA_LABEL).toBe('Minha área');
  });
});
