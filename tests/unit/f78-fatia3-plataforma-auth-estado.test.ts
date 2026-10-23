/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 78 · FATIA 3 — plataforma, autenticação e estado
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PRENDE (e o que a catraca da fatia 2 não prendia)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A catraca (`f78-topo-unico.test.ts`) garante a FORMA: nenhum `<h1>` escrito à
 *  mão, todo topo vindo do `PageHeader`, eyebrow da fonte única. Este arquivo
 *  prende o CONTRATO desta fatia em particular:
 *
 *    • as 4 telas do `text-headline` (conta, esqueci-senha, redefinir-senha,
 *      dois-fatores) passam pelo token de título de página (`text-title-lg`,
 *      28px) — a classe inexistente não existe mais em `src/`;
 *    • a "volta" derivada funciona na trilha da plataforma: `PLATFORM_CRUMB`
 *      tem destino e o penúltimo item da tela de detalhe também;
 *    • `verification-title` e `tenant-detail-name` continuam no `<h1>` — pela
 *      prop `titleTestId`, e não por um `<h1>` escrito à mão;
 *    • `profile-name` NÃO está em `/conta` (é do perfil público, fatia 4);
 *    • as 16 telas têm o seu `<main>` e o `<PageHeader>` (nenhum `<main>` novo é
 *      criado aqui — as telas já viviam fora da casca `(app)`).
 *
 *  A renderização é `renderToStaticMarkup`, o mesmo caminho do teste da fatia 1:
 *  o que está em julgamento é o HTML que o SERVIDOR entrega.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PageHeader } from '../../src/components/ui/page-header';
import { PLATFORM_CRUMB, PLATFORM_NAV_GROUP } from '../../src/components/shell/tenant-nav';

const RAIZ = process.cwd();

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Todos os `.ts`/`.tsx`/`.css` de `src/` — a árvore em que a classe não pode existir. */
function arquivosDe(diretorio: string, encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(join(RAIZ, diretorio))) {
    const absoluto = join(RAIZ, diretorio, entrada);

    if (statSync(absoluto).isDirectory()) {
      arquivosDe(`${diretorio}/${entrada}`, encontrados);
      continue;
    }

    if (/\.(?:tsx|ts|css)$/.test(entrada)) encontrados.push(`${diretorio}/${entrada}`);
  }

  return encontrados;
}

const TELAS_DA_FATIA = [
  // Plataforma (4 que ainda não usavam o componente)
  'src/app/superadmin/tenants/page.tsx',
  'src/app/superadmin/tenants/[tenantId]/page.tsx',
  'src/app/superadmin/governanca/page.tsx',
  'src/app/superadmin/leads/page.tsx',
  // Autenticação (6)
  'src/app/login/page.tsx',
  'src/app/signup/page.tsx',
  'src/app/esqueci-senha/page.tsx',
  'src/app/redefinir-senha/page.tsx',
  'src/app/login/dois-fatores/page.tsx',
  'src/app/conta/page.tsx',
  // Estado/institucional (6)
  'src/app/instituicao-bloqueada/page.tsx',
  'src/app/selecionar-instituicao/page.tsx',
  'src/app/verificacao/page.tsx',
  'src/app/validar/[code]/page.tsx',
  'src/app/validar/lote/page.tsx',
  'src/app/t/[tenantSlug]/(public)/convite/page.tsx',
] as const;

