/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — o destino de quem ACABA de entrar (FASE 82 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA REGRA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Hoje o fim de todo fluxo de entrada é um `redirect` INCONDICIONAL para
 *  `/selecionar-instituicao` (`auth-actions.ts`, `/login` e `/signup`). Não há uma
 *  única pergunta sobre QUEM entrou: o SuperAdmin cai no seletor de instituições
 *  (e fica sem porta de volta), quem não tem vínculo nenhum cai numa tela que só
 *  oferece "Sair da conta", e quem chegou por um link profundo perde o lugar onde
 *  estava. O destino não pode continuar sendo uma constante escolhida por acaso:
 *  ele é uma DECISÃO, com fatos e com ordem.
 *
 *  A decisão é uma FUNÇÃO PURA pelo mesmo motivo da irmã `vitrine-account-rules`:
 *  o destino é consumido por mais de um caminho (o redirect da entrada agora; o
 *  CTA "Minha área" da vitrine na fatia seguinte) e duas cópias de `if` divergem
 *  no primeiro ajuste. Aqui ela é exercitada sem banco, sem sessão e sem Next.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELA RECEBE (E POR QUE NÃO LÊ NADA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela NÃO lê sessão, NÃO lê cookie e NÃO consulta o banco: recebe o fato já
 *  apurado. Quem apura é `resolveEntryDestinationForUser` (`src/lib/auth/`), e só
 *  no fluxo de entrada — em especial o flag de plataforma, que custa uma consulta
 *  administrativa e NÃO pode entrar no `getRequestContext()` (ver o cabeçalho do
 *  adaptador).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { PLATFORM_HOME_PATH } from '@/domain/platform/platform-nav-rules';
import {
  SELECT_INSTITUTION_PATH,
  tenantDashboardPath,
} from '@/domain/platform/vitrine-account-rules';

/**
 * Os fatos que decidem o destino — todos já apurados por quem chama.
 *
 * `activeLinkCount` SUBSTITUI o booleano `hasActiveLink` (FASE 83). A pergunta
 * mudou de forma: não é mais "existe vínculo?", e sim "quantos?". Com um, há um
 * painel óbvio; com dois ou mais, escolher por conta própria é inventar uma
 * resposta que a pessoa nunca deu — a regra passa a perguntar.
 *
 * `activeTenantSlug` e `activeLinkCount` NÃO são fundidos: o vínculo pode existir
 * sem que o slug chegue (dado incompleto, chamador novo, coluna ausente). Nesse
 * caso não há painel para onde mandar, e a regra precisa cair para o próximo
 * degrau em vez de montar `/t/null/dashboard`.
 */
export interface EntryDestinationInput {
  /** O principal de plataforma tem `PLATFORM_MANAGE` vigente no escopo PLATFORM. */
  isPlatformOperator: boolean;
  /**
   * A escolha EXPLÍCITA que a pessoa já fez, derivada do cookie `ef_tenant` e JÁ
   * revalidada contra um vínculo `ACTIVE`; `null` quando não houve cookie válido.
   *
   * É a diferença entre "a pessoa escolheu" e "nós escolhemos por ela": com 2+
   * vínculos, um slug aqui manda ao painel; sem ele, a regra pergunta.
   */
  chosenTenantSlug: string | null;
  /** Slug do melhor vínculo ativo; `null` se não houver — ou se o dado não o trouxe. */
  activeTenantSlug: string | null;
  /** Quantos vínculos operacionais (`ACTIVE`) existem. 0, 1 e 2+ mudam o destino. */
  activeLinkCount: number;
  /** Existe convite pendente — é o que dá conteúdo ao seletor de instituição. */
  hasPendingInvite: boolean;
  /** O destino que a pessoa pediu (`?redirectTo=`), ainda NÃO validado. */
  redirectTo: string | null | undefined;
}

/**
 * A descoberta pública de eventos — o destino de quem não tem painel nenhum.
 *
 * É `/eventos`, e não `/`, porque `/` é a vitrine (FASE 75: ela não redireciona
 * mais ninguém) e `/eventos` é onde a pessoa ENCONTRA um evento e se inscreve —
 * a inscrição pública cria vínculo `ACTIVE` + papel `PARTICIPANT`, então este é
 * um destino que pode virar pertencimento, não um beco.
 */
export const ENTRY_DISCOVERY_PATH = '/eventos';

/** As telas de entrada: voltar para elas depois de entrar é um laço, não um destino. */
const AUTH_SCREENS = ['/login', '/signup'] as const;

/**
 * O caminho aponta para uma das telas de autenticação (ou para uma subpágina
 * delas, como `/login/dois-fatores`)?
 *
 * A comparação olha o PATHNAME, não a string inteira: `/login?redirectTo=/x`
 * continua sendo a tela de login, e aceitá-la faria o login recém-concluído
 * devolver a pessoa ao formulário que ela acabou de preencher.
 */
function pointsToAuthScreen(value: string): boolean {
  const pathname = value.split(/[?#]/)[0] ?? '';

  return AUTH_SCREENS.some(
    (screen) => pathname === screen || pathname.startsWith(`${screen}/`),
  );
}

/**
 * Um `redirectTo` pode ser honrado?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS SEIS RECUSAS, E O ATAQUE QUE CADA UMA FECHA
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. **vazio / não-string** — não é destino, é ausência.
 *  2. **com espaço (ou qualquer branco)** — o valor é copiado do formulário para
 *     uma URL; espaço, tab ou quebra de linha revelam que ele não foi pensado
 *     como caminho, e navegadores divergem ao normalizá-lo.
 *  3. **não começa com `/`** — `https://evil.com` e `javascript:...` são outro
 *     sítio ou outro esquema, não uma volta para dentro da plataforma.
 *  4. **começa com `//`** — URL relativa a protocolo: o navegador lê `//evil.com`
 *     como outro HOST, mantendo o esquema. É o open redirect clássico.
 *  5. **começa com `/\`** — a barra invertida é normalizada para `/` nos
 *     esquemas especiais, então `/\evil.com` vira `//evil.com` no navegador
 *     mesmo parecendo "um caminho com uma barra".
 *  6. **contém `://`** — mesmo dentro da query, um destino carrega um endereço
 *     absoluto; não temos caso de uso para isso e o custo de recusar é zero.
 *  7. **aponta para `/login` ou `/signup`** — voltar para a tela de entrada
 *     depois de entrar é o laço que esta fase existe para fechar.
 *
 * O que é aceito preserva a string ORIGINAL (com query e hash), porque é para
 * isso que ela foi gravada: a pessoa volta para a atividade com o filtro aberto,
 * não para a atividade "limpa".
 */
export function isSafeEntryRedirect(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/\s/.test(value)) return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.startsWith('/\\')) return false;
  if (value.includes('://')) return false;
  if (pointsToAuthScreen(value)) return false;

  return true;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A ORDEM DAS PERGUNTAS É O CONTRATO
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  1. `redirectTo` VÁLIDO — OVERRIDE, não fallback
 *     ────────────────────────────────────────────────────────────────────────
 *     É o primeiro item de propósito, e o pedido original o punha em último. A
 *     jornada de inscrição prova o contrário: `registration-journey:475-519`
 *     existe para garantir que quem criou conta a partir de uma ATIVIDADE volta
 *     para ela — sem isso o visitante perde o contexto e desiste. O mesmo vale
 *     para quem entra por um convite ou por uma chamada de proposta. "Voltar
 *     para onde eu estava" é a única pergunta cuja resposta o USUÁRIO escolheu;
 *     por isso ela vence inclusive o SuperAdmin: o operador também é gente que
 *     clica em "entrar e continuar" numa atividade.
 *
 *  2. OPERADOR DE PLATAFORMA — a governança é a casa dele
 *     ────────────────────────────────────────────────────────────────────────
 *     Depois do override e ANTES do vínculo: o SuperAdmin pode pertencer a
 *     instituições, e mandá-lo ao painel de uma delas esconderia o painel de
 *     governança de quem só o alcança digitando a URL (não existe link para
 *     `/superadmin` a partir da área da instituição). A constante vem do domínio
 *     (`PLATFORM_HOME_PATH`), a mesma que a trilha do `PageHeader` usa — um
 *     literal repetido aqui viraria uma segunda verdade no dia em que o índice
 *     mudasse de tela, e importar de `src/components` inverteria o grafo de
 *     dependência (fatia 1 cobrava isso).
 *
 *  3. ESCOLHA EXPLÍCITA (o cookie) — a resposta que a pessoa JÁ deu
 *     ────────────────────────────────────────────────────────────────────────
 *     Vem ANTES da contagem de propósito. Quem já escolheu uma instituição (o
 *     `switchTenantAction` grava o cookie `ef_tenant`) não pode ser perguntado de
 *     novo a cada entrada: o cookie é a resposta que a pessoa já deu; sem cookie,
 *     com 2+ vínculos, a resposta não é nossa. Por isso o slug escolhido manda ao
 *     painel dele mesmo havendo vários vínculos ativos.
 *
 *     O cookie só chega aqui se REVALIDOU como vínculo `ACTIVE` (o adaptador faz
 *     essa conferência): um slug sem vínculo ou de convite pendente vira `null` e
 *     a regra segue para os degraus seguintes — fail-closed, sem confiar no que o
 *     navegador mandou.
 *
 *  4. EXATAMENTE UM VÍNCULO ATIVO — o painel da instituição
 *     ────────────────────────────────────────────────────────────────────────
 *     É o destino de sempre para a esmagadora maioria de quem entra, e o mesmo
 *     caminho que o CTA da vitrine usa (`tenantDashboardPath`) — `/t/<slug>` é o
 *     endereço canônico por path, que funciona sem DNS wildcard em
 *     desenvolvimento e nos testes. Com um vínculo só não há o que perguntar.
 *
 *  5. DOIS OU MAIS VÍNCULOS ATIVOS, SEM ESCOLHA — o seletor
 *     ────────────────────────────────────────────────────────────────────────
 *     Escolher por conta própria é o defeito que a FASE 83 corrige: a regra
 *     antiga olhava só SE existia vínculo ativo e mandava ao "primeiro" — que,
 *     ordenado por nome da instituição, podia ser um vínculo criado por inscrição
 *     pública. Quando existe mais de uma casa possível e a pessoa ainda não disse
 *     qual é a dela, a resposta honesta é perguntar. O seletor mostra todas as
 *     instituições e a escolha grava o cookie, que passa a vencer no degrau 3.
 *
 *  6. CONVITE PENDENTE — o seletor
 *     ────────────────────────────────────────────────────────────────────────
 *     Quem ainda não tem vínculo ATIVO mas foi convidado PRECISA da tela do
 *     convite: é ali que o convite aparece e pode ser aceito
 *     (`auth-tenancy:340-364` prova que o seletor mostra o convite e recusa o
 *     uso até o aceite). Mandar essa pessoa para a descoberta de eventos
 *     esconderia a única tela capaz de resolver o vínculo dela.
 *
 *  7. NADA — a descoberta
 *     ────────────────────────────────────────────────────────────────────────
 *     Nem operador, nem vínculo, nem convite: não há painel que faça sentido. O
 *     seletor seria um beco ("Nenhuma instituição vinculada" + "Sair da conta"),
 *     e `/eventos` é público, entrega descoberta e inscrição, e a inscrição
 *     pública cria o vínculo que falta.
 */
export function resolveEntryDestination(input: EntryDestinationInput): string {
  if (isSafeEntryRedirect(input.redirectTo)) {
    return input.redirectTo;
  }

  if (input.isPlatformOperator) {
    return PLATFORM_HOME_PATH;
  }

  /**
   * A ESCOLHA JÁ FEITA vence a contagem.
   *
   * Com 2+ vínculos, perguntar de novo a quem acabou de escolher transformaria o
   * seletor num pedágio em toda entrada. O adaptador só preenche este campo
   * quando o cookie revalida contra um vínculo ATIVO — então "existe escolha" e
   * "existe vínculo" são o mesmo fato, e não há como um slug órfão desviar
   * ninguém para um painel sem acesso.
   */
  if (input.chosenTenantSlug) {
    return tenantDashboardPath(input.chosenTenantSlug);
  }

  if (input.activeLinkCount === 1 && input.activeTenantSlug) {
    return tenantDashboardPath(input.activeTenantSlug);
  }

  /**
   * 2+ vínculos: a resposta não é nossa. O seletor é a pergunta — e a escolha
   * dele grava o cookie que, na próxima entrada, faz o degrau 3 responder.
   */
  if (input.activeLinkCount >= 2) {
    return SELECT_INSTITUTION_PATH;
  }

  if (input.hasPendingInvite) {
    return SELECT_INSTITUTION_PATH;
  }

  return ENTRY_DISCOVERY_PATH;
}
