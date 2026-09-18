/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Seed de desenvolvimento — FASES 2 a 5
 *
 *  Cria duas instituições com o MESMO usuário atuando em papéis diferentes, um
 *  terceiro usuário com vínculo em apenas uma, e — a partir da FASE 5 — um
 *  catálogo de cartas colecionáveis, missões e XP de demonstração.
 *
 *  Esse arranjo é o que permite verificar de verdade:
 *
 *    • acúmulo de papéis (Palestrante + Revisor no mesmo evento);
 *    • papéis por escopo (Organizador em A, apenas Participante em B);
 *    • troca de contexto sem perda de sessão;
 *    • isolamento entre instituições (a RLS impede que A veja dados de B);
 *    • gamificação com dado real (álbum, extrato de XP, ranking, missões).
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
import { awardForEvent } from '../src/lib/gamification/reward-engine';
import {
  generateCertificate,
  requestCertificate,
} from '../src/lib/certificates/certificate-service';
import { createRaffle, drawRaffle } from '../src/lib/raffles/raffle-service';
import {
  addPageBlock,
  ensureHomePage,
  savePageSettings,
  updatePageBlock,
} from '../src/lib/admin/landing-service';
import { saveSponsor, saveSponsorTier } from '../src/lib/admin/sponsor-service';
import type { PageBlockType } from '../src/domain/events/landing-page';

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
        // FASE 9 — perfil público: é o que aparece no diretório `/organizacoes`.
        isPublic: true,
        description:
          'Universidade pública federal com ensino, pesquisa e extensão — sede em Salvador, Bahia.',
        websiteUrl: 'https://www.ufba.br',
      },
      {
        id: fiocruzId,
        slug: 'fiocruz-demo',
        name: 'Fundação Oswaldo Cruz',
        status: 'ACTIVE',
        plan: 'STARTER',
        primaryColor: '#0f766e',
        timezone: 'America/Sao_Paulo',
        isPublic: true,
        description:
          'Instituição de ciência e tecnologia em saúde, vinculada ao Ministério da Saúde.',
        websiteUrl: 'https://www.fiocruz.br',
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
  /** Minicurso usado como base dos certificados de demonstração (FASE 6). */
  const minicursoRustId = randomUUID();

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
          id: minicursoRustId,
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

    /**
     * ── Cartas colecionáveis (FASE 5) ────────────────────────────────────────
     *
     * Sete cartas cobrindo os cinco níveis de raridade e os gatilhos principais.
     * A paleta e a arte são DADO: o componente aplica as cores como variáveis
     * CSS, nunca como string de estilo.
     *
     * Duas cartas têm tiragem limitada de propósito — escassez é o que dá valor
     * percebido à coleção, e o `mintedCount` é reservado NO BANCO a cada emissão.
     */
    const premioPresencaId = randomUUID();

    await prisma.cardTemplate.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'cracha-pioneiro',
          name: 'Crachá do Pioneiro',
          description: 'Para quem chegou primeiro: credenciamento no evento.',
          lore: 'O primeiro dia começa com uma fila e termina com uma história.',
          rarity: 'COMMON',
          trigger: 'CHECKIN',
          palette: {
            primary: '#0f766e',
            secondary: '#134e4a',
            glow: '#5eead4',
            text: '#f0fdfa',
          },
          art: { animation: 'none', particle: 'none' },
          dropWeight: 120,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'presenca-constante',
          name: 'Presença Constante',
          description: 'Conquistada por participar de uma atividade completa.',
          rarity: 'RARE',
          trigger: 'ACTIVITY_COMPLETION',
          palette: {
            primary: '#2563eb',
            secondary: '#1e3a8a',
            glow: '#60a5fa',
            text: '#eff6ff',
          },
          art: { animation: 'shimmer', particle: 'sparkle' },
          dropWeight: 100,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'autor-estreante',
          name: 'Autor Estreante',
          description: 'Primeiro trabalho submetido para avaliação por pares.',
          rarity: 'EPIC',
          trigger: 'SUBMISSION_SUBMITTED',
          palette: {
            primary: '#7c3aed',
            secondary: '#3b0764',
            glow: '#c084fc',
            text: '#faf5ff',
          },
          art: { animation: 'float', particle: 'orbit' },
          dropWeight: 100,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'trabalho-aprovado',
          name: 'Trabalho Aprovado',
          description: 'O resultado que o evento existe para produzir: artigo aceito.',
          lore: 'Revisado às cegas, defendido em público, aceito pelo comitê.',
          rarity: 'LEGENDARY',
          trigger: 'SUBMISSION_ACCEPTED',
          palette: {
            primary: '#d97706',
            secondary: '#78350f',
            glow: '#fbbf24',
            text: '#fffbeb',
          },
          art: { animation: 'shimmer', particle: 'sparkle', foil: true },
          dropWeight: 60,
          maxSupply: 50,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'guardiao-do-metodo',
          name: 'Guardião do Método',
          description: 'Parecer concluído — o trabalho invisível que sustenta a ciência.',
          rarity: 'MYTHIC',
          trigger: 'REVIEW_COMPLETED',
          palette: {
            primary: '#db2777',
            secondary: '#500724',
            glow: '#f472b6',
            text: '#fdf2f8',
          },
          art: { animation: 'pulse', particle: 'orbit', foil: true },
          dropWeight: 40,
          maxSupply: 10,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'chama-da-constancia',
          name: 'Chama da Constância',
          description: 'Três dias consecutivos de participação.',
          rarity: 'EPIC',
          trigger: 'STREAK',
          triggerCondition: { streak: 3 },
          palette: {
            primary: '#ea580c',
            secondary: '#7c2d12',
            glow: '#fb923c',
            text: '#fff7ed',
          },
          art: { animation: 'pulse', particle: 'sparkle' },
          dropWeight: 100,
        },
        {
          id: premioPresencaId,
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'veterano-do-evento',
          name: 'Veterano do Evento',
          description: 'Recompensa da missão "Presença tripla".',
          rarity: 'RARE',
          trigger: 'MANUAL_GRANT',
          palette: {
            primary: '#0891b2',
            secondary: '#164e63',
            glow: '#22d3ee',
            text: '#ecfeff',
          },
          art: { animation: 'none', particle: 'dust' },
          dropWeight: 100,
        },
      ],
    });

    /**
     * ── Missões (FASE 5) ────────────────────────────────────────────────────
     *
     * O gatilho da missão é uma origem de XP: a missão avança quando o fato
     * correspondente acontece. O XP só é creditado no RESGATE — completar não é o
     * mesmo que receber, e é essa distinção que cria o momento de recompensa.
     */
    await prisma.taskDefinition.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'primeiro-credenciamento',
          name: 'Primeiro credenciamento',
          description: 'Faça o credenciamento no evento.',
          kind: 'ONE_OFF',
          trigger: 'CHECKIN',
          target: { count: 1 },
          xpReward: 100,
          displayOrder: 1,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'presenca-tripla',
          name: 'Presença tripla',
          description: 'Participe de três atividades com carga horária cumprida.',
          kind: 'ONE_OFF',
          trigger: 'ACTIVITY_ATTENDANCE',
          target: { count: 3 },
          xpReward: 150,
          rewardCardTemplateId: premioPresencaId,
          displayOrder: 2,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'maratona-de-minicursos',
          name: 'Maratona de minicursos',
          description: 'Conclua um minicurso completo.',
          kind: 'ONE_OFF',
          trigger: 'MINI_COURSE_COMPLETION',
          target: { count: 1, activityType: 'MINI_COURSE' },
          xpReward: 120,
          displayOrder: 3,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'voz-cientifica',
          name: 'Voz científica',
          description: 'Submeta um trabalho para a chamada de trabalhos.',
          kind: 'ONE_OFF',
          trigger: 'SUBMISSION_SUBMITTED',
          target: { count: 1 },
          xpReward: 200,
          displayOrder: 4,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'revisor-dedicado',
          name: 'Revisor dedicado',
          description: 'Conclua dois pareceres.',
          kind: 'ACHIEVEMENT',
          trigger: 'REVIEW_COMPLETED',
          target: { count: 2 },
          xpReward: 250,
          displayOrder: 5,
        },
        {
          id: randomUUID(),
          tenantId: ufbaId,
          eventId: congressoUfba,
          slug: 'atividade-do-dia',
          name: 'Atividade do dia',
          description: 'Assista a uma atividade hoje.',
          kind: 'DAILY',
          trigger: 'ACTIVITY_ATTENDANCE',
          target: { count: 1 },
          xpReward: 30,
          displayOrder: 6,
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

  // ── Gamificação: fatos de demonstração (FASE 5) ────────────────────────────
  /**
   * Em vez de gravar XP "na mão", o seed reproduz FATOS e deixa o motor de
   * recompensas fazer o trabalho. Assim o dado de demonstração nasce com a mesma
   * consistência do dado de produção: livro-razão, perfil, cartas e progresso de
   * missão coerentes entre si.
   *
   * O sorteio de cartas recebe uma sequência determinística para que duas
   * execuções do seed produzam o mesmo álbum — dado de demonstração que muda a
   * cada execução atrapalha quem está testando.
   */
  /**
   * Sorteio determinístico do seed.
   *
   * A sequência é criada UMA vez e avança a cada número pedido. Criar uma
   * sequência nova a cada chamada (`(() => sequenceRandom([...])())`) devolveria
   * sempre o primeiro valor — o sorteio pareceria funcionar e estaria fixo em um
   * único número, escondendo completamente o comportamento da distribuição.
   *
   * Os valores foram escolhidos para produzir um álbum de demonstração
   * interessante: `0.3` na raridade, `0.5` na escolha dentro da raridade e
   * `0.05` no foil (abaixo da chance de épica/lendária/mítica, acima da comum).
   */
  let demoCursor = 0;
  const demoSequence = [0.3, 0.5, 0.05];
  const demoRandom = () => demoSequence[demoCursor++ % demoSequence.length]!;
  const ganhosDemo = [
    // Ana: submeteu e teve o trabalho aceito.
    { userId: ana, source: 'SUBMISSION_SUBMITTED' as const, key: 'seed-ana-submeteu' },
    { userId: ana, source: 'SUBMISSION_ACCEPTED' as const, key: 'seed-ana-aceito' },
    // Bruno: credenciou, assistiu três atividades, concluiu um minicurso e deu
    // dois pareceres — o suficiente para completar missões e subir de nível.
    { userId: bruno, source: 'CHECKIN' as const, key: 'seed-bruno-credenciou' },
    { userId: bruno, source: 'ACTIVITY_ATTENDANCE' as const, key: 'seed-bruno-presenca-1' },
    { userId: bruno, source: 'ACTIVITY_ATTENDANCE' as const, key: 'seed-bruno-presenca-2' },
    { userId: bruno, source: 'ACTIVITY_ATTENDANCE' as const, key: 'seed-bruno-presenca-3' },
    { userId: bruno, source: 'MINI_COURSE_COMPLETION' as const, key: 'seed-bruno-minicurso' },
    { userId: bruno, source: 'REVIEW_COMPLETED' as const, key: 'seed-bruno-parecer-1' },
    { userId: bruno, source: 'REVIEW_COMPLETED' as const, key: 'seed-bruno-parecer-2' },
  ];

  let eventosPremiados = 0;

  for (const ganho of ganhosDemo) {
    const resultado = await awardForEvent({
      tenantId: ufbaId,
      userId: ganho.userId,
      source: ganho.source,
      idempotencyKey: `seed:${ufbaId}:${ganho.key}`,
      eventId: congressoUfba,
      activityType: ganho.source === 'MINI_COURSE_COMPLETION' ? 'MINI_COURSE' : null,
      minutes: ganho.source === 'ACTIVITY_ATTENDANCE' ? 240 : null,
      random: demoRandom,
    });

    if (resultado.ok) eventosPremiados += 1;
  }

  console.log(`  ✓ gamificação: 7 cartas, 6 missões e ${eventosPremiados} fatos de XP`);

  // ── Certificação: fatos reais + documentos emitidos (FASE 6) ───────────────
  /**
   * Diferente do XP (que é um fato declarado pelo seed), o certificado depende de
   * PRESENÇA MEDIDA e de TRABALHO ACEITO — os fatos que a elegibilidade consulta
   * no banco. Então o seed cria:
   *
   *   • presença completa do Bruno no minicurso (entrada, saída e minutos);
   *   • um trabalho aceito da Ana na trilha;
   *
   * e emite os documentos chamando o MESMO caminho de produção. O resultado é um
   * certificado real, com hash, assinatura e QR Code que valida de verdade — o que
   * torna a demonstração da validação pública honesta.
   */
  const presencaInicio = new Date(now.getTime() - 2 * 3_600_000);
  const inscricaoMinicursoId = randomUUID();

  await inTenant(ufbaId, async () => {
    await prisma.registration.create({
      data: {
        id: inscricaoMinicursoId,
        tenantId: ufbaId,
        eventId: congressoUfba,
        activityId: minicursoRustId,
        userId: bruno,
        status: 'ATTENDED',
        consentData: true,
        consentImage: true,
        consentAt: presencaInicio,
        badgeToken: `DEMO-BADGE-${ufbaId.slice(0, 8)}`,
        checkedInAt: presencaInicio,
        checkedInById: ana,
      },
    });

    await prisma.attendance.create({
      data: {
        id: randomUUID(),
        tenantId: ufbaId,
        eventId: congressoUfba,
        activityId: minicursoRustId,
        registrationId: inscricaoMinicursoId,
        userId: bruno,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: presencaInicio,
        // 240 minutos: exatamente a carga declarada do minicurso.
        checkedOutAt: new Date(presencaInicio.getTime() + 240 * 60_000),
        minutesAttended: 240,
        validatedById: ana,
      },
    });

    await prisma.submission.create({
      data: {
        id: randomUUID(),
        tenantId: ufbaId,
        eventId: congressoUfba,
        trackId: trilhaTecnologia,
        protocol: `DEMO${ufbaId.slice(0, 4).toUpperCase()}`,
        title: 'Tecnologias digitais na formação docente: um estudo de caso',
        abstract:
          'Este trabalho analisa o uso de tecnologias digitais em programas de formação docente, descrevendo a metodologia adotada, os resultados observados e as implicações para políticas de inclusão digital no ensino superior.',
        keywords: ['tecnologia educacional', 'formação docente', 'inclusão digital'],
        language: 'pt-BR',
        status: 'ACCEPTED',
        submittedById: ana,
        submittedAt: now,
        decisionAt: now,
        decisionNotes: 'Aprovado com recomendação de publicação.',
        finalScore: 88.5,
        authors: {
          create: [
            {
              id: randomUUID(),
              tenantId: ufbaId,
              userId: ana,
              authorOrder: 1,
              isCorresponding: true,
              institution: 'Universidade Federal da Bahia',
            },
          ],
        },
      },
    });
  });

  const certificadosDemo: { quem: string; codigo: string; tipo: string }[] = [];

  for (const pedido of [
    { userId: bruno, kind: 'MINI_COURSE' as const, quem: 'Bruno (minicurso)' },
    { userId: ana, kind: 'AUTHOR' as const, quem: 'Ana (autoria)' },
  ]) {
    const solicitado = await requestCertificate({
      tenantId: ufbaId,
      eventId: congressoUfba,
      userId: pedido.userId,
      kind: pedido.kind,
    });

    if (!solicitado.ok) {
      console.warn(`  ! certificado não emitido para ${pedido.quem}: ${solicitado.message}`);
      continue;
    }

    const gerado = await generateCertificate({
      tenantId: ufbaId,
      certificateId: solicitado.certificateId,
    });

    certificadosDemo.push({
      quem: pedido.quem,
      codigo: solicitado.validationCode,
      tipo: gerado.ok ? 'emitido' : 'na fila (arquivo pendente)',
    });
  }

  console.log(`  ✓ certificação: ${certificadosDemo.length} certificado(s) de demonstração`);

  // ── Sorteio de demonstração (FASE 8) ───────────────────────────────────────
  /**
   * Um sorteio REAL, apurado pelo mesmo caminho de produção: universo restrito ao
   * minicurso, piso de 120 minutos e um vencedor.
   *
   * Com os dados semeados, apenas Bruno cumpre o piso (240 min medidos) — o que
   * torna o resultado da demonstração verificável: quem conferir a lista de
   * elegíveis verá exatamente uma pessoa, e ela é o vencedor.
   */
  const sorteioDemo = await createRaffle({
    tenantId: ufbaId,
    eventId: congressoUfba,
    actorId: ana,
    title: 'Sorteio de brindes do minicurso',
    description: 'Sorteio entre os participantes que concluíram o minicurso com ao menos 120 minutos.',
    scope: 'ACTIVITY',
    activityId: minicursoRustId,
    minAttendanceMinutes: 120,
    winnersCount: 1,
    allowPriorEventWinners: true,
  });

  let sorteioRealizado = 'não configurado';

  if (sorteioDemo.ok) {
    const apuracao = await drawRaffle({
      tenantId: ufbaId,
      raffleId: sorteioDemo.raffleId,
      actorId: ana,
    });

    sorteioRealizado = apuracao.ok
      ? `${apuracao.winners.length} vencedor(es) entre ${apuracao.eligibleCount} elegíveis (hash ${apuracao.resultHash.slice(0, 16)}…)`
      : `configurado, sem apuração: ${apuracao.message}`;
  }

  console.log(`  ✓ sorteio: ${sorteioRealizado}`);

  // ── Página pública e patrocínio (FASE 17) ──────────────────────────────────
  /**
   * Executado pelos SERVIÇOS REAIS, e não por `prisma.eventPage.create`.
   *
   * É o que garante que o dado de demonstração nasça do mesmo caminho que a tela
   * usa: se a criação da página publicada só funcionasse por escrita direta, o
   * seed estaria demonstrando um sistema que não existe.
   */
  const pagina = await ensureHomePage({
    tenantId: ufbaId,
    eventId: congressoUfba,
    actorId: ana,
  });

  let blocosDemo = 0;
  let patrocinioDemo = 'não configurado';

  if (pagina.ok) {
    const blocos: { type: PageBlockType; content: Record<string, unknown> }[] = [
      {
        type: 'RICH_TEXT',
        content: {
          title: 'Sobre o congresso',
          body:
            'O Congresso de Tecnologia e Educação reúne pesquisadores, docentes e estudantes para ' +
            'discutir o uso de tecnologia na sala de aula.\n\n' +
            'A programação inclui palestras, minicursos e sessões de pôsteres, com certificação ' +
            'para todas as atividades.',
        },
      },
      {
        type: 'TRACKS',
        content: { title: 'Trilhas da chamada de trabalhos' },
      },
      {
        type: 'FAQ',
        content: {
          title: 'Perguntas frequentes',
          items: [
            {
              question: 'Preciso me inscrever em cada atividade?',
              answer: 'Sim. As vagas são por atividade e podem esgotar.',
            },
            {
              question: 'O certificado é emitido automaticamente?',
              answer:
                'Sim, após o credenciamento na atividade. Ele fica disponível na área do participante.',
            },
          ],
        },
      },
      {
        type: 'REGISTRATION_CTA',
        content: {
          title: 'Garanta sua vaga',
          description: 'As inscrições estão abertas e as vagas são limitadas por atividade.',
        },
      },
      { type: 'SPONSORS', content: {} },
    ];

    for (const bloco of blocos) {
      const criado = await addPageBlock({
        tenantId: ufbaId,
        eventId: congressoUfba,
        actorId: ana,
        type: bloco.type,
      });

      if (criado.ok) {
        // O conteúdo é gravado pelo MESMO caminho da tela (validação por tipo).
        const atualizado = await updatePageBlock({
          tenantId: ufbaId,
          eventId: congressoUfba,
          actorId: ana,
          blockId: criado.blockId,
          content: bloco.content,
        });
        if (atualizado.ok) blocosDemo += 1;
      }
    }

    // Publicar é ato explícito: a página nasce rascunho (ver landing-service).
    await savePageSettings({
      tenantId: ufbaId,
      eventId: congressoUfba,
      actorId: ana,
      title: 'Congresso de Tecnologia e Educação',
      metaTitle: 'Congresso de Tecnologia e Educação 2026 — UFBA',
      metaDescription:
        'Três dias de palestras, minicursos e apresentações sobre tecnologia na educação.',
      isPublished: true,
      theme: {
        primaryColor: '#1d4ed8',
        radius: 14,
        fontFamily: 'inter',
        heroStyle: 'gradient',
        spacing: 'normal',
        animation: 'fade',
        colorMode: 'light',
      },
    });

    const cota = await saveSponsorTier({
      tenantId: ufbaId,
      eventId: congressoUfba,
      actorId: ana,
      key: 'GOLD',
      name: 'Ouro',
      description: 'Cota com logo em destaque na página e estande no evento.',
      color: '#f59e0b',
      rank: 10,
      priceCents: 1_500_000,
      currency: 'BRL',
      maxSponsors: 3,
      benefits: ['Logo na página pública', 'Estande de 9 m²', 'Duas inscrições cortesia'],
    });

    if (cota.ok) {
      for (const patrocinador of [
        { name: 'Instituto de Tecnologia Aberta', websiteUrl: 'https://example.org/ita' },
        { name: 'Editora Ciência Viva', websiteUrl: 'https://example.org/ciencia-viva' },
      ]) {
        await saveSponsor({
          tenantId: ufbaId,
          eventId: congressoUfba,
          actorId: ana,
          name: patrocinador.name,
          description: 'Patrocinador de demonstração.',
          websiteUrl: patrocinador.websiteUrl,
          logoUrl: null,
          tierId: cota.tierId,
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          taxId: null,
          contractValueCents: 1_500_000,
          contractStart: days(-30),
          contractEnd: days(120),
          displayOrder: 0,
          isActive: true,
        });
      }

      patrocinioDemo = '1 cota (Ouro) e 2 patrocinadores';
    }
  }

  console.log(`  ✓ página pública: ${blocosDemo} bloco(s) publicados · patrocínio: ${patrocinioDemo}`);

  // ── Conteúdo e mídia (FASE 23) ─────────────────────────────────────────────
  /**
   * A página do SIMPÓSIO nasce AGENDADA (item E13).
   *
   * É o estado que mais precisa de demonstração: a página existe, tem conteúdo e
   * está fora do ar — porque a data ainda não chegou. Sem um exemplo assim, a
   * diferença entre "rascunho" e "agendada" só aparece na documentação.
   */
  const paginaSimposio = await ensureHomePage({
    tenantId: fiocruzId,
    eventId: simposioFiocruz,
    actorId: ana,
  });

  let agendamentoDemo = 'não configurado';

  if (paginaSimposio.ok) {
    const bloco = await addPageBlock({
      tenantId: fiocruzId,
      eventId: simposioFiocruz,
      actorId: ana,
      type: 'RICH_TEXT',
    });

    if (bloco.ok) {
      await updatePageBlock({
        tenantId: fiocruzId,
        eventId: simposioFiocruz,
        actorId: ana,
        blockId: bloco.blockId,
        content: {
          title: 'Sobre o simpósio',
          body:
            'Encontro anual de pesquisa em saúde coletiva, com mesas-redondas e apresentação ' +
            'de trabalhos.\n\nA página entra no ar automaticamente na data agendada.',
        },
      });
    }

    const agendadaPara = days(7);
    const agendamento = await savePageSettings({
      tenantId: fiocruzId,
      eventId: simposioFiocruz,
      actorId: ana,
      title: 'Simpósio de Saúde Coletiva 2026',
      metaDescription: 'Pesquisa em saúde coletiva: mesas-redondas e apresentação de trabalhos.',
      isPublished: false,
      publishAt: agendadaPara,
    });

    agendamentoDemo = agendamento.ok
      ? `${agendamento.publication} para ${agendadaPara.toISOString().slice(0, 16).replace('T', ' ')} UTC`
      : `falhou: ${agendamento.message}`;
  }

  /**
   * O histórico de versões da página do congresso (item E12) é consequência dos
   * serviços reais: cada alteração acima gravou uma versão. Contá-las aqui é o que
   * prova que o caminho de escrita está ligado.
   */
  const versoesDemo = await prisma.eventPageVersion.count({
    where: { tenantId: ufbaId },
  });

  console.log(`  ✓ conteúdo e mídia: ${versoesDemo} versão(ões) no histórico · simpósio ${agendamentoDemo}`);

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
  console.log(`\n  Submissão e avaliação (FASE 4):`);  console.log(`    http://localhost:3000/t/ufba-demo/submissoes        (autor)`);
  console.log(`    http://localhost:3000/t/ufba-demo/revisoes          (revisor)`);
  console.log(`    http://localhost:3000/t/ufba-demo/comite            (comitê)`);
  console.log(`    Trilha semeada: "Trilha de Tecnologia Educacional" (rubrica 4 critérios,`);
  console.log(`    2 pareceres exigidos, aceite ≥ 70, rejeição < 45)`);
  console.log(`\n  Gamificação (FASE 5):`);
  console.log(`    http://localhost:3000/t/ufba-demo/conquistas      (XP, nível, missões, ranking)`);
  console.log(`    http://localhost:3000/t/ufba-demo/cartas          (álbum colecionável)`);
  console.log(`    http://localhost:3000/t/ufba-demo/credenciamento  (check-in da equipe)`);
  console.log(`    7 cartas (comum → mítica, duas com tiragem limitada), 6 missões e`);
  console.log(`    XP de demonstração para ana e bruno (líquido e consistente no extrato)`);
  console.log(`\n  Certificação (FASE 6):`);
  if (certificadosDemo.length === 0) {
    console.log(`    nenhum certificado de demonstração foi emitido`);
  }
  for (const certificado of certificadosDemo) {
    console.log(
      `    ${certificado.quem}: ${certificado.codigo} (${certificado.tipo}) · http://localhost:3000/validar/${certificado.codigo}`,
    );
  }
  console.log(`\n  Sorteios (FASE 8):`);
  console.log(`    ${sorteioRealizado}`);
  console.log(`    /t/ufba-demo/administracao/eventos/<id>/sorteios`);
  console.log(`\n  Página pública e patrocínio (FASE 17):`);
  console.log(`    ${blocosDemo} bloco(s) e ${patrocinioDemo} publicados em /t/ufba-demo/eventos/congresso-2026`);
  console.log(`    Editor: /t/ufba-demo/administracao/eventos/<id>/pagina`);
  console.log(`    Patrocínio: /t/ufba-demo/administracao/eventos/<id>/patrocinadores`);
  console.log(`\n  Conteúdo e mídia (FASE 23):`);
  console.log(`    ${versoesDemo} versão(ões) no histórico da página do congresso (restauráveis no editor)`);
  console.log(`    Pré-visualização do rascunho: .../eventos/<id>/pagina/previa`);
  console.log(`    Página do simpósio: ${agendamentoDemo}`);
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