// ───────────────────────────────────────────────────────────────────────────────
//  O `text-headline` que não existia
// ───────────────────────────────────────────────────────────────────────────────
describe('o token de título de página substituiu a classe inexistente (FASE 78 · fatia 3)', () => {
  it('`text-headline` não é USADA em NENHUM arquivo de `src/` — nem no CSS, nem nas telas', () => {
    /**
     * A prova da raiz: a classe foi usada em 4 telas por engano e NUNCA existiu no
     * `globals.css` nem no `DESIGN.md`. Se ela voltar a aparecer em qualquer
     * arquivo, isso é uma tela renderizando o `<h1>` em 16px de novo.
     *
     * A busca ignora comentários pelo mesmo motivo da catraca do `<h1>`: este
     * teste e a migração CITAM a classe para contar a história, e procurar no
     * texto cru reprovaria a própria documentação — a asserção é sobre o CÓDIGO.
     */
    const ocorrencias = arquivosDe('src').filter((arquivo) =>
      semComentarios(ler(arquivo)).includes('text-headline'),
    );

    expect(ocorrencias, `text-headline voltou em:\n${ocorrencias.join('\n')}`).toEqual([]);
  });

  it('o `PageHeader` usa `text-title-lg` — o token de 28px documentado', () => {
    const componente = ler('src/components/ui/page-header.tsx');

    expect(componente).toContain('font-display text-title-lg text-foreground');

    // O valor do token é o que a fase cita no relatório: 1.75rem = 28px.
    const globals = ler('src/app/globals.css');
    expect(globals).toContain('--text-title-lg: 1.75rem');
  });

  it('as 4 telas do `text-headline` declaram título e descrição no componente', () => {
    const titulos: [string, string][] = [
      ['src/app/conta/page.tsx', 'Minha conta'],
      ['src/app/esqueci-senha/page.tsx', 'Esqueci minha senha'],
      ['src/app/redefinir-senha/page.tsx', 'Definir nova senha'],
      ['src/app/login/dois-fatores/page.tsx', 'Verificação em duas etapas'],
    ];

    for (const [arquivo, titulo] of titulos) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, `${arquivo} não usa <PageHeader>`).toContain('<PageHeader');
      expect(fonte, `${arquivo} perdeu o título "${titulo}"`).toContain(`title="${titulo}"`);
      expect(fonte, `${arquivo} não tem descrição`).toContain('description=');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A volta derivada nas telas de plataforma
// ───────────────────────────────────────────────────────────────────────────────
describe('a trilha da plataforma dá destino à volta derivada (FASE 78 · fatia 3)', () => {
  it('a constante é única e aponta para uma tela que existe', () => {
    expect(PLATFORM_NAV_GROUP).toBe('Plataforma');
    expect(PLATFORM_CRUMB).toEqual({ label: 'Plataforma', href: '/superadmin/metricas' });

    // O destino não é um link morto: a tela de métricas existe e usa o topo.
    expect(ler('src/app/superadmin/metricas/page.tsx')).toContain('<PageHeader');
  });

  it('numa tela de primeiro nível, a volta aponta para a Plataforma', () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: 'Instituições',
        eyebrow: PLATFORM_NAV_GROUP,
        breadcrumbs: [PLATFORM_CRUMB, { label: 'Instituições' }],
      }),
    );

    document.body.innerHTML = html;

    const volta = Array.from(document.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Voltar para'),
    );

    expect(volta?.getAttribute('href')).toBe('/superadmin/metricas');
    expect(volta?.textContent).toContain('Voltar para Plataforma');
  });

  it('no detalhe da instituição, a volta nomeia o PAI (Instituições), não a raiz', () => {
    /**
     * Era este o buraco que a fatia 1 deixou aberto: o penúltimo item
     * ("Instituições") não tinha `href`, e o topo desenhava um "← Instituições"
     * escrito à mão. Agora a volta sai da trilha e diz o destino.
     */
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: 'UFBA',
        titleTestId: 'tenant-detail-name',
        eyebrow: PLATFORM_NAV_GROUP,
        breadcrumbs: [
          PLATFORM_CRUMB,
          { label: 'Instituições', href: '/superadmin/tenants' },
          { label: 'UFBA' },
        ],
      }),
    );

    document.body.innerHTML = html;

    const volta = Array.from(document.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Voltar para'),
    );

    expect(volta?.getAttribute('href')).toBe('/superadmin/tenants');
    expect(volta?.textContent).toContain('Voltar para Instituições');
    expect(document.querySelector('h1')?.getAttribute('data-testid')).toBe('tenant-detail-name');
  });

  it('as 8 telas de governança declaram a trilha com a constante (nenhuma string solta)', () => {
    const plataforma = [
      'src/app/superadmin/metricas/page.tsx',
      'src/app/superadmin/auditoria/page.tsx',
      'src/app/superadmin/denuncias/page.tsx',
      'src/app/superadmin/rotinas/page.tsx',
      'src/app/superadmin/tenants/page.tsx',
      'src/app/superadmin/tenants/[tenantId]/page.tsx',
      'src/app/superadmin/governanca/page.tsx',
      'src/app/superadmin/leads/page.tsx',
    ];

    for (const arquivo of plataforma) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, `${arquivo} não usa a raiz da trilha`).toContain('PLATFORM_CRUMB');
      expect(fonte, `${arquivo} não usa o grupo da plataforma`).toContain(
        'eyebrow={PLATFORM_NAV_GROUP}',
      );
      expect(fonte, `${arquivo} ainda escreve a trilha à mão`).not.toContain("label: 'Plataforma'");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Os data-testid do título e o landmark
// ───────────────────────────────────────────────────────────────────────────────
describe('os testids do título e o `<main>` das telas da fatia (FASE 78 · fatia 3)', () => {
  it('`verification-title` e `tenant-detail-name` passam por `titleTestId` (e continuam no `<h1>`)', () => {
    const verificacao = ler('src/app/verificacao/page.tsx');
    const detalhe = ler('src/app/superadmin/tenants/[tenantId]/page.tsx');

    expect(verificacao).toContain('titleTestId="verification-title"');
    expect(verificacao).not.toContain('<h1');

    expect(detalhe).toContain('titleTestId="tenant-detail-name"');
    expect(detalhe).not.toContain('<h1');
  });

  it('o selo de estado do detalhe da instituição continua no `<header>`', () => {
    /**
     * O `tenant-detail-status` já era lido pela tela (e o `data-status` é o que
     * distingue suspensa de ativa). Ele não pode sumir na migração: o slot
     * `badge` é para ESTADO, e é exatamente o caso.
     */
    expect(ler('src/app/superadmin/tenants/[tenantId]/page.tsx')).toContain(
      'data-testid="tenant-detail-status"',
    );
  });

  it('`profile-name` NÃO está em `/conta`', () => {
    /**
     * O pedido tinha a condição "se estiver em `/conta`": não está. O
     * `profile-name` é o `<h1>` do perfil PÚBLICO (`/t/<slug>/u/<username>`), que
     * é fatia 4 — a área de conta usa os testids `account-current-email`,
     * `account-security-*` e afins, e nenhum deles é um título.
     *
     * A fatia 4 migrou aquele `<h1>` para o `PageHeader`: o contrato do E2E é o
     * mesmo (o testid continua no `<h1>`), e o que muda é a forma de chegar lá —
     * pela prop `titleTestId`, como nos outros 11 testids de título do produto.
     */
    expect(ler('src/app/conta/page.tsx')).not.toContain('profile-name');
    expect(ler('src/app/t/[tenantSlug]/(public)/u/[username]/page.tsx')).toContain(
      'titleTestId="profile-name"',
    );
  });

  it('as 16 telas têm o seu `<main>` — nenhuma ganhou um segundo', () => {
    /**
     * Estas telas vivem FORA da casca `(app)` (o layout de `/t/[slug]` não desenha
     * landmark desde a F52). O teste prende o mínimo: cada arquivo desenha o seu
     * `<main>`. Telas com dois ramos (selecionar-instituicao, validar/[code])
     * desenham um por render — o que o arquivo mostra são dois ramos exclusivos.
     */
    for (const arquivo of TELAS_DA_FATIA) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, `${arquivo} não tem <main>`).toContain('<main');
      expect(fonte, `${arquivo} não usa <PageHeader>`).toContain('<PageHeader');
    }
  });

  it('as telas de auth e de sessão não inventam trilha', () => {
    for (const arquivo of [
      'src/app/login/page.tsx',
      'src/app/signup/page.tsx',
      'src/app/esqueci-senha/page.tsx',
      'src/app/redefinir-senha/page.tsx',
      'src/app/login/dois-fatores/page.tsx',
      'src/app/conta/page.tsx',
      'src/app/selecionar-instituicao/page.tsx',
    ]) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, `${arquivo} inventou um eyebrow`).not.toContain('eyebrow=');
      expect(fonte, `${arquivo} inventou uma trilha`).not.toContain('breadcrumbs=');
    }
  });
});
