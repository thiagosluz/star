/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — ACESSIBILIDADE (dívida H5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O projeto tem sistema de design, testes de unidade e 166 testes E2E — e nenhum
 *  deles perguntava se a tela pode ser USADA por quem navega por teclado, por leitor
 *  de tela ou com baixa visão. O `docs/design-system.md` recomenda a varredura desde
 *  a FASE 2 e ela nunca existiu: acessibilidade sem catraca vira intenção, e
 *  intenção não sobrevive à pressa de uma fase.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A VARREDURA REPROVA — E O QUE ELA NÃO REPROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Roda o `axe-core` no HTML que o servidor entregou (já hidratado) e **reprova** em
 *  impacto `critical` e `serious` — o que impede alguém de usar a tela. `moderate` e
 *  `minor` NÃO reprovam: viraria uma lista de preferências que ninguém lê, e o
 *  objetivo aqui é o portão, não o relatório.
 *
 *  As tags são as do padrão **WCAG AA (2.0, 2.1 e 2.2)**. `best-practice` fica de
 *  fora de propósito (ordem de títulos, região): não impede o uso, e misturar
 *  recomendação com requisito é o caminho mais rápido para alguém desligar o teste.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MENSAGEM DO ERRO DIZ O QUE CORRIGIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Falha de acessibilidade sem o seletor é meia informação: quem lê o CI precisa
 *  saber QUAL regra, em QUAL elemento e o que a regra espera. O helper monta isso
 *  (id, impacto, descrição, seletores e o link da regra) em vez de despejar o JSON
 *  do axe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NENHUMA ISENÇÃO GENÉRICA — A ISENÇÃO É POR NÓ, NÃO POR REGRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `disableRules('color-contrast')` calaria a regra INTEIRA, inclusive num texto
 *  cinza que ninguém consegue ler. O que existe aqui é isenção **por elemento**: só
 *  o nó que usa o token de aviso é dispensado, e qualquer OUTRA falha de contraste
 *  continua reprovando o build. A isenção também é CONTADA e impressa — dívida
 *  silenciosa é dívida esquecida.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createRoom,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
} from './helpers';
import { createDemand } from '../../src/lib/events/demand-service';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';
import { favoriteActivity } from '../../src/lib/events/agenda-service';
import {
  publishTenantPublicPage,
  saveTenantPublicPageDraft,
} from '../../src/lib/tenancy/tenant-public-page-write-service';
import {
  unsubscribePerson,
  unsubscribeUrlFor,
} from '../../src/lib/communication/unsubscribe-service';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'acessibilidade';

/** Só o que IMPEDE o uso da tela reprova (ver o cabeçalho). */
const IMPACTOS_REPROVADOS = ['critical', 'serious'] as const;

/**
 * Isenções — por ELEMENTO e com o motivo medido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A DÍVIDA DO TOKEN DE AVISO FOI PAGA (FASE 52) — E ESTA LISTA ESTÁ VAZIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A varredura da FASE 50 mediu, aqui mesmo, que `text-warning-strong` (`#d97706`)
 *  dava **2,89:1** sobre `bg-warning-soft` (`#fff2e4`) e 4,15:1 sobre a superfície
 *  escura do telão: um valor único não serve às duas superfícies, e por isso estes
 *  nós foram isentos enquanto o token não fosse separado.
 *
 *  Ele foi separado — `warning-strong` (`#92400e`) para painéis claros e
 *  `warning-strong-on-dark` (`#fcd34d`) para o telão, ambos presos por teste em
 *  `tests/unit/f52-warning-contrast.test.ts`. **Não há mais nada isentado**: qualquer
 *  violação de `color-contrast`, em qualquer nó, reprova o portão.
 *
 *  A lista e o teto continuam existindo porque o mecanismo é bom: isenção por NÓ (e
 *  nunca `disableRules`, que calaria a regra inteira), com o motivo medido escrito ao
 *  lado. Quem precisar isentar algo no futuro passa a ter onde declarar — e o teto de
 *  duas linhas obriga a justificar.
 */
const ISENCOES: readonly { id: string; classeAncestral: string; motivo: string }[] = [];

/** Teto das isenções: passar disso deixou de ser exceção e virou configuração. */
const MAX_ISENCOES = 2;

interface NodeResumo {
  alvo: string;
  html: string;
}

interface ViolacaoResumo {
  id: string;
  impacto: string;
  ajuda: string;
  descricao: string;
  url: string;
  nodes: NodeResumo[];
}

/**
 * Varre a tela atual e reprova o que impediria alguém de usá-la.
 *
 * Devolve também quantos NÓS foram isentos, para o relatório do CI dizer o tamanho da
 * dívida em vez de escondê-la.
 */
