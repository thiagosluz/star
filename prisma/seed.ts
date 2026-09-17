/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Seed de desenvolvimento — FASE 2
 *
 *  Cria duas instituições com o MESMO usuário atuando em papéis diferentes, e um
 *  terceiro usuário com vínculo em apenas uma. Esse arranjo é o que permite
 *  verificar de verdade:
 *
 *    • acúmulo de papéis (Palestrante + Revisor no mesmo evento);
 *    • papéis por escopo (Organizador em A, apenas Participante em B);
 *    • troca de contexto sem perda de sessão;
 *    • isolamento entre instituições (a RLS impede que A veja dados de B).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ATENÇÃO — POR QUE ESTE SEED DEFINE CONTEXTO DE TENANT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A role `eventflow_admin` é DONA das tabelas e as policies usam
 *  `FORCE ROW LEVEL SECURITY`. Isso significa que nem o admin escapa da RLS:
 *  todo INSERT em tabela de tenant precisa de `app.tenant_id` definido. É
 *  intencional — o seed falha ruidosamente se alguém esquecer o contexto, em vez
 *  de gravar dados malformados.
 *
 *  Uso:
 *      npm run db:seed
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.MIGRATE_DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATE_DATABASE_URL não definida. Copie .env.example para .env.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

// ───────────────────────────────────────────────────────────────────────────────
//  Utilidades
// ───────────────────────────────────────────────────────────────────────────────
const line = '─'.repeat(78);

/**
 * Executa `fn` em uma transação com o contexto de tenant aplicado.
 * Equivalente ao `withTenant()` da aplicação, mas usando a conexão admin —
 * afinal, o seed precisa criar os próprios tenants.
 */
async function inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn();
  });
}

/** Datas relativas, para que o seed continue coerente quando for executado. */
const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

