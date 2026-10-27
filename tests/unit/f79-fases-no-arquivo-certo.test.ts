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
 *    • o arquivo histórico guarda as fases movidas (hoje 1–25, 29, 30, 31–35 e 36–42), e cada uma
 *      tem o seu documento (`docs/fase-NN-*.md`) — o registro não se apaga, muda de
 *      arquivo;
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

/** O registro histórico: as fases que saíram da tabela corrente na FASE 79, na FASE 82 e na FASE 83. */
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
];

/**
 * A tabela corrente começa na F43 — a 26, a 27 e a 28 nunca existiram; a 29 e a
 * 30 desceram na F82, a 31 a 35 na F83, e a 36 a 42 na F84.
 *
 * A lista é DECLARADA, não derivada do `AGENTS.md`: é o gesto de declarar a fase
 * nova que mantém a catraca honesta (o comentário do cabeçalho explica). A F80
 * acrescentou a linha 80 à §9 sem estender esta lista e deixou a árvore vermelha
 * (`expected [ '80' ] to deeply equal []`); a F81 estendeu até a 81, a F82 até a 82
 * e o movimento das fases 29 e 30 baixou o começo para a 31; a F83 estendeu até a
 * 83 e o movimento das 31 a 35 baixou o começo para a 36; a F84 estendeu até a 84 e o movimento das 36 a 42 baixou o começo para a 43.
 */
const FASES_CORRENTES = Array.from({ length: 42 }, (_, indice) => String(43 + indice));

/** A ordem da tabela histórica é a CRONOLÓGICA, não a numérica. */
const ORDEM_CRONOLOGICA = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11A', '11B', '12',
  '13', '14', '15', '16', '17', '23', '24', '25', '21', '22', '29', '30', '31', '32', '33', '34',
  '35', '36', '37', '38', '39', '40', '41', '42'];

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

  it('o arquivo histórico guarda as 37 fases movidas, na ordem cronológica, e só elas', () => {
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
