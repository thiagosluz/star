/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O TOPO ÚNICO — a catraca de TODAS as telas do produto (FASE 78 · fatias 2 a 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CATRACA PROVA — E O QUE ELA NÃO PROVA (leia antes de confiar nela)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela lê a FONTE dos `page.tsx` de `src/app`: cada tela migrada importa e usa
 *  `PageHeader`, não escreve `<h1>` nem um `<header>` logo depois do `<main>`, e
 *  declara o `eyebrow` com a constante da fonte única — `TENANT_NAV_GROUPS` no
 *  painel da instituição, `PLATFORM_NAV_GROUP` nas telas de plataforma — nunca com
 *  uma string solta.
 *
 *  **Ela NÃO prova o render.** Uma tela pode importar o componente e passar props
 *  que o anulam, ou renderizá-lo só num ramo que a pessoa nunca vê. Quem prova o
 *  HTML entregue é o par de E2E (`h1 === 1` e o eyebrow como `<p>`), e por isso a
 *  fatia 2 não substitui o navegador por este arquivo. O limite está escrito aqui
 *  para que ninguém use o verde da catraca como prova de que a tela está certa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ALLOWLIST — e por que as linhas dela têm MOTIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 3 fechou as 16 telas de plataforma, autenticação e estado. A fatia 4
 *  fechou as PÚBLICAS: as 7 que desenhavam o topo à mão mais a lista de eventos
 *  (cujo topo mora no componente compartilhado, ver `TOPO_COMPARTILHADO`). O que
 *  sobrou tem motivo escrito, e são só três famílias:
 *
 *    • **tema do evento** (e a prévia que o renderiza) — o topo é do site do
 *      organizador (ADR-324/325), não do painel;
 *    • **heróis de marketing** — página de venda, declarada fora do escopo pelo
 *      plano da F78;
 *    • **renderizador próprio** — a página da casa (F64) e os dois redirects.
 *
 *  A dívida só encolhe: o tamanho da allowlist é ASSERTADO. Migrar uma tela exige
 *  remover a linha dela e baixar o número — acrescentar exceção nova reprova.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
const APP = 'src/app';
const GRUPO_APP = 'src/app/t/[tenantSlug]/(app)';

/**
 * O tema do evento é decisão registrada (ADR-324/325): o topo é o do site do
 * organizador, e a tipografia e a paleta também. Migrar aqui trocaria o desenho
 * dele pelo topo do painel — e a prévia (`.../pagina/previa`) existe exatamente
 * para mostrar ao organizador o que o visitante verá: ela usa o MESMO renderizador.
 *
 * A ficha pública do palestrante entra nesta família pela FONTE, não por
 * conveniência: a rota mora dentro do evento (`/eventos/<slug>/palestrantes/<id>`),
 * importa o `event-theme.css`, renderiza sob `ThemeScope` e desenha com as classes
 * `ef-*` do tema. Um `PageHeader` ali seria o topo da gestão dentro da vitrine.
 */
const MOTIVO_TEMA_DO_EVENTO =
  'Tema do evento: o topo é o do site do organizador (ADR-324/325), com a paleta e a ' +
  'tipografia dele — um PageHeader aqui seria o topo do painel dentro da vitrine.';

const MOTIVO_HERO =
  'Herói de marketing: página de venda com desenho próprio, declarada FORA do escopo pelo plano ' +
  'da F78 ("O que fica fora, de propósito"). Não tem gestão no topo.';

/**
 * Redirect não desenha topo nenhum.
 *
 * São DOIS arquivos, e os dois ficaram nesta lista desde a fatia 3/4: `/superadmin`
 * (que sempre foi redirect para as métricas) e `/organizacoes` (que virou um 308
 * para `/eventos?aba=instituicoes` na FASE 71, ADR-350). Nenhum dos dois tem tela.
 */
const MOTIVO_REDIRECT =
  'Não é tela: o arquivo só redireciona. Um redirect não desenha topo nenhum, e criar uma ' +
  'segunda tela só para caber o PageHeader seria inventar um endereço que ninguém pediu.';

/**
 * O que ainda não migrou, e por quê.
 *
 * A chave é o caminho relativo à raiz (com a barra normalizada para `/`), para
 * que a mensagem de falha diga exatamente qual tela precisa de decisão.
 */
const ALLOWLIST: Readonly<Record<string, string>> = {
  [`${GRUPO_APP}/administracao/eventos/[eventId]/pagina/previa/page.tsx`]:
    'Pré-visualização da página pública do evento: usa o MESMO renderizador do tema ' +
    '(ADR-324/325), e o topo é o do site do organizador. Migrar aqui faria a prévia ' +
    'mentir sobre o que o visitante vê.',

  // ── Não são telas ───────────────────────────────────────────────────────────
  'src/app/superadmin/page.tsx': MOTIVO_REDIRECT,
  'src/app/(public)/organizacoes/page.tsx':
    'Diretório de instituições LEGADO, unificado em `/eventos?aba=instituicoes` na FASE 71 ' +
    '(ADR-350): a rota só REDIRECIONA em caráter permanente (308), preservando busca e página. ' +
    'Não é tela — e é mantida para os links antigos continuarem valendo.',

  // ── Heróis de marketing (fora do escopo declarado) ──────────────────────────
  'src/app/page.tsx': MOTIVO_HERO,
  'src/app/(public)/eventos/page.tsx': MOTIVO_HERO,
  'src/app/(public)/para-instituicoes/page.tsx': MOTIVO_HERO,

  // ── Renderizador próprio (decisão registrada) ───────────────────────────────
  'src/app/t/[tenantSlug]/(public)/page.tsx':
    'A página da casa (FASE 64): a vitrine é desenhada por `TenantHome`/`TenantPublicPage`, ' +
    'um renderizador próprio com capa, identidade, grupos por data e os blocos que a ' +
    'instituição publicou (ADR-332). O topo é dela, e não o da plataforma.',

  // ── Tema do evento: as sete telas que o organizador desenha ─────────────────
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx': MOTIVO_TEMA_DO_EVENTO,
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/atividades/[activitySlug]/page.tsx':
    MOTIVO_TEMA_DO_EVENTO,
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx':
    MOTIVO_TEMA_DO_EVENTO,
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/inscricao/page.tsx':
    MOTIVO_TEMA_DO_EVENTO,
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/sorteios/[raffleId]/page.tsx':
    MOTIVO_TEMA_DO_EVENTO,
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/sorteios/[raffleId]/auditoria/page.tsx':
    MOTIVO_TEMA_DO_EVENTO,
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/sorteios/[raffleId]/palco/page.tsx':
    'Tema do evento: o telão do sorteio é superfície INVERSA (escura nos dois modos, F52/F29) ' +
    'desenhada pelo tema do organizador — o `<main>` é o conteúdo do palco, e migrar aqui ' +
    'apagaria a operação de palco.',

  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/palestrantes/[speakerId]/page.tsx':
    MOTIVO_TEMA_DO_EVENTO,
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  O TOPO COMPARTILHADO — a tela está MIGRADA; o `<PageHeader>` não mora nela
 * ─────────────────────────────────────────────────────────────────────────────
 *  A lista pública de eventos tem DOIS pontos de montagem: `/t/<slug>/eventos` e o
 *  fallback da página da casa (F64). O topo ("Eventos" + a contagem do serviço) não
 *  pode morar em duas páginas — seria a segunda fonte que esta fase está matando.
 *  Ele mora em `PublicEventList`, e as duas telas montam o MESMO cabeçalho.
 *
 *  Isto NÃO é uma allowlist: a linha abaixo NÃO conta como dívida (a tela não tem
 *  `<h1>` nem `<header>` escritos à mão), e o teste que a prende é mais forte que o
 *  da allowlist — ele exige que o módulo declarado USE o componente único.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const TOPO_COMPARTILHADO: Readonly<Record<string, { modulo: string; motivo: string }>> = {
  'src/app/t/[tenantSlug]/(public)/eventos/page.tsx': {
    modulo: 'src/components/tenancy/public-event-list.tsx',
    motivo:
      'A lista é UMA e tem dois pontos de montagem (a página e o fallback da página da casa, ' +
      'F64): o topo mora no componente para não existirem dois cabeçalhos para a mesma lista.',
  },
};

/** Varre `src/app` e devolve os `page.tsx`, em caminho relativo com `/`. */
function paginasDe(diretorio: string, encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(join(RAIZ, diretorio))) {
    const absoluto = join(RAIZ, diretorio, entrada);

    if (statSync(absoluto).isDirectory()) {
      paginasDe(`${diretorio}/${entrada}`, encontrados);
      continue;
    }

    if (entrada === 'page.tsx') encontrados.push(`${diretorio}/${entrada}`);
  }

  return encontrados;
}

const PAGINAS = paginasDe(APP).sort();
const MIGRADAS = PAGINAS.filter((arquivo) => !(arquivo in ALLOWLIST));

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

/**
 * Remove comentários antes de procurar `<h1`/`<header`.
 *
 * Os comentários desta migração CITAM o topo antigo (é o "porquê" que o AGENTS §3
 * exige) e alguns dizem literalmente "aqui havia `<h1>`". Procurar no texto cru
 * reprovaria a própria documentação — o mesmo cuidado que o teste da fatia 1
 * tomou com `'use client'`.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** O `<header>` que era o TOPO: imediatamente depois do `<main>`. */
const TOPO_ESCRITO_A_MAO = /<main[^>]*>\s*<header\b/;

// ───────────────────────────────────────────────────────────────────────────────
//  A fonte única dos grupos: instituição × plataforma
// ───────────────────────────────────────────────────────────────────────────────
const TENANT_NAV = ler('src/components/shell/tenant-nav.tsx');

/**
 * As 16 telas da fatia 3, por grupo — a lista é EXPLÍCITA porque é o contrato da
 * fatia. As de plataforma saem de uma varredura (ver o teste), e as de
 * autenticação e estado não têm diretório comum: são endereços de topo.
 */
const AUTENTICACAO = [
  'src/app/login/page.tsx',
  'src/app/signup/page.tsx',
  'src/app/esqueci-senha/page.tsx',
  'src/app/redefinir-senha/page.tsx',
  'src/app/login/dois-fatores/page.tsx',
  'src/app/conta/page.tsx',
] as const;

/** Telas de estado que servem a PLATAFORMA (o serviço é da casa, não da instituição). */
const ESTADO_DE_PLATAFORMA = [
  'src/app/instituicao-bloqueada/page.tsx',
  'src/app/verificacao/page.tsx',
  'src/app/validar/[code]/page.tsx',
  'src/app/validar/lote/page.tsx',
] as const;

/** Telas de estado de SESSÃO/INSTITUIÇÃO: não têm grupo de navegação para exibir. */
const ESTADO_DE_SESSAO = [
  'src/app/selecionar-instituicao/page.tsx',
  'src/app/t/[tenantSlug]/(public)/convite/page.tsx',
] as const;

describe('catraca — todo `page.tsx` do produto usa o topo único (FASE 78)', () => {
  it('encontra as telas e ancora o tamanho da dívida', () => {
    /**
     * Uma catraca que não acha arquivo nenhum fica verde para sempre. A âncora é
     * o número medido no fim da fatia 4: 96 `page.tsx`, 81 migrados (73 da fatia
     * 2/3 + 8 públicas, uma delas por topo compartilhado) e 15 exceções com
     * motivo. Migrar uma tela exige baixar a allowlist; acrescentar exceção nova
     * reprova aqui.
     */
    expect(PAGINAS.length).toBe(96);
    expect(MIGRADAS.length).toBe(81);
    expect(Object.keys(ALLOWLIST)).toHaveLength(15);
    expect(Object.keys(TOPO_COMPARTILHADO)).toHaveLength(1);
  });

  it('nenhuma tela migrada desenha o próprio `<h1>`', () => {
    const infratores = MIGRADAS.filter((arquivo) => semComentarios(ler(arquivo)).includes('<h1'));

    expect(infratores, `o <h1> vem do PageHeader:\n${infratores.join('\n')}`).toEqual([]);
  });

  it('nenhuma tela migrada desenha um `<header>` como topo, logo depois do `<main>`', () => {
    /**
     * O limite do regex: ele pega o formato que TODAS as telas antigas usavam
     * (`<main …>` seguido de `<header …>`) e não o `<header>` de um CARTÃO, que
     * continua legítimo (o quadro de demandas usa um dentro da coluna). Quem
     * escrever o topo à mão de outro jeito ainda passa aqui — e é por isso que o
     * E2E de render é obrigatório.
     */
    const infratores = MIGRADAS.filter((arquivo) =>
      TOPO_ESCRITO_A_MAO.test(semComentarios(ler(arquivo))),
    );

    expect(infratores, `o topo vem do PageHeader:\n${infratores.join('\n')}`).toEqual([]);
  });

  it('toda tela migrada importa e usa `PageHeader` — ou delega o topo ao componente declarado', () => {
    const semComponente = MIGRADAS.filter((arquivo) => {
      if (arquivo in TOPO_COMPARTILHADO) return false;

      const fonte = semComentarios(ler(arquivo));
      return !fonte.includes('<PageHeader') || !fonte.includes("from '@/components/ui'");
    });

    expect(semComponente, `faltou o PageHeader em:\n${semComponente.join('\n')}`).toEqual([]);
  });

  it('a tela de topo compartilhado MONTA o componente, e o componente usa o `PageHeader`', () => {
    /**
     * A outra metade do contrato: declarar o módulo não basta. A tela tem de
     * montar o componente que desenha o topo, e o módulo tem de usar o topo único
     * — senão a "delegação" viraria uma porta dos fundos para a dívida.
     */
    for (const [arquivo, { modulo, motivo }] of Object.entries(TOPO_COMPARTILHADO)) {
      const fonte = semComentarios(ler(arquivo));
      const componente = semComentarios(ler(modulo));

      expect(fonte, `${arquivo} não monta o componente do topo (${modulo})`).toMatch(
        /<PublicEventList[\s/>]/,
      );
      expect(fonte, `${arquivo} passou a desenhar o próprio topo`).not.toContain('<h1');

      expect(componente, `${modulo} não usa o PageHeader`).toContain('<PageHeader');
      expect(componente, `${modulo} escreve um <h1> à mão`).not.toContain('<h1');
      expect(componente, `${modulo} não é um page.tsx`).not.toMatch(/\/page\.tsx$/);

      expect(motivo.length, `topo compartilhado sem motivo: ${arquivo}`).toBeGreaterThan(40);
    }
  });

  it('a allowlist tem motivo escrito, aponta para arquivo existente e não guarda tela migrada', () => {
    for (const [arquivo, motivo] of Object.entries(ALLOWLIST)) {
      expect(PAGINAS, `allowlist aponta para arquivo inexistente: ${arquivo}`).toContain(arquivo);
      expect(motivo.length, `allowlist sem motivo: ${arquivo}`).toBeGreaterThan(40);

      // Se a tela já usa o componente, a exceção ficou para trás: ela mente.
      expect(
        semComentarios(ler(arquivo)).includes('<PageHeader'),
        `a allowlist guarda uma tela JÁ migrada: ${arquivo}`,
      ).toBe(false);
    }
  });

  it('o motivo da exceção é de UMA das três famílias declaradas', () => {
    /**
     * O que fica de fora tem de caber em: tema do evento, herói de marketing,
     * renderizador próprio/redirect. Um motivo que não caia em nenhuma delas é
     * uma tela pública esquecida com uma frase bonita ao lado.
     */
    const familias = [/tema do evento/i, /herói de marketing/i, /redireciona|renderizador/i];

    for (const [arquivo, motivo] of Object.entries(ALLOWLIST)) {
      expect(
        familias.some((familia) => familia.test(motivo)),
        `motivo fora das três famílias: ${arquivo} — "${motivo}"`,
      ).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O eyebrow de cada grupo
// ───────────────────────────────────────────────────────────────────────────────
describe('o `eyebrow` vem da fonte única de cada grupo (FASE 78)', () => {
  it('(app): os quatro grupos da instituição, de `TENANT_NAV_GROUPS`', () => {
    /**
     * Duas coisas de uma vez:
     *   • nenhuma tela escreve `eyebrow="Operação"` — o grupo sai de
     *     `TENANT_NAV_GROUPS`, definido em `tenant-nav.tsx`;
     *   • o valor é uma das quatro chaves do menu, e não um rótulo inventado na
     *     hora (um quinto "grupo" seria uma segunda lista, que envelhece sozinha).
     */
    const doPainel = MIGRADAS.filter((arquivo) => arquivo.startsWith(GRUPO_APP));
    /**
     * A vitrine (`/superadmin/design`) fica de fora da regra de literal: ela
     * DEMONSTRA o componente e escreve os valores de amostra à mão de propósito
     * ("Operação", "Minha participação"). As telas reais não podem.
     */
    const literal = MIGRADAS.filter(
      (arquivo) =>
        arquivo !== 'src/app/superadmin/design/page.tsx' && /eyebrow=(?:"|')/.test(ler(arquivo)),
    );

    expect(literal, `eyebrow literal em:\n${literal.join('\n')}`).toEqual([]);

    const infratores = doPainel.filter((arquivo) => {
      const fonte = semComentarios(ler(arquivo));
      return (
        !fonte.includes('TENANT_NAV_GROUPS') ||
        !/eyebrow=\{TENANT_NAV_GROUPS\.(?:geral|participacao|comite|operacao)\}/.test(fonte)
      );
    });

    expect(infratores, `eyebrow fora da fonte única em:\n${infratores.join('\n')}`).toEqual([]);
  });

  it('plataforma: `PLATFORM_NAV_GROUP` e a trilha começando na `PLATFORM_CRUMB`', () => {
    /**
     * A lista é DERIVADA da varredura de `/superadmin`: toda tela de governança
     * migrada tem o grupo da plataforma. A vitrine (`/superadmin/design`) e o
     * redirect (`/superadmin/page.tsx`) não são telas de governança e ficam de
     * fora — a vitrine mostra o componente, não é uma tela de operação.
     */
    const plataforma = MIGRADAS.filter(
      (arquivo) =>
        arquivo.startsWith('src/app/superadmin/') && arquivo !== 'src/app/superadmin/design/page.tsx',
    );

    expect(plataforma.length, 'a varredura da plataforma não pode passar vazia').toBe(8);

    const infratores = plataforma.filter((arquivo) => {
      const fonte = semComentarios(ler(arquivo));
      return !fonte.includes('eyebrow={PLATFORM_NAV_GROUP}') || !fonte.includes('PLATFORM_CRUMB');
    });

    expect(infratores, `plataforma sem o grupo/trilha da fonte única:\n${infratores.join('\n')}`).toEqual([]);
  });

  it('autenticação: NENHUM eyebrow e NENHUMA trilha inventada', () => {
    /**
     * O grupo de autenticação não é navegação de instituição: login, cadastro,
     * recuperação de senha e a área de conta não pertencem a um "lugar" do menu.
     * A regra é explícita — título e descrição, sem inventar hierarquia.
     */
    const infratores = AUTENTICACAO.filter((arquivo) => {
      const fonte = semComentarios(ler(arquivo));
      return fonte.includes('eyebrow=') || fonte.includes('breadcrumbs=');
    });

    expect(infratores, `auth com eyebrow/trilha:\n${infratores.join('\n')}`).toEqual([]);
  });

  it('estado: `Plataforma` onde o serviço é da plataforma; silêncio onde é sessão', () => {
    const comGrupo = ESTADO_DE_PLATAFORMA.filter(
      (arquivo) => !semComentarios(ler(arquivo)).includes('eyebrow={PLATFORM_NAV_GROUP}'),
    );
    const semGrupo = ESTADO_DE_SESSAO.filter((arquivo) =>
      semComentarios(ler(arquivo)).includes('eyebrow='),
    );

    expect(comGrupo, `estado de plataforma sem o grupo:\n${comGrupo.join('\n')}`).toEqual([]);
    expect(semGrupo, `estado de sessão com grupo inventado:\n${semGrupo.join('\n')}`).toEqual([]);
  });

  it('o rótulo "Plataforma" é declarado UMA vez, e nenhuma tela o escreve à mão', () => {
    /**
     * A prova de que a constante é ÚNICA: uma declaração no módulo de navegação
     * (o mesmo que monta a navegação da plataforma) e nenhuma tela com
     * `eyebrow="Plataforma"`. O texto pode aparecer em prosa, nunca como rótulo
     * de grupo.
     */
    expect(TENANT_NAV.match(/export const PLATFORM_NAV_GROUP = 'Plataforma' as const;/g)).toHaveLength(1);

    const literais = MIGRADAS.filter((arquivo) => /eyebrow=(?:"|')Plataforma(?:"|')/.test(ler(arquivo)));
    expect(literais, `rótulo solto em:\n${literais.join('\n')}`).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A FATIA 4 — as públicas
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As telas públicas que a fatia 4 migrou (a oitava, a lista de eventos, está em
 * `TOPO_COMPARTILHADO` porque o topo dela mora no componente).
 *
 * O critério da fatia, que os testes abaixo prendem:
 *   • o topo vem do componente, e o nome da INSTITUIÇÃO não é `eyebrow` — a casca
 *     pública já o mostra, e a linha do topo é a única que pode dizer onde a
 *     pessoa está;
 *   • os `data-testid` públicos não somem (`public-*`, `invitation-*`,
 *     `shared-card-*`, `profile-*`, `sponsor-*`, `unsubscribe-*`);
 *   • ninguém ganha `'use client'` por causa do topo (o componente é server).
 */
const PUBLICAS_DA_FATIA = [
  'src/app/404-tenant/page.tsx',
  'src/app/t/[tenantSlug]/(public)/carta/[token]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/descadastro/[token]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/palestrante/convite/page.tsx',
  'src/app/t/[tenantSlug]/(public)/patrocinador/convite/page.tsx',
  'src/app/t/[tenantSlug]/(public)/patrocinio/[code]/page.tsx',
  'src/app/t/[tenantSlug]/(public)/u/[username]/page.tsx',
] as const;

describe('as públicas da fatia 4 — o topo, o eyebrow e os testids (FASE 78)', () => {
  it('as 7 usam o `PageHeader`, não escrevem `<h1>` e continuam server', () => {
    for (const arquivo of PUBLICAS_DA_FATIA) {
      const fonte = semComentarios(ler(arquivo));

      expect(fonte, `${arquivo} não usa <PageHeader>`).toContain('<PageHeader');
      expect(fonte, `${arquivo} ainda escreve <h1>`).not.toContain('<h1');
      expect(fonte, `${arquivo} ganhou 'use client'`).not.toContain("'use client'");
      expect(fonte, `${arquivo} não tem <main>`).toContain('<main');
    }
  });

  it('NENHUMA pública põe o nome da instituição no `eyebrow`', () => {
    /**
     * O defeito que a fatia veio matar: `eyebrow` era o nome da instituição em 7
     * públicas, repetindo o que o `PublicHeader` já mostra. O teste lê a
     * EXPRESSÃO passada ao slot — não a prosa — e reprova se ela citar a casa.
     */
    const daInstituicao = /\b(?:tenant|page|state|qr|tenantName)\b.*\bname\b|\btenantName\b/;

    for (const arquivo of PUBLICAS_DA_FATIA) {
      const fonte = semComentarios(ler(arquivo));
      const expressoes = [...fonte.matchAll(/eyebrow=\{([^}]*)\}/g)].map((casamento) =>
        casamento[1] ?? '',
      );

      for (const expressao of expressoes) {
        expect(
          daInstituicao.test(expressao),
          `${arquivo} põe o nome da instituição no eyebrow: eyebrow={${expressao}}`,
        ).toBe(false);
      }
    }
  });

  it('os `data-testid` do topo passam pelo componente (e não somem)', () => {
    const contrato: [string, string[]][] = [
      ['src/app/t/[tenantSlug]/(public)/carta/[token]/page.tsx', [
        'titleTestId="shared-card-title"',
        'descriptionTestId="shared-card-owner"',
      ]],
      ['src/app/t/[tenantSlug]/(public)/u/[username]/page.tsx', [
        'titleTestId="profile-name"',
        'data-testid="profile-handle"',
        'data-testid="profile-hidden-reason"',
      ]],
      ['src/app/t/[tenantSlug]/(public)/palestrante/convite/page.tsx', [
        'data-testid="invite-code-present"',
      ]],
      ['src/app/t/[tenantSlug]/(public)/patrocinador/convite/page.tsx', [
        'data-testid="invite-login"',
      ]],
      ['src/app/t/[tenantSlug]/(public)/patrocinio/[code]/page.tsx', [
        'data-testid="sponsor-scan"',
        'data-testid="scan-login"',
      ]],
      ['src/app/t/[tenantSlug]/(public)/descadastro/[token]/page.tsx', [
        'data-testid="unsubscribe-state"',
        'data-testid="unsubscribe-state-value"',
        'data-testid="unsubscribe-keeps-list"',
        'data-testid="unsubscribe-actions"',
        'data-testid="unsubscribe-back-to-events"',
      ]],
    ];

    for (const [arquivo, testids] of contrato) {
      const fonte = semComentarios(ler(arquivo));

      for (const testid of testids) {
        expect(fonte, `${arquivo} perdeu ${testid}`).toContain(testid);
      }
    }
  });

  it('a lista pública de eventos continua com o testid do fallback da casa', () => {
    /**
     * O `tenant-events-fallback` fica no `<main>` que o `TenantHome` desenha — o
     * `PublicEventList` é o CONTEÚDO e não pode ganhar um landmark próprio (a
     * catraca da F60 reprova dois). A asserção prende os dois lados de uma vez.
     */
    const casa = ler('src/components/tenancy/tenant-page.tsx');
    const lista = semComentarios(ler('src/components/tenancy/public-event-list.tsx'));

    expect(casa).toContain('data-testid="tenant-events-fallback"');
    expect(lista).not.toContain('<main');
    expect(lista).toContain('data-testid="events-pagination"');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Os grupos da instituição (a fonte única da fatia 2)
// ───────────────────────────────────────────────────────────────────────────────
describe('os grupos de navegação da instituição — a fonte única (FASE 78)', () => {
  it('os quatro rótulos são declarados UMA vez, em `tenant-nav.tsx`', () => {
    for (const [chave, rotulo] of [
      ['geral', 'Geral'],
      ['participacao', 'Minha participação'],
      ['comite', 'Comitê científico'],
      ['operacao', 'Operação'],
    ]) {
      expect(TENANT_NAV, `o grupo ${chave} sumiu da fonte`).toContain(`${chave}: '${rotulo}'`);
    }
  });

  it('o menu e o topo leem a MESMA constante (o menu não tem strings paralelas)', () => {
    /**
     * `buildTenantNav` monta os títulos dos grupos com a constante — se alguém
     * voltar a escrever `title: 'Operação'` aqui, o menu e o eyebrow passam a ter
     * duas fontes e podem divergir sem nenhum outro teste reclamar.
     */
    const titulos = TENANT_NAV.match(/title: TENANT_NAV_GROUPS\.[a-z]+/g) ?? [];

    expect(titulos).toHaveLength(4);
    expect(TENANT_NAV).not.toMatch(/title: '(?:Geral|Minha participação|Comitê científico|Operação)'/);
  });
});
