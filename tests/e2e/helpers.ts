/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Utilitários para os testes E2E
 *
 *  Criam instituições e vínculos diretamente no banco (via conexão admin),
 *  porque a plataforma ainda não expõe UI de provisionamento — isso chega na
 *  FASE 7. Os testes E2E focam no que o usuário faz no navegador.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O SUFIXO É DA EXECUÇÃO; A LIMPEZA PASSOU A SER DO ARQUIVO (FASE 60 · I3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `RUN_ID` nasce uma vez por PROCESSO — e o Playwright roda a suíte inteira no
 *  MESMO processo (`workers: 1` e o registro de módulos do Node é reaproveitado
 *  entre arquivos). Medido com dois specs de diagnóstico na mesma execução:
 *
 *      [DIAG-A] RUN_ID=02ff3015
 *      [DIAG-B] RUN_ID=02ff3015
 *
 *  Ou seja: o sufixo identifica a EXECUÇÃO, não o arquivo. A limpeza por
 *  `slug contains RUN_ID` / `email contains RUN_ID` era, portanto, uma varredura
 *  DA EXECUÇÃO INTEIRA (~50 arquivos, uma vez por spec, sem índice), disparada pelo
 *  `afterAll` de cada arquivo — o que o nome promete é outra coisa: cada spec
 *  limpando o que criou. Medido também no banco: 350 instituições e 2.128 contas
 *  acumuladas de execuções anteriores, porque a limpeza depende de um `afterAll`
 *  que nem sempre roda (execução interrompida) e nada recolhe o que ficou.
 *
 *  A limpeza agora apaga **só o que ESTE arquivo criou** — e o que um arquivo
 *  anterior deixou para trás sem limpar (a janela é "desde a última limpeza"): as
 *  instituições saem pelos IDs anotados aqui e pela janela, as pessoas saem pelos
 *  IDs de `linkUser` e pela janela. Nada de varredura sem índice pela tabela
 *  inteira, e nada que possa alcançar um arquivo que ainda esteja rodando.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA: O QUE FAZ UMA SPEC SER INDEPENDENTE (FASE 62 · dívida I3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A casa pagou esta conta DUAS vezes — o **E71** (FASE 50: a suíte de credenciamento
 *  só passava na ordem em que foi escrita) e o **I3** (FASE 60/61: um caso lia o cartão
 *  do caso anterior, e um tropeço virava três vermelhos). As cinco regras abaixo são o
 *  que sobrou dessas duas contas. Elas valem para TODA spec nova:
 *
 *  1. CADA CASO CRIA O PRÓPRIO DADO, pelo caminho da tela, e espera pelo que ELE criou.
 *     Nada de `demands[0]`, `list.length`, "o primeiro da lista" ou qualquer coisa que
 *     outro caso tenha deixado. Contagem global não é âncora: `expect(total).toBe(2)`
 *     só vale enquanto o caso for o segundo a rodar.
 *
 *  2. A ESPERA É O FATO, NUNCA O GESTO. Espere o que o SERVIDOR gravou (um poll no
 *     banco) ou o que a tela passou a mostrar por causa disso — não o clique, nem o
 *     `press`, nem "deu tempo". Um `expect` de texto logo depois de uma Server Action
 *     pode não ter espera suficiente; e um gesto que só existe no cliente (o
 *     `onKeyDown`, o `input.click()`) pode ser ENGOLIDO antes da hidratação — nesse
 *     caso, repita o gesto ATÉ O FATO (ver `teclarAte` em `demand-board.spec.ts`, e o
 *     `dragAte`/`clickUntil` do resto da suíte). Aumentar timeout não conserta isso:
 *     o POST que não aconteceu não acontece porque se esperou mais.
 *
 *  3. NEGATIVA SÓ DEPOIS DA POSITIVA. "Isto não acontece" é uma prova fraca enquanto
 *     não se sabe que o mecanismo está vivo: um handler ausente e um handler que
 *     recusou a ação são indistinguíveis pelo silêncio. Prove primeiro que o caminho
 *     funciona (com outra tecla, outro clique) e só então afirme que ele não reagiu.
 *
 *  4. A ORDEM ENTRE ARQUIVOS É PROIBIDA COMO SOLUÇÃO. `RUN_ID` é por PROCESSO (e o
 *     Playwright reaproveita o registro de módulos entre arquivos com `workers: 1`),
 *     então dois arquivos compartilham o sufixo: prender ordem não isola nada — só
 *     esconde de quem lê. Se duas specs dependem uma da outra, o defeito é das duas.
 *
 *  5. A LIMPEZA É DO ARQUIVO (`cleanupRun` no `afterAll`), nunca da execução. Execução
 *     interrompida não roda `afterAll` e deixa sobra no banco: para isso existe
 *     `npm run e2e:clean` (simulação por padrão; apaga só com `--confirmar`).
 *
 *  O jeito de conferir se a spec é independente é rodá-la SOZINHA, caso a caso:
 *
 *      npx playwright test tests/e2e/<spec>.spec.ts --grep "<um caso só>"
 *
 *  Passar no arquivo inteiro e falhar sozinha é a assinatura do E71/I3.
 */
import { randomUUID } from 'node:crypto';
import { test } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.ts';

const connectionString =
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://eventflow_admin:eventflow_dev_password@localhost:5432/eventflow?schema=public';

export const e2eDb = new PrismaClient({ adapter: new PrismaPg(connectionString) });

/** Sufixo único por execução, para que os testes não colidam entre si. */
export const RUN_ID = randomUUID().slice(0, 8);

/**
 * O que ESTE arquivo de teste criou — a chave é o caminho do arquivo de spec.
 *
 * `test.info().file` só existe dentro de teste ou de hook, que é exatamente de
 * onde as fixtures e o `cleanupRun` são chamados.
 */
interface EscopoDoArquivo {
  /** Quando este arquivo começou a montar fixture: a janela das pessoas criadas. */
  desde: Date;
  /** Instituições criadas por `createTenant` neste arquivo. */
  tenants: Set<string>;
  /** Pessoas que este arquivo vinculou (`linkUser`). */
  usuarios: Set<string>;
}

const escopos = new Map<string, EscopoDoArquivo>();

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  O RELÓGIO DA LIMPEZA (FASE 60 · dívida I3)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `desde` sozinho não basta: há specs que **nunca chamam um helper** antes de criar
 *  as contas (a de rotinas automáticas monta as duas pessoas no `beforeAll` e só
 *  chama `cleanupRun` no fim). Para elas a janela começaria no `afterAll` e as contas
 *  ficariam para trás — medido: 2 usuários `f36.*` sobrevivendo à execução.
 *
 *  O relógio resolve isso sem afrouxar o isolamento: a janela de um arquivo é
 *  **desde a limpeza anterior** (ou desde a carga deste módulo, no primeiro arquivo).
 *  Como os arquivos rodam um depois do outro, o que cai na janela é sempre dado do
 *  arquivo ANTERIOR — que já terminou — ou deste; nunca de um arquivo em execução.
 */
let ultimaLimpeza = new Date();

/** O caminho do arquivo de spec em execução — a chave do escopo. */
function chaveAtual(): string {
  try {
    return test.info().file;
  } catch {
    // Fora de teste/hook (script, `--list`): cai num escopo só, que é o de antes.
    return 'sem-arquivo';
  }
}

function escopoAtual(): EscopoDoArquivo {
  const arquivo = chaveAtual();

  const existente = escopos.get(arquivo);
  if (existente) return existente;

  const novo: EscopoDoArquivo = { desde: new Date(), tenants: new Set(), usuarios: new Set() };
  escopos.set(arquivo, novo);

  return novo;
}

/**
 * Anota uma pessoa criada PELO ARQUIVO (fora dos helpers) para a limpeza levar.
 *
 * A maioria das specs cria contas pela API (`POST /api/auth/sign-up/email`) e
 * nunca passa por `linkUser`; a janela de tempo do escopo já as alcança, e esta
 * função existe para quem monta fixture antes da janela começar.
 */
export function trackTestUser(userId: string): void {
  escopoAtual().usuarios.add(userId);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;
}

/**
 * Cria uma instituição. O slug precisa ser válido segundo as regras do domínio
 * (minúsculas, sem hífen nas pontas), então derivamos dele o sufixo da execução.
 */
export async function createTenant(options: {
  label: string;
  name: string;
  status?: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
}) {
  const slug = `${options.label}-${RUN_ID}`.toLowerCase();

  const tenant = await e2eDb.tenant.create({
    data: {
      id: randomUUID(),
      slug,
      name: options.name,
      status: options.status ?? 'ACTIVE',
      plan: 'FREE',
    },
  });

  escopoAtual().tenants.add(tenant.id);

  return tenant;
}

/** Vincula um usuário a uma instituição. */
export async function linkUser(options: {
  tenantId: string;
  userId: string;
  status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  /**
   * Natureza do vínculo (FASE 14): o default é EQUIPE, que é o que os cenários de
   * RBAC esperam. `PARTICIPANT` existe para montar a fixture do público de eventos
   * sem passar pelo fluxo de inscrição pública.
   */
  kind?: 'MEMBER' | 'PARTICIPANT';
}) {
  const profile = await e2eDb.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId: options.tenantId,
      userId: options.userId,
      status: options.status ?? 'ACTIVE',
      kind: options.kind ?? 'MEMBER',
      joinedAt: options.status === 'INVITED' ? null : new Date(),
    },
  });

  escopoAtual().usuarios.add(options.userId);

  return profile;
}

