/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 78 · FATIA 4 — as páginas PÚBLICAS
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE TESTE PRENDE (e o que a catraca não prende)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A catraca (`f78-topo-unico.test.ts`) garante a FORMA: nenhum `<h1>` escrito à
 *  mão, todo topo vindo do `PageHeader` (ou delegado ao componente compartilhado)
 *  e o `eyebrow` do painel vindo da fonte única. Este arquivo prende o CONTRATO
 *  desta fatia:
 *
 *    • as 7 públicas declaram TÍTULO (e, quando a tela já tinha, descrição) no
 *      componente — o `<h1>` e a linha de identificação não sumiram na migração;
 *    • o nome da instituição NÃO é `eyebrow` em nenhuma delas: o `PublicHeader` da
 *      casca já o mostra, e a linha do topo é a única que pode dizer onde a pessoa
 *      está. Em página pública não há grupo de menu, então o `eyebrow` fica vazio;
 *    • os `data-testid` públicos continuam (título por `titleTestId`, descrição por
 *      `descriptionTestId`, o resto na própria tela);
 *    • um `<main>` por tela — e o componente compartilhado NÃO desenha landmark;
 *    • as telas continuam SERVER (o `PageHeader` é o que permitiu isso);
 *    • o `generateMetadata` das quatro rotas públicas não depende da forma do JSX:
 *      ele lê o SERVIÇO e devolve dados.
 *
 *  O que fica FORA, com o motivo medido na fonte, também é teste (o último bloco):
 *  tema do evento, heróis de marketing, a página da casa (renderizador próprio) e
 *  os dois redirects. A renderização é `renderToStaticMarkup`, o mesmo caminho da
 *  fatia 1: o que está em julgamento é o HTML que o SERVIDOR entrega.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PageHeader } from '../../src/components/ui/page-header';

const RAIZ = process.cwd();

const PUBLICAS = {
  notFound: 'src/app/404-tenant/page.tsx',
  carta: 'src/app/t/[tenantSlug]/(public)/carta/[token]/page.tsx',
  descadastro: 'src/app/t/[tenantSlug]/(public)/descadastro/[token]/page.tsx',
  convitePalestrante: 'src/app/t/[tenantSlug]/(public)/palestrante/convite/page.tsx',
  convitePatrocinador: 'src/app/t/[tenantSlug]/(public)/patrocinador/convite/page.tsx',
  qrDoPatrocinador: 'src/app/t/[tenantSlug]/(public)/patrocinio/[code]/page.tsx',
  perfilPublico: 'src/app/t/[tenantSlug]/(public)/u/[username]/page.tsx',
} as const;

/**
 * A lista de eventos: a OITAVA tela pública, e a única cujo topo não mora nela.
 *
 * O `PageHeader` está em `PublicEventList`, que tem dois pontos de montagem (a
 * página e o fallback da página da casa, F64). A catraca declara a delegação em
 * `TOPO_COMPARTILHADO`; aqui a prova é o que a tela faz: monta o componente, não
 * escreve topo, e o componente usa o topo único.
 */
