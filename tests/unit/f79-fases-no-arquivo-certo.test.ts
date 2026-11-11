/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS FASES NO ARQUIVO CERTO — a catraca do registro que mudou de lugar (FASE 79)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `AGENTS.md` encostou no teto de ~64.800 bytes porque a tabela da §9 carregava
 *  TODAS as fases desde a 1 — e o corte do harness (65.244 bytes) apaga conteúdo em
 *  silêncio. A FASE 79 resolveu isso por ESTRUTURA, não por redação: as fases
 *  **1 a 25** foram MOVIDAS (como estavam) para `docs/fases-historico.md`, e o
 *  `AGENTS.md` ficou com a tabela CORRENTE.
 *
 *  Um movimento que ninguém prende volta a acontecer: a próxima fase "só precisa
 *  acrescentar uma linha", alguém reencontra a linha antiga num diff e ela volta —
 *  ou some do histórico —, e o teto volta a apertar sem que ninguém perceba. Por
 *  isso o invariante é teste, e ele morde nos dois sentidos:
 *
 *    • fase MOVIDA NÃO pode aparecer como linha de tabela no `AGENTS.md`;
 *    • TODA fase corrente conhecida precisa estar na tabela do `AGENTS.md`;
 *    • fase que ninguém moveu NÃO pode aparecer no arquivo histórico;
 *    • o arquivo histórico guarda as fases movidas (hoje 1–25, 29, 30, 31–35, 36–42, 43–49,
 *      50–59 e 60), e cada uma tem o seu documento (`docs/fase-NN-*.md`) — o registro não se
 *      apaga, muda de arquivo;
 *    • a §9 do `AGENTS.md` aponta para o arquivo novo (o ponteiro é o que impede
 *      alguém de "consertar" a ausência das fases antigas recolocando as linhas).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELA NÃO PROVA (leia antes de confiar nela)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela NÃO compara o TEXTO das linhas movidas com o texto de antes — o estado
 *  anterior não vive no repositório. Quem provou o "movido como estava" foi o
 *  script da fase, comparando HEAD/tree com o arquivo novo, byte a byte. Esta
 *  catraca prende o LUGAR das fases, que é o que se degrada numa edição futura.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUANDO UMA FASE NOVA ENTRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Acrescente o número dela em `FASES_CORRENTES`. É de propósito que a lista seja
 *  explícita: o gesto de declarar a fase nova é o que mantém a catraca honesta —
 *  derivar de `docs/fase-NN-*.md` faria um documento de PLANO exigir uma linha de
 *  fase entregue.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
const AGENTS = 'AGENTS.md';
const HISTORICO = 'docs/fases-historico.md';

/** Linha de tabela cuja PRIMEIRA célula é o número da fase (`| 12 |`, `| 11A |`). */
const LINHA_DE_FASE = /^\|\s*([0-9]+[A-Z]?)\s*\|/;