async function main() {
  console.log(`\n${line}\n  SEED — EventFlow (FASE 4)\n${line}\n`);

  // ── Limpeza idempotente ────────────────────────────────────────────────────
  // Remove apenas os dados deste seed, identificados pelos e-mails/slugs abaixo.
  const seedEmails = [
    'ana@example.test',
    'bruno@example.test',
    'carla@example.test',
    'diego@example.test',
  ];
  const seedSlugs = ['ufba-demo', 'fiocruz-demo'];

  const existingTenants = await prisma.tenant.findMany({
    where: { slug: { in: seedSlugs } },
    select: { id: true },
  });

  if (existingTenants.length > 0) {
    await prisma.tenant.deleteMany({
      where: { id: { in: existingTenants.map((t) => t.id) } },
    });
    console.log('  • seed anterior removido');
  }

  await prisma.user.deleteMany({ where: { email: { in: seedEmails } } });

  // ── Instituições ───────────────────────────────────────────────────────────
  const ufbaId = randomUUID();
  const fiocruzId = randomUUID();

  await prisma.tenant.createMany({
    data: [
      {
        id: ufbaId,
        slug: 'ufba-demo',
        name: 'Universidade Federal da Bahia',
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        primaryColor: '#1d4ed8',
        timezone: 'America/Bahia',
      },
      {
        id: fiocruzId,
        slug: 'fiocruz-demo',
        name: 'Fundação Oswaldo Cruz',
        status: 'ACTIVE',
        plan: 'STARTER',
        primaryColor: '#0f766e',
        timezone: 'America/Sao_Paulo',
      },
    ],
  });

  console.log(`  ✓ 2 instituições criadas (ufba-demo, fiocruz-demo)`);

  // ── Usuários ───────────────────────────────────────────────────────────────
  // `passwordHash` é preenchido pelo Better Auth em produção. Aqui usamos um
  // marcador: estes usuários existem para exercitar RBAC e tenancy, não para
  // login por senha. Crie contas pela UI para testar o fluxo de autenticação.
  const ana = randomUUID();
  const bruno = randomUUID();
  const carla = randomUUID();
  const diego = randomUUID();

  await prisma.user.createMany({
    data: [
      {
        id: ana,
        name: 'Ana Ribeiro',
        email: 'ana@example.test',
        emailVerified: true,
        publicHandle: 'ana-ribeiro',
        headline: 'Coordenadora de eventos científicos',
      },
      {
        id: bruno,
        name: 'Bruno Souza',
        email: 'bruno@example.test',
        emailVerified: true,
        publicHandle: 'bruno-souza',
        headline: 'Pesquisador em saúde pública',
      },
      {
        id: carla,
        name: 'Carla Menezes',
        email: 'carla@example.test',
        emailVerified: true,
        publicHandle: 'carla-menezes',
      },
      {
        id: diego,
        name: 'Diego Almeida',
        email: 'diego@example.test',
        emailVerified: true,
        publicHandle: 'diego-almeida',
        headline: 'Professor de tecnologia educacional',
      },
    ],
  });

  console.log('  ✓ 4 usuários criados');

  // ── Vínculos ───────────────────────────────────────────────────────────────
  await inTenant(ufbaId, async () => {
    await prisma.userTenantProfile.createMany({
      data: [
        { id: randomUUID(), tenantId: ufbaId, userId: ana, status: 'ACTIVE', joinedAt: now },
        { id: randomUUID(), tenantId: ufbaId, userId: bruno, status: 'ACTIVE', joinedAt: now },
        { id: randomUUID(), tenantId: ufbaId, userId: diego, status: 'ACTIVE', joinedAt: now },
        // Convite pendente: NÃO concede contexto (fail-closed).
        { id: randomUUID(), tenantId: ufbaId, userId: carla, status: 'INVITED' },
      ],
    });
  });

  await inTenant(fiocruzId, async () => {
    await prisma.userTenantProfile.createMany({
      data: [
        { id: randomUUID(), tenantId: fiocruzId, userId: ana, status: 'ACTIVE', joinedAt: now },
      ],
    });
  });

  console.log('  ✓ vínculos criados (Carla com convite pendente em ufba-demo)');

  // ── Eventos (necessários para papéis com escopo de evento) ─────────────────
  const congressoUfba = randomUUID();
  const simposioFiocruz = randomUUID();
  const salaPrincipal = randomUUID();
  const salaOficinas = randomUUID();
  const trilhaTecnologia = randomUUID();

  await inTenant(ufbaId, async () => {
    await prisma.event.create({
      data: {
        id: congressoUfba,
        tenantId: ufbaId,
        slug: 'congresso-2026',
        title: 'Congresso de Tecnologia e Educação 2026',
        subtitle: 'Inovação, inclusão e futuro do ensino superior',
        summary:
          'Três dias de palestras, minicursos e apresentações de trabalhos sobre tecnologia e educação.',
        description:
          'O Congresso de Tecnologia e Educação reúne pesquisadores, docentes e profissionais para discutir inovação, inclusão digital e o futuro do ensino superior.\n\nA programação inclui palestras internacionais, minicursos práticos e sessões de apresentação de trabalhos avaliados por pares.',
        status: 'REGISTRATION_OPEN',
        modality: 'HYBRID',
        startsAt: days(30),
        endsAt: days(33),
        timezone: 'America/Bahia',
        venueName: 'Centro de Convenções da UFBA',
        city: 'Salvador',
        state: 'BA',
        country: 'BR',
        capacity: null,
        confirmedCount: 0,
        // Inscrições abertas por 20 dias.
        registrationOpensAt: days(-1),
        registrationClosesAt: days(20),
        primaryColor: '#1d4ed8',
        theme: {
          primaryColor: '#1d4ed8',
          accentColor: '#0f766e',
          radius: 14,
          fontFamily: 'inter',
          heroStyle: 'gradient',
          spacing: 'normal',
          animation: 'fade',
          colorMode: 'light',
        },
      },
    });

    await prisma.room.createMany({
      data: [
        {
          id: salaPrincipal,
          tenantId: ufbaId,
          eventId: congressoUfba,
          name: 'Auditório Principal',
          capacity: 300,
        },
        {
          id: salaOficinas,
          tenantId: ufbaId,
          eventId: congressoUfba,
          name: 'Sala de Oficinas 1',
          capacity: 40,
        },
      ],
    });

    await prisma.activity.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'abertura',
          title: 'Cerimônia de abertura e conferência magna',
          description:
            'Abertura oficial do congresso com a conferência magna sobre o futuro da educação digital.',
          type: 'LECTURE',
          status: 'SCHEDULED',
          modality: 'HYBRID',
          startsAt: days(30),
          endsAt: new Date(days(30).getTime() + 2 * 3_600_000),
          roomId: salaPrincipal,
          capacity: null,
          workloadMinutes: 120,
          isFeatured: true,
          tags: ['abertura', 'conferência'],
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'minicurso-rust',
          title: 'Minicurso: Programação em Rust para iniciantes',
          description:
            'Introdução prática à linguagem Rust: ownership, borrowing e primeiros projetos. Traga seu notebook.',
          type: 'MINI_COURSE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: days(31),
          endsAt: new Date(days(31).getTime() + 4 * 3_600_000),
          roomId: salaOficinas,
          // Lotação pequena e lista de espera: exercita o controle de vagas.
          capacity: 30,
          waitlistEnabled: true,
          workloadMinutes: 240,
          tags: ['programação', 'rust'],
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'mesa-inclusao',
          title: 'Mesa-redonda: Inclusão digital no ensino superior',
          type: 'ROUND_TABLE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: days(32),
          endsAt: new Date(days(32).getTime() + 90 * 60_000),
          roomId: salaPrincipal,
          capacity: 150,
          waitlistEnabled: false,
          workloadMinutes: 90,
        },
      ],
    });

    /**
     * ── Chamada de trabalhos (FASE 4) ────────────────────────────────────────
     *
     * A trilha é o eixo da avaliação por pares: define a rubrica, quantos
     * pareceres são exigidos e os limiares de decisão. Sem uma trilha ativa, a
     * página `/submissoes/nova` não tem para onde apontar.
     */
    await prisma.track.create({
      data: {
        id: trilhaTecnologia,
        tenantId: ufbaId,
        eventId: congressoUfba,
        slug: 'tecnologia-educacional',
        name: 'Trilha de Tecnologia Educacional',
        description:
          'Trabalhos sobre ferramentas, metodologias e políticas de tecnologia aplicada ao ensino.',
        color: '#1d4ed8',
        chairId: ana,
        maxSubmissionsPerAuthor: 3,
        requiresBlindReview: true,
        // Pesos diferentes DE PROPÓSITO: a nota final é ponderada, não média.
        reviewRubric: [
          {
            key: 'originality',
            label: 'Originalidade e relevância',
            weight: 3,
            maxScore: 10,
            description: 'O trabalho traz contribuição nova e relevante para a área?',
          },
          {
            key: 'methodology',
            label: 'Rigor metodológico',
            weight: 3,
            maxScore: 10,
            description: 'O método é adequado, descrito e reprodutível?',
          },
          {
            key: 'clarity',
            label: 'Clareza e escrita',
            weight: 1,
            maxScore: 10,
            description: 'O texto é claro, organizado e bem escrito?',
          },
          {
            key: 'impact',
            label: 'Impacto potencial',
            weight: 1,
            maxScore: 10,
            description: 'Os resultados podem influenciar a prática?',
          },
        ],
        requiredReviews: 2,
        acceptanceThreshold: 70,
        rejectThreshold: 45,
        isActive: true,
      },
    });

    /**
     * ── Perfis de revisor (FASE 4) ───────────────────────────────────────────
     *
     * Bruno e Diego avaliam a MESMA trilha a partir de instituições diferentes:
     *   • Bruno declara a UFBA. Se um autor também declarar a UFBA, o conflito
     *     de mesma instituição aparece BLOQUEANDO no painel do comitê.
     *   • Diego é de outra instituição: candidato elegível.
     * É esse contraste que torna o painel de distribuição demonstrável.
     */
    await prisma.reviewerExpertise.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: bruno,
          expertiseKeywords: ['tecnologia educacional', 'saúde pública', 'inclusão digital'],
          preferredTrackIds: [trilhaTecnologia],
          maxConcurrentAssignments: 3,
          declaredInstitution: 'Universidade Federal da Bahia',
          institutionalEmailDomain: 'ufba.br',
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: diego,
          expertiseKeywords: [
            'tecnologia educacional',
            'aprendizagem ativa',
            'formação docente',
          ],
          preferredTrackIds: [trilhaTecnologia],
          maxConcurrentAssignments: 5,
          declaredInstitution: 'Universidade Estadual de Feira de Santana',
          institutionalEmailDomain: 'uefs.br',
        },
      ],
    });
  });

  await inTenant(fiocruzId, async () => {
    await prisma.event.create({
      data: {
        id: simposioFiocruz,
        tenantId: fiocruzId,
        slug: 'simposio-2026',
        title: 'Simpósio de Saúde Coletiva 2026',
        summary: 'Encontro anual de pesquisa em saúde coletiva.',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt: days(60),
        endsAt: days(62),
        timezone: 'America/Sao_Paulo',
        city: 'Rio de Janeiro',
        state: 'RJ',
        country: 'BR',
        capacity: 200,
        confirmedCount: 0,
        registrationOpensAt: days(-1),
        registrationClosesAt: days(45),
        primaryColor: '#0f766e',
        theme: {
          primaryColor: '#0f766e',
          radius: 8,
          fontFamily: 'serif',
          heroStyle: 'minimal',
          spacing: 'spacious',
          animation: 'slide',
          colorMode: 'light',
        },
      },
    });

    await prisma.activity.create({
      data: {
        id: randomUUID(),
        tenantId: fiocruzId,
        eventId: simposioFiocruz,
        slug: 'palestra-epidemiologia',
        title: 'Palestra: Epidemiologia e vigilância em saúde',
        type: 'LECTURE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt: days(60),
        endsAt: new Date(days(60).getTime() + 2 * 3_600_000),
        capacity: 120,
        workloadMinutes: 120,
      },
    });
  });

  console.log('  ✓ 2 eventos, 2 salas e 4 atividades criados');

  // ── Papéis: acúmulo e escopo ───────────────────────────────────────────────
  await inTenant(ufbaId, async () => {
    await prisma.roleAssignment.createMany({
      data: [
        // Ana é ADMIN na UFBA (escopo de tenant).
        { id: randomUUID(), tenantId: ufbaId, userId: ana, role: 'ADMIN', scope: 'TENANT' },
        // Bruno é ORGANIZER no Congresso E também REVIEWER no mesmo evento:
        // acúmulo de papéis no mesmo alvo.
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: bruno,
          role: 'ORGANIZER',
          scope: 'EVENT',
          eventId: congressoUfba,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: bruno,
          role: 'REVIEWER',
          scope: 'EVENT',
          eventId: congressoUfba,
        },
        // Bruno é STAFF apenas no primeiro dia (papel temporário).
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: bruno,
          role: 'STAFF',
          scope: 'EVENT',
          eventId: congressoUfba,
          expiresAt: days(31),
        },
        // Diego é revisor no Congresso — o par elegível de Bruno no painel.
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: diego,
          role: 'REVIEWER',
          scope: 'EVENT',
          eventId: congressoUfba,
        },
        // Ana é CHAIR no Congresso: é quem distribui e decide.
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: ana,
          role: 'CHAIR',
          scope: 'EVENT',
          eventId: congressoUfba,
        },
        // Carla é PARTICIPANT (mesmo com convite pendente, o papel existe mas
        // não é utilizável — o vínculo INVITED bloqueia).
        {
          id: randomUUID(),
          tenantId: ufbaId,
          userId: carla,
          role: 'PARTICIPANT',
          scope: 'TENANT',
        },
      ],
    });
  });

  await inTenant(fiocruzId, async () => {
    await prisma.roleAssignment.createMany({
      data: [
        // Ana é apenas CHAIR na FIOCRUZ — contexto bem diferente do dela na UFBA.
        {
          id: randomUUID(),
          tenantId: fiocruzId,
          userId: ana,
          role: 'CHAIR',
          scope: 'EVENT',
          eventId: simposioFiocruz,
        },
        // E também PARTICIPANT (acúmulo).
        {
          id: randomUUID(),
          tenantId: fiocruzId,
          userId: ana,
          role: 'PARTICIPANT',
          scope: 'EVENT',
          eventId: simposioFiocruz,
        },
      ],
    });
  });

  console.log('  ✓ papéis atribuídos (acúmulo e escopos variados)');

  // ── Resumo ─────────────────────────────────────────────────────────────────
  console.log(`\n${line}`);
  console.log('  CONTAS DE DEMONSTRAÇÃO\n');
  console.log('  ana@example.test    → ADMIN em ufba-demo · CHAIR + PARTICIPANT em fiocruz-demo');
  console.log('  bruno@example.test  → ORGANIZER + REVIEWER + STAFF em ufba-demo');
  console.log('  carla@example.test  → PARTICIPANT em ufba-demo (convite PENDENTE)');
  console.log('  diego@example.test  → REVIEWER em ufba-demo (instituição diferente)');
  console.log(`\n  Instituições:`);
  console.log(`    http://localhost:3000/t/ufba-demo`);
  console.log(`    http://localhost:3000/t/fiocruz-demo`);
  console.log(`\n  Páginas públicas (landing pages dos eventos):`);
  console.log(`    http://localhost:3000/t/ufba-demo/eventos`);
  console.log(`    http://localhost:3000/t/ufba-demo/eventos/congresso-2026`);
  console.log(`    http://localhost:3000/t/ufba-demo/eventos/congresso-2026/atividades/minicurso-rust`);
  console.log(`\n  Submissão e avaliação (FASE 4):`);
  console.log(`    http://localhost:3000/t/ufba-demo/submissoes        (autor)`);
  console.log(`    http://localhost:3000/t/ufba-demo/revisoes          (revisor)`);
  console.log(`    http://localhost:3000/t/ufba-demo/comite            (comitê)`);
  console.log(`    Trilha semeada: "Trilha de Tecnologia Educacional" (rubrica 4 critérios,`);
  console.log(`    2 pareceres exigidos, aceite ≥ 70, rejeição < 45)`);
  console.log(`\n  Subdomínios (com ROOT_DOMAIN=lvh.me):`);
  console.log(`    http://ufba-demo.lvh.me:3000/eventos`);
  console.log(`    http://fiocruz-demo.lvh.me:3000/eventos`);
  console.log(`${line}\n`);
}

main()
  .catch((error) => {
    console.error(`\n  ✗ Seed falhou: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
