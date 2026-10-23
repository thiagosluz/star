/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE CATRACA — OS DOIS SERVIÇOS FRACIONADOS
 *                                          (FASE 75 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM TESTE QUE LÊ O CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 3 tirou a LEITURA de `raffle-service` e de `registration-service` e
 *  deixou a ESCRITA onde estava, porque ela divide UMA transação. O risco de um
 *  refactor assim não é apagar uma função — é a próxima pessoa "arrumar" o arquivo
 *  de escrita movendo `cancelRegistration` para o irmão de leitura (parece
 *  organização, é perda de atomicidade), ou dar `withTenant` a uma função que já
 *  recebe `tx` (parece independência, é transação aninhada).
 *
 *  Este teste é a CATRACA, e ele lê o TEXTO:
 *
 *    1. a lista das funções de ESCRITA não pode sair do arquivo original — se
 *       alguém as mover, reprova;
 *    2. toda função que recebe `tx` NÃO pode abrir `withTenant`/`$transaction`
 *       própria (a transação é do chamador);
 *    3. as LEITURAS que saíram não escrevem: nada de `recordAudit`, `$transaction`,
 *       `$executeRaw` nem verbo de escrita em `tx.<modelo>`;
 *    4. a direção do grafo é única: os irmãos de leitura não importam o serviço de
 *       escrita (ciclo de importação é a armadilha que o cabeçalho evita).
 *
 *  A extração da fatia foi MECÂNICA, e este arquivo é o que impede que a próxima
 *  edição a desfaça por engano.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const RAIZ = process.cwd();

const RAFFLE_ESCRITA = 'src/lib/raffles/raffle-service.ts';
const RAFFLE_LEITURA = 'src/lib/raffles/raffle-read-service.ts';
const RAFFLE_PUBLICO = 'src/lib/raffles/raffle-public-view-service.ts';
const INSCRICAO_ESCRITA = 'src/lib/events/registration-service.ts';
const INSCRICAO_LEITURA = 'src/lib/events/registration-read-service.ts';

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

interface Funcao {
  nome: string;
  /** Declaração inteira (assinatura + corpo + comentário não entram: só o nó). */
  texto: string;
  exportada: boolean;
}

/**
 * As funções de topo do arquivo, pelo parser do TypeScript.
 *
 * Regex sobre o texto erraria em corpo com template literal (as consultas SQL
 * usam `` `${...}` ``) — e catraca que erra o alvo reprova por motivo errado.
 */
function funcoesDe(caminho: string): Funcao[] {
  const fonte = ts.createSourceFile(
    caminho,
    ler(caminho),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const funcoes: Funcao[] = [];

  for (const declaracao of fonte.statements) {
    if (!ts.isFunctionDeclaration(declaracao) || !declaracao.name || !declaracao.body) {
      continue;
    }

    funcoes.push({
      nome: declaracao.name.text,
      texto: declaracao.getText(fonte),
      exportada: (declaracao.modifiers ?? []).some(
        (modificador) => modificador.kind === ts.SyntaxKind.ExportKeyword,
      ),
    });
  }

  return funcoes;
}

function nomesDe(caminho: string): string[] {
  return funcoesDe(caminho).map((funcao) => funcao.nome);
}

/** O arquivo importa algo cujo módulo casa com o trecho? (lido do AST, não do texto) */
function importaDe(caminho: string, trecho: string): boolean {
  const fonte = ts.createSourceFile(
    caminho,
    ler(caminho),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  return fonte.statements.some(
    (declaracao) =>
      ts.isImportDeclaration(declaracao) &&
      declaracao.moduleSpecifier.getText(fonte).includes(trecho),
  );
}

function funcaoChamada(caminho: string, nome: string): Funcao {
  const encontrada = funcoesDe(caminho).find((funcao) => funcao.nome === nome);

  if (!encontrada) {
    throw new Error(`função ${nome} não existe em ${caminho}`);
  }

  return encontrada;
}

/** A primeira posição de parâmetro nomeada `tx` com tipo `TxClient`. */
function recebeTx(funcao: Funcao): boolean {
  return /\btx\s*:\s*TxClient\b/.test(funcao.texto);
}

// ───────────────────────────────────────────────────────────────────────────────
//  1. As escritas que NÃO podem sair do arquivo original
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A lista é o contrato da fatia. `drawRaffle` entra como ESCRITA porque é o atalho
 * que apura a rodada preparada — ele delega a `drawRound`, mas continua sendo um
 * caminho de escrita, e movê-lo para o arquivo de leitura seria tão errado quanto
 * mover o próprio `drawRound`.
 */
const ESCRITAS_DO_RAFFLE = [
  'createRaffle',
  'prepareRound',
  'drawRound',
  'drawRaffle',
  'updateRoundAnnouncement',
  'markPrizeDelivered',
  'reversePrizeDelivery',
  'setRaffleVisibility',
  'setBigscreenVisibility',
  'cancelRaffle',
] as const;

/**
 * `cancelRegistration` é a que mais parece "só uma leitura com status": ela libera
 * a vaga, decrementa o contador e promove o próximo NA MESMA transação (ADR-175/178).
 * Fica registrada aqui, com o motivo, para que a semelhança não engane.
 */
const ESCRITAS_DA_INSCRICAO = [
  'attemptRegistration',
  'tryReserveSeat',
  'admitToEventRegistration',
  'cancelRegistration',
  'updateEventRegistrationData',
  'syncOpenActivityEnrollments',
  'acceptPromotion',
] as const;

describe('as funções de ESCRITA continuam no serviço original', () => {
  it('as escritas do sorteio estão no raffle-service e em nenhum irmão de leitura', () => {
    const original = nomesDe(RAFFLE_ESCRITA);
    const leitura = [...nomesDe(RAFFLE_LEITURA), ...nomesDe(RAFFLE_PUBLICO)];

    for (const nome of ESCRITAS_DO_RAFFLE) {
      expect(original, `${nome} sumiu de ${RAFFLE_ESCRITA}`).toContain(nome);
      expect(leitura, `${nome} foi movida para um arquivo de leitura`).not.toContain(nome);
    }
  });

  it('as escritas da inscrição estão no registration-service e em nenhum irmão de leitura', () => {
    const original = nomesDe(INSCRICAO_ESCRITA);
    const leitura = nomesDe(INSCRICAO_LEITURA);

    for (const nome of ESCRITAS_DA_INSCRICAO) {
      expect(original, `${nome} sumiu de ${INSCRICAO_ESCRITA}`).toContain(nome);
      expect(leitura, `${nome} foi movida para um arquivo de leitura`).not.toContain(nome);
    }
  });

  it('as leituras que saíram não ficaram para trás no original', () => {
    const raffleOriginal = nomesDe(RAFFLE_ESCRITA);
    const inscricaoOriginal = nomesDe(INSCRICAO_ESCRITA);

    for (const nome of [
      'listRaffles',
      'listPublicRaffleResults',
      'getPublicRaffleResult',
      'getRaffleLiveState',
      'getRaffleStageView',
      'getRaffleAudit',
      'previewEligibility',
      'getLiveEligibility',
    ]) {
      expect(raffleOriginal, `${nome} voltou para ${RAFFLE_ESCRITA}`).not.toContain(nome);
    }

    for (const nome of [
      'listMyRegistrations',
      'findMyEventRegistration',
      'readEventRegistrationFields',
      'findMyRegistrationFor',
      'readActivityCounters',
      'listEventWaitlist',
    ]) {
      expect(inscricaoOriginal, `${nome} voltou para ${INSCRICAO_ESCRITA}`).not.toContain(nome);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  2. Quem recebe `tx` não abre transação própria
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A regra vale para TODA função que recebe `tx`, e não só para as listadas: se a
 * próxima fase criar outra recebedora, ela entra na catraca sem precisar de lista.
 * Abrir `withTenant` aqui dentro trocaria "participa da transação do chamador" por
 * "abre outra, sem ver o que ainda não foi gravado" — exatamente o defeito que a
 * fatia evita.
 */
const SERVICOS = [RAFFLE_ESCRITA, INSCRICAO_ESCRITA] as const;

describe('função que recebe tx não ganha transação própria', () => {
  for (const caminho of SERVICOS) {
    it(`${caminho}: nenhuma recebedora de tx contém withTenant/$transaction`, () => {
      const recebedoras = funcoesDe(caminho).filter(recebeTx);

      // A lista não pode esvaziar: se esvaziar, a catraca deixou de olhar o alvo.
      expect(recebedoras.length, `nenhuma função com tx em ${caminho}`).toBeGreaterThan(0);

      for (const funcao of recebedoras) {
        expect(funcao.texto, `${funcao.nome} abriu withTenant própria`).not.toContain('withTenant(');
        expect(funcao.texto, `${funcao.nome} abriu $transaction`).not.toContain('$transaction');
      }
    });
  }

  it('as recebedoras de tx declaradas continuam sendo as mesmas', () => {
    const nomes = funcoesDe(INSCRICAO_ESCRITA)
      .filter(recebeTx)
      .map((funcao) => funcao.nome);

    for (const nome of [
      'tryReserveSeat',
      'admitToEventRegistration',
      'enrollEventRegistrationInOpenActivities',
      'promoteNextFromWaitlist',
      'promoteNextFromEventWaitlist',
      'reindexWaitlist',
    ]) {
      expect(nomes, `${nome} deixou de receber tx`).toContain(nome);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  3. Leitura não escreve
// ───────────────────────────────────────────────────────────────────────────────
/**
 * `tx.` sozinho NÃO é sinal de escrita: toda leitura sob RLS consulta por
 * `tx.raffle.findFirst`, `tx.registration.findMany` etc. O que a catraca proíbe é o
 * VERBO de escrita e as saídas que furam a transação de leitura — o que a frase
 * "leitura não escreve" quer dizer no código.
 *
 * A checagem roda sobre o CORPO das funções (nó do AST), e não sobre o arquivo
 * inteiro: os comentários deste projeto CITAM `recordAudit` e `$transaction` para
 * explicar por que eles não estão ali, e uma catraca que lê comentário reprova por
 * motivo errado.
 */
const VERBO_DE_ESCRITA_EM_TX =
  /\btx\.[A-Za-z_$][\w$]*\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const FURO_DE_TRANSACAO = /\$(transaction|executeRaw|executeRawUnsafe)\b/;

describe('as leituras extraídas não escrevem', () => {
  for (const caminho of [RAFFLE_LEITURA, RAFFLE_PUBLICO, INSCRICAO_LEITURA]) {
    it(`${caminho}: sem recordAudit, sem transação e sem verbo de escrita`, () => {
      expect(importaDe(caminho, 'lib/admin/audit'), `${caminho} importou a trilha`).toBe(false);

      for (const funcao of funcoesDe(caminho)) {
        expect(funcao.texto, `${funcao.nome} passou a auditar`).not.toContain('recordAudit');
        expect(funcao.texto, `${funcao.nome} abriu $transaction`).not.toContain('$transaction');
        expect(funcao.texto, `${funcao.nome} executou SQL cru`).not.toMatch(FURO_DE_TRANSACAO);
        expect(funcao.texto, `${funcao.nome} escreveu por tx`).not.toMatch(VERBO_DE_ESCRITA_EM_TX);
      }
    });
  }

  it('cada leitura exportada consulta de verdade (o gate não é vazio)', () => {
    const exportadas = (caminho: string): Funcao[] =>
      funcoesDe(caminho).filter((funcao) => funcao.exportada);

    for (const caminho of [RAFFLE_LEITURA, RAFFLE_PUBLICO, INSCRICAO_LEITURA]) {
      const consultas = exportadas(caminho).filter((funcao) => funcao.texto.includes('tx.'));

      expect(consultas.length, `${caminho} não tem leitura nenhuma`).toBeGreaterThan(0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  4. A direção do grafo: leitura não importa escrita
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Se o irmão de leitura importasse o serviço original, a extração criaria um CICLO
 * (`escrita → leitura` para os leitores do universo, `leitura → escrita` pelo
 * import). O cabeçalho de ambos explica a direção; esta catraca a prende.
 */
describe('o grafo de importação não tem ciclo entre os irmãos', () => {
  it('os arquivos de leitura não importam o serviço de escrita', () => {
    expect(ler(RAFFLE_LEITURA)).not.toContain("from '@/lib/raffles/raffle-service'");
    expect(ler(RAFFLE_PUBLICO)).not.toContain("from '@/lib/raffles/raffle-service'");
    expect(ler(INSCRICAO_LEITURA)).not.toContain("from '@/lib/events/registration-service'");
  });

  it('o serviço de escrita do sorteio importa os leitores do universo do irmão', () => {
    const texto = ler(RAFFLE_ESCRITA);

    expect(texto).toContain("from '@/lib/raffles/raffle-read-service'");
    for (const nome of ['loadAttendances', 'loadPriorWinnerIds', 'loadRaffleWinnerIds']) {
      expect(funcaoChamada(RAFFLE_LEITURA, nome).exportada, `${nome} não é exportada`).toBe(true);
    }
  });
});
