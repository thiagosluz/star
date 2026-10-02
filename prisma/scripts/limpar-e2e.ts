/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LIMPEZA DO DADO QUE A SUÍTE E2E DEIXOU PARA TRÁS (FASE 62 · dívida I3)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *      npm run e2e:clean                    # SIMULAÇÃO: conta e mostra o que sairia
 *      npm run e2e:clean -- --confirmar     # apaga de verdade
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Desde a FASE 60 cada arquivo de spec limpa o que ELE criou (`cleanupRun`), e isso
 *  resolveu a limpeza que varria a execução inteira. O que não resolve é a execução
 *  INTERROMPIDA: o `afterAll` não roda, e o que ficou não é recolhido por ninguém.
 *  Medido em 2026: ~350 instituições e ~2.150 contas acumuladas de execuções
 *  anteriores — e toda consulta da suíte passa a carregar esse peso junto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO ELE RECONHECE O QUE É DA SUÍTE (e não uma lista de rótulos que envelhece)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Toda spec cria a instituição por `createTenant` (`tests/e2e/helpers.ts`), e o slug
 *  é `<rótulo>-${RUN_ID}`, onde `RUN_ID = randomUUID().slice(0, 8)` — OITO dígitos
 *  hexadecimais minúsculos, sorteados a cada execução. É essa a impressão digital:
 *
 *      demandas-f38-9f3a1c07      ← a suíte criou
 *      ufba-demo                  ← o seed criou
 *
 *  As contas seguem a mesma marca: `<prefixo>.<RUN_ID>.<sufixo>@example.test`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELE NUNCA TOCA — e a razão de cada um
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • `ufba-demo` e `fiocruz-demo`: as duas instituições do seed de demonstração;
 *  • `ana@ / bruno@ / carla@ / diego@example.test`: o seed cria essas QUATRO contas
 *    sem senha, no MESMO domínio das contas de teste. Casar só por `@example.test`
 *    apagaria o dado de demonstração — por isso a lista literal E a marca de RUN_ID;
 *  • as contas `@eventflow.test` do `npm run db:seed:dev`;
 *  • a trilha de identidade (`identity_audit_logs`): é TRILHA, não dado de teste, e
 *    por desenho não tem FK. O relatório CONTA as linhas que apontam para as contas
 *    removidas e as deixa onde estão — apagar trilha é decisão de quem opera, não
 *    efeito colateral de uma limpeza.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS TRAVAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. O PADRÃO É A SIMULAÇÃO. Apagar exige `--confirmar`; sem ele, nada é escrito.
 *  2. `NODE_ENV=production` ABORTA. Não existe variável para contornar: em produção
 *     as instituições são de gente de verdade, e o casamento por rótulo de execução
 *     é uma heurística — heurística não decide o que apagar em produção.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';

import { adminPrisma } from '../../src/lib/db/admin-client.ts';

const line = '─'.repeat(78);

// ───────────────────────────────────────────────────────────────────────────────
//  Trava 2 — ambiente
// ───────────────────────────────────────────────────────────────────────────────
const nodeEnv = process.env.NODE_ENV ?? 'development';