/** Concede um papel. */
export async function grantRole(options: {
  tenantId: string;
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'ORGANIZER' | 'CHAIR' | 'REVIEWER' | 'STAFF' | 'SPEAKER' | 'PARTICIPANT';
  scope?: 'TENANT' | 'EVENT' | 'ACTIVITY';
  eventId?: string;
  /**
   * Alvo quando `scope = 'ACTIVITY'` (FASE 25).
   *
   * O papel de palestrante é concedido POR ATIVIDADE: quem ministra um minicurso não
   * ganha acesso ao evento inteiro. Sem poder apontar a atividade, a fixture não
   * conseguiria reproduzir o padrão que a própria plataforma recomenda.
   */
  activityId?: string;
}) {
  return e2eDb.$transaction(async (tx) => {
    // `role_assignments` está sob FORCE RLS: nem o admin escapa sem contexto.
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        userId: options.userId,
        role: options.role,
        scope: options.scope ?? 'TENANT',
        eventId: options.eventId ?? null,
        activityId: options.activityId ?? null,
      },
    });
  });
}

/**
 * Concede o papel de PLATAFORMA (FASE 9).
 *
 * Não há `tenantId` aqui de propósito: a governança da plataforma não pertence a
 * instituição alguma (`scope = PLATFORM`, `tenant_id = NULL`). A linha é inserida
 * pela conexão administrativa, que é o mesmo caminho do provisionamento real —
 * nenhuma transação de instituição enxerga uma concessão de plataforma.
 */