async function expectNoCriticalViolations(page: Page, tela: string): Promise<{ isentos: number }> {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A VARREDURA ESPERA O MOVIMENTO PARAR (FASE 50)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O axe lê a cor COMPUTADA de cada nó. No meio de uma transição de `opacity` ou de
   *  uma animação de entrada, o valor lido é o do instante — e a mesma tela passa numa
   *  execução e reprova na seguinte (aconteceu: a varredura do diretório reprovou uma
   *  vez e passou nas outras duas). Não era violação: era corrida.
   *
   *  `reducedMotion: 'reduce'` usa o caminho que o PRÓPRIO produto tem para movimento
   *  reduzido (o CSS do projeto já o respeita), e o estilo desliga transições e
   *  animações que o app não cobre. O portão não fica mais frouxo: fica determinístico
   *  — violação de contraste que exista de verdade continua reprovando.
   */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  E ESPERA O DOM PARAR DE MUDAR (FASE 50)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A segunda metade da corrida: com a máquina sob carga, o axe analisava a página
   *  ENQUANTO o React ainda trocava o conteúdo que veio por streaming — e reprovava
   *  regra de um DOM que não é o que a pessoa vê. O sintoma era o pior possível: a
   *  MESMA tela passando três vezes e falhando na quarta.
   *
   *  `MutationObserver` com 120 ms de silêncio é a espera determinística: continua
   *  assim que o DOM para, e não "espera 2 segundos para ver se resolve". As fontes
   *  entram junto porque o layout depende delas.
   */
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts?.ready;

    await new Promise<void>((resolve) => {
      let timer = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 120);

      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 120);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    });
  });

  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const reprovadas: ViolacaoResumo[] = [];
  let isentos = 0;

  for (const violacao of resultado.violations) {
    if (!(IMPACTOS_REPROVADOS as readonly string[]).includes(violacao.impact ?? '')) continue;

    const isencao = ISENCOES.find((item) => item.id === violacao.id);
    const nodes = violacao.nodes.map((node) => ({
      alvo: node.target.map((alvo) => String(alvo)).join(' '),
      html: node.html,
    }));

    /**
     * A isenção olha para o ELEMENTO e seus ANCESTRAIS no navegador, e não para o HTML
     * do próprio nó: quem falha é o `<p>` interno, e a cor vem de um invólucro com o
     * token (`text-warning-strong`) — o HTML do nó não traz a classe, e casar por texto
     * deixaria a isenção sem efeito (foi o primeiro erro desta varredura).
     */
    const restantes = isencao
      ? (
          await Promise.all(
            nodes.map(async (node) => {
              const seletor = node.alvo.split(' >>> ').pop() ?? node.alvo;
              const herdado = await page
                .evaluate(
                  (dados) => {
                    try {
                      const elemento = document.querySelector(dados.seletor);
                      return Boolean(elemento?.closest('.' + dados.classe));
                    } catch {
                      return false;
                    }
                  },
                  { seletor, classe: isencao.classeAncestral },
                )
                .catch(() => false);

              return herdado ? null : node;
            }),
          )
        ).filter((node): node is NodeResumo => node !== null)
      : nodes;

    isentos += nodes.length - restantes.length;

    if (restantes.length === 0) continue;

    reprovadas.push({
      id: violacao.id,
      impacto: violacao.impact ?? 'desconhecido',
      ajuda: violacao.help,
      descricao: violacao.description,
      url: violacao.helpUrl,
      nodes: restantes,
    });
  }

  if (isentos > 0) {
    /**
     * O aviso fica no log de propósito: quem for corrigir a paleta precisa saber que a
     * isenção AINDA está sendo usada (e onde).
     */
    console.log(
      `[a11y] ${tela}: ${isentos} nó(s) isento(s) — dívida do token de aviso (ver ISENCOES)`,
    );
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  E O LANDMARK: EXATAMENTE UM `<main>` POR TELA (ADR-290 · FASE 60)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A FASE 52 tirou o `<main>` da casca e o devolveu às páginas — e **16 páginas
   *  ficaram sem NENHUM** (a dívida I2). O `axe` não reprova landmark ausente (é boa
   *  prática, e não critério do AA), então sem esta linha a varredura ficaria VERDE
   *  numa tela sem landmark nenhum.
   *
   *  A pergunta é feita ao DOM, e nos DOIS sentidos: ZERO pega a página que não tem o
   *  seu `<main>`; DOIS pega a casca voltando a ser landmark — o defeito original
   *  (achado H5), que não pode renascer em silêncio.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A RÉGUA VOLTOU A SER ESTRITA, E O CONSERTO FOI NA CAUSA (FASE 64 · fatia 5)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Quando o editor da página da instituição passou a EMBUTIR a página pública
   *  inteira como prévia, o caso novo reprovou aqui com `Received: 2` — o `<main>` do
   *  editor e o da prévia. A primeira reação foi perguntar ao navegador se o elemento
   *  produz caixa (`checkVisibility()`), porque o `<main>` da prévia estava com
   *  `display: contents`. **Era um falso conserto**: `display: contents` tira a caixa,
   *  mas o nó continua na árvore de acessibilidade como região `main` em parte dos
   *  leitores de tela — a página seguia com dois "conteúdo principal".
   *
   *  A casa já tinha resolvido esse mesmo tipo de defeito pela CAUSA uma vez (foi
   *  assim na fatia 2, quando a catraca reprovou e o `<main>` saiu do ramo do
   *  fallback em vez de a catraca mudar). Aqui não foi diferente: a prévia passou a
   *  pedir `landmark="none"` ao `TenantPublicPage` e desenha um `<div>` — ela não é o
   *  conteúdo principal da tela do editor, é um pedaço do formulário.
   *
   *  Com isso a régua voltou a ser a ESTRITA: `page.locator('main')` e nada mais. Ela
   *  continua pegando, nos dois sentidos, o que sempre pegou — e sem depender de
   *  nenhuma propriedade de estilo.
   *
   *  Vem ANTES do retorno antecipado de propósito: dentro do caminho de falha, a
   *  catraca só rodaria em tela já reprovada.
   */
  await expect
    .soft(page.locator('main'), `Landmarks <main> em ${tela}: esperado exatamente 1`)
    .toHaveCount(1);

  if (reprovadas.length === 0) return { isentos };

  const detalhe = reprovadas
    .map((violacao) => {
      const alvos = violacao.nodes
        .map((node) => `      ${node.alvo}\n        <${node.html.slice(0, 180)}>`)
        .join('\n');

      return [
        `  ✗ ${violacao.id} (${violacao.impacto}) — ${violacao.ajuda}`,
        `    o que corrigir: ${violacao.descricao}`,
        `    elementos (${violacao.nodes.length}):`,
        alvos,
        `    regra: ${violacao.url}`,
      ].join('\n');
    })
    .join('\n\n');

  expect
    .soft(
      reprovadas.map((violacao) => violacao.id),
      `Acessibilidade em ${tela}: ${reprovadas.length} violação(ões) de impacto crítico/sério\n\n${detalhe}\n`,
    )
    .toEqual([]);

  return { isentos };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fixture: uma instituição com uma pessoa da equipe (a tela autenticada precisa de
//  vínculo E papel — vínculo sem papel não chega ao painel; lição da FASE 25).
// ───────────────────────────────────────────────────────────────────────────────
let tenantSlug: string;
/**
 * O `id` da instituição da fixture.
 *
 * O `createTenant` do helper devolve o `id`, mas o endereço de descadastro precisa
 * dele FORA do `beforeAll` — e guardá-lo aqui evita uma segunda leitura do banco (e
 * uma consulta a `tenant` fora do contexto de instituição) no meio do caso.
 */
let tenantId: string;
let adminEmail: string;
/** O `id` da administradora — é ela que a fixture da FASE 67 inscreve na atividade. */
let adminId: string;
/** O evento do quadro de demandas (FASE 57) e a pessoa que o administra. */
let eventId: string;
/** A conta de PLATAFORMA: a fila de denúncias só abre para SuperAdmin (FASE 56 · E62). */
let superEmail: string;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS TELAS DA FASE 65 ACHAM CONTEÚDO AQUI (fatia 5)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Duas telas novas entram no portão, e as duas medem MAIS quando têm o que
 *  mostrar:
 *
 *    • **"minha agenda"** (`/t/<slug>/minha-agenda`) — o resumo, as DUAS marcas
 *      (`Inscrito` × `Favorito`) e o bloco de choque de horário. Uma agenda vazia
 *      desenha uma frase e nenhum distintivo: a varredura mediria bem menos do que
 *      a tela mostra;
 *    • **a aba "Acontecendo agora"** (`?aba=agora`) — o agrupamento por sala, o
 *      cartão em curso, a barra de progresso com os atributos ARIA e os dois
 *      caminhos (crachá e balcão). Sem uma atividade cuja janela CONTÉM o agora, a
 *      aba desenha o estado vazio — e a barra, que é a peça com o `role` e o
 *      contraste medido, nem existiria no DOM.
 */
/** O evento EM CURSO: a janela dele contém o agora (é ele que hospeda a aba). */
let eventoEmCursoSlug: string;
/**
 * O evento da fixture da FASE 65 (o das duas atividades em choque) — e o dono da aba
 * "Programação", que entra no portão na FASE 66. O `slug` é o que falta para alcançar
 * a página pública: os outros casos desta tela usam o `id` (a "minha agenda" recebe
 * `?evento=<id>`), mas a página do evento é aberta pelo `slug`.
 */
let eventoSlug: string;
/** A atividade EM CURSO — começou há vinte minutos e termina em quarenta. */
let atividadeEmCursoId: string;
/** A sala onde ela acontece: é o nome do grupo na aba. */
const SALA_EM_CURSO = `Auditório A11y ${RUN_ID}`;
/** As duas atividades que DISPUTAM o mesmo horário (o choque da minha agenda). */
let atividadeLongaId: string;
let atividadeInternaId: string;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS SUPERFÍCIES DO ENDEREÇO DA SALA ONLINE (FASE 68 · fatia 5)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A fase criou o ESCRITOR da coluna e desenhou o endereço em três lugares. Cada um
 *  tem um `data-testid` próprio, e os três entram na varredura:
 *
 *   • `evento-sala-online`  — o bloco de LOCAL da página pública (`VenueBlock`);
 *   • `agora-sala-online-<id>` — o cartão do "acontecendo agora" (`NowCard`);
 *   • `atividade-sala-online`  — a página da atividade.
 *
 *  Os endereços são DISTINTOS de propósito: se um vazasse para o lugar do outro, a
 *  asserção diria QUAL vazou em vez de só acusar "tem um link ali".
 */
const ENDERECO_DO_EVENTO = `https://sala.exemplo.test/evento-${RUN_ID}`;
const ENDERECO_DA_ATIVIDADE = `https://sala.exemplo.test/atividade-${RUN_ID}`;
/** A sala em curso do evento dedicado — o grupo dela na aba é o nome desta constante. */
const SALA_ONLINE = `Sala virtual A11y ${RUN_ID}`;
const ATIVIDADE_ONLINE_TITULO = 'Oficina transmitida ao vivo';
/**
 * O EVENTO DEDICADO a estas três superfícies — em curso, com página PUBLICADA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM EVENTO SÓ PARA ISSO (e não pendurar no evento em curso da F65)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O bloco de LOCAL (`VenueBlock`) só é renderizado quando o evento tem PÁGINA
 *  PUBLICADA com o bloco `VENUE_MAP`: sem página, a landing cai na composição padrão
 *  (Sobre + Programação) e o bloco nem existe no DOM — a varredura passaria verde
 *  medindo uma tela em que o nó da fase não está. Publicar a página do evento da F65
 *  mudaria o layout das OUTRAS duas varreduras dele (a aba "Programação" da F66, por
 *  exemplo, mede a composição padrão) e quebraria catracas alheias ao assunto.
 *
 *  Um evento próprio, com a própria página, resolve os dois: o bloco existe, e
 *  nenhuma outra varredura muda de desenho. Ele é um SEGUNDO evento em curso na
 *  vitrine da instituição, e é por isso que os casos que contam cartões por grupo
 *  continuam presos ao evento da F65.
 */
let eventoDaSalaSlug: string;
/** A atividade em curso DESTE evento — o `agora-item-<id>` que o portão mede. */
let atividadeDaSalaId: string;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O EVENTO DE TEMA ESCURO (FASE 69 · a quitação da E84)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A COBERTURA QUE FALTAVA — E POR QUE ELA FALTAVA EM SILÊNCIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todas as varreduras de tela do EVENTO deste arquivo mediam o **tema padrão**
 *  (`colorMode: 'light'`) com o visitante no claro — as duas metades claras. O par que
 *  a dívida E84 registrava desabava exatamente na combinação que ninguém media:
 *  **organizador escuro** com o visitante claro, onde o token de texto da PLATAFORMA
 *  (claro) era desenhado sobre a superfície escura que o organizador escolheu —
 *  **2,10:1** na `--ef-background` e **1,86:1** no `.ef-card`, contra os 4,5:1 do AA.
 *
 *  A FASE 69 consertou isso pela causa (o escopo do evento passou a republicar os papéis
 *  semânticos no modo do TEMA) e mediu o antes e o depois com o `axe`. Este caso é a
 *  metade que faltava do PORTÃO: sem ele, o defeito poderia voltar amanhã e a varredura
 *  continuaria verde, porque nenhum dos 26 casos abria um evento escuro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM EVENTO PRÓPRIO (a terceira vez que esta suíte faz isso)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Trocar o tema do evento que a F65/F66/F68 medem mudaria o desenho de QUATRO
 *  varreduras alheias ao assunto (as duas abas, o bloco de local e o "agora com sala
 *  online") — e uma delas mede justamente o contraste do rótulo de seção sobre a
 *  `--ef-background` do organizador. Um evento próprio muda UM caso e nenhum outro.
 *
 *  O evento nasce EM CURSO (de ontem a amanhã) porque a aba do "agora" só desenha
 *  atividade cuja janela contém o instante: um evento futuro desenharia o estado vazio,
 *  e o nó que a dívida media (`agora-legenda`) nem existiria no DOM.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
let eventoEscuroSlug: string;
/** A atividade em curso do evento escuro — o cartão que a varredura precisa encontrar. */
let atividadeEscuraId: string;
/** A sala dela: é o nome do grupo na aba. */
const SALA_ESCURA = `Auditório Noturno A11y ${RUN_ID}`;
const ATIVIDADE_ESCURA_TITULO = 'Mesa redonda noturna sobre avaliação';

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `a11y.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  return { id: user.id, email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/**
 * Cria um evento com a JANELA de datas pedida (FASE 64).
 *
 * O `createEvent` do helper ancora tudo em "daqui a N dias" e serve à maioria das
 * fixtures; aqui a JANELA é o que decide o grupo em que o evento aparece na página da
 * instituição ("em breve", "acontecendo agora", "edições anteriores"), então ela
 * precisa ser dita. O evento nasce pelo contexto de instituição, como todo dado de
 * tenant.
 */
async function criarEventoComJanela(input: {
  tenantId: string;
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** O endereço da sala online do EVENTO (FASE 68) — sem ele o bloco de LOCAL não anuncia nada. */
  onlineUrl?: string | null;
  /**
   * O TEMA do organizador (FASE 69 · E84): o `colorMode` é o que decide a rampa.
   *
   * Ele existe porque a dívida E84 só se manifesta num modo — e a varredura precisa
   * poder montar a fixture do modo que ninguém media (ver `eventoEscuroSlug`).
   */
  theme?: object;
}): Promise<string> {
  const id = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.event.create({
      data: {
        id,
        tenantId: input.tenantId,
        slug: input.slug,
        title: input.title,
        summary: 'Evento criado para a varredura de acessibilidade da FASE 64.',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: 'America/Bahia',
        city: 'Salvador',
        state: 'BA',
        capacity: null,
        confirmedCount: 0,
        onlineUrl: input.onlineUrl ?? null,
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 30 * 86_400_000),
        theme: input.theme,
      },
    });
  });

  /** O `id` volta porque a FASE 65 pendura a atividade em curso no evento EM CURSO. */
  return id;
}

/**
 * A inscrição CONFIRMADA de alguém numa atividade — fixture direta, pelo banco.
 *
 * O caminho da tela é da fatia irmã e tem spec própria; aqui a inscrição é o FATO
 * que a varredura precisa ENCONTRAR na grade. Sem ela, "minha agenda" não teria a
 * marca `Inscrito` nem o par em choque — e o portão mediria uma tela mais pobre do
 * que a que a pessoa usa.
 */
async function inscreverNaAtividade(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  userId: string;
}): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'CONFIRMED',
      },
    });
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição Acessível ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;
    tenantId = tenant.id;

    const admin = await signUpVia(api, 'Administradora Acessível');
    adminEmail = admin.email;
    adminId = admin.id;

    await linkUser({ userId: admin.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId: tenant.id, role: 'ADMIN', scope: 'TENANT' });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  AS TELAS DA FASE 56 E DA FASE 57 ENTRAM NO PORTÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O quadro de demandas foi varrido na FASE 50 como UMA tela (o Kanban). Ele passou
     *  a ter três vistas (FASE 57), e cada uma desenha o que a outra não desenha — eixo,
     *  barra, célula de mês. A fila de denúncias (FASE 56) tem o formulário de decisão,
     *  que é onde rótulo ausente e contraste ruim aparecem.
     *
     *  As fixtures são criadas aqui para a varredura encontrar a tela COM conteúdo: uma
     *  fila vazia e um Gantt sem barra não provam nada sobre o que a tela mostra.
     */
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `acessivel-${RUN_ID}`,
      title: `Evento Acessível ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      capacity: 100,
    });

    eventId = event.id;
    eventoSlug = `acessivel-${RUN_ID}`;

    const hoje = new Date();
    const demandaBase = {
      tenantId: tenant.id,
      eventId: event.id,
      actorId: admin.id,
    };

    /** Uma barra que ATRAVESSA o período e vence no mês corrente. */
    await createDemand({
      ...demandaBase,
      title: 'Confirmar os crachás da portaria',
      priority: 'HIGH',
      startAt: new Date(hoje.getTime() - 2 * 86_400_000),
      dueAt: hoje,
    });

    /** Um marco: começa e vence no mesmo dia (a barra de um dia do Gantt). */
    await createDemand({
      ...demandaBase,
      title: 'Imprimir a lista de presença',
      startAt: new Date(hoje.getTime() - 86_400_000),
      dueAt: new Date(hoje.getTime() + 5 * 86_400_000),
    });

    /** Sem prazo nenhum: é a faixa "sem data" das duas vistas. */
    await createDemand({
      ...demandaBase,
      title: 'Revisar o texto de abertura',
    });

    /** A conta de plataforma e UMA denúncia na fila (o formulário de decisão). */
    const superAdmin = await signUpVia(api, 'SuperAdmin Acessível');
    superEmail = superAdmin.email;
    await grantPlatformRole({ userId: superAdmin.id });

    await e2eDb.user.update({
      where: { id: admin.id },
      data: { publicHandle: `acessivel-${RUN_ID}` },
    });

    await reportPublicProfile({
      tenantId: tenant.id,
      reporterUserId: superAdmin.id,
      username: `acessivel-${RUN_ID}`,
      category: 'SPAM',
      details: 'Denúncia criada pela varredura de acessibilidade para a fila ter conteúdo.',
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PÁGINA PÚBLICA DA INSTITUIÇÃO ENTRA NO PORTÃO (FASE 64)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A FASE 64 deu à instituição uma página própria em `/t/<slug>` (capa, identidade,
     *  os três grupos de eventos e blocos) e um editor em `/t/<slug>/administracao/pagina`.
     *  Nenhuma das duas telas tinha varredura: a página é NOVA e o editor desenha a
     *  página inteira outra vez, na prévia.
     *
     *  A fixture publica a página PELO SERVIÇO REAL (`saveTenantPublicPageDraft` +
     *  `publishTenantPublicPage`): é o mesmo caminho da fatia 1, e é o que garante que
     *  o portão mede o que o editor produz — e não uma linha montada à mão.
     */
    const pagina = await saveTenantPublicPageDraft({
      tenantId: tenant.id,
      actorId: admin.id,
      title: `Instituição Acessível ${RUN_ID}`,
      description: 'A casa dos cursos de graduação e pós-graduação, aberta ao público.',
      coverImageUrl: null,
      theme: { primaryColor: '#7b2ff7' },
      blocks: [
        {
          type: 'ABOUT',
          content: {
            title: 'Nossa história',
            foundedLabel: '1946',
            body: 'Fundada em 1946, a casa reúne cursos de graduação e pós-graduação.',
          },
        },
        { type: 'RICH_TEXT', content: { title: 'Como chegar', body: 'A portaria abre às 7h.' } },
        { type: 'PAST_EVENTS', content: { title: 'Edições anteriores', limit: 3 } },
        {
          type: 'CONTACT',
          content: {
            title: 'Contato e localização',
            address: 'Rua das Artes, 100 — Salvador/BA',
            email: 'secretaria@acessivel.test',
            phone: '(71) 3333-4444',
          },
        },
        {
          type: 'FAQ',
          content: {
            title: 'Perguntas frequentes',
            items: [
              { question: 'Preciso me inscrever?', answer: 'Sim, a inscrição é gratuita.' },
            ],
          },
        },
        {
          type: 'CUSTOM_HTML',
          content: { title: 'Aviso', html: '<p>Este HTML aparece como texto.</p>' },
        },
      ],
    });

    if (!pagina.ok) throw new Error(`Falha ao gravar a página: ${pagina.message}`);

    const publicada = await publishTenantPublicPage({ tenantId: tenant.id, actorId: admin.id });

    if (!publicada.ok) throw new Error(`Falha ao publicar a página: ${publicada.message}`);

    /**
     * Os três grupos precisam de evento em CADA um: um grupo vazio desenha uma frase
     * e nenhum cartão, e a varredura mediria menos do que a tela mostra. As janelas
     * são relativas ao agora porque é o INSTANTE que decide o grupo (o agrupador do
     * domínio) — data fixa faria o cenário mentir no dia seguinte.
     */
    await criarEventoComJanela({
      tenantId: tenant.id,
      slug: `acessivel-antigo-${RUN_ID}`,
      title: 'Mostra do ano passado',
      startsAt: new Date(hoje.getTime() - 30 * 86_400_000),
      endsAt: new Date(hoje.getTime() - 25 * 86_400_000),
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  AS DUAS TELAS DA FASE 65 — O CONTEÚDO QUE A VARREDURA PRECISA ENCONTRAR
     * ─────────────────────────────────────────────────────────────────────────────
     *  (1) A ABA "ACONTECENDO AGORA" precisa de uma atividade cuja JANELA CONTÉM o
     *  agora e de uma SALA (é a sala que dá nome ao grupo, e o "a seguir nesta sala"
     *  só existe quando há uma próxima). Ela é pendurada no evento que JÁ está em
     *  curso na vitrine ("Semana de portas abertas", de ontem a amanhã): um evento
     *  que está acontecendo e uma atividade que está acontecendo é o cenário
     *  coerente — e é o estado em que a pessoa realmente abre a aba.
     */
    const eventoEmCursoId = await criarEventoComJanela({
      tenantId: tenant.id,
      slug: `acessivel-em-curso-${RUN_ID}`,
      title: 'Semana de portas abertas',
      startsAt: new Date(hoje.getTime() - 86_400_000),
      endsAt: new Date(hoje.getTime() + 86_400_000),
    });

    eventoEmCursoSlug = `acessivel-em-curso-${RUN_ID}`;

    const sala = await createRoom({
      tenantId: tenant.id,
      eventId: eventoEmCursoId,
      name: SALA_EM_CURSO,
      capacity: 80,
    });

    /** Em curso DE VERDADE: começou há vinte minutos e termina daqui a quarenta. */
    atividadeEmCursoId = (
      await createActivity({
        tenantId: tenant.id,
        eventId: eventoEmCursoId,
        slug: `acessivel-agora-${RUN_ID}`,
        title: 'Mesa redonda sobre avaliação por pares',
        roomId: sala.id,
        startsAtOffsetDays: -20 / (24 * 60),
        workloadMinutes: 60,
      })
    ).id;

    /** A PRÓXIMA da mesma sala: é ela que dá conteúdo ao "a seguir nesta sala". */
    await createActivity({
      tenantId: tenant.id,
      eventId: eventoEmCursoId,
      slug: `acessivel-proxima-${RUN_ID}`,
      title: 'Oficina de rubricas',
      roomId: sala.id,
      startsAtOffsetDays: 1 / 24,
      workloadMinutes: 60,
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O EVENTO DEDICADO AO ENDEREÇO DA SALA ONLINE (FASE 68 · fatia 5)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A fase deu ESCRITOR à coluna `Event.onlineUrl` e pôs o endereço em TRÊS
     *  superfícies novas: o bloco de LOCAL da página pública (`VenueBlock`), o cartão
     *  do "acontecendo agora" (`NowCard`) e a página da atividade. Nenhuma das três
     *  tinha histórico de varredura, e as três são LINKS dentro de cartão — a família
     *  exata do defeito da FASE 66 (o rótulo que media 4,44:1 sobre a
     *  `--ef-background` do organizador e sobreviveu porque a tela onde ele mora não
     *  era medida).
     *
     *  ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE UM EVENTO PRÓPRIO, E NÃO PENDURAR ISTO NO EVENTO EM CURSO DA F65
     *  ─────────────────────────────────────────────────────────────────────────────
     *  Duas razões, e a primeira é a que reprovou a varredura:
     *
     *   1. o bloco de LOCAL só existe quando o evento tem PÁGINA PUBLICADA com o bloco
     *      `VENUE_MAP` (sem página, a landing cai na composição padrão). Publicar a
     *      página do evento da F65 trocaria o desenho das OUTRAS duas varreduras dele
     *      — o caso "aba Programação" da F66 mede justamente a composição padrão;
     *   2. duas atividades em curso no MESMO evento multiplicam os `agora-barra`
     *      (um por cartão) e os `agora-cracha-*`/`agora-balcao-*`, e as catracas do
     *      portão e da regressão visual afirmam contagens EXATAS. Uma segunda atividade
     *      aqui quebraria asserções alheias ao assunto desta fase.
     *
     *  O evento nasce EM CURSO (de ontem a amanhã) porque a aba do "agora" e o cartão
     *  dela só desenham atividade cuja janela contém o instante: um evento futuro
     *  desenharia o estado vazio e a varredura mediria menos do que a tela mostra.
     */
    const eventoDaSalaId = await criarEventoComJanela({
      tenantId: tenant.id,
      slug: `acessivel-sala-${RUN_ID}`,
      title: 'Jornada de transmissão ao vivo',
      startsAt: new Date(hoje.getTime() - 86_400_000),
      endsAt: new Date(hoje.getTime() + 86_400_000),
      onlineUrl: ENDERECO_DO_EVENTO,
    });

    eventoDaSalaSlug = `acessivel-sala-${RUN_ID}`;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A PÁGINA PUBLICADA COM OS DOIS BLOCOS QUE A VARREDURA PRECISA
     * ─────────────────────────────────────────────────────────────────────────────
     *  `SCHEDULE` desenha o CARTÃO DA ATIVIDADE (onde o endereço da atividade
     *  aparece) e `VENUE_MAP` é o bloco de LOCAL (o `VenueBlock`). Uma página
     *  configurada SUBSTITUI a composição padrão, então os dois entram: publicar só o
     *  `VENUE_MAP` deixaria a programação de fora.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      const page = await tx.eventPage.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          eventId: eventoDaSalaId,
          slug: 'principal',
          title: 'Página do evento',
          isHome: true,
          isPublished: true,
        },
      });

      for (const [ordem, tipo] of (['SCHEDULE', 'VENUE_MAP'] as const).entries()) {
        await tx.pageBlock.create({
          data: {
            id: randomUUID(),
            tenantId: tenant.id,
            pageId: page.id,
            type: tipo,
            content: {},
            style: {},
            displayOrder: ordem,
            isVisible: true,
          },
        });
      }
    });

    const salaOnline = await createRoom({
      tenantId: tenant.id,
      eventId: eventoDaSalaId,
      name: SALA_ONLINE,
      capacity: 40,
    });

    atividadeDaSalaId = (
      await createActivity({
        tenantId: tenant.id,
        eventId: eventoDaSalaId,
        slug: `acessivel-online-${RUN_ID}`,
        title: ATIVIDADE_ONLINE_TITULO,
        roomId: salaOnline.id,
        startsAtOffsetDays: -15 / (24 * 60),
        workloadMinutes: 60,
        onlineUrl: ENDERECO_DA_ATIVIDADE,
      })
    ).id;

    /** E a inscrição CONFIRMADA da administradora NESTA atividade: o "quem tem direito". */
    await inscreverNaAtividade({
      tenantId: tenant.id,
      eventId: eventoDaSalaId,
      activityId: atividadeDaSalaId,
      userId: admin.id,
    });

    /**
     * A PRÓXIMA da MESMA sala do evento dedicado — sem ela o grupo desenha só o cartão
     * em curso e a tela mede menos do que mostra.
     */
    await createActivity({
      tenantId: tenant.id,
      eventId: eventoDaSalaId,
      slug: `acessivel-sala-proxima-${RUN_ID}`,
      title: 'Oficina de transmissão',
      roomId: salaOnline.id,
      startsAtOffsetDays: 1 / 24,
      workloadMinutes: 60,
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O EVENTO DE TEMA ESCURO (FASE 69 · E84) — a combinação que o portão não media
     * ─────────────────────────────────────────────────────────────────────────────
     *  O organizador declara `colorMode: 'dark'` e o visitante entra no CLARO (o padrão
     *  de quem nunca escolheu): é exatamente o par que media **2,10:1** sobre a
     *  `--ef-background` e **1,86:1** sobre o `.ef-card` antes do conserto da FASE 69, e
     *  é o par em que ele era invisível para este arquivo — todos os outros casos de
     *  evento abrem o tema PADRÃO (claro).
     *
     *  A cor primária entra junto para o tema ser o do ORGANIZADOR de verdade (e não
     *  só o modo trocado): a página do evento publica a identidade dele, e é sobre ela
     *  que os papéis semânticos da plataforma precisam se ajeitar.
     */
    eventoEscuroSlug = `acessivel-escuro-${RUN_ID}`;

    const eventoEscuroId = await criarEventoComJanela({
      tenantId: tenant.id,
      slug: eventoEscuroSlug,
      title: 'Mostra noturna de avaliação',
      startsAt: new Date(hoje.getTime() - 86_400_000),
      endsAt: new Date(hoje.getTime() + 86_400_000),
      theme: { colorMode: 'dark', primaryColor: '#7c3aed', accentColor: '#0f766e' },
    });

    const salaEscura = await createRoom({
      tenantId: tenant.id,
      eventId: eventoEscuroId,
      name: SALA_ESCURA,
      capacity: 40,
    });

    atividadeEscuraId = (
      await createActivity({
        tenantId: tenant.id,
        eventId: eventoEscuroId,
        slug: `acessivel-escuro-atividade-${RUN_ID}`,
        title: ATIVIDADE_ESCURA_TITULO,
        roomId: salaEscura.id,
        startsAtOffsetDays: -15 / (24 * 60),
        workloadMinutes: 60,
      })
    ).id;

    /**
     * (2) "MINHA AGENDA" precisa das DUAS marcas e de um CHOQUE. As duas atividades
     * nascem no MESMO instante (o mesmo deslocamento de dias) com durações
     * diferentes: a palestra cai DENTRO do minicurso, e `intervalsOverlap` responde
     * choque por CONTER — a borda decidida na fatia 1 (encostar não é choque).
     */
    atividadeLongaId = (
      await createActivity({
        tenantId: tenant.id,
        eventId: event.id,
        slug: `acessivel-longa-${RUN_ID}`,
        title: 'Minicurso de avaliação por pares',
        startsAtOffsetDays: 30,
        workloadMinutes: 240,
      })
    ).id;

    atividadeInternaId = (
      await createActivity({
        tenantId: tenant.id,
        eventId: event.id,
        slug: `acessivel-interna-${RUN_ID}`,
        title: 'Palestra sobre rubricas',
        startsAtOffsetDays: 30,
        workloadMinutes: 60,
      })
    ).id;

    /**
     * As duas marcas são gravadas pelo SERVIÇO REAL onde ele existe: o favorito passa
     * por `favoriteActivity` (a régua da fatia 1 — atividade visível, evento público,
     * RLS no meio). A inscrição não tem serviço de fixture aqui, e vai pelo banco,
     * como o resto das fixtures deste arquivo.
     */
    const favorito = await favoriteActivity({
      tenantId: tenant.id,
      userId: admin.id,
      activityId: atividadeLongaId,
    });

    if (!favorito.ok) throw new Error(`Falha ao favoritar: ${favorito.message}`);

    await inscreverNaAtividade({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: atividadeInternaId,
      userId: admin.id,
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** A lista de isenções é exceção, não configuração. */
test('a lista de isenções continua curta', () => {
  expect(
    ISENCOES.length,
    `Isenções de acessibilidade: ${ISENCOES.map((item) => `${item.id} (${item.classeAncestral})`).join(', ')}`,
  ).toBeLessThanOrEqual(MAX_ISENCOES);
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('telas públicas', () => {
  test('a landing da plataforma não tem violação crítica', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    await expectNoCriticalViolations(page, 'landing da plataforma (/)');
  });

  test('a tela de login não tem violação crítica', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible();

    await expectNoCriticalViolations(page, 'login (/login)');
  });

  test('a validação pública de certificado não tem violação crítica', async ({ page }) => {
    /**
     * O código inexistente é o caso mais comum da vida real (link digitado errado,
     * certificado revogado) — e é a tela que um TERCEIRO abre sem login. Se o estado
     * de erro não for acessível, quem depende de leitor de tela não sabe o resultado.
     */
    await page.goto(`/validar/CERT-INEXISTENTE-${RUN_ID}`);
    await expect(page.locator('body')).toBeVisible();

    await expectNoCriticalViolations(page, 'validação pública (/validar/<code>)');
  });

  test('o diretório público de instituições não tem violação crítica', async ({ page }) => {
    await page.goto('/organizacoes');
    await expect(page.locator('body')).toBeVisible();

    await expectNoCriticalViolations(page, 'diretório de instituições (/organizacoes)');
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A PÁGINA PÚBLICA DA INSTITUIÇÃO TAMBÉM PASSA PELO PORTÃO (FASE 64)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `/t/<slug>` deixou de ser um redirect para o painel e virou a VITRINE da casa:
   *  capa, identidade, os três grupos de eventos e até seis tipos de bloco, todos
   *  desenhados ali pela primeira vez. Nada disso tinha histórico de varredura, e é
   *  a superfície mais exposta do produto — quem chega de um link compartilhado NÃO
   *  tem sessão, e a página é a única chance de a instituição ser encontrada.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O CASO AFIRMA O CONTEÚDO ANTES DE VARRER
   * ─────────────────────────────────────────────────────────────────────────────
   *  O `axe` mede o que está no DOM, e "o grupo sumiu" não é violação de regra
   *  nenhuma: uma página que perdesse os cartões, os blocos ou o controle de
   *  aparência passaria IGUAL. As asserções abaixo prendem o conteúdo da fixture — os
   *  três grupos com o evento certo em cada um, os blocos publicados e a peça da
   *  FASE 63 no rodapé —, e só então a varredura mede a tela que existe.
   */
  test('a página pública da instituição não tem violação crítica', async ({ page }) => {
    await page.goto(`/t/${tenantSlug}`);

    await expect(page.getByTestId('tenant-public-page')).toBeVisible();
    await expect(page.getByTestId('tenant-page-title')).toHaveText(
      `Instituição Acessível ${RUN_ID}`,
    );

    /**
     * Os TRÊS grupos, com conteúdo em cada — nenhum deles vazio.
     *
     * ─────────────────────────────────────────────────────────────────────────────
     *  O GRUPO "ACONTECENDO AGORA" TEM TRÊS CARTÕES DESDE A FASE 69
     * ─────────────────────────────────────────────────────────────────────────────
     *  A contagem subiu DUAS vezes, e cada uma por um evento que precisa estar EM CURSO
     *  para a varredura medir o que quer medir:
     *
     *    • **FASE 68 (fatia 5)** — o evento dedicado ao endereço da sala online
     *      (`eventoDaSalaSlug`) nasce em curso porque é a janela que faz a aba do "agora"
     *      e o cartão dela desenharem: 1 → 2;
     *    • **FASE 69 (E84)** — o evento de TEMA ESCURO (`eventoEscuroSlug`) nasce em
     *      curso pelo mesmo motivo, e é o único jeito de o portão medir a combinação que
     *      a dívida registrava (organizador escuro × visitante claro): 2 → 3.
     *
     *  Os outros dois grupos continuam com um. A contagem explícita é o que mantém esta
     *  asserção útil: um grupo que esvaziasse continuaria "passando" se a régua fosse só
     *  `> 0`, e um evento novo que ninguém contasse reprova aqui — que foi exatamente o
     *  que aconteceu quando a fixture do tema escuro entrou.
     */
    await expect(
      page.getByTestId('tenant-group-upcoming').getByTestId('tenant-event-card'),
    ).toHaveCount(1);
    await expect(
      page.getByTestId('tenant-group-ongoing').getByTestId('tenant-event-card'),
    ).toHaveCount(3);
    await expect(page.getByTestId('tenant-group-past').getByTestId('tenant-event-card')).toHaveCount(
      1,
    );

    /** Os blocos: o `ABOUT` publicado, o histórico automático e o contato. */
    await expect(page.getByText('Fundada em 1946, a casa reúne cursos')).toBeVisible();
    await expect(page.locator('#edicoes-anteriores')).toContainText('Mostra do ano passado');
    await expect(page.getByText('secretaria@acessivel.test')).toBeVisible();

    /**
     * O controle de aparência do VISITANTE vive no rodapé DESTA página (FASE 63/64) e
     * fica FORA do escopo do tema da instituição — é ele que garante que a paleta da
     * casa não mata o claro/escuro de quem lê.
     */
    const controle = page.locator('footer').getByTestId('theme-choice');

    await expect(controle).toBeVisible();
    await expect(controle.locator('[aria-pressed="true"]')).toHaveCount(1);

    await expectNoCriticalViolations(page, `página pública da instituição (/t/${tenantSlug})`);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O CONTROLE DE APARÊNCIA DO VISITANTE TAMBÉM PASSA PELO PORTÃO (FASE 63)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A FASE 63 pôs no rodapé das páginas públicas da PLATAFORMA uma peça nova: um
   *  `<form>` com três `<button name="tema">` que funciona sem JavaScript, dentro de
   *  um `role="group"` nomeado pelo texto VISÍVEL ("Aparência:"). Nada disso tinha
   *  histórico de varredura — e as três coisas que o `axe` reprova e que esta peça
   *  pode quebrar sozinha são exatamente as que o desenho usa: contraste (o texto
   *  mudo ao lado de três botões, um deles com o preenchimento de `primary`), nome
   *  acessível do conjunto (o `aria-labelledby` apontando para um `id`) e rótulo de
   *  cada botão.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE A VARREDURA EXISTENTE DA RAIZ NÃO BASTAVA
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O primeiro caso deste bloco (`a landing da plataforma não tem violação
   *  crítica`) varre `/` — e passaria IGUAL se o controle não existisse: o `axe`
   *  mede o que está no DOM, e "o controle sumiu" não é violação de regra nenhuma.
   *  Por isso estes dois casos AFIRMAM a peça antes de varrer (o `<form>` dentro do
   *  `<footer>`, os três estados e EXATAMENTE um com `aria-pressed="true"`) e varrem
   *  o tema ESCOLHIDO, e não o sistema operacional da máquina que roda a suíte.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O MODO ESCURO, E POR QUE O DIRETÓRIO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A FASE 61 varreu o modo escuro do PAINEL autenticado — e nada mais: a escala
   *  escura das páginas públicas nunca foi medida aqui, e é onde o rodapé da FASE 63
   *  vive. O cookie `ef_tema=escuro` entra ANTES do `goto` (o mesmo caminho do caso
   *  do painel escuro): o servidor desenha o escuro na PRIMEIRA resposta, e o `axe`
   *  lê a paleta de verdade em vez de um tema aplicado depois pelo cliente.
   *
   *  O diretório entra porque é a outra superfície do mesmo controle: ali o rodapé
   *  fica depois de uma vitrine de CARTÕES (`bg-card`, texto mudo, botão `primary`)
   *  e de um formulário de busca — e a busca é o que traz a instituição DESTA
   *  execução para a tela (`q=<slug da fixture>`), em vez de uma página de vitrine
   *  emprestada de execuções anteriores.
   */
  test('a raiz pública com o controle de aparência no rodapé não tem violação crítica', async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto('/');
    /** A prova de que quem entregou o escuro foi o SERVIDOR, e não o cliente. */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    const controle = page.locator('footer').getByTestId('theme-choice');

    await expect(controle, 'o controle de aparência não está no rodapé de `/`').toBeVisible();
    await expect(controle).toContainText('Aparência:');
    await expect(controle.getByRole('button')).toHaveCount(3);
    await expect(controle.getByRole('group')).toHaveAccessibleName(/Aparência/);

    /** E o estado atual é UM só: três botões idênticos não respondem "qual vale?". */
    await expect(controle.locator('[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByTestId('theme-option-escuro')).toHaveAttribute('aria-pressed', 'true');

    await expectNoCriticalViolations(
      page,
      'raiz pública com o controle de aparência (/ · ef_tema=escuro)',
    );
  });

  test('o diretório público com o controle de aparência no rodapé não tem violação crítica', async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    /**
     * A busca recorta a vitrine para a instituição DESTA execução (`createTenant`
     * deriva o slug de `RUN_ID`): o cenário mede o diretório COM o cartão que ele
     * mesmo criou, e não o que outra execução deixou na página 1.
     */
    await page.goto(`/organizacoes?q=acessibilidade-${RUN_ID}`);
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    const cartoes = page.getByTestId('directory-card');

    await expect(cartoes, 'a vitrine não mostrou a instituição da fixture').toHaveCount(1);
    await expect(cartoes.first()).toContainText(`Instituição Acessível ${RUN_ID}`);

    const controle = page.locator('footer').getByTestId('theme-choice');

    await expect(controle, 'o controle de aparência não está no rodapé do diretório').toBeVisible();
    await expect(controle.locator('[aria-pressed="true"]')).toHaveCount(1);

    await expectNoCriticalViolations(
      page,
      `diretório público com o controle de aparência (/organizacoes?q=acessibilidade-${RUN_ID} · ef_tema=escuro)`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('telas autenticadas', () => {
  test('o painel da instituição não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/dashboard`);
    /**
     * `.last()` porque a CASCA do painel também é um `<main>` e a página traz o dela:
     * são DOIS landmarks `main` na mesma página — achado desta varredura, registrado no
     * relatório da dívida H5. Não é violação de WCAG AA (landmark único é
     * `best-practice`), então o portão não reprova; a correção é estrutural, no shell,
     * e mexe em todas as telas autenticadas de uma vez.
     */
    await expect(page.getByRole('main').last()).toBeVisible();

    await expectNoCriticalViolations(page, `painel da instituição (/t/${tenantSlug}/dashboard)`);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A BARRA RECOLHIDA TAMBÉM PASSA PELO PORTÃO (FASE 59)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A varredura anterior mede a barra INTEIRA. A recolhida é outra tela para o
   *  `axe`: o rótulo de cada item sai da área visível (vira `sr-only`), o bloco de
   *  contexto e o de conta perdem o texto, e é exatamente aí que um link sem nome
   *  acessível (`link-name`) aparece — o defeito que esta varredura existe para
   *  prender.
   *
   *  O cookie é gravado ANTES do `goto` de propósito: a barra precisa nascer
   *  recolhida no HTML do servidor, que é como a pessoa a encontra quando volta ao
   *  painel. Recolher por clique mediria o estado depois de uma hidratação, e não
   *  o que o servidor entrega.
   */
  test('o painel com a barra recolhida não tem violação crítica', async ({ page, baseURL }) => {
    await signInAs(page, adminEmail);

    await page.context().addCookies([
      { name: 'ef_nav', value: 'rail', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenantSlug}/dashboard`);
    await expect(page.locator('aside[data-nav]')).toHaveAttribute('data-nav', 'rail');

    /**
     * Os itens do menu continuam nomeados MESMO sem o rótulo desenhado — e é isto
     * que a varredura confirma por outro caminho (o `axe` reprova `link-name`).
     */
    await expect(
      page.locator('aside[data-nav]').getByRole('link', { name: 'Painel', exact: true }),
    ).toHaveAccessibleName('Painel');

    await expectNoCriticalViolations(
      page,
      `painel com a barra recolhida (/t/${tenantSlug}/dashboard · ef_nav=rail)`,
    );

    /**
     * A barra volta ao estado normal para o resto do arquivo: o cookie é do
     * CONTEXTO do navegador, e um teste seguinte que abrisse o painel mediria a
     * barra recolhida sem ter pedido.
     */
    await page.context().addCookies([
      { name: 'ef_nav', value: 'full', url: baseURL ?? 'http://localhost:3000' },
    ]);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  E O MODO ESCURO TAMBÉM PASSA PELO PORTÃO (FASE 61 · dívida H3)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Até aqui toda varredura deste arquivo media UMA paleta: a clara, que é o `:root`
   *  de sempre. O modo noturno traz um conjunto NOVO de pares texto/fundo — e nenhum
   *  deles tem histórico de medição.
   *
   *  O navegador entra com a escolha JÁ gravada (`ef_tema=escuro`, o mesmo cookie que o
   *  layout raiz lê no servidor), então a página chega escura desde a primeira
   *  resposta: o `axe` mede a paleta escura de verdade, e não um tema aplicado depois
   *  por JavaScript — que é justamente o que não queremos que exista.
   */
  test('o painel em modo escuro não tem violação crítica', async ({ page, baseURL }) => {
    await signInAs(page, adminEmail);

    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenantSlug}/dashboard`);
    /** A prova de que o SERVIDOR entregou o escuro (e não o cliente, depois). */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    await expectNoCriticalViolations(
      page,
      `painel em modo escuro (/t/${tenantSlug}/dashboard · ef_tema=escuro)`,
    );

    /**
     * A paleta volta à CLARA para o resto do arquivo: o cookie é do CONTEXTO do
     * navegador, e um teste seguinte mediria o escuro sem ter pedido. `claro` é
     * escolha explícita de propósito: sem cookie o modo é o do SISTEMA, e a varredura
     * passaria a depender da preferência da máquina que roda a suíte.
     */
    await page.context().addCookies([
      { name: 'ef_tema', value: 'claro', url: baseURL ?? 'http://localhost:3000' },
    ]);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O EDITOR DA PÁGINA DA INSTITUIÇÃO (FASE 64 · fatias 3 e 4)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A tela de administração é a outra metade da fase, e é a mais densa das duas: ela
   *  traz formulários de identidade e de paleta, dois envios de imagem, a lista de
   *  blocos com quatro ações cada, o guia dos tipos de bloco e — o que mais importa
   *  aqui — a PRÉVIA DA PÁGINA INTEIRA, desenhada pelo MESMO componente do visitante.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A PRÉVIA DO EDITOR NÃO TRAZ UM SEGUNDO `<main>` (FASE 64 · fatia 5)
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O `TenantPublicPage` desenha o `<main>` dele — e deve desenhar: na página
   *  pública ele É o conteúdo, e é exatamente um. Dentro do editor, a prévia o traria
   *  como SEGUNDO landmark, e a tela ficaria com dois "conteúdo principal" para quem
   *  navega por leitor de tela. O conserto é na CAUSA: a prévia pede
   *  `landmark="none"` e desenha um `<div>` (ver o comentário longo em
   *  `administracao/pagina/page.tsx`). O que a prévia MOSTRA não mudou: mesmos filhos,
   *  mesmas classes, mesmo `data-testid`.
   *
   *  Por isso a régua do landmark continua a ESTRITA (`page.locator('main')`, um só),
   *  sem depender de nenhuma propriedade de estilo: ZERO continua pegando a tela sem o
   *  seu conteúdo, e DOIS continua pegando a casca voltando a ser landmark — o defeito
   *  H5 da FASE 52.
   *
   *  O caso é o mesmo que a própria fase escreveu no spec do editor
   *  (`f64-editor-da-pagina.spec.ts`, bloco (d)): um portão que não roda não é portão,
   *  e aqui ele roda junto com os outros dezesseis.
   */
  test('o editor da página da instituição não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/administracao/pagina`);

    await expect(page.getByTestId('tenant-page-status')).toBeVisible();
    await expect(page.getByTestId('tenant-block-editor')).toBeVisible();
    await expect(page.getByTestId('tenant-page-preview-banner')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `editor da página da instituição (/t/${tenantSlug}/administracao/pagina)`,
    );
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS DUAS TELAS DA FASE 65 ENTRAM NO PORTÃO (fatia 5)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A fase entregou duas superfícies novas, e nenhuma delas tinha varredura:
   *
   *    • **"minha agenda"** (`/t/<slug>/minha-agenda`) — a grade do dia com as duas
   *      marcas, o resumo e o bloco de choque. É uma tela DENSA para o padrão desta
   *      suíte: quatro contadores num `<dl>`, cartões com três botões cada (link,
   *      `.ics`, Google, favoritar), duas seções com `aria-labelledby` e um aviso com
   *      `role="note"`. É onde falta de rótulo e contraste fora do token aparecem;
   *    • **a aba "Acontecendo agora"** (`/t/<slug>/eventos/<slug>?aba=agora`) — a
   *      primeira peça do produto com `role="progressbar"` e `aria-valuetext`, dentro
   *      do `ThemeScope` do evento. A barra é o que o `axe` pode reprovar sozinho: um
   *      preenchimento sobre um trilho sem contraste é violação de componente.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O CASO DO "AGORA" ENTRA COM SESSÃO (e não como visitante)
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A aba é pública, mas ela desenha DOIS caminhos que só existem para quem tem o
   *  que fazer ali: "Abrir o meu crachá" (exige sessão) e "Abrir o balcão de
   *  credenciamento" (exige `registration:checkin`, conferida no servidor). Varrer a
   *  versão anônima mediria um DOM MENOR — e os dois links são justamente os nós que
   *  esta varredura existe para prender (link sem nome acessível, contraste do
   *  `currentColor` do tema). Com a administradora (que tem a permissão), a varredura
   *  mede a UNIÃO do que a tela pode desenhar. A régua do landmark continua a mesma:
   *  a página herda UM `<main>` da `EventLanding`.
   */
  test('a tela "minha agenda" não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/minha-agenda?evento=${eventId}`);

    /** A tela é a CERTA e tem conteúdo — os quatro números que a fixture montou. */
    await expect(page.getByRole('heading', { level: 1, name: 'Minha agenda' })).toBeVisible();
    await expect(page.getByTestId('minha-agenda')).toBeVisible();
    await expect(page.getByTestId('resumo-itens')).toHaveText('2');
    await expect(page.getByTestId('resumo-inscritas')).toHaveText('1');
    await expect(page.getByTestId('resumo-favoritas')).toHaveText('1');
    await expect(page.getByTestId('resumo-choques')).toHaveText('1');

    /** As DUAS marcas, cada uma no seu cartão — é a leitura de relance da grade. */
    await expect(page.getByTestId(`agenda-item-${atividadeLongaId}`)).toHaveAttribute(
      'data-mark',
      'FAVORITO',
    );
    await expect(page.getByTestId(`agenda-item-${atividadeInternaId}`)).toHaveAttribute(
      'data-mark',
      'INSCRITO',
    );

    /** E o choque, com os dois títulos: o aviso que INFORMA e não bloqueia nada. */
    await expect(page.getByTestId('minha-agenda-choques-secao')).toBeVisible();
    await expect(page.getByTestId(`choque-${atividadeInternaId}`)).toBeVisible();

    /**
     * O caminho de exportação está na tela e é um LINK de verdade: a fatia 3 tirou o
     * download do estado de cliente, e a varredura mede o `<a>` que a pessoa usa.
     */
    await expect(page.getByTestId('minha-agenda-exportacao')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `minha agenda (/t/${tenantSlug}/minha-agenda?evento=<id>)`,
    );
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A ABA "PROGRAMAÇÃO" ENTRA NO PORTÃO (FASE 66) — E ELA JÁ TINHA UM DEFEITO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A FASE 65 fechou a aba "Acontecendo agora" neste portão e deixou registrado, com
   *  o número na mão, que a aba "Programação" estava FORA dele — e que o `eyebrow` do
   *  `SectionHeading` (o rótulo "Programação") media **4,44:1** sobre a
   *  `--ef-background` do organizador, abaixo dos 4,5:1 do AA. O defeito sobreviveu
   *  por UM motivo: a tela onde ele mora não era medida. Este caso é a outra metade da
   *  correção (a catraca de unidade é `tests/unit/f66-contraste-do-rotulo.test.ts`).
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O CASO AFIRMA O CONTEÚDO ANTES DE VARRER
   * ─────────────────────────────────────────────────────────────────────────────
   *  O `axe` mede o que está no DOM. Se a aba perdesse a grade, ou se o cabeçalho de
   *  seção deixasse de ser desenhado, a varredura passaria IGUAL — e o nó que esta fase
   *  corrigiu nem estaria na página. Por isso as três asserções: a aba ATIVA (o
   *  `aria-current` vem do servidor, sem estado de cliente), a seção `#programacao` com
   *  o rótulo do cabeçalho, e as DUAS atividades da fixture na grade.
   */
  test('a aba "Programação" não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/eventos/${eventoSlug}`);

    /** A aba navegada é a ATIVA — e a irmã não é. */
    await expect(page.getByTestId('aba-programacao')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('aba-agora')).not.toHaveAttribute('aria-current', 'page');

    const programacao = page.locator('#programacao');

    await expect(programacao).toBeVisible();

    /**
     * O RÓTULO do cabeçalho de seção — o nó que a FASE 66 corrigiu. O `<header>` tem
     * DOIS `<p>` (o rótulo e a descrição), e o filtro por texto é o que diz qual deles
     * a asserção está medindo: contar "quantos `<p>` o cabeçalho tem" mediria o desenho,
     * não o fato.
     */
    const rotulo = programacao.locator('header p', { hasText: 'Programação' });

    await expect(rotulo).toHaveCount(1);
    await expect(rotulo).toHaveText('Programação');
    await expect(programacao).toContainText('Minicurso de avaliação por pares');
    await expect(programacao).toContainText('Palestra sobre rubricas');

    await expectNoCriticalViolations(
      page,
      `aba "programação" (/t/${tenantSlug}/eventos/<slug>)`,
    );
  });

  test('a aba "Acontecendo agora" não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/eventos/${eventoEmCursoSlug}?aba=agora`);

    /** A aba navegada é a ATIVA (link com `aria-current`, sem estado de cliente). */
    await expect(page.getByTestId('aba-agora')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('aba-programacao')).not.toHaveAttribute('aria-current', 'page');

    const secao = page.getByTestId('agora');

    await expect(secao).toBeVisible();
    await expect(page.getByTestId(`agora-sala-${SALA_EM_CURSO}`)).toBeVisible();
    await expect(page.getByTestId(`agora-item-${atividadeEmCursoId}`)).toContainText(
      'Mesa redonda sobre avaliação por pares',
    );

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A BARRA ACESSÍVEL — ESCOPADA AO CARTÃO DELA (FASE 68 · fatia 5)
     * ─────────────────────────────────────────────────────────────────────────────
     *  `role="progressbar"` SEM `aria-label` é exatamente o defeito que passa
     *  despercebido no olho e reprova no leitor de tela, e é o motivo de esta tela
     *  entrar no portão. A asserção é feita DENTRO do cartão (`agora-item-<id>`) e não
     *  na página: a aba pode ter MAIS de um cartão em curso, e `agora-barra` solto
     *  resolveria para o primeiro — ou, com dois, para nenhum (o `strict mode` do
     *  Playwright reprova, que foi como este caso nasceu vermelho quando a fixture
     *  ganhou uma segunda atividade).
     */
    const cartao = page.getByTestId(`agora-item-${atividadeEmCursoId}`);
    const barra = cartao.getByTestId('agora-barra');

    await expect(barra).toHaveAttribute('role', 'progressbar');
    await expect(barra).toHaveAttribute('aria-valuemin', '0');
    await expect(barra).toHaveAttribute('aria-valuemax', '100');
    await expect(barra).toHaveAttribute(
      'aria-label',
      'Tempo restante da atividade Mesa redonda sobre avaliação por pares',
    );
    await expect(cartao.getByTestId('agora-restante')).toHaveText(/termina em /);

    /** E os DOIS caminhos do dia do evento: o crachá e o balcão. */
    await expect(cartao.getByTestId(`agora-cracha-${atividadeEmCursoId}`)).toBeVisible();
    await expect(cartao.getByTestId(`agora-balcao-${atividadeEmCursoId}`)).toBeVisible();

    /** O que vem depois NA MESMA SALA — o "a seguir" que a visão por sala existe para dar. */
    await expect(page.getByTestId(`agora-proxima-${SALA_EM_CURSO}`)).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `aba "acontecendo agora" (/t/${tenantSlug}/eventos/<slug>?aba=agora)`,
    );
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  O ENDEREÇO DA SALA ONLINE NAS TRÊS SUPERFÍCIES (FASE 68 · fatia 5)
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ESTES CASOS EXISTEM
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A fase criou o ESCRITOR da coluna `Event.onlineUrl` e desenhou o endereço em
   *  TRÊS lugares, todos novos e nenhum com histórico de varredura:
   *
   *    • `evento-sala-online`      — o bloco de LOCAL da página pública (`VenueBlock`);
   *    • `agora-sala-online-<id>`  — o cartão do "acontecendo agora" (`NowCard`);
   *    • `atividade-sala-online`   — a página da atividade.
   *
   *  Os três são LINKS de texto pequeno — a família exata do defeito da FASE 66, onde
   *  um rótulo media 4,44:1 sobre a `--ef-background` e sobreviveu porque a tela onde
   *  ele mora não era medida. Nenhuma isenção nova entra por causa deles.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O CASO AFIRMA O CONTEÚDO ANTES DE VARRER
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O `axe` mede o que está no DOM, e "o link sumiu" não é violação de regra
   *  nenhuma: uma tela que perdesse o endereço passaria IGUAL. As asserções prendem
   *  o `href` e a presença de cada nó — e o `href` de cada um é DIFERENTE (o do
   *  evento e o da atividade), então a falha diz QUAL vazou para o lugar do outro.
   *
   *  A página do evento precisa de PÁGINA PUBLICADA com os blocos `SCHEDULE` e
   *  `VENUE_MAP`: sem ela a landing cai na composição padrão e o bloco de LOCAL nem
   *  existe. É por isso que a fixture tem um evento dedicado (`eventoDaSalaSlug`).
   */
  test('o bloco de local com a sala online não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/eventos/${eventoDaSalaSlug}`);

    /**
     * A administradora vê o endereço do EVENTO por ser EQUIPE dele
     * (`event:update`/`event:manage`, a régua de `seesEventOnlineRoom`) — ela é
     * `ADMIN` nesta instituição. É a metade da régua que o cartão do agora NÃO exercita:
     * lá quem abriu a porta foi a INSCRIÇÃO na atividade; aqui, a permissão.
     */
    const bloco = page.getByTestId('evento-sala-online');

    await expect(bloco).toBeVisible();
    await expect(bloco).toHaveAttribute('href', ENDERECO_DO_EVENTO);

    /** O bloco é o do LOCAL: o endereço físico continua ao lado, não no lugar dele. */
    await expect(page.locator('#local')).toContainText('Salvador');

    await expectNoCriticalViolations(
      page,
      `bloco de local com a sala online (/t/${tenantSlug}/eventos/<slug>)`,
    );
  });

  test('a aba "Acontecendo agora" com a sala online não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/eventos/${eventoDaSalaSlug}?aba=agora`);

    const cartao = page.getByTestId(`agora-item-${atividadeDaSalaId}`);

    await expect(cartao).toContainText(ATIVIDADE_ONLINE_TITULO);

    /**
     * O LINK NOVO DO CARTÃO, e a prova de que ele está no DOM. O endereço é o DA
     * ATIVIDADE — as duas projeções (`seesEventOnlineRoom` × `seesActivityOnlineRoom`)
     * são caminhos diferentes, e é isto que diz qual delas o cartão desenha.
     */
    const linkDaSala = cartao.getByTestId(`agora-sala-online-${atividadeDaSalaId}`);

    await expect(linkDaSala).toBeVisible();
    await expect(linkDaSala).toHaveAttribute('href', ENDERECO_DA_ATIVIDADE);
    await expect(linkDaSala).toHaveText(/Entrar na sala online/);

    /**
     * E o GRUPO da sala aparece na aba: `agora-sala-*` (o grupo) e
     * `agora-sala-online-*` (o cartão) são prefixos que se parecem, e afirmar os dois
     * separadamente é o que impede um de ser lido como o outro — o §4 do plano da fase
     * avisou que nome novo com prefixo parecido quebra a contagem da regressão visual.
     */
    await expect(page.getByTestId(`agora-sala-${SALA_ONLINE}`)).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `aba "acontecendo agora" com a sala online (/t/${tenantSlug}/eventos/<slug>?aba=agora)`,
    );
  });

  test('a página da atividade com a sala online não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(
      `/t/${tenantSlug}/eventos/${eventoDaSalaSlug}/atividades/acessivel-online-${RUN_ID}`,
    );

    /**
     * O link é o nó novo, e ele só existe porque a administradora tem lugar nesta
     * atividade (inscrição CONFIRMADA, criada na fixture). É a mesma régua do cartão
     * do agora, noutro desenho.
     */
    const link = page.getByTestId('atividade-sala-online');

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', ENDERECO_DA_ATIVIDADE);

    await expectNoCriticalViolations(
      page,
      `página da atividade com a sala online (/t/${tenantSlug}/eventos/<slug>/atividades/<slug>)`,
    );
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  O TEMA ESCURO DO ORGANIZADOR ENTRA NO PORTÃO (FASE 69 · a quitação da E84)
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A DÍVIDA QUE O PORTÃO NÃO ALCANÇAVA — E ISSO É O ACHADO, NÃO O CONSERTO
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A E84 registrava que o token de texto da PLATAFORMA desenhado dentro do tema do
   *  organizador desabava no modo escuro dele: **2,10:1** sobre a `--ef-background` e
   *  **1,86:1** sobre o `.ef-card`. O portão tinha 26 casos e passava — porque **todos
   *  os casos do evento abriam o tema PADRÃO (claro)** com o visitante no claro. É a
   *  mesma forma do defeito da FASE 66 ("o defeito não sobreviveu por ser sutil:
   *  sobreviveu porque a tela onde ele mora não era medida"), agora na dimensão do
   *  MODO.
   *
   *  Os dois casos abaixo cobrem as DUAS metades do par, uma por evento:
   *
   *    • **organizador ESCURO × visitante CLARO** — o par da medição original (2,10:1),
   *      no evento de tema escuro da fixture;
   *    • **organizador CLARO × visitante ESCURO** — o outro lado, medido em 1,62:1 e
   *      1,35:1 na mesma fase. Ele reusa o evento EM CURSO da FASE 65 e troca só o
   *      cookie do visitante: `ef_tema` é do CONTEXTO, e é o que faz a rampa da
   *      plataforma ser a escura dentro de um escopo de evento claro.
   *
   *  Nenhuma isenção nova, e nenhuma asserção de cor aqui: quem mede o número é a
   *  catraca de unidade da fase (`tests/unit/f69-contraste-do-tema-do-evento.test.ts`,
   *  18 casos). O que este portão prende é o que só o navegador sabe — que o nó existe,
   *  que ele herdou a rampa certa e que o `axe` não acha violação no par real.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O `agora-legenda` É AFIRMADO ANTES DE VARRER
   *  ─────────────────────────────────────────────────────────────────────────────
   *  Ele é o nó que a fase usou para MEDIR (o `<p class="text-sm text-muted-foreground">`
   *  do cabeçalho da aba): um token de TEXTO da plataforma dentro do escopo do evento.
   *  Sem afirmá-lo, uma aba que perdesse a legenda passaria verde — o `axe` não reprova
   *  a ausência de um nó, e a varredura mediria uma tela mais pobre do que a que a
   *  dívida descreve.
   */
  test('a aba "Acontecendo agora" num evento de tema ESCURO não tem violação crítica', async ({
    page,
  }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/eventos/${eventoEscuroSlug}?aba=agora`);

    /**
     * O modo do TEMA chegou ao servidor. O atributo vive no ESCOPO do evento
     * (`.ef-theme`, `theme-scope.tsx`) e não no `<html>`: é ele que faz o CSS reagir ao
     * claro/escuro do ORGANIZADOR sem lógica de cliente.
     */
    const escopo = page.locator('[data-theme-mode]');

    await expect(escopo).toHaveCount(1);
    await expect(escopo).toHaveAttribute('data-theme-mode', 'dark');

    const secao = page.getByTestId('agora');

    await expect(secao).toBeVisible();
    await expect(page.getByTestId(`agora-item-${atividadeEscuraId}`)).toContainText(
      ATIVIDADE_ESCURA_TITULO,
    );

    /**
     * O nó que a dívida media. Ele é `text-muted-foreground` (token da PLATAFORMA)
     * desenhado sobre a superfície do organizador — o par exato da E84.
     */
    const legenda = page.getByTestId('agora-legenda');

    await expect(legenda).toBeVisible();
    await expect(legenda).toContainText('em curso neste momento');

    await expect(page.getByTestId(`agora-sala-${SALA_ESCURA}`)).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `aba "acontecendo agora" com tema ESCURO do organizador (/t/${tenantSlug}/eventos/<slug>?aba=agora)`,
    );
  });

  test('a aba "Acontecendo agora" com o VISITANTE no escuro não tem violação crítica', async ({
    page,
    baseURL,
  }) => {
    await signInAs(page, adminEmail);

    /**
     * A escolha do visitante entra ANTES da navegação (o layout raiz lê o cookie no
     * servidor): a página chega com a rampa escura da plataforma desde a primeira
     * resposta, e não aplicada depois por JavaScript — que é o que não queremos.
     */
    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenantSlug}/eventos/${eventoEmCursoSlug}?aba=agora`);

    /** A prova de que o SERVIDOR entregou o escuro do visitante. */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    await expect(page.getByTestId('agora')).toBeVisible();
    await expect(page.getByTestId('agora-legenda')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `aba "acontecendo agora" com VISITANTE no escuro (/t/${tenantSlug}/eventos/<slug>?aba=agora · ef_tema=escuro)`,
    );

    /**
     * O cookie volta ao CLARO para o resto do arquivo: ele é do CONTEXTO do navegador, e
     * um caso seguinte mediria o escuro sem ter pedido. `claro` é escolha explícita de
     * propósito — sem cookie o modo é o do SISTEMA, e a suíte passaria a depender da
     * preferência da máquina que a roda (a mesma nota do caso do painel escuro da F61).
     */
    await page.context().addCookies([
      { name: 'ef_tema', value: 'claro', url: baseURL ?? 'http://localhost:3000' },
    ]);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A ABA "SEGMENTOS" E A PÁGINA DE DESCADASTRO ENTRAM NO PORTÃO (FASE 67)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A fase entregou duas superfícies novas, e nenhuma das duas tinha varredura:
   *
   *    • **a aba "Segmentos"** (`?aba=segmentos`) — o formulário `GET` com os campos
   *      que o CATÁLOGO declara (seleção, data, hora, número), o resultado com as
   *      frases explicativas, a prévia da lista e o passo de confirmação. É a tela
   *      mais densa da fase, e é onde rótulo ausente e contraste fora do token
   *      aparecem;
   *    • **a página de descadastro** (`/t/<slug>/descadastro/<token>`, SEM LOGIN) —
   *      a tela que a pessoa abre de um e-mail. É pública e é acessível por qualquer
   *      um que tenha o endereço, então ela é a superfície mais exposta da fase.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE OS CASOS AFIRMAM O CONTEÚDO ANTES DE VARRER
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O `axe` mede o que está no DOM, e "a tela esvaziou" não é violação de regra
   *  nenhuma. Sem as asserções, uma aba que perdesse o resultado — ou uma página que
   *  não desenhasse os dois blocos da promessa — passaria IGUAL, e o portão estaria
   *  medindo uma tela que ninguém usa.
   *
   *  O segmento entra MONTADO (a definição vai na URL, que é como a tela funciona) e
   *  COM RESULTADO: a administradora está inscrita na atividade da fixture, então a
   *  contagem é 1 e a lista tem uma pessoa. Um segmento sem resultado desenharia o
   *  estado vazio e nenhuma das frases.
   */
  test('a aba "Segmentos" da comunicação não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    const query = new URLSearchParams({
      aba: 'segmentos',
      segmento: '1',
      evento: eventId,
      c0: 'inscrito-na-atividade',
      p0_atividade: atividadeInternaId,
    });

    await page.goto(`/t/${tenantSlug}/administracao/comunicacao?${query.toString()}`);

    /** A aba certa está ativa, e a caixa de saída continua ao lado. */
    await expect(page.getByTestId('communication-tab-segmentos')).toHaveAttribute(
      'aria-current',
      'page',
    );

    /** O formulário com os campos que o CATÁLOGO declara — e o resultado com frases. */
    await expect(page.getByTestId('segment-form')).toBeVisible();
    await expect(page.locator('select[name="p0_atividade"]')).toBeVisible();
    await expect(page.getByTestId('segment-count')).toHaveText('1');
    await expect(page.getByTestId('segment-explanation')).toContainText(
      'Quem está inscrito na atividade',
    );
    await expect(page.getByTestId('segment-people')).toBeVisible();

    /**
     * O bloco dos MARCADORES é a peça de texto novo da fatia 3 (`{nome}`,
     * `{instituicao}`, `{evento}`), e ele só existe porque o formulário está na tela.
     */
    await expect(page.getByTestId('segment-marker-note')).toContainText('{nome}');
    await expect(page.getByTestId('segment-template-note')).toContainText('descadastro');

    await expectNoCriticalViolations(
      page,
      `aba "segmentos" da comunicação (/t/${tenantSlug}/administracao/comunicacao?aba=segmentos)`,
    );
  });

  /**
   * A PÁGINA DE DESCADASTRO, NOS DOIS ESTADOS (FASE 67 · fatia 3).
   *
   * É a tela SEM LOGIN: quem a abre vem de um e-mail, muitas vezes sem nunca ter
   * entrado na plataforma. Ela desenha o bloco de situação, os DOIS blocos da
   * promessa (o que para e o que continua) e os formulários — o de saída e o de
   * volta. Nada disso tinha histórico de varredura.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE SÃO DOIS CASOS, E NÃO UM
   * ─────────────────────────────────────────────────────────────────────────────
   *  Os dois estados desenham DOM DIFERENTE, e a diferença não é cosmética: quem
   *  está DENTRO vê o formulário de saída e o caminho de volta avulso; quem está
   *  FORA vê a data em que saiu (`unsubscribe-since`) e o bloco "Voltar a receber"
   *  no lugar do de confirmação. Um caso só mediria metade dos nós que a fase criou
   *  — e o estado "fora" é justamente o que a pessoa encontra quando volta ao
   *  endereço, que é o uso mais comum de uma página de descadastro.
   *
   * O endereço é DERIVADO pelo serviço (`unsubscribeUrlFor`), com o token de
   * verdade: é o mesmo endereço que o rodapé do e-mail leva, porque o token é
   * determinístico por (instituição, pessoa).
   */
  test('a página de descadastro (recebendo) não tem violação crítica', async ({ page }) => {
    const endereco = unsubscribeUrlFor({ tenantSlug, tenantId, userId: adminId });

    if (!endereco) throw new Error('Não foi possível derivar o endereço de descadastro.');

    await page.goto(endereco);

    await expect(page.getByTestId('unsubscribe-state')).toBeVisible();
    await expect(page.getByTestId('unsubscribe-state-value')).toHaveAttribute('data-out', 'false');

    /** Os dois blocos da promessa — o que a página existe para dizer. */
    await expect(page.getByTestId('unsubscribe-what-stops')).toContainText('recados em massa');
    await expect(page.getByTestId('unsubscribe-keeps-list')).toContainText('Certificado');

    /** E os dois formulários, os dois no DOM: sair e voltar a receber. */
    await expect(page.getByTestId('unsubscribe-form')).toBeVisible();
    await expect(page.getByTestId('resubscribe-form')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `página de descadastro, recebendo (/t/${tenantSlug}/descadastro/<token>)`,
    );
  });

  test('a página de descadastro (fora da lista) não tem violação crítica', async ({ page }) => {
    const saida = await unsubscribePerson({
      tenantId,
      userId: adminId,
      channel: 'MANUAL',
      reason: 'Fixture da varredura de acessibilidade da FASE 67.',
    });

    if (!saida.ok) throw new Error(`Falha ao descadastrar a fixture: ${saida.message}`);

    const endereco = unsubscribeUrlFor({ tenantSlug, tenantId, userId: adminId });
    if (!endereco) throw new Error('Não foi possível derivar o endereço de descadastro.');

    await page.goto(endereco);

    await expect(page.getByTestId('unsubscribe-state-value')).toHaveAttribute('data-out', 'true');
    await expect(page.getByTestId('unsubscribe-since')).toBeVisible();
    await expect(page.getByTestId('resubscribe-form')).toBeVisible();
    await expect(page.getByTestId('unsubscribe-confirm-submit')).toHaveCount(0);

    await expectNoCriticalViolations(
      page,
      `página de descadastro, fora da lista (/t/${tenantSlug}/descadastro/<token>)`,
    );

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ADMINISTRADORA FICA FORA DA LISTA ATÉ O FIM DO ARQUIVO — E ISSO É INÓCUO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O que o descadastro muda é só o que uma CAMPANHA alcança; nenhuma das outras
     *  telas deste arquivo consulta essa condição (nem a caixa de saída, nem o
     *  painel, nem o diretório). A varredura anterior, que mediria a aba "Segmentos"
     *  com a pessoa fora, roda ANTES desta — e é isso que dá aos dois casos a
     *  cobertura dos dois estados.
     */
    await expect(page.getByTestId('unsubscribe-state')).toBeVisible();
  });

  test('o diretório de participantes não tem violação crítica', async ({ page }) => {    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/participantes`);
    await expect(page.getByRole('main').last()).toBeVisible();

    /**
     * Esta é a tela mais DENSA do sistema num só lugar: filtros, tabela, seleção e o
     * painel de exportação da FASE 49 — o melhor alvo para o portão pegar rótulo
     * ausente, nome de botão e contraste fora do token de aviso.
     */
    await expectNoCriticalViolations(page, `diretório de participantes (/t/${tenantSlug}/participantes)`);
  });
  // ───────────────────────────────────────────────────────────────────────────────
  //  As VISTAS do quadro de demandas (FASE 57) — uma varredura por vista
  // ───────────────────────────────────────────────────────────────────────────────
  test('o quadro de demandas (Kanban) não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/demandas`);
    await expect(page.getByTestId('demand-board-kanban')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `quadro de demandas · Kanban (/t/${tenantSlug}/administracao/eventos/<id>/demandas)`,
    );
  });

  test('o quadro de demandas (Gantt) não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    /**
     * O Gantt é a vista com mais texto pequeno e mais cor fora do token: eixo de dias,
     * barras com tom por situação e a faixa "sem data". Se a acessibilidade valesse só
     * para o Kanban, esta tela nasceria fora do portão.
     */
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/demandas?vista=gantt`);
    await expect(page.getByTestId('demand-gantt')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `quadro de demandas · Gantt (/t/${tenantSlug}/administracao/eventos/<id>/demandas?vista=gantt)`,
    );
  });

  test('o quadro de demandas (calendário) não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/demandas?vista=calendario`);
    await expect(page.getByTestId('demand-calendar')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `quadro de demandas · Calendário (/t/${tenantSlug}/administracao/eventos/<id>/demandas?vista=calendario)`,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────
  //  A FILA DE DENÚNCIAS (FASE 56 · dívida E62) — tela de PLATAFORMA
  // ───────────────────────────────────────────────────────────────────────────────
  test('a fila de denúncias da plataforma não tem violação crítica', async ({ page }) => {
    await signInAs(page, superEmail);

    await page.goto('/superadmin/denuncias');
    await expect(page.getByTestId('moderation-queue')).toBeVisible();

    /**
     * A fila traz o relato de quem denunciou e o formulário de decisão (nota + dispensar
     * + ocultar). É onde uma decisão de moderação é tomada: se ela não for operável por
     * teclado e leitor de tela, quem decide fica sem o caminho.
     */
    await expectNoCriticalViolations(page, 'fila de denúncias (/superadmin/denuncias)');
  });
});
