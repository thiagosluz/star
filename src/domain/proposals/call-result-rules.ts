/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O RESULTADO QUE O ORGANIZADOR PUBLICA NA CHAMADA (FASE 73 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PRINCÍPIO: O RESULTADO É UM ATO, NÃO UMA VISTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O comitê JÁ decidiu cada proposta (o protocolo de aceite da FASE 33). O que este
 *  módulo governa é o OUTRO ato: o organizador **escolhe** o que vai ao público,
 *  escreve o texto e os próximos passos, e publica. A lista é DERIVADA da decisão
 *  (para ele não redigitar título e autoria de cada trabalho), mas é ESCOLHIDA por
 *  ele: publicar não é sinônimo de aceitar, e uma proposta em avaliação pode ser
 *  publicada se ele quiser (decisão 1 do humano na FASE 73).
 *
 *  Daí os dois invariantes que organizam o arquivo:
 *    • **rascunho não vaza** — SEM_RESULTADO e RASCUNHO não produzem seção pública,
 *      nem por acidente de JSON;
 *    • **final não muda em silêncio** — de FINAL só se sai por REABRIR, um ato
 *      explícito (com confirmação e trilha na fatia 2).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  REPROVAR, E NÃO FILTRAR EM SILÊNCIO (a decisão da FASE 72)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nota, parecer, revisor, e-mail, CPF, dado de inscrição, `proposalData` cru e
 *  lista de espera NÃO existem nesta superfície. E eles não são "removidos" da
 *  saída: `assertResultadoSemCampoProibido` LANÇA, como
 *  `assertApiProjectionSemCampoProibido` na API do evento (FASE 72). O motivo é o
 *  mesmo: filtrar em silêncio transforma o defeito em "campo que simplesmente não
 *  aparece", e a próxima pessoa a mexer na projeção não tem como saber que aquele
 *  dado já saiu numa versão anterior. Lançar responde erro (fail-closed), nomeia o
 *  campo no log e mantém o teste vermelho enquanto o defeito existir.
 *
 *  Ela é chamada DENTRO de `projectPublicCallResult`, e não pelo chamador: a tela
 *  (fatia 3) e a página pública (fatia 4) não têm como esquecê-la.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A EXCEÇÃO DECLARADA DO NOME COMPLETO (decisão 2 do humano na FASE 73)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O resto da casa MASCARA o nome de quem se oculta (`maskPersonName`) e pergunta
 *  antes se a pessoa pode ser citada (`isPersonPubliclyVisible`) — a régua da dívida
 *  E79, com fonte única em `src/domain/profile/public-profile-rules.ts`.
 *
 *  **A lista de aprovados da chamada é a ÚNICA superfície que ignora a ocultação, e
 *  isto é uma exceção DECLARADA pelo humano, não um esquecimento.** A razão é o
 *  documento: a lista de aprovados de um evento é publicação acadêmica — o ato de
 *  aprovar um trabalho TORNA os autores públicos, e é assim que o congresso, o
 *  anais e a biblioteca citam o trabalho. Mascarar "Ana S." numa lista de aprovados
 *  tornaria o documento inútil justamente para quem precisa citá-lo.
 *
 *  O escopo é **só desta superfície** e está preso por dois testes da fatia:
 *    (a) aqui o nome completo sai mesmo de quem se oculta;
 *    (b) a MESMA pessoa oculta continua mascarada na régua geral — se alguém
 *        "consertar" esta exceção copiando-a para outra superfície, ou trouxer a
 *        régua da E79 para cá, um dos dois testes cai.
 *
 *  Consequência mecânica: o dado de entrada traz o sinal `oculto` e a projeção
 *  **lê o nome e não lê o sinal** — de propósito, no único lugar do arquivo onde
 *  isso acontece. E o sinal em si NUNCA vai ao público (está na lista fechada):
 *  publicá-lo revelaria *quem* se ocultou, que é o oposto do que a E79 protege.
 *
 *  O módulo é PURO: não importa Prisma, Next nem relógio — o instante do ato entra
 *  por parâmetro (`agora`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { normalizeApiFieldName } from '@/domain/api/public-api-contract';
import type { SubmissionStatus } from '@/domain/review/submission-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Os estados do resultado
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os quatro estados, e o que cada um significa para o público:
 *
 *   SEM_RESULTADO — a chamada nunca teve resultado. Nada no público (a seção não
 *                   existe). É também o que um JSON torto devolve.
 *   RASCUNHO      — o organizador escreveu e escolheu a lista; NADA no público.
 *   PARCIAL       — publicado e EDITÁVEL: a próxima publicação substitui, e o ato
 *                   fica na trilha (fatia 2).
 *   FINAL         — publicado e TRAVADO: mudar exige REABRIR.
 */
export const CALL_RESULT_STATES = Object.freeze([
  'SEM_RESULTADO',
  'RASCUNHO',
  'PARCIAL',
  'FINAL',
] as const);

export type CallResultState = (typeof CALL_RESULT_STATES)[number];

export const CALL_RESULT_STATE_LABELS: Readonly<Record<CallResultState, string>> = {
  SEM_RESULTADO: 'Sem resultado',
  RASCUNHO: 'Rascunho',
  PARCIAL: 'Resultado parcial',
  FINAL: 'Resultado final',
};

/** Os estados que o público vê. Fora deles, a seção NÃO EXISTE — nem vazia. */
export const PUBLIC_CALL_RESULT_STATES = Object.freeze(['PARCIAL', 'FINAL'] as const);

export type PublicCallResultState = (typeof PUBLIC_CALL_RESULT_STATES)[number];

export function isCallResultState(value: unknown): value is CallResultState {
  return typeof value === 'string' && (CALL_RESULT_STATES as readonly string[]).includes(value);
}

export function isPublicCallResultState(estado: CallResultState): estado is PublicCallResultState {
  return estado === 'PARCIAL' || estado === 'FINAL';
}

// ───────────────────────────────────────────────────────────────────────────────
//  As ações e a tabela de transições
// ───────────────────────────────────────────────────────────────────────────────
export const CALL_RESULT_ACTIONS = Object.freeze([
  'SALVAR_RASCUNHO',
  'PUBLICAR_PARCIAL',
  'PUBLICAR_FINAL',
  'REABRIR',
] as const);

export type CallResultAction = (typeof CALL_RESULT_ACTIONS)[number];

export const CALL_RESULT_ACTION_LABELS: Readonly<Record<CallResultAction, string>> = {
  SALVAR_RASCUNHO: 'Salvar rascunho',
  PUBLICAR_PARCIAL: 'Publicar parcial',
  PUBLICAR_FINAL: 'Publicar final',
  REABRIR: 'Reabrir resultado final',
};

/**
 * A tabela legal — a FONTE ÚNICA do que é possível.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS DECISÕES QUE ESTA TABELA TOMA, E POR QUÊ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. **De FINAL só se sai por REABRIR.** `SALVAR_RASCUNHO`, `PUBLICAR_PARCIAL` e
 *     `PUBLICAR_FINAL` não têm FINAL entre as origens. A leitura mais segura é esta:
 *     o resultado final que muda por um clique de "salvar" não é final — e o
 *     organizador que só queria corrigir uma vírgula precisa passar pelo ato que
 *     diz, na trilha, que ele reabriu. Sem isso, "final" seria só um rótulo.
 *
 *  2. **Publicar NÃO exige passar pelo rascunho.** `SEM_RESULTADO` pode ir direto a
 *     PARCIAL: o ato de publicar já carrega o texto e a lista que estavam na tela,
 *     e exigir dois cliques para a primeira publicação seria uma armadilha de uso
 *     (o organizador de um evento pequeno escreve e publica na mesma sessão). É o
 *     diagrama do plano da fase: `SEM_RESULTADO ──publicar parcial──▶ PARCIAL`.
 *
 *  3. **FINAL não sai de SEM_RESULTADO.** O final é o estado TERMINAL, e só se
 *     chega a ele depois de o resultado existir — como rascunho (o organizador viu
 *     o que ia publicar) ou como parcial (o público já viu uma versão). Uma chamada
 *     que nunca teve resultado indo direto a FINAL pularia o único momento em que o
 *     organizador olha a publicação antes de ela virar definitiva.
 *
 * `REABRIR` leva a PARCIAL e não a RASCUNHO: o texto continua NO AR como parcial
 * (o diagrama do plano não tira o resultado do público ao reabrir), e "parcial" é a
 * resposta honesta — o resultado voltou a ser editável.
 */
const CALL_RESULT_TRANSITIONS: Readonly<
  Record<CallResultAction, { readonly para: CallResultState; readonly de: readonly CallResultState[] }>
> = {
  SALVAR_RASCUNHO: { para: 'RASCUNHO', de: ['SEM_RESULTADO', 'RASCUNHO', 'PARCIAL'] },
  PUBLICAR_PARCIAL: { para: 'PARCIAL', de: ['SEM_RESULTADO', 'RASCUNHO', 'PARCIAL'] },
  PUBLICAR_FINAL: { para: 'FINAL', de: ['RASCUNHO', 'PARCIAL'] },
  REABRIR: { para: 'PARCIAL', de: ['FINAL'] },
};

/** De quais estados a ação é legal (a tela da fatia 3 usa isto para os botões). */
export function legalResultStatesFor(acao: CallResultAction): readonly CallResultState[] {
  return CALL_RESULT_TRANSITIONS[acao].de;
}

export function isLegalResultTransition(acao: CallResultAction, estado: CallResultState): boolean {
  return CALL_RESULT_TRANSITIONS[acao].de.includes(estado);
}

/** O estado em que o resultado fica depois da ação — sempre um só. */
export function resultStateAfter(acao: CallResultAction): CallResultState {
  return CALL_RESULT_TRANSITIONS[acao].para;
}

/** As ações possíveis a partir do estado atual, na ordem em que a tela as mostra. */
export function availableCallResultActions(estado: CallResultState): readonly CallResultAction[] {
  return CALL_RESULT_ACTIONS.filter((acao) => isLegalResultTransition(acao, estado));
}

// ───────────────────────────────────────────────────────────────────────────────
//  O spec gravado
// ───────────────────────────────────────────────────────────────────────────────
/** Teto do texto público. É um comunicado, não um capítulo — e a página é de leitura. */
export const CALL_RESULT_TEXT_MAX = 4_000;

/** Teto dos próximos passos. Menor de propósito: é uma instrução, não um texto. */
export const CALL_RESULT_NEXT_STEPS_MAX = 1_000;

/**
 * Teto da lista publicada.
 *
 * Alto o bastante para um congresso inteiro (a lista de aprovados de um evento
 * grande cabe), e existe para o JSON não crescer sem limite por um laço de
 * formulário — a página renderiza a lista inteira.
 */
export const CALL_RESULT_PUBLISHED_MAX = 1_000;

/**
 * O resultado como ele é GRAVADO em `call_for_proposals.result`.
 *
 * `atualizadoEm` é `null` no único caso em que nunca houve ato: SEM_RESULTADO. Não
 * inventamos uma data para "nunca" — 1970 e "agora" seriam as duas mentiras
 * disponíveis, e a segunda ainda faria a tela dizer "atualizado há instantes" para
 * uma chamada que ninguém tocou.
 */
export interface CallResult {
  estado: CallResultState;
  /** Texto público do organizador (vazio = não há texto). */
  texto: string;
  /** Próximos passos (vazio = não há). */
  proximosPassos: string;
  /** Ids de submissão NA ORDEM em que a lista pública os mostra. */
  publicados: readonly string[];
  /** ISO-8601 do último ato; `null` = nunca houve ato (SEM_RESULTADO). */
  atualizadoEm: string | null;
  /**
   * ISO-8601 da publicação VIGENTE. Ausente enquanto nada está no ar — e um
   * PARCIAL/FINAL sem esta data é lido como RASCUNHO (ver `readCallResult`).
   */
  publicadoEm?: string;
}

/** O resultado de quem nunca publicou nada. Objeto NOVO a cada chamada. */
export function emptyCallResult(): CallResult {
  return {
    estado: 'SEM_RESULTADO',
    texto: '',
    proximosPassos: '',
    publicados: [],
    atualizadoEm: null,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A decisão da transição — erro como VALOR
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Por que uma transição foi recusada. Cada código existe para a tela poder dizer o
 * que houve sem inventar texto, e para o teste prender o motivo (e não só o "não").
 */
export type CallResultRefusalCode =
  | 'ACAO_DESCONHECIDA'
  | 'TRANSICAO_ILEGAL'
  | 'TEXTO_LONGO'
  | 'PROXIMOS_PASSOS_LONGO'
  | 'ID_FORA_DA_CHAMADA'
  | 'ID_REPETIDO'
  | 'LISTA_LONGA'
  | 'PUBLICACAO_VAZIA';

export interface CallResultRefusal {
  ok: false;
  code: CallResultRefusalCode;
  /** Mensagem em português, pronta para a tela do organizador. */
  message: string;
  /** O que exatamente o sistema recusou — diagnóstico, não texto de tela. */
  details?: Readonly<Record<string, string>>;
}

/** O que o organizador escreveu e escolheu NESTE ato. */
export interface CallResultContent {
  texto: string;
  proximosPassos: string;
  publicados: readonly string[];
}

export interface CallResultTransitionInput {
  /** O resultado lido do banco (o retorno de `readCallResult(...).resultado`). */
  atual: CallResult;
  acao: CallResultAction;
  /**
   * O conteúdo da tela. Obrigatório em TODAS as ações, inclusive REABRIR: cada ato
   * grava o que estava à vista, e nenhum campo do formulário é descartado em
   * silêncio.
   */
  conteudo: CallResultContent;
  /**
   * Os ids de TODAS as submissões desta chamada.
   *
   * Vem por parâmetro porque o domínio não consulta o banco — e é o que impede a
   * lista de publicar submissão de OUTRA chamada (o serviço da fatia 2 preenche com
   * a leitura real; a validação mora aqui, junto da escrita, para não depender de o
   * serviço lembrar).
   */
  submissoesDaChamada: readonly string[];
  /** O instante do ato: o domínio não lê relógio. */
  agora: Date;
}

export type CallResultTransition = { ok: true; resultado: CallResult } | CallResultRefusal;

function refusal(input: {
  code: CallResultRefusalCode;
  message: string;
  details?: Readonly<Record<string, string>>;
}): CallResultRefusal {
  return input.details ? { ok: false, code: input.code, message: input.message, details: input.details } : { ok: false, code: input.code, message: input.message };
}

/**
 * A mensagem da transição ilegal, com o motivo — e não só "não pode".
 *
 * Os dois casos especiais (o final travado e o reabrir) são os que a tela precisa
 * explicar: são eles que fazem o organizador entender POR QUE o botão não funciona
 * e qual é o caminho.
 */
function illegalTransitionMessage(acao: CallResultAction, estado: CallResultState): string {
  const atual = CALL_RESULT_STATE_LABELS[estado];
  const acaoLabel = CALL_RESULT_ACTION_LABELS[acao];

  if (estado === 'FINAL') {
    return (
      `"${acaoLabel}" não é possível com o resultado final: ele está travado para não mudar em silêncio. ` +
      'Reabra o resultado final para voltar a editá-lo.'
    );
  }

  if (acao === 'REABRIR') {
    return `Só o resultado final pode ser reaberto — este está em "${atual}".`;
  }

  if (acao === 'PUBLICAR_FINAL') {
    return (
      `"${acaoLabel}" não é possível a partir de "${atual}": o resultado final vem depois de um rascunho ` +
      'ou de um parcial, para o organizador ver o que vira definitivo. Salve um rascunho ou publique o parcial primeiro.'
    );
  }

  return `"${acaoLabel}" não é possível a partir de "${atual}".`;
}

/**
 * Decide a transição e devolve o NOVO resultado — ou o motivo da recusa.
 *
 * A ordem das conferências é a ordem em que o organizador erra: primeiro o estado
 * (o botão que ele clicou não valia), depois o que ele escreveu, depois o que ele
 * marcou. Ela não MUTA `atual` (a tela costuma ter o JSON lido em mãos).
 */
export function decideCallResultTransition(
  input: CallResultTransitionInput,
): CallResultTransition {
  const { atual, acao, conteudo, agora } = input;

  if (!(CALL_RESULT_ACTIONS as readonly string[]).includes(acao)) {
    return refusal({
      code: 'ACAO_DESCONHECIDA',
      message: `"${String(acao)}" não é uma ação do resultado.`,
      details: { acao: String(acao) },
    });
  }

  if (!isLegalResultTransition(acao, atual.estado)) {
    return refusal({
      code: 'TRANSICAO_ILEGAL',
      message: illegalTransitionMessage(acao, atual.estado),
      details: { acao, estado: atual.estado },
    });
  }

  /**
   * O texto é APARADO antes de medir, porque é aparado antes de gravar: medir o cru
   * recusaria um texto que cabe, e medir depois de gravar gravaria um texto que não
   * cabe.
   */
  const texto = conteudo.texto.trim();
  if (texto.length > CALL_RESULT_TEXT_MAX) {
    return refusal({
      code: 'TEXTO_LONGO',
      message: `O texto público passa de ${CALL_RESULT_TEXT_MAX} caracteres (tem ${texto.length}).`,
      details: { limite: String(CALL_RESULT_TEXT_MAX), medido: String(texto.length) },
    });
  }

  const proximosPassos = conteudo.proximosPassos.trim();
  if (proximosPassos.length > CALL_RESULT_NEXT_STEPS_MAX) {
    return refusal({
      code: 'PROXIMOS_PASSOS_LONGO',
      message: `Os próximos passos passam de ${CALL_RESULT_NEXT_STEPS_MAX} caracteres (têm ${proximosPassos.length}).`,
      details: { limite: String(CALL_RESULT_NEXT_STEPS_MAX), medido: String(proximosPassos.length) },
    });
  }

  /**
   * A lista passa por um `Set` e não por um `filter`: id repetido é RECUSADO, e não
   * deduplicado. Deduplicar em silêncio gravaria uma lista que o organizador não
   * montou, e a ordem publicada é a escolha dele.
   */
  const daChamada = new Set(input.submissoesDaChamada);
  const vistos = new Set<string>();
  const publicados: string[] = [];

  for (const bruto of conteudo.publicados) {
    if (typeof bruto !== 'string' || bruto.trim().length === 0) {
      return refusal({
        code: 'ID_FORA_DA_CHAMADA',
        message: 'A lista de publicados tem um item que não é id de submissão.',
        details: { valor: String(bruto) },
      });
    }

    const id = bruto.trim();

    if (!daChamada.has(id)) {
      return refusal({
        code: 'ID_FORA_DA_CHAMADA',
        message:
          'A lista de publicados tem uma submissão que não é desta chamada. ' +
          'O resultado de uma chamada não pode publicar o trabalho de outra.',
        details: { submissionId: id },
      });
    }

    if (vistos.has(id)) {
      return refusal({
        code: 'ID_REPETIDO',
        message: 'A lista de publicados tem a mesma submissão mais de uma vez.',
        details: { submissionId: id },
      });
    }

    vistos.add(id);
    publicados.push(id);
  }

  if (publicados.length > CALL_RESULT_PUBLISHED_MAX) {
    return refusal({
      code: 'LISTA_LONGA',
      message: `A lista de publicados passa de ${CALL_RESULT_PUBLISHED_MAX} submissões (tem ${publicados.length}).`,
      details: { limite: String(CALL_RESULT_PUBLISHED_MAX), medido: String(publicados.length) },
    });
  }

  /**
   * Publicação VAZIA é recusada: sem texto, sem próximos passos e sem lista, a
   * seção apareceria no público com uma etiqueta e uma data — o que parece defeito,
   * não resultado. Um rascunho vazio é legítimo (alguém começou a escrever).
   */
  if (
    (acao === 'PUBLICAR_PARCIAL' || acao === 'PUBLICAR_FINAL') &&
    texto.length === 0 &&
    proximosPassos.length === 0 &&
    publicados.length === 0
  ) {
    return refusal({
      code: 'PUBLICACAO_VAZIA',
      message:
        'Não há nada para publicar: escreva o texto, os próximos passos ou marque ao menos uma submissão na lista.',
      details: { acao },
    });
  }

  const instante = agora.toISOString();

  const resultado: CallResult = {
    estado: resultStateAfter(acao),
    texto,
    proximosPassos,
    publicados,
    atualizadoEm: instante,
  };

  if (acao === 'PUBLICAR_PARCIAL' || acao === 'PUBLICAR_FINAL') {
    /**
     * Cada publicação carimba a PRÓPRIA data: é a data que a página mostra ao lado do
     * estado, e ela precisa dizer quando a versão que está no ar foi publicada.
     */
    resultado.publicadoEm = instante;
  } else if (acao === 'REABRIR') {
    /**
     * Reabrir NÃO despublica: o texto continua no ar como PARCIAL, e a data é a da
     * publicação vigente (só se reabre de FINAL, e FINAL sempre tem data). Carimbar
     * "agora" aqui contaria como publicação um ato que não publicou nada.
     */
    if (atual.publicadoEm !== undefined) resultado.publicadoEm = atual.publicadoEm;
  }

  /**
   * `SALVAR_RASCUNHO` não carimba `publicadoEm`, e é de propósito.
   *
   * Salvar rascunho a partir de PARCIAL é o caminho de DESPUBLICAR: o rascunho não
   * tem data de publicação, e a seção sai do público inteira (invariante "rascunho
   * não vaza"). Guardar a data antiga faria um rascunho parecer publicado.
   */

  return { ok: true, resultado };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O leitor TOLERANTE
// ───────────────────────────────────────────────────────────────────────────────
export type CallResultSource = 'DEFAULT' | 'RESULT';

export interface ReadCallResultResult {
  /** Sempre um resultado utilizável — nunca lança. */
  resultado: CallResult;
  /** `DEFAULT` = não havia um resultado legível (ausente, vazio ou torto). */
  source: CallResultSource;
  /**
   * Por que a leitura caiu no padrão (ou o que foi descartado). Em português: a tela
   * do organizador (fatia 3) pode avisar em vez de mostrar um cartão vazio sem
   * explicação.
   */
  problems: readonly string[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Data ISO-8601 — a MESMA régua de `readEventApiConfig`, e normalizada para UTC:
 * duas grafias do mesmo instante não podem virar duas datas no JSON regravado.
 */
function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

const CALL_RESULT_KEYS: readonly string[] = [
  'estado',
  'texto',
  'proximosPassos',
  'publicados',
  'atualizadoEm',
  'publicadoEm',
];

/**
 * Lê `call_for_proposals.result` com tolerância, e diz o motivo de cada descarte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SOBRE TOLERÂNCIA E FAIL-CLOSED: AS DUAS ANDAM JUNTAS
 * ─────────────────────────────────────────────────────────────────────────────
 *  `result` é JSON livre: uma linha torta — gravada à mão, por uma versão anterior
 *  ou por um bug — NÃO pode derrubar a página pública da chamada. A leitura nunca
 *  lança; ela cai no padrão e devolve o motivo.
 *
 *  Mas "cair no padrão" é sempre para o lado de MENOS público:
 *   • estado desconhecido/ausente → SEM_RESULTADO;
 *   • PARCIAL/FINAL sem `publicadoEm` → **RASCUNHO** (nada vai ao público sem data
 *     de publicação; inventar a data faria a seção aparecer com informação que
 *     ninguém publicou);
 *   • RASCUNHO com `publicadoEm` → a data sai (rascunho não tem data de publicação);
 *   • SEM_RESULTADO com conteúdo → o conteúdo é descartado;
 *   • campo desconhecido → é REPORTADO (o spec é fechado; quem gravar `nota` dentro
 *     do resultado precisa saber que o sistema não a usa — e não que ela foi
 *     "aceita").
 */
export function readCallResult(raw: unknown): ReadCallResultResult {
  const vazio = emptyCallResult();

  /** Ausente é o caso normal — é o que a coluna `'{}'` significa —, não um erro. */
  if (raw === undefined || raw === null) return { resultado: vazio, source: 'DEFAULT', problems: [] };

  if (!isPlainRecord(raw)) {
    return {
      resultado: vazio,
      source: 'DEFAULT',
      problems: [
        `resultado: o valor gravado não é um objeto (recebido ${Array.isArray(raw) ? 'lista' : typeof raw}).`,
      ],
    };
  }

  const problems: string[] = [];

  for (const chave of Object.keys(raw)) {
    if (!CALL_RESULT_KEYS.includes(chave)) {
      problems.push(`resultado.${chave}: campo desconhecido no resultado (o spec é fechado).`);
    }
  }

  const estadoBruto = raw.estado;

  if (estadoBruto === undefined || estadoBruto === null) {
    /** O `DEFAULT '{}'` da coluna: nunca houve ato, e isso não é um problema. */
    if (Object.keys(raw).length === 0) return { resultado: vazio, source: 'DEFAULT', problems };

    problems.push('resultado.estado: ausente — lido como SEM_RESULTADO.');
    return { resultado: vazio, source: 'DEFAULT', problems };
  }

  if (!isCallResultState(estadoBruto)) {
    problems.push(
      `resultado.estado: "${String(estadoBruto)}" não é um estado do resultado ` +
        `(${CALL_RESULT_STATES.join(', ')}). Lido como SEM_RESULTADO.`,
    );
    return { resultado: vazio, source: 'DEFAULT', problems };
  }

  const estado = estadoBruto;

  let texto = '';
  if (raw.texto !== undefined && raw.texto !== null) {
    if (typeof raw.texto !== 'string') {
      problems.push('resultado.texto: deveria ser texto.');
    } else {
      texto = raw.texto.trim();
      if (texto.length > CALL_RESULT_TEXT_MAX) {
        problems.push(
          `resultado.texto: ${texto.length} caracteres, acima do teto de ${CALL_RESULT_TEXT_MAX} ` +
            '(mantido como está: a leitura tolera, a escrita recusa).',
        );
      }
    }
  }

  let proximosPassos = '';
  if (raw.proximosPassos !== undefined && raw.proximosPassos !== null) {
    if (typeof raw.proximosPassos !== 'string') {
      problems.push('resultado.proximosPassos: deveria ser texto.');
    } else {
      proximosPassos = raw.proximosPassos.trim();
      if (proximosPassos.length > CALL_RESULT_NEXT_STEPS_MAX) {
        problems.push(
          `resultado.proximosPassos: ${proximosPassos.length} caracteres, acima do teto de ` +
            `${CALL_RESULT_NEXT_STEPS_MAX} (mantido como está: a leitura tolera, a escrita recusa).`,
        );
      }
    }
  }

  const publicados: string[] = [];

  if (raw.publicados !== undefined && raw.publicados !== null) {
    if (!Array.isArray(raw.publicados)) {
      problems.push('resultado.publicados: deveria ser uma lista de ids de submissão.');
    } else {
      const vistos = new Set<string>();

      raw.publicados.forEach((item, index) => {
        if (typeof item !== 'string' || item.trim().length === 0) {
          problems.push(`resultado.publicados[${index}]: item que não é id de submissão.`);
          return;
        }

        const id = item.trim();

        /** Repetido é reportado e a segunda cópia sai: a lista publicada é um conjunto. */
        if (vistos.has(id)) {
          problems.push(`resultado.publicados[${index}]: id repetido ("${id}") — a segunda cópia sai.`);
          return;
        }

        vistos.add(id);
        publicados.push(id);
      });
    }
  }

  let atualizadoEm: string | null = null;
  if (raw.atualizadoEm !== undefined && raw.atualizadoEm !== null) {
    const lido = isoTimestamp(raw.atualizadoEm);
    if (lido === null) {
      problems.push('resultado.atualizadoEm: deveria ser uma data ISO-8601.');
    } else {
      atualizadoEm = lido;
    }
  }

  let publicadoEm: string | undefined;
  if (raw.publicadoEm !== undefined && raw.publicadoEm !== null) {
    const lido = isoTimestamp(raw.publicadoEm);
    if (lido === null) {
      problems.push('resultado.publicadoEm: deveria ser uma data ISO-8601.');
    } else {
      publicadoEm = lido;
    }
  }

  if (estado === 'SEM_RESULTADO') {
    if (texto.length > 0 || proximosPassos.length > 0 || publicados.length > 0 || atualizadoEm !== null) {
      problems.push(
        'resultado: gravado como SEM_RESULTADO mas com conteúdo — o conteúdo é descartado ' +
          '(sem resultado não há o que mostrar).',
      );
    }

    return { resultado: vazio, source: 'RESULT', problems };
  }

  if (estado === 'RASCUNHO' && publicadoEm !== undefined) {
    problems.push(
      'resultado.publicadoEm: presente num rascunho — removido, porque rascunho não tem data de publicação.',
    );
    publicadoEm = undefined;
  }

  if (isPublicCallResultState(estado) && publicadoEm === undefined) {
    problems.push(
      `resultado.publicadoEm: ausente num resultado ${estado} — lido como RASCUNHO, porque nada vai ` +
        'ao público sem data de publicação.',
    );

    return {
      resultado: { estado: 'RASCUNHO', texto, proximosPassos, publicados, atualizadoEm },
      source: 'RESULT',
      problems,
    };
  }

  const resultado: CallResult = { estado, texto, proximosPassos, publicados, atualizadoEm };

  if (publicadoEm !== undefined) resultado.publicadoEm = publicadoEm;

  return { resultado, source: 'RESULT', problems };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A projeção PÚBLICA — o mínimo, e com a exceção declarada
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A ordem das chaves da seção pública. É CONTRATO (invariante 7 da casa): a página
 * renderiza nesta ordem e o teste prende a lista — uma reordenação acidental muda o
 * documento sem mudar valor nenhum.
 */
export const PUBLIC_CALL_RESULT_FIELD_ORDER = Object.freeze([
  'estado',
  'publicadoEm',
  'texto',
  'proximosPassos',
  'lista',
] as const);

/** A ordem das chaves de UM item da lista — título, tipo e autoria. */
export const PUBLIC_CALL_RESULT_ITEM_FIELD_ORDER = Object.freeze([
  'protocoloOuIdEstavel',
  'titulo',
  'tipo',
  'autores',
] as const);

/**
 * A autoria como ela chega do serviço: o nome COMPLETO e o sinal de ocultação.
 *
 * O sinal existe aqui para que a exceção seja VISÍVEL e testável. Sem ele, a
 * exceção ficaria invisível no serviço ("o serviço só manda nomes") e ninguém
 * conseguiria provar que a régua da E79 foi considerada e recusada de propósito
 * neste ponto.
 */
export interface CallResultAuthorSource {
  /** Nome completo, como está no cadastro (ou o nome declarado do coautor). */
  nome: string;
  /**
   * A pessoa está oculta pela moderação (E79)? **Nesta superfície o sinal NÃO é
   * lido** — ver o bloco da exceção no cabeçalho do arquivo. Na régua geral, este
   * `true` mascara o nome; aqui, não.
   */
  oculto: boolean;
}

/** O material de UMA submissão publicada, como o serviço o carrega do banco. */
export interface CallResultSubmissionSource {
  id: string;
  /** Código público de protocolo; vazio cai para o `id` (ver `stableSubmissionIdentifier`). */
  protocol: string;
  titulo: string;
  /** Rótulo do TIPO da proposta (o `kind` da chamada, já em português). */
  tipo: string;
  autores: readonly CallResultAuthorSource[];
}

export interface CallResultPublicItem {
  protocoloOuIdEstavel: string;
  titulo: string;
  tipo: string;
  /** NOMES COMPLETOS — a exceção declarada da FASE 73 (ver o cabeçalho). */
  autores: string[];
}

export interface PublicCallResultView {
  estado: PublicCallResultState;
  publicadoEm: string;
  texto: string;
  proximosPassos: string;
  lista: CallResultPublicItem[];
}

export interface PublicCallResultProjection {
  /**
   * `null` = **a seção não existe**. É a resposta para SEM_RESULTADO e RASCUNHO, e
   * também para um resultado publicado sem data de publicação.
   */
  view: PublicCallResultView | null;
  /** O que a projeção precisou descartar — para o log, nunca para a página. */
  problems: readonly string[];
}

/**
 * O identificador estável da submissão na lista pública.
 *
 * O protocolo é o que o autor conhece e o que o documento cita; o `id` é o último
 * recurso (submissão antiga, sem protocolo legível). Nunca os dois.
 */
export function stableSubmissionIdentifier(input: { protocol: string; id: string }): string {
  const protocol = input.protocol.trim();
  return protocol.length > 0 ? protocol : input.id;
}

/**
 * Monta a seção pública do resultado — ou `null` quando ela não deve existir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ENTRA, E O QUE O TIPO JÁ PROÍBE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Entra o estado, a data da publicação vigente, o texto, os próximos passos e a
 *  lista (protocolo ou id estável, título, tipo, autores). Não entra — e nem existe
 *  no tipo — nota, parecer, revisor, e-mail, CPF, dado de inscrição, `proposalData`
 *  cru ou lista de espera. A lista fechada (`assertResultadoSemCampoProibido`) é
 *  conferida no FIM, sobre o objeto pronto: ela pega o campo que uma versão futura
 *  acrescentar, inclusive aninhado — que o tipo, sozinho, não pegaria.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A EXCEÇÃO DO NOME COMPLETO, AQUI, EM UMA LINHA
 * ─────────────────────────────────────────────────────────────────────────────
 *  `autores: sub.autores.map((autor) => autor.nome)` — e o sinal `autor.oculto` é
 *  deliberadamente IGNORADO. É o único ponto do sistema que faz isso, e ele é a
 *  decisão 2 do humano na FASE 73: lista de aprovados é documento público, e
 *  aprovar torna o autor público. Todo o resto da casa continua mascarando
 *  (`maskPersonName`) — e há teste prendendo os dois lados.
 */
export function projectPublicCallResult(input: {
  resultado: CallResult;
  /** As submissões desta chamada que o serviço carregou (id, protocolo, título, tipo, autores). */
  submissoes: readonly CallResultSubmissionSource[];
}): PublicCallResultProjection {
  const { resultado } = input;

  if (!isPublicCallResultState(resultado.estado)) {
    return { view: null, problems: [] };
  }

  if (resultado.publicadoEm === undefined) {
    return {
      view: null,
      problems: ['resultado.publicadoEm: ausente num resultado publicado — a seção não é montada.'],
    };
  }

  const problems: string[] = [];
  const porId = new Map(input.submissoes.map((submissao) => [submissao.id, submissao]));

  const lista: CallResultPublicItem[] = [];

  /**
   * A ORDEM é a de `publicados` — a escolha do organizador —, e não a do banco. Um
   * `filter` sobre `submissoes` publicaria na ordem da consulta, que muda quando
   * alguém muda o `orderBy`.
   */
  for (const id of resultado.publicados) {
    const submissao = porId.get(id);

    if (submissao === undefined) {
      problems.push(
        `resultado.publicados: a submissão "${id}" não está entre as carregadas da chamada — ` +
          'ela sai da lista (não há dado para mostrar).',
      );
      continue;
    }

    lista.push({
      protocoloOuIdEstavel: stableSubmissionIdentifier({
        protocol: submissao.protocol,
        id: submissao.id,
      }),
      titulo: submissao.titulo,
      tipo: submissao.tipo,
      /** EXCEÇÃO DECLARADA (FASE 73): nome completo, e `oculto` NÃO é lido. */
      autores: submissao.autores.map((autor) => autor.nome),
    });
  }

  const view: PublicCallResultView = {
    estado: resultado.estado,
    publicadoEm: resultado.publicadoEm,
    texto: resultado.texto,
    proximosPassos: resultado.proximosPassos,
    lista,
  };

  /** Fail-closed, e DENTRO da projeção: nenhum chamador pode pular a conferência. */
  assertResultadoSemCampoProibido(view);

  return { view, problems };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A LISTA FECHADA — reprova, não filtra
// ───────────────────────────────────────────────────────────────────────────────
export interface ResultForbiddenField {
  readonly campo: string;
  /** Por que ele não pode sair. A frase é lida no relatório do teste. */
  readonly motivo: string;
}

/**
 * Os campos que NUNCA atravessam a fronteira do resultado público.
 *
 * A lista é por NOME de chave (normalizado), e não por posição, porque as
 * armadilhas são as mesmas da API do evento (F72): o campo mudar de `finalScore`
 * para `final_score` e escapar de uma comparação literal, o dado chegar aninhado, e
 * o nome vir em português no próximo mapper (`nota`, `parecer`, `revisor`).
 *
 * `oculto`, `hidden` e `publicProfileHiddenAt` estão aqui por um motivo que só esta
 * fase tem: publicar o SINAL da ocultação revelaria **quem** se ocultou — o oposto
 * do que a E79 protege. A lista mostra o nome completo (exceção declarada), e não
 * diz que aquela pessoa está oculta em outros lugares.
 */
export const RESULT_FORBIDDEN_FIELDS: readonly ResultForbiddenField[] = [
  // ── A avaliação (a decisão interna não é resultado público) ────────────────
  { campo: 'nota', motivo: 'nota da avaliação — a decisão interna não sai por aqui.' },
  { campo: 'notas', motivo: 'notas da avaliação.' },
  { campo: 'notaFinal', motivo: 'nota final da avaliação.' },
  { campo: 'notaPonderada', motivo: 'nota ponderada da avaliação.' },
  { campo: 'finalScore', motivo: 'nota final da avaliação.' },
  { campo: 'averageScore', motivo: 'média das notas da avaliação.' },
  { campo: 'weightedScore', motivo: 'nota ponderada da avaliação.' },
  { campo: 'score', motivo: 'pontuação da avaliação.' },
  { campo: 'parecer', motivo: 'parecer do revisor — texto interno do comitê.' },
  { campo: 'pareceres', motivo: 'pareceres do comitê.' },
  { campo: 'review', motivo: 'parecer/revisão interna.' },
  { campo: 'reviews', motivo: 'pareceres internos.' },
  { campo: 'reviewer', motivo: 'quem avaliou — a revisão é cega.' },
  { campo: 'reviewers', motivo: 'quem avaliou.' },
  { campo: 'revisor', motivo: 'quem avaliou, em português.' },
  { campo: 'revisores', motivo: 'quem avaliou, em português.' },
  { campo: 'reviewRecommendation', motivo: 'recomendação do revisor.' },
  { campo: 'recommendation', motivo: 'recomendação da avaliação.' },
  { campo: 'assignment', motivo: 'atribuição de avaliação.' },
  { campo: 'assignments', motivo: 'atribuições de avaliação.' },
  { campo: 'decision', motivo: 'decisão interna do comitê.' },
  { campo: 'decisao', motivo: 'decisão interna do comitê.' },
  { campo: 'decisionNotes', motivo: 'anotações da decisão do comitê.' },
  { campo: 'decisionById', motivo: 'quem decidiu.' },
  { campo: 'decidedAt', motivo: 'carimbo da decisão interna.' },
  { campo: 'status', motivo: 'situação interna da submissão.' },
  { campo: 'submissionStatus', motivo: 'situação interna da submissão.' },

  // ── O dado pessoal e de inscrição ──────────────────────────────────────────
  { campo: 'email', motivo: 'e-mail — dado de contato da pessoa.' },
  { campo: 'emailMasked', motivo: 'e-mail, ainda que mascarado.' },
  { campo: 'contactEmail', motivo: 'e-mail de contato.' },
  { campo: 'cpf', motivo: 'CPF — dado sensível.' },
  { campo: 'documento', motivo: 'documento de participante.' },
  { campo: 'telefone', motivo: 'telefone de participante.' },
  { campo: 'phone', motivo: 'telefone de participante.' },
  { campo: 'registration', motivo: 'inscrição de participante.' },
  { campo: 'registrationId', motivo: 'identificador de inscrição.' },
  { campo: 'registrationStatus', motivo: 'situação de inscrição.' },
  { campo: 'formResponses', motivo: 'respostas do formulário de inscrição.' },
  { campo: 'answers', motivo: 'respostas do formulário de inscrição.' },
  { campo: 'userId', motivo: 'conta da pessoa.' },
  { campo: 'user', motivo: 'conta da pessoa.' },

  // ── O rascunho do autor e a fila ───────────────────────────────────────────
  { campo: 'proposalData', motivo: 'dados brutos da proposta do autor — só título e tipo são declarados.' },
  { campo: 'abstract', motivo: 'resumo do autor — o resultado publica título e autoria, não o texto da proposta.' },
  { campo: 'keywords', motivo: 'palavras-chave do autor.' },
  { campo: 'waitlist', motivo: 'lista de espera.' },
  { campo: 'waitlistPosition', motivo: 'posição na lista de espera.' },
  { campo: 'position', motivo: 'posição na fila.' },

  // ── O sinal da ocultação (ver o comentário da lista) ───────────────────────
  { campo: 'oculto', motivo: 'sinal de ocultação — publicaria QUEM se ocultou.' },
  { campo: 'hidden', motivo: 'sinal de ocultação sob outro nome.' },
  { campo: 'publicProfileHiddenAt', motivo: 'data da ocultação da pessoa.' },

  // ── Segredos e carimbos internos ───────────────────────────────────────────
  { campo: 'token', motivo: 'token de acesso.' },
  { campo: 'secret', motivo: 'segredo de integração.' },
  { campo: 'password', motivo: 'senha de acesso.' },
  { campo: 'passwordHash', motivo: 'hash de senha.' },
  { campo: 'hash', motivo: 'hash interno.' },
  { campo: 'createdAt', motivo: 'carimbo interno de criação.' },
  { campo: 'updatedAt', motivo: 'carimbo interno de atualização.' },
  { campo: 'deletedAt', motivo: 'exclusão lógica.' },
];

/**
 * Famílias inteiras proibidas, por PREFIXO da chave normalizada.
 *
 * Um prefixo só entra quando a família INTEIRA é proibida — prefixo frouxo reprovaria
 * campo legítimo e ensinaria a desligar a catraca. `nota` cobre `notaFinal` e
 * `notas`; `inscri` cobre `inscricao` e `inscricoes`; `ocult` cobre `oculto`.
 */
export const RESULT_FORBIDDEN_PREFIXES = Object.freeze([
  'nota',
  'parecer',
  'revisor',
  'review',
  'avaliac',
  'atribuic',
  'inscri',
  'participant',
  'attendee',
  'presenc',
  'checkin',
  'badge',
  'email',
  'cpf',
  'waitlist',
  'fila',
  'proposaldat',
  'formresponse',
  'respost',
  'score',
  'decis',
  'ocult',
  'hidden',
  'publicprofilehidden',
  'token',
  'secret',
  'password',
] as const);

const RESULT_FORBIDDEN_EXACT: ReadonlySet<string> = new Set(
  RESULT_FORBIDDEN_FIELDS.map((entrada) => normalizeApiFieldName(entrada.campo)),
);

const RESULT_FORBIDDEN_NORMALIZED_PREFIXES: readonly string[] =
  RESULT_FORBIDDEN_PREFIXES.map(normalizeApiFieldName);

/** A chave é proibida no resultado público? A normalização é a MESMA da API (F72). */
export function isForbiddenResultField(field: string): boolean {
  const normalizada = normalizeApiFieldName(field);

  if (RESULT_FORBIDDEN_EXACT.has(normalizada)) return true;

  return RESULT_FORBIDDEN_NORMALIZED_PREFIXES.some((prefixo) => normalizada.startsWith(prefixo));
}

export interface ForbiddenResultFieldFound {
  readonly campo: string;
  readonly caminho: string;
}

/** O erro que o serviço registra e transforma em falha, nunca em "campo omitido". */
export class ResultadoCampoProibidoError extends Error {
  constructor(
    readonly campo: string,
    readonly caminho: string,
  ) {
    super(
      `O resultado público tentou levar o campo proibido "${campo}" em ${caminho}. ` +
        'A projeção é recusada inteira (fail-closed): a lista fechada da FASE 73 não é filtrada em silêncio.',
    );
    this.name = 'ResultadoCampoProibidoError';
  }
}

/**
 * Procura o primeiro campo proibido em QUALQUER profundidade.
 *
 * O caminho (`data.lista[0].nota`) é o que o log e o relatório do teste mostram: o
 * nome do campo sozinho não diz onde ele entrou.
 */
export function findForbiddenResultField(value: unknown): ForbiddenResultFieldFound | null {
  return walkForbidden(value, 'resultado');
}

function walkForbidden(value: unknown, caminho: string): ForbiddenResultFieldFound | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const achado = walkForbidden(value[index], `${caminho}[${index}]`);
      if (achado) return achado;
    }

    return null;
  }

  if (!isPlainRecord(value)) return null;

  for (const [campo, aninhado] of Object.entries(value)) {
    if (isForbiddenResultField(campo)) return { campo, caminho: `${caminho}.${campo}` };

    const achado = walkForbidden(aninhado, `${caminho}.${campo}`);
    if (achado) return achado;
  }

  return null;
}

/**
 * Reprova o resultado público inteiro quando um campo da lista fechada aparece nele.
 *
 * É `assert` de propósito: o chamador que ignorar o retorno (não há retorno) não
 * consegue seguir em frente com o dado. Ver o cabeçalho para a justificativa de não
 * filtrar. Chamada dentro de `projectPublicCallResult` — e exportada para o teste
 * injetar o campo proibido de propósito.
 */
export function assertResultadoSemCampoProibido(value: unknown): void {
  const achado = findForbiddenResultField(value);
  if (achado) throw new ResultadoCampoProibidoError(achado.campo, achado.caminho);
}

// ───────────────────────────────────────────────────────────────────────────────
//  O SELETOR DA LISTA — a decisão vira marca, e a marca é do organizador
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O rótulo dos estados REAIS de `SubmissionStatus` (o enum do schema).
 *
 * O domínio não importa o ORM: o tipo vem de `submission-rules` (que espelha o enum
 * do banco desde a FASE 4). O `Record` é a catraca — um status novo no enum quebra
 * o `tsc` aqui, e não vira uma opção sem rótulo na tela.
 *
 * Os textos são os MESMOS que as telas de submissão já usam (`/submissoes`,
 * `/comite`); a fatia 3 pode passar a importar daqui em vez de manter a quarta
 * cópia (relatado como achado, sem tocar em tela nesta fatia).
 */
export const SUBMISSION_STATUS_LABELS: Readonly<Record<SubmissionStatus, string>> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Enviada',
  UNDER_REVIEW: 'Em avaliação',
  REVISION_REQUESTED: 'Revisão solicitada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  WITHDRAWN: 'Retirada',
  CANCELED: 'Cancelada',
};

/** A DECISÃO que pré-marca a lista: trabalho aceito é o que se publica por padrão. */
export function isAcceptedSubmission(status: SubmissionStatus): boolean {
  return status === 'ACCEPTED';
}

/**
 * Uma submissão da chamada, como o serviço a entrega ao seletor.
 *
 * `autores` são NOMES COMPLETOS: o seletor é a tela do ORGANIZADOR, que precisa
 * reconhecer o trabalho para escolhê-lo (e que já vê a autoria no comitê). Não há
 * exceção a declarar aqui — a ocultação só vale para superfície pública.
 */
export interface CallResultSelectorSource {
  id: string;
  titulo: string;
  tipo: string;
  /** O status REAL da submissão (`SubmissionStatus`). */
  status: SubmissionStatus;
  autores: readonly string[];
}

export interface CallResultSelectorOption {
  id: string;
  titulo: string;
  tipo: string;
  /** O status como veio — o chamador não precisa traduzir. */
  decisao: SubmissionStatus;
  /** O rótulo em português, pronto para a tela. */
  decisaoLabel: string;
  autores: string[];
  /** Já está na lista publicada (o organizador pode desmarcar). */
  jaPublicada: boolean;
  /** O estado da caixa: a pré-marcação, ou a escolha já gravada do organizador. */
  marcada: boolean;
}

/**
 * O que o organizador vê no seletor: TODAS as submissões da chamada, com o status da
 * decisão ao lado e as **aceitas pré-marcadas**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A PRÉ-MARCAÇÃO É UM PADRÃO, NÃO UMA REGRA — E ELA SÓ VALE NO PRIMEIRO ATO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Derivar a lista da decisão existe para o organizador não redigitar título e
 *  autoria de cada trabalho. Mas a partir do momento em que ele SALVOU o resultado
 *  (RASCUNHO, PARCIAL ou FINAL), a escolha é DELE: desmarcar uma aceita e salvar tem
 *  de continuar desmarcado, senão a caixa voltaria marcada na recarga e a decisão
 *  dele seria desfeita em silêncio.
 *
 *  Por isso o critério é o ESTADO, e não "a lista está vazia": um rascunho salvo com
 *  a lista vazia (porque ele desmarcou tudo) é uma escolha, e re-marcar as aceitas
 *  ali seria o mesmo defeito por outra porta.
 *
 * A ordem é a que o serviço passou (por protocolo, por título — decisão da consulta,
 * não deste módulo): o domínio não inventa ordem, e a lista publicada tem a ordem
 * que o organizador gravou.
 */
export function buildCallResultSelector(input: {
  resultado: CallResult;
  submissoes: readonly CallResultSelectorSource[];
}): readonly CallResultSelectorOption[] {
  const escolhaGravada = new Set(input.resultado.publicados);
  const primeiroAto = input.resultado.estado === 'SEM_RESULTADO';

  return input.submissoes.map((submissao) => {
    const jaPublicada = escolhaGravada.has(submissao.id);

    return {
      id: submissao.id,
      titulo: submissao.titulo,
      tipo: submissao.tipo,
      decisao: submissao.status,
      decisaoLabel: SUBMISSION_STATUS_LABELS[submissao.status],
      autores: [...submissao.autores],
      jaPublicada,
      marcada: primeiroAto ? isAcceptedSubmission(submissao.status) : jaPublicada,
    };
  });
}