export async function grantPlatformRole(options: { userId: string; role?: 'SUPERADMIN' }) {
  return e2eDb.roleAssignment.create({
    data: {
      id: randomUUID(),
      tenantId: null,
      userId: options.userId,
      role: options.role ?? 'SUPERADMIN',
      scope: 'PLATFORM',
      reason: 'Concessão do teste E2E da FASE 9',
    },
  });
}

/** Cria um evento dentro de uma instituição (para papéis com escopo de evento). */

export async function createEvent(options: {
  tenantId: string;
  slug: string;
  title: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED';
  capacity?: number | null;
  startsAtOffsetDays?: number;
  summary?: string;
}) {
  const startsAt = new Date(Date.now() + (options.startsAtOffsetDays ?? 30) * 86_400_000);

  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.event.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        slug: options.slug,
        title: options.title,
        summary: options.summary ?? null,
        status: options.status ?? 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        city: 'Salvador',
        state: 'BA',
        capacity: options.capacity === undefined ? null : options.capacity,
        confirmedCount: 0,
        // Inscrições já abertas: o E2E não deve depender de relógio.
        registrationOpensAt: new Date(Date.now() - 86_400_000),
        registrationClosesAt: new Date(Date.now() + 20 * 86_400_000),
      },
    });
  });
}

