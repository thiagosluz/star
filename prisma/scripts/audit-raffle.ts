/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONFERIR UM SORTEIO FORA DO SITE (FASE 29)
 *
 *      npx tsx prisma/scripts/audit-raffle.ts --semente <hex> --lista lista.json
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE SCRIPT EXISTE, E POR QUE ELE **IMPORTA** A REGRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página de auditoria publica uma receita para conferir o sorteio sem passar por
 *  ela: os dois primeiros passos são `sha256sum` puro, e o terceiro precisa rodar a
 *  SELEÇÃO. Se a receita mandasse "escreva um script", ela seria uma promessa a mais
 *  — o defeito exato que a FASE 29 veio corrigir.
 *
 *  A tentação era copiar a seleção para um `.mjs` sem dependências. Isso criaria uma
 *  TERCEIRA implementação da mesma regra, e a auditoria passaria a conferir uma
 *  regra que pode não ser a que rodou. Aqui a seleção vem do módulo compartilhado
 *  (`src/domain/raffles/draw-selection.ts`, o mesmo que o servidor e o navegador
 *  usam) e o gerador é o do servidor (`createSeededRandomInt`, em `node:crypto`).
 *  Não há cópia para divergir.
 *
 *  O script NÃO toca no banco e NÃO precisa de `.env`: entra a semente e a lista
 *  publicada, sai a ordem das posições. É de propósito — quem audita não deveria
 *  precisar de credencial nenhuma.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ENTRADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `--lista` é o documento canônico publicado na página de auditoria: o JSON
 *  `[{ index, code, minutes }, …]`. `--vagas` diz quantas posições foram sorteadas
 *  (titulares + suplentes; padrão: a lista inteira) e `--peso` liga o sorteio
 *  proporcional aos minutos. `--resultado` recebe os códigos publicados, separados
 *  por vírgula, e transforma a saída em veredito: `confere` ou `DIVERGE`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { reproduceFromPool, type RafflePoolEntry } from '../../src/domain/raffles/draw-selection.ts';
import { createSeededRandomInt } from '../../src/domain/raffles/raffle-rules.ts';

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;

    if (!token.startsWith('--')) continue;

    const [flag, inline] = token.slice(2).split('=');
    const next = argv[index + 1];

    if (inline !== undefined) {
      args[flag!] = inline;
    } else if (next && !next.startsWith('--')) {
      args[flag!] = next;
      index += 1;
    } else {
      args[flag!] = true;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));

const usage =
  'Uso: npx tsx prisma/scripts/audit-raffle.ts --semente <hex> --lista <arquivo.json> [--vagas N] [--peso] [--resultado P-AAA,P-BBB]';

if (typeof args.semente !== 'string' || typeof args.lista !== 'string') {
  console.error(usage);
  process.exit(1);
}

const pool = JSON.parse(readFileSync(args.lista, 'utf8')) as RafflePoolEntry[];

if (!Array.isArray(pool) || pool.length === 0) {
  console.error('A lista precisa ser um JSON não vazio: [{ index, code, minutes }, …].');
  process.exit(1);
}

const vacancies = typeof args.vagas === 'string' ? Number(args.vagas) : pool.length;
const weightByMinutes = args.peso === true || args.peso === 'true';

const drawn = reproduceFromPool({
  pool,
  count: vacancies,
  weightByMinutes,
  randomInt: createSeededRandomInt(args.semente),
});

console.log(`\nSemente ......... ${args.semente}`);
console.log(
  `Lista ........... ${pool.length} participante(s) · ${vacancies} vaga(s) · ${
    weightByMinutes ? 'ponderado por minutos' : 'chance igual'
  }\n`,
);

const expected =
  typeof args.resultado === 'string' ? args.resultado.split(',').map((item) => item.trim()) : null;

let diverged = 0;

drawn.forEach((entry, index) => {
  const position = index + 1;
  const expectedCode = expected ? expected[index] : null;
  const verdict =
    expectedCode === undefined || expectedCode === null
      ? ''
      : expectedCode === entry.code
        ? ' · confere'
        : ' · DIVERGE';

  if (expectedCode !== null && expectedCode !== undefined && expectedCode !== entry.code) {
    diverged += 1;
  }

  console.log(
    `${String(position).padStart(3)}º ${entry.code}  (${entry.minutes} min, índice ${entry.index})${verdict}`,
  );
});

if (expected) {
  console.log(
    diverged === 0
      ? '\nConfere: as posições reproduzem exatamente o resultado publicado.\n'
      : `\nDIVERGE em ${diverged} posição(ões): a lista ou a semente não correspondem ao resultado publicado.\n`,
  );

  process.exit(diverged === 0 ? 0 : 2);
}

console.log('');