const LISTA_DE_EVENTOS = 'src/app/t/[tenantSlug]/(public)/eventos/page.tsx';
const LISTA_COMPONENTE = 'src/components/tenancy/public-event-list.tsx';

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** O HTML do servidor montado num `document` do jsdom, para inspeção por seletor. */
function corpo(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

// ───────────────────────────────────────────────────────────────────────────────
//  O contrato de cada tela
// ───────────────────────────────────────────────────────────────────────────────
describe('as públicas declaram título e descrição no `PageHeader` (FASE 78 · fatia 4)', () => {
  it('o título de cada tela está no componente — e continua dizendo a mesma coisa', () => {
    /**
     * O título que a tela publica não pode mudar de SIGNIFICADO na migração: quem
     * chega pelo link do convite, pelo QR do estande ou pelo link selado da carta
     * lê o mesmo `<h1>` de antes. A tabela é explícita porque é o contrato da
     * fatia — e porque um `title=` vazio passaria na catraca.
     */
    const titulos: [string, string[]][] = [
      [PUBLICAS.notFound, ['title="Instituição não encontrada"']],
      [PUBLICAS.carta, ['title={card.cardName}']],
      [PUBLICAS.descadastro, [
        "title={state.isOut ? 'Você está fora da lista' : 'Parar de receber os recados'}",
      ]],
      [PUBLICAS.convitePalestrante, ['title="Convite de palestrante"']],
      [PUBLICAS.convitePatrocinador, ['title="Convite de patrocinador"']],
      [PUBLICAS.qrDoPatrocinador, ['title={qr.sponsorName}']],
      [PUBLICAS.perfilPublico, ['title={profile.displayName ?? `@${page.username}`}']],
    ];

    for (const [arquivo, esperados] of titulos) {
      const fonte = semComentarios(ler(arquivo));

      for (const esperado of esperados) {
        expect(fonte, `${arquivo} perdeu o título: ${esperado}`).toContain(esperado);
      }
    }
  });

  it('as telas que já publicavam descrição continuam publicando', () => {
    /**
     * A descrição é onde o estado da tela vive (o motivo do descadastro, a linha
     * "Conquistada por…", o texto do convite). Ela NÃO é decoração: o E2E a lê por
     * testid na carta, e a régua de contraste da F67 depende de ela ser
     * `text-muted-foreground` — o que o componente garante por construção.
     */
    for (const arquivo of [
      PUBLICAS.notFound,
      PUBLICAS.carta,
      PUBLICAS.descadastro,
      PUBLICAS.convitePalestrante,
      PUBLICAS.qrDoPatrocinador,
      PUBLICAS.perfilPublico,
    ]) {
      expect(semComentarios(ler(arquivo)), `${arquivo} perdeu a descrição`).toContain('description=');
    }
  });

  it('o NOME DA INSTITUIÇÃO não é `eyebrow` em nenhuma pública da fatia', () => {
    /**
     * A decisão da fatia, presa mecanicamente: `eyebrow` é o grupo de navegação, e
     * página pública não pertence a grupo nenhum — a instituição já está no
     * `PublicHeader`. Nenhuma das sete passa `eyebrow`, e o bloco do `<PageHeader>`
     * de cada uma não cita a casa (nem no título, nem na descrição): o nome dela
     * pode aparecer na tela onde ele é AÇÃO ("Ver os eventos de …"), nunca no topo.
     */
    for (const arquivo of Object.values(PUBLICAS)) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, `${arquivo} inventou um eyebrow público`).not.toContain('eyebrow=');

      const inicio = fonte.indexOf('<PageHeader');
      const fim = fonte.indexOf('/>', inicio);
      const blocoDoTopo = fonte.slice(inicio, fim === -1 ? undefined : fim);

      expect(blocoDoTopo, `${arquivo} não usa <PageHeader>`).toContain('<PageHeader');
      expect(blocoDoTopo, `${arquivo} põe a instituição no topo`).not.toMatch(
        /tenant\.name|tenantName/,
      );
    }
  });

  it('um `<main>` por tela — e o componente da lista NÃO desenha landmark', () => {
    /**
     * O perfil público declara DOIS `<main>` no arquivo porque tem dois RAMOS
     * exclusivos: o perfil oculto (a página avisa) e o perfil visível. Um por
     * render, como as telas de dois ramos da fatia 3 — o número é explícito para
     * que um `<main>` novo dentro de um ramo reprove.
     */
    const ramos: Record<string, number> = {
      [PUBLICAS.notFound]: 1,
      [PUBLICAS.carta]: 1,
      [PUBLICAS.descadastro]: 1,
      [PUBLICAS.convitePalestrante]: 1,
      [PUBLICAS.convitePatrocinador]: 1,
      [PUBLICAS.qrDoPatrocinador]: 1,
      [PUBLICAS.perfilPublico]: 2,
    };

    for (const [arquivo, esperados] of Object.entries(ramos)) {
      const fonte = semComentarios(ler(arquivo));
      const landmarks = fonte.match(/<main\b/g) ?? [];

      expect(
        landmarks,
        `${arquivo} precisa de ${esperados} <main> (um por ramo de render) e tem ${landmarks.length}`,
      ).toHaveLength(esperados);
    }

    const lista = semComentarios(ler(LISTA_COMPONENTE));

    expect(semComentarios(ler(LISTA_DE_EVENTOS)).match(/<main\b/g) ?? []).toHaveLength(1);
    expect(lista, 'o componente ganhou um landmark: quem monta é que o desenha').not.toContain('<main');
  });

  it('nenhuma ganhou `use client` por causa do topo (o componente é server)', () => {
    for (const arquivo of [...Object.values(PUBLICAS), LISTA_DE_EVENTOS]) {
      expect(ler(arquivo), `${arquivo} virou ilha de cliente`).not.toContain("'use client'");
    }
  });

  it('a lista de eventos delega o topo — e o componente usa o `PageHeader`', () => {
    const pagina = semComentarios(ler(LISTA_DE_EVENTOS));
    const componente = semComentarios(ler(LISTA_COMPONENTE));

    expect(pagina).toContain('<PublicEventList');
    expect(pagina).not.toContain('<h1');
    expect(componente).toContain('<PageHeader');
    expect(componente).not.toContain('<h1');
    /** O título continua o mesmo que o E2E da F60/F64 procura por nome acessível. */
    expect(componente).toContain('title="Eventos"');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O topo renderizado: o que o servidor entrega
// ───────────────────────────────────────────────────────────────────────────────
describe('o topo público no HTML do servidor (FASE 78 · fatia 4)', () => {
  it('a carta: o `<h1>` é o nome da carta e a linha do dono é a descrição', () => {
    /**
     * O E2E (`card-premium`, `f60-ocultacao`, `f51-card-share-expiry`) lê os dois
     * testids. Aqui a prova é de FORMA: o testid do título está no `<h1>` e o da
     * linha do dono está no `<p>` da descrição — nenhum dos dois ficou num
     * `<span>` qualquer.
     */
    const dom = corpo(
      renderToStaticMarkup(
        createElement(PageHeader, {
          title: 'Carta de Boas-Vindas',
          titleTestId: 'shared-card-title',
          description: 'Conquistada por Ana Premium',
          descriptionTestId: 'shared-card-owner',
        }),
      ),
    );

    const titulo = dom.querySelector('h1');
    const dono = dom.querySelector('[data-testid="shared-card-owner"]');

    expect(titulo?.getAttribute('data-testid')).toBe('shared-card-title');
    expect(titulo?.textContent).toBe('Carta de Boas-Vindas');
    expect(dono?.tagName).toBe('P');
    expect(dono?.textContent).toBe('Conquistada por Ana Premium');
    expect(dono?.closest('h1')).toBeNull();
  });

  it('o perfil público: um `<h1>` (o nome), a instituição fora do topo e o handle na descrição', () => {
    /**
     * O `profile-name` continua no `<h1>`, e o handle continua um dado de
     * identificação na linha de baixo. Nenhum `eyebrow`: o nome da instituição que
     * o topo antigo publicava não existe aqui — quem o mostra é o `PublicHeader`.
     */
    const dom = corpo(
      renderToStaticMarkup(
        createElement(PageHeader, {
          title: 'Ana do Perfil',
          titleTestId: 'profile-name',
          description: createElement(
            'span',
            { className: 'code-data', 'data-testid': 'profile-handle' },
            '@ana-perfil',
          ),
        }),
      ),
    );

    expect(dom.querySelectorAll('h1')).toHaveLength(1);
    expect(dom.querySelector('h1')?.textContent).toBe('Ana do Perfil');
    expect(dom.querySelector('[data-testid="profile-handle"]')?.textContent).toBe('@ana-perfil');
    expect(dom.querySelector('nav')).toBeNull();
    expect(dom.textContent).not.toContain('Instituição');

    /** O `eyebrow` é `<p>` e não existe: a única `<p>` é a descrição. */
    expect(dom.querySelectorAll('p')).toHaveLength(1);
  });

  it('o perfil oculto: o aviso é o título, e o motivo é a descrição (com testid)', () => {
    const dom = corpo(
      renderToStaticMarkup(
        createElement(PageHeader, {
          title: 'Este perfil está oculto por decisão da moderação',
          description: createElement(
            'span',
            { 'data-testid': 'profile-hidden-reason' },
            'Motivo registrado: dados de terceiro',
          ),
        }),
      ),
    );

    expect(dom.querySelector('h1')?.textContent).toBe(
      'Este perfil está oculto por decisão da moderação',
    );
    expect(dom.querySelector('[data-testid="profile-hidden-reason"]')?.textContent).toContain(
      'Motivo registrado',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Metadados: dados, não JSX
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As QUATRO rotas públicas que declaram metadados próprios.
 *
 * A pergunta da fatia ("o topo antigo participava da meta?") tem uma resposta só:
 * `generateMetadata` é uma função separada, que lê o SERVIÇO e devolve um objeto —
 * ela nunca leu o JSX. O teste prende isso: o bloco da função não pode citar o
 * topo nem um `<h1`, e os campos que o link compartilhado usa (`openGraph`,
 * `twitter`, `robots`) continuam sendo montados a partir dos dados.
 */
const ROTAS_COM_METADADOS = [
  'src/app/t/[tenantSlug]/(public)/carta/[token]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/u/[username]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/palestrantes/[speakerId]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/page.tsx',
] as const;

describe('os metadados das rotas públicas não dependem da forma do JSX (FASE 78 · fatia 4)', () => {
  it('as quatro rotas continuam exportando `generateMetadata` como função própria', () => {
    for (const arquivo of ROTAS_COM_METADADOS) {
      expect(ler(arquivo), `${arquivo} perdeu o generateMetadata`).toContain(
        'export async function generateMetadata',
      );
    }
  });

  it('o corpo do `generateMetadata` monta dados — não renderiza topo', () => {
    /**
     * O recorte vai do `export async function generateMetadata` até o próximo
     * `export`: é o corpo da função. Se alguém "reaproveitar" o JSX do cabeçalho
     * para montar o título, o recorte passa a citar o componente e o teste
     * reprova — que é exatamente o acoplamento que a fatia não pode criar.
     */
    for (const arquivo of ROTAS_COM_METADADOS) {
      const fonte = ler(arquivo);
      const inicio = fonte.indexOf('export async function generateMetadata');
      const depois = fonte.indexOf('\nexport ', inicio + 1);
      const corpoDaFuncao = fonte.slice(inicio, depois === -1 ? undefined : depois);

      expect(corpoDaFuncao, `${arquivo}: metadados citam o PageHeader`).not.toContain('PageHeader');
      expect(corpoDaFuncao, `${arquivo}: metadados renderizam <h1>`).not.toContain('<h1');
      expect(corpoDaFuncao, `${arquivo}: metadados não devolvem objeto`).toContain('return {');
      expect(corpoDaFuncao, `${arquivo}: metadados sem título`).toContain('title');
    }
  });

  it('a carta continua com o `openGraph`/`twitter` que alimenta a prévia do link', () => {
    /**
     * O `og:image` NÃO sai daqui — ele vem da rota `opengraph-image.tsx` do
     * `next/og` (o E2E baixa a imagem anunciada). O que este arquivo fornece é o
     * título e a descrição do card, e eles continuam vindo do serviço.
     */
    const fonte = ler(PUBLICAS.carta);

    expect(fonte).toContain('openGraph:');
    expect(fonte).toContain('twitter:');
    expect(fonte).toContain('siteName: tenant.name');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O que ficou de fora — a prova está na FONTE, não na intenção
// ───────────────────────────────────────────────────────────────────────────────
describe('as exclusões da fatia 4, conferidas na fonte (FASE 78)', () => {
  it('a ficha pública do palestrante é do TEMA DO EVENTO (não é pública da plataforma)', () => {
    /**
     * A rota mora dentro do evento e desenha com o tema do organizador: importa o
     * `event-theme.css`, renderiza sob `ThemeScope` e usa as classes `ef-*`. Um
     * `PageHeader` ali seria o topo do painel dentro da vitrine — e o `speaker-name`
     * continua no `<h1>` que a ficha já desenha.
     */
    const fonte = semComentarios(
      ler('src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/palestrantes/[speakerId]/page.tsx'),
    );

    expect(fonte).toContain('event-theme.css');
    expect(fonte).toContain('ThemeScope');
    expect(fonte).toContain('data-testid="speaker-name"');
    expect(fonte).not.toContain('<PageHeader');
  });

  it('a página da casa tem renderizador próprio (F64) e o topo é dela', () => {
    const fonte = semComentarios(ler('src/app/t/[tenantSlug]/(public)/page.tsx'));

    expect(fonte).toContain('<TenantHome');
    expect(fonte).not.toContain('<PageHeader');
  });

  it('os três heróis de marketing e a prévia do evento continuam fora', () => {
    const fora = [
      'src/app/page.tsx',
      'src/app/(public)/eventos/page.tsx',
      'src/app/(public)/para-instituicoes/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/previa/page.tsx',
    ];

    for (const arquivo of fora) {
      expect(ler(arquivo), `${arquivo} migrou sem decisão`).not.toContain('<PageHeader');
    }
  });

  it('os dois redirects não desenham topo nenhum', () => {
    for (const arquivo of [
      'src/app/superadmin/page.tsx',
      'src/app/(public)/organizacoes/page.tsx',
    ]) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, `${arquivo} deixou de ser redirect`).toMatch(/redirect\(/i);
      expect(fonte, `${arquivo} passou a desenhar topo`).not.toContain('<PageHeader');
    }
  });
});