/** Cria uma atividade dentro de um evento. */
export async function createActivity(options: {
  tenantId: string;
  eventId: string;
  slug: string;
  title: string;
  capacity?: number | null;
  waitlistEnabled?: boolean;
  status?: 'DRAFT' | 'SCHEDULED' | 'FULL' | 'CANCELED';
  workloadMinutes?: number;
  roomId?: string | null;
  startsAtOffsetDays?: number;
  /** `false` = atividade ABERTA: entra pela inscrição no evento (revisão da FASE 3). */
  requiresRegistration?: boolean;
  type?: 'LECTURE' | 'MINI_COURSE' | 'WORKSHOP' | 'ROUND_TABLE';
}) {
  const startsAt = new Date(Date.now() + (options.startsAtOffsetDays ?? 30) * 86_400_000);

  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.activity.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        eventId: options.eventId,
        slug: options.slug,
        title: options.title,
        description: 'Atividade criada para os testes E2E.',
        type: options.type ?? 'WORKSHOP',
        status: options.status ?? 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + (options.workloadMinutes ?? 120) * 60_000),
        workloadMinutes: options.workloadMinutes ?? 120,
        capacity: options.capacity === undefined ? 20 : options.capacity,
        waitlistEnabled: options.waitlistEnabled ?? false,
        confirmedCount: 0,
        waitlistCount: 0,
        roomId: options.roomId ?? null,
        requiresRegistration: options.requiresRegistration ?? true,
      },
    });
  });
}

/**
 * Cria uma sala no evento.
 *
 * `capacity: null` (ou ausente com `null` explícito) = sala SEM LIMITE definido —
 * é o estado que a revisão da FASE 3 passou a permitir e que os cenários de
 * "atividade ilimitada numa sala pequena" precisam montar. O default continua
 * sendo 50 lugares, para não mudar o significado das fixtures existentes.
 */
export async function createRoom(options: {
  tenantId: string;
  eventId: string;
  name: string;
  capacity?: number | null;
}) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${options.tenantId}, true)`;

    return tx.room.create({
      data: {
        id: randomUUID(),
        tenantId: options.tenantId,
        eventId: options.eventId,
        name: options.name,
        capacity: options.capacity === undefined ? 50 : options.capacity,
      },
    });
  });
}

/**
 * Remove todos os dados criados POR ESTE ARQUIVO de teste.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A JANELA DE TEMPO, E NÃO SÓ OS IDs (FASE 60 · dívida I3)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Instituições toda spec cria por `createTenant`, então o ID basta. As PESSOAS
 *  não: a maioria nasce de um `POST /api/auth/sign-up/email` dentro da própria
 *  spec, sem passar por aqui. Por isso elas saem pela JANELA — e a janela também
 *  vale para as instituições, porque um arquivo que não chama `cleanupRun` deixaria
 *  a sua para trás. A margem de 1 s cobre a diferença entre o relógio do Node e o
 *  `now()` do Postgres, que é quem grava `createdAt`.
 *
 *  A ordem importa: primeiro a instituição (a cascata leva eventos, inscrições,
 *  crachás, mídia), depois as pessoas — apagar a pessoa antes deixaria as duas
 *  tabelas pela metade.
 */
export async function cleanupRun(): Promise<void> {
  const escopo = escopoAtual();
  const janela = new Date(Math.min(escopo.desde.getTime(), ultimaLimpeza.getTime()) - 1_000);

  const tenants = await e2eDb.tenant.findMany({
    where: {
      OR: [
        { id: { in: [...escopo.tenants] } },
        { slug: { contains: RUN_ID }, createdAt: { gte: janela } },
      ],
    },
    select: { id: true },
  });

  const pessoas = await e2eDb.user.findMany({
    where: {
      OR: [
        { id: { in: [...escopo.usuarios] } },
        { email: { contains: RUN_ID }, createdAt: { gte: janela } },
      ],
    },
    select: { id: true },
  });

  const tenantIds = tenants.map((row) => row.id);
  const userIds = pessoas.map((row) => row.id);

  if (tenantIds.length > 0) {
    await e2eDb.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }

  if (userIds.length > 0) {
    await e2eDb.user.deleteMany({ where: { id: { in: userIds } } });
  }

  ultimaLimpeza = new Date();
  escopos.delete(chaveAtual());
}

/**
 * Cabeçalho que força o contexto de instituição em `localhost`.
 *
 * O Proxy só confia nesse header quando o host é o domínio raiz (ou localhost),
 * justamente para que um tenant não consiga forjar contexto no próprio domínio.
 * É o que torna possível testar subdomínios sem DNS wildcard.
 */
export function tenantHeaders(slug: string): Record<string, string> {
  return { 'x-ef-tenant': slug };
}