/** O registro histórico: as fases que saíram da tabela corrente nas FASES 79, 82, 83, 84, 85 e 86. */
const FASES_HISTORICAS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11A',
  '11B',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '21',
  '22',
  '23',
  '24',
  '25',
  // Movidas na FASE 82: as duas mais antigas que restavam na tabela corrente,
  // quando a linha 82 fez o `AGENTS.md` encostar no teto outra vez.
  '29',
  '30',
  // Movidas na FASE 83: as cinco mais antigas que restavam (64.825 bytes com a
  // linha 83; as 31 a 35 desceram para o arquivo histórico).
  '31',
  '32',
  '33',
  '34',
  '35',
  // Movidas na FASE 84: as sete mais antigas que restavam (66.050 bytes com a
  // linha 84 — acima do corte de 65.244 do harness); as 36 a 42 desceram juntas.
  '36',
  '37',
  '38',
  '39',
  '40',
  '41',
  '42',
  // Movidas na FASE 85: as sete mais antigas que restavam (65.986 bytes com a
  // linha 85); as 43 a 49 desceram juntas, como estavam.
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  // Movidas na FASE 86: as sete mais antigas que restavam (a linha 86 fez o
  // `AGENTS.md` encostar no teto outra vez); as 50 a 56 desceram juntas, como
  // estavam, e a tabela corrente passou a começar na 57.
  '50',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  // Movidas na FASE 86 (segundo movimento): as três seguintes, depois de o
  // fechamento da fase acrescentar o parágrafo de dívidas e o ponteiro da §9.
  '57',
  '58',
  '59',
  // Movida na FASE 87: a mais antiga que restava, quando a linha nova e a
  // narrativa de dívidas encostaram no teto outra vez; a tabela passou a
  // começar na 61 e o `AGENTS.md` terminou em 63.048 bytes.
  '60',
  // Movidas na FASE 89: as duas mais antigas que restavam (65.027 bytes com a
  // linha 89); as 61 e 62 desceram juntas, como estavam, e a tabela passou a
  // começar na 63.
  '61',
  '62',
  // Movidas na FASE 91: as três mais antigas que restavam (quando o cadastro
  // de atividade separado encostou o `AGENTS.md` no teto de novo); as 63 a 65
  // desceram juntas, como estavam, e a tabela passou a começar na 66.
  '63',
  '64',
  '65',
  // Movidas na FASE 92: as duas mais antigas que restavam (quando a padronização
  // dos cards de salas encostou o `AGENTS.md` no teto de novo); as 66 e 67
  // desceram juntas, como estavam, e a tabela passou a começar na 68.
  '66',
  '67',
  // Movidas na FASE 93: as duas mais antigas que restavam (quando o cadastro de
  // chamadas dedicado encostou o `AGENTS.md` no teto de novo); a 68 e a 69 desceram
  // como estavam, e a tabela passou a começar na 70.
  '68',
  '69',
  // Movidas na FASE 94: as duas mais antigas que restavam (quando o cadastro de
  // patrocinadores dedicado encostou o `AGENTS.md` no teto de novo); a 70 e a 71 desceram
  // como estavam, e a tabela passou a começar na 72.
  '70',
  '71',
  // Movidas na FASE 95: as três mais antigas que restavam (quando o cadastro de
  // cartas dedicado encostou o `AGENTS.md` no teto de novo); a 72 a 74 desceram
  // como estavam, e a tabela passou a começar na 75.
  '72',
  '73',
  '74',
  // Movidas na FASE 96: as duas mais antigas que restavam (quando o fechamento
  // de pool, transação única, edição dedicada de carta e catraca de fronteira
  // encostou o `AGENTS.md` no teto de novo); a 75 e a 76 desceram como estavam,
  // e a tabela passou a começar na 77.
  '75',
  '76',
  // Movidas na FASE 97: as duas mais antigas que restavam (quando a unificação
  // de Missões e Palestrantes, loading.tsx e confirmação pós-criação encostou o
  // `AGENTS.md` no teto de novo); a 77 e a 78 desceram como estavam, e a tabela
  // passou a começar na 79.
  '77',
  '78',
  // Movidas na FASE 98: as duas mais antigas que restavam (quando o destravamento
  // de submissões, cockpit do comitê e concorrência de consultas encostou o
  // `AGENTS.md` no teto de novo); a 79 e a 80 desceram como estavam, e a tabela
  // passou a começar na 81.
  '79',
  '80',
  // Movidas na FASE 99: as duas mais antigas que restavam (quando o feedback global
  // de transição, filtros reativos e suspense granular encostou o `AGENTS.md` no teto);
  // a 81 e a 82 desceram como estavam, e a tabela passou a começar na 83.
  '81',
  '82',
];

/**
 * A tabela corrente começa na F83 — a 26, a 27 e a 28 nunca existiram; a 29 e a
 * 30 desceram na F82, a 31 a 35 na F83, a 36 a 42 na F84, a 43 a 49 na F85, a
 * 50 a 59 na F86, a 60 na F87, a 61 a 62 na F89, a 63 a 65 na F91, a 66 a 67 na F92, a 68 a 69 na F93, a 70 a 71 na F94, a 72 a 74 na F95, a 75 a 76 na F96, a 77 a 78 na F97, a 79 a 80 na F98 e a 81 a 82 na F99.
 *
 * A lista é DECLARADA, não derivada do `AGENTS.md`: é o gesto de declarar a fase
 * nova que mantém a catraca honesta (o comentário do cabeçalho explica).
 */
const FASES_CORRENTES = Array.from({ length: 17 }, (_, indice) => String(83 + indice));