if (nodeEnv === 'production') {
  console.error(
    [
      '',
      '  ✖ RECUSADO: esta limpeza apaga instituições e contas por semelhança de rótulo,',
      '    e NÃO roda em produção. Em produção, apagar é decisão de quem opera, olhando',
      '    caso a caso pelo painel de governança.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const confirmar = args.includes('--confirmar');
const simulacao = !confirmar || args.includes('--dry-run');

/**
 * A impressão digital da execução no slug: oito dígitos hexadecimais no fim.
 *
 * O hífen é exigido para que o sufixo seja um SEGMENTO do slug, e não um pedaço de
 * uma palavra: `ufba-demo` não casa, `demandas-f38-9f3a1c07` casa.
 */
const MARCA_DE_EXECUCAO_NO_SLUG = /-[0-9a-f]{8}$/;

/** A mesma marca no endereço: um segmento inteiro de oito hexadecimais. */
const MARCA_DE_EXECUCAO_NO_EMAIL = /(^|\.)[0-9a-f]{8}(\.|@)/;

const DOMINIO_DA_SUITE = '@example.test';

/** Instituições de demonstração: preservadas por decisão, não por sorte de rótulo. */
const TENANTS_PRESERVADOS = ['ufba-demo', 'fiocruz-demo'];

/** O seed cria estas quatro contas SEM senha, no mesmo domínio das contas de teste. */
const CONTAS_DO_SEED = [
  'ana@example.test',
  'bruno@example.test',
  'carla@example.test',
  'diego@example.test',
];

/** Quantas linhas de cada lista o relatório mostra antes de resumir. */
const AMOSTRA = 12;

function listar(itens: readonly string[]): string {
  if (itens.length <= AMOSTRA) return itens.join(', ') || '—';

  return `${itens.slice(0, AMOSTRA).join(', ')} … e mais ${itens.length - AMOSTRA}`;
}

function ehTenantDaSuite(slug: string): boolean {
  return MARCA_DE_EXECUCAO_NO_SLUG.test(slug) && !TENANTS_PRESERVADOS.includes(slug);
}

function ehContaDaSuite(email: string): boolean {
  if (CONTAS_DO_SEED.includes(email)) return false;

  return email.endsWith(DOMINIO_DA_SUITE) && MARCA_DE_EXECUCAO_NO_EMAIL.test(email);
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS CONTAS QUE O BANCO RECUSA APAGAR (FK `Restrict`)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Três relações para `User` são `onDelete: Restrict`: `Submission.submittedById`,
 *  `Raffle.createdById` e `RaffleRound.createdById` — o banco não deixa apagar a conta
 *  que assina trabalho acadêmico ou sorteio. No caso normal a cascata da INSTITUIÇÃO
 *  resolve (o dado sai junto com ela), mas quando a referência está numa instituição
 *  PRESERVADA a remoção da conta falharia no meio da limpeza, deixando o serviço pela
 *  metade. Por isso isto é medido ANTES, no `--dry-run`: quem assina trabalho fora do
 *  conjunto a apagar é PULADO, com o motivo escrito.
 */
async function contasPresasPorTrabalho(
  contaIds: readonly string[],
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  const presas = new Map<string, string>();

  if (contaIds.length === 0) return presas;

  /** `notIn: []` não é filtro nenhum — sem instituições a apagar, tudo está "fora". */
  const fora = tenantIds.length > 0 ? { tenantId: { notIn: [...tenantIds] } } : {};

  const submissions = await adminPrisma.submission.findMany({
    where: { submittedById: { in: [...contaIds] }, ...fora },
    select: { submittedById: true },
  });

  const raffles = await adminPrisma.raffle.findMany({
    where: { createdById: { in: [...contaIds] }, ...fora },
    select: { createdById: true },
  });

  const rounds = await adminPrisma.raffleRound.findMany({
    where: { createdById: { in: [...contaIds] }, ...fora },
    select: { createdById: true },
  });

  for (const row of submissions) presas.set(row.submittedById, 'assina submissão');
  for (const row of raffles) presas.set(row.createdById, 'criou sorteio');
  for (const row of rounds) presas.set(row.createdById, 'criou rodada de sorteio');

  return presas;
}

async function main(): Promise<void> {
  console.log(`\n${line}`);
  console.log('  LIMPEZA DO DADO DE TESTE DO E2E (FASE 62 · dívida I3)');
  console.log(line);
  console.log(
    `  modo: ${simulacao ? 'SIMULAÇÃO — nada é apagado (use --confirmar)' : 'APAGANDO DE VERDADE'}`,
  );
  console.log(`  critério: instituição com slug \`-<8 hexadecimais>\` · conta @example.test com a mesma marca`);

  const tenants = await adminPrisma.tenant.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { slug: 'asc' },
  });

  const contas = await adminPrisma.user.findMany({
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
  });

  const tenantsDaSuite = tenants.filter((tenant) => ehTenantDaSuite(tenant.slug));
  const tenantsPreservados = tenants.filter((tenant) => !ehTenantDaSuite(tenant.slug));
  const contasDaSuite = contas.filter((conta) => ehContaDaSuite(conta.email));
  const contasPreservadas = contas.filter((conta) => !ehContaDaSuite(conta.email));

  /** A trava do `Restrict`: mede quem NÃO pode ser apagado antes de tentar. */
  const presas = await contasPresasPorTrabalho(
    contasDaSuite.map((conta) => conta.id),
    tenantsDaSuite.map((tenant) => tenant.id),
  );

  const contasApagaveis = contasDaSuite.filter((conta) => !presas.has(conta.id));
  const contasTravadas = contasDaSuite.filter((conta) => presas.has(conta.id));

  const contasDoSeedPresentes = contasPreservadas.filter((conta) =>
    CONTAS_DO_SEED.includes(conta.email),
  );
  const contasDeDemonstracao = contasPreservadas.filter((conta) =>
    conta.email.endsWith('@eventflow.test'),
  );

  // ── O que sai ────────────────────────────────────────────────────────────────
  console.log(`\n  ${line}`);
  console.log('  SERIA APAGADO');
  console.log(line);
  console.log(`  instituições ......... ${tenantsDaSuite.length}`);
  console.log(`     ${listar(tenantsDaSuite.map((tenant) => tenant.slug))}`);
  console.log(`  contas ............... ${contasApagaveis.length}`);
  console.log(`     ${listar(contasApagaveis.map((conta) => conta.email))}`);

  /**
   * A medida da trava: zero aqui significa que a remoção das contas NÃO encontra
   * obstáculo de chave estrangeira — e é isso que o modo que apaga vai enfrentar.
   */
  console.log(
    `  contas travadas por FK Restrict: ${contasTravadas.length}` +
      (contasTravadas.length === 0
        ? '  ← nenhuma: a remoção das contas não encontra obstáculo'
        : `  ← PULADAS (${listar(contasTravadas.map((conta) => `${conta.email}: ${presas.get(conta.id)}`))})`),
  );

  // ── O que fica (a prova de que o seed e a demonstração não são alcançados) ───
  console.log(`\n  ${line}`);
  console.log('  PRESERVADO');
  console.log(line);
  console.log(`  instituições ......... ${tenantsPreservados.length}`);
  console.log(`     ${listar(tenantsPreservados.map((tenant) => tenant.slug))}`);
  console.log(`  contas ............... ${contasPreservadas.length}`);
  console.log(`     ${listar(contasPreservadas.map((conta) => conta.email))}`);

  console.log(`\n  as duas de demonstração, nominalmente:`);

  for (const slug of TENANTS_PRESERVADOS) {
    const encontrada = tenantsPreservados.find((tenant) => tenant.slug === slug);
    console.log(
      `     ${slug.padEnd(16)} ${encontrada ? `✓ preservada (${encontrada.name})` : '· não existe neste banco'}`,
    );
  }

  console.log(`\n  as quatro contas do seed (mesmo domínio das de teste), nominalmente:`);

  for (const email of CONTAS_DO_SEED) {
    const encontrada = contasDoSeedPresentes.find((conta) => conta.email === email);
    console.log(`     ${email.padEnd(26)} ${encontrada ? '✓ preservada' : '· não existe neste banco'}`);
  }

  console.log(
    `\n  contas @eventflow.test (seed de desenvolvimento) preservadas: ${contasDeDemonstracao.length}`,
  );

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A PILHA QUE NÃO É DESTA SUÍTE, DITA EM VOZ ALTA
   * ─────────────────────────────────────────────────────────────────────────────
   *  O banco de teste carrega OUTRA pilha de contas de exemplo — no domínio
   *  `@exemplo.test` (em português), não `@example.test`. Elas nascem dos testes de
   *  INTEGRAÇÃO do Vitest (`tests/integration/**`), que gravam direto no banco com a
   *  fixture deles. NÃO são deste script: a instrução é apagar o que a suíte E2E
   *  criou, e apagar a fixture de outro teste por semelhança seria o mesmo defeito
   *  que esta fase está consertando. O número fica no relatório para que a sobra seja
   *  uma decisão visível, e não uma surpresa.
   */
  const deIntegracao = contasPreservadas.filter((conta) => conta.email.endsWith('@exemplo.test'));

  console.log(
    `\n  FORA DO ESCOPO (não é desta suíte): ${deIntegracao.length} conta(s) @exemplo.test`,
  );
  console.log('     fixture dos testes de INTEGRAÇÃO do Vitest — este script não as toca.');

  /**
   * A trilha de identidade não tem FK de propósito (FASE 49): ela sobrevive às contas.
   * O número é dito em voz alta para que a sobra seja uma decisão visível.
   */
  const trilha = await adminPrisma.identityAuditLog.count({
    where: { userId: { in: contasDaSuite.map((conta) => conta.id) } },
  });

  console.log(
    `  trilha de identidade dessas contas: ${trilha} linha(s) CONTINUAM (é trilha, e não tem FK)`,
  );

  if (simulacao) {
    console.log(`\n${line}`);
    console.log('  Nada foi apagado. Para apagar: npm run e2e:clean -- --confirmar');
    console.log(`${line}\n`);
    return;
  }

  // ── Apagar ───────────────────────────────────────────────────────────────────
  const inicio = Date.now();
  const tenantIds = tenantsDaSuite.map((tenant) => tenant.id);
  const contaIds = contasApagaveis.map((conta) => conta.id);

  console.log(`\n  ${line}`);
  console.log('  APAGANDO');
  console.log(line);

  /**
   * A ORDEM IMPORTA e é a mesma do `cleanupRun`: primeiro a INSTITUIÇÃO (a cascata
   * leva eventos, inscrições, submissões, sorteios, mídia), depois as pessoas. Ao
   * contrário, um `Submission.author` (FK `Restrict`) barraria a remoção da conta.
   */
  if (tenantIds.length > 0) {
    const removidos = await adminPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    console.log(`  instituições apagadas  ${removidos.count}`);
  } else {
    console.log('  instituições apagadas  0');
  }

  if (contaIds.length > 0) {
    const removidas = await adminPrisma.user.deleteMany({ where: { id: { in: contaIds } } });
    console.log(`  contas apagadas ....... ${removidas.count}`);
  } else {
    console.log('  contas apagadas ....... 0');
  }

  console.log(`\n${line}`);
  console.log(`  concluído em ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
  console.log(`${line}\n`);
}

main()
  .catch((erro: unknown) => {
    console.error(
      `\n  ✗ Falha na limpeza: ${erro instanceof Error ? erro.message : String(erro)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await adminPrisma.$disconnect().catch(() => undefined);
  });