/** A ordem da tabela histórica é a CRONOLÓGICA, não a numérica. */
const ORDEM_CRONOLOGICA = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11A', '11B', '12',
  '13', '14', '15', '16', '17', '23', '24', '25', '21', '22', '29', '30', '31', '32', '33', '34',
  '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '49', '50',
  '51', '52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65', '66', '67', '68', '69', '70', '71', '72', '73', '74', '75', '76', '77', '78', '79', '80', '81', '82'];

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8');
}

/** Extrai as linhas `| NN |` de um arquivo, na ordem em que aparecem. */
function tabelaDeFases(caminho: string): { fases: string[]; texto: Map<string, string> } {
  const fases: string[] = [];
  const texto = new Map<string, string>();

  for (const linha of ler(caminho).split(/\r?\n/)) {
    const achado = LINHA_DE_FASE.exec(linha);
    if (!achado) continue;

    const fase = achado[1];

    fases.push(fase);
    texto.set(fase, linha);
  }

  return { fases, texto };
}

function numeroDaFase(fase: string): number {
  return Number.parseInt(fase, 10);
}

const agents = tabelaDeFases(AGENTS);
const historico = tabelaDeFases(HISTORICO);

describe('FASE 79 · as fases movidas moram em docs/fases-historico.md', () => {
  it('não há fase do histórico como linha de tabela no AGENTS.md', () => {
    const invasoras = agents.fases.filter((fase) => FASES_HISTORICAS.includes(fase));

    expect(invasoras, 'estas fases voltaram para a tabela da §9; o lugar delas é o histórico').toEqual([]);
  });

  it('todas as fases > 25 estão na tabela corrente do AGENTS.md', () => {
    const ausentes = FASES_CORRENTES.filter((fase) => !agents.texto.has(fase));
    expect(ausentes, 'fases entregues que sumiram da §9').toEqual([]);

    const desconhecidas = agents.fases.filter((fase) => !FASES_CORRENTES.includes(fase));
    expect(desconhecidas, 'linha de fase que a catraca não conhece (declare-a em FASES_CORRENTES)').toEqual([]);
  });

  it('o arquivo histórico guarda as 57 fases movidas, na ordem cronológica, e só elas', () => {
    const emOrdemNumerica = [...historico.fases].sort(
      (a, b) => numeroDaFase(a) - numeroDaFase(b) || a.localeCompare(b),
    );

    // O CONJUNTO: as 25 fases históricas, sem sobra e sem falta.
    expect(emOrdemNumerica).toEqual(FASES_HISTORICAS);

    // A ORDEM: a cronológica da tabela original (a 21 e a 22 vêm depois da 25;
    // a 29 e a 30, movidas na F82, entram no fim).
    expect(historico.fases).toEqual(ORDEM_CRONOLOGICA);
  });

  it('o arquivo histórico não recebe fase que ninguém moveu (ele não cresce sozinho)', () => {
    const jovens = historico.fases.filter((fase) => !FASES_HISTORICAS.includes(fase));

    expect(jovens, 'fase recente no arquivo histórico: a tabela corrente é a do AGENTS.md').toEqual([]);
  });

  it('a §9 aponta para o arquivo histórico e cada fase histórica tem o seu documento', () => {
    const agentsInteiro = ler(AGENTS);
    const inicioDaSecao9 = agentsInteiro.indexOf('## 9.');
    const inicioDaSecao10 = agentsInteiro.indexOf('## 10.');

    expect(inicioDaSecao9, 'não achei a §9').toBeGreaterThan(-1);
    expect(inicioDaSecao10, 'não achei a §10').toBeGreaterThan(inicioDaSecao9);

    const secao9 = agentsInteiro.slice(inicioDaSecao9, inicioDaSecao10);
    expect(secao9, 'o ponteiro da §9 precisa apontar para docs/fases-historico.md').toContain(HISTORICO);

    // O registro não se apaga: cada fase histórica tem o documento dela em `docs/`.
    const documentos = readdirSync(join(RAIZ, 'docs'));
    const semDocumento = historico.fases.filter((fase) => {
      const prefixo = `fase-${fase.padStart(2, '0').toLowerCase()}-`;

      return !documentos.some((arquivo) => arquivo.startsWith(prefixo) && arquivo.endsWith('.md'));
    });

    expect(semDocumento, 'fase histórica sem docs/fase-NN-*.md: o registro completo se perdeu').toEqual([]);
  });
});
