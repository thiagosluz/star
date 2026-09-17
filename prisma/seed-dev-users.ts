/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SEED DE CONTAS DE TESTE — **SOMENTE DESENVOLVIMENTO**
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PARA QUE ISTO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O seed principal (`prisma/seed.ts`) cria as contas de demonstração SEM senha,
 *  de propósito: elas existem para exercitar RBAC e tenancy, não para login. O
 *  efeito colateral é que testar a interface exigia criar uma conta em `/signup`,
 *  vinculá-la ao banco e conceder papel — sempre à mão.
 *
 *  Este script cria UMA conta por perfil (todos os 10 papéis, mais os estados de
 *  borda: convite pendente, vínculo suspenso e conta sem vínculo), todas com a
 *  MESMA senha, prontas para entrar e testar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS TRAVAS DE SEGURANÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. RECUSA EM PRODUÇÃO. `NODE_ENV=production` aborta o script. Não existe
 *     variável para contornar: a única forma de rodar isso em produção seria
 *     editar o código — e é exatamente esse o atrito que se quer.
 *  2. RECUSA SEM OS DADOS DE DEMONSTRAÇÃO. Se os tenants/evento do seed não
 *     existirem, o script PARA e diz o que rodar (nada de meia-configuração).
 *  3. SENHA VEM DO AMBIENTE. O padrão é público e está documentado; para usar
 *     outra, defina `SEED_TEST_PASSWORD`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  IDEMPOTENTE POR CONSTRUÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Rodar quantas vezes quiser: usuários são atualizados, a senha é RE-GRAVADA
 *  (é assim que se recupera uma conta cuja senha foi trocada na tela) e os papéis
 *  já existentes não são duplicados. Papéis concedidos à mão NÃO são removidos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from 'better-auth/crypto';

import { PrismaClient } from '../src/generated/prisma/client.ts';

// ───────────────────────────────────────────────────────────────────────────────
//  Trava 1 — ambiente
// ───────────────────────────────────────────────────────────────────────────────
const nodeEnv = process.env.NODE_ENV ?? 'development';

if (nodeEnv === 'production') {
  console.error(
    [
      '',
      '  ✖ RECUSADO: este script cria contas com senha conhecida e NÃO roda em produção.',
      '',
      '    Ele existe para desenvolvimento. Em produção, crie contas por /signup e',
      '    conceda papéis pelo painel (ou pela concessão inicial de SuperAdmin).',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const connectionString = process.env.MIGRATE_DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATE_DATABASE_URL não definida. Copie .env.example para .env.');
}

/** Senha única de todas as contas de teste (mínimo de 10 caracteres do Better Auth). */
const PASSWORD = process.env.SEED_TEST_PASSWORD ?? 'EventFlow@2026';
const EMAIL_DOMAIN = process.env.SEED_TEST_EMAIL_DOMAIN ?? 'eventflow.test';

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

const line = '─'.repeat(78);

// ───────────────────────────────────────────────────────────────────────────────
//  Definição das contas
// ───────────────────────────────────────────────────────────────────────────────
type RoleName =
  | 'OWNER'
  | 'ADMIN'
  | 'ORGANIZER'
  | 'CHAIR'
  | 'REVIEWER'
  | 'SPEAKER'
  | 'STAFF'
  | 'PARTICIPANT'
  | 'SPONSOR';

interface RoleGrant {
  role: RoleName;
  scope: 'TENANT' | 'EVENT';
  /** Slug do evento, quando o papel tem escopo de evento. */
  eventSlug?: string;
}

interface MembershipLink {
  tenantSlug: 'ufba-demo' | 'fiocruz-demo';
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  roles: RoleGrant[];
}

interface TestAccount {
  /** Vira `<id>@eventflow.test`. */
  id: string;
  name: string;
  /** O que esta conta existe para testar — é a coluna mais útil da documentação. */
  purpose: string;
  /** Concessão de governança da plataforma (`scope = PLATFORM`). */
  superAdmin?: boolean;
  links?: MembershipLink[];
}

const EVENT_SLUG = 'congresso-2026';

/**
 * Marca das concessões feitas por ESTE script.
 *
 * Serve para o script poder apagar e recriar os próprios papéis sem tocar em
 * concessões feitas à mão: sem isso, mudar o escopo de uma conta aqui deixaria
 * duas concessões vigentes (a antiga e a nova), e o teste passaria a medir uma
 * combinação que ninguém pediu.
 */
const SEED_REASON = 'Conta de teste de desenvolvimento (seed-dev-users)';

const ACCOUNTS: readonly TestAccount[] = [
  {
    id: 'superadmin',
    name: 'SuperAdmin da Plataforma',
    purpose:
      'Painel de governança (/superadmin): criar, suspender e reativar instituições, métricas e concessão de papéis de plataforma.',
    superAdmin: true,
  },
  {
    id: 'owner',
    name: 'Dono da Instituição',
    purpose: 'Topo da instituição: tudo do tenant, incluindo exclusão, billing e concessão de papéis.',
    links: [{ tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'OWNER', scope: 'TENANT' }] }],
  },
  {
    id: 'admin',
    name: 'Administrador da Instituição',
    purpose: 'Rotina administrativa: eventos, pessoas e configurações — sem billing nem exclusão do tenant.',
    links: [{ tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'ADMIN', scope: 'TENANT' }] }],
  },
  {
    id: 'organizador',
    name: 'Organizador (instituição inteira)',
    purpose: 'Criar e editar eventos, salas, atividades e trilhas em toda a instituição.',
    links: [{ tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'ORGANIZER', scope: 'TENANT' }] }],
  },
  {
    id: 'organizador-evento',
    name: 'Organizador (um evento)',
    purpose:
      'Escopo de EVENTO: administra apenas o Congresso 2026. Serve para ver o RBAC recusando o que está fora do escopo.',
    links: [
      {
        tenantSlug: 'ufba-demo',
        status: 'ACTIVE',
        roles: [{ role: 'ORGANIZER', scope: 'EVENT', eventSlug: EVENT_SLUG }],
      },
    ],
  },
  {
    id: 'presidente',
    name: 'Presidente do Comitê',
    purpose: 'Comitê científico: distribuir avaliações, ler pareceres e decidir aceite/rejeição.',
    links: [{ tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'CHAIR', scope: 'TENANT' }] }],
  },
  {
    id: 'revisor',
    name: 'Revisor',
    purpose: 'Fila de revisão (revisão cega), envio de parecer — e a recusa de ler parecer alheio.',
    links: [{ tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'REVIEWER', scope: 'TENANT' }] }],
  },
  {
    id: 'palestrante',
    name: 'Palestrante',
    purpose: 'Convidado de atividade: vê a própria agenda e a atividade em que é speaker.',
    links: [
      {
        tenantSlug: 'ufba-demo',
        status: 'ACTIVE',
        roles: [{ role: 'SPEAKER', scope: 'EVENT', eventSlug: EVENT_SLUG }],
      },
    ],
  },
  {
    id: 'equipe',
    name: 'Equipe de Credenciamento',
    purpose: 'Check-in e check-out por busca ou leitura de QR Code na tela /credenciamento.',
    /**
     * Escopo de TENANT, e não de evento, porque a tela de credenciamento exige uma
     * permissão de alcance institucional (`attendance:manage` no escopo TENANT).
     * Com escopo de evento a conta é redirecionada ao painel — ver a nota nas
     * dívidas técnicas da documentação de contas de teste.
     */
    links: [
      {
        tenantSlug: 'ufba-demo',
        status: 'ACTIVE',
        roles: [{ role: 'STAFF', scope: 'TENANT' }],
      },
    ],
  },
  {
    id: 'participante',
    name: 'Participante',
    purpose: 'Jornada do participante: inscrição, minhas inscrições, certificados, cartas, missões e conquistas.',
    links: [
      { tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'PARTICIPANT', scope: 'TENANT' }] },
    ],
  },
  {
    id: 'patrocinador',
    name: 'Patrocinador',
    purpose:
      'Vínculo ATIVO **sem** permissão de inscrição: a fronteira entre "é membro" e "pode agir" (a inscrição é recusada).',
    links: [{ tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'SPONSOR', scope: 'TENANT' }] }],
  },
  {
    id: 'multi',
    name: 'Multi-institucional (acúmulo de papéis)',
    purpose:
      'ADMIN na UFBA e CHAIR + PARTICIPANT na Fiocruz: testa troca de contexto no seletor e acúmulo de papéis.',
    links: [
      { tenantSlug: 'ufba-demo', status: 'ACTIVE', roles: [{ role: 'ADMIN', scope: 'TENANT' }] },
      {
        tenantSlug: 'fiocruz-demo',
        status: 'ACTIVE',
        roles: [
          { role: 'CHAIR', scope: 'TENANT' },
          { role: 'PARTICIPANT', scope: 'TENANT' },
        ],
      },
    ],
  },
  {
    id: 'convidado',
    name: 'Convidado (convite pendente)',
    purpose:
      'Vínculo com status INVITED: a plataforma é fail-closed — a instituição NÃO aparece no seletor e o acesso é negado.',
    links: [
      { tenantSlug: 'ufba-demo', status: 'INVITED', roles: [{ role: 'PARTICIPANT', scope: 'TENANT' }] },
    ],
  },
  {
    id: 'suspenso',
    name: 'Vínculo Suspenso',
    purpose:
      'Vínculo SUSPENDED: a inscrição em evento público é BLOQUEADA e a página mostra "Acesso bloqueado".',
    links: [
      { tenantSlug: 'ufba-demo', status: 'SUSPENDED', roles: [{ role: 'PARTICIPANT', scope: 'TENANT' }] },
    ],
  },
  {
    id: 'semvinculo',
    name: 'Sem Vínculo',
    purpose:
      'Conta autenticada sem nenhum vínculo: inscreve-se em evento público e passa a ser PARTICIPANTE (FASE 10); nada mais é acessível.',
  },
];

// ───────────────────────────────────────────────────────────────────────────────
//  Utilidades
// ───────────────────────────────────────────────────────────────────────────────
function emailFor(accountId: string): string {
  return `${accountId}@${EMAIL_DOMAIN}`;
}

/** Contexto de tenant aplicado à transação (mesma mecânica de `withTenant`). */
async function inTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn();
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Execução
// ───────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${line}\n  SEED DE CONTAS DE TESTE — ambiente "${nodeEnv}"\n${line}\n`);

  // ── Trava 2: os dados de demonstração precisam existir ─────────────────────
  const tenants = await prisma.tenant.findMany({
    where: { slug: { in: ['ufba-demo', 'fiocruz-demo'] } },
    select: { id: true, slug: true, name: true },
  });

  const tenantBySlug = new Map(tenants.map((tenant) => [tenant.slug, tenant]));

  if (!tenantBySlug.has('ufba-demo') || !tenantBySlug.has('fiocruz-demo')) {
    console.error(
      [
        '',
        '  ✖ RECUSADO: as instituições de demonstração não existem.',
        '',
        '    Rode primeiro:  npm run db:seed',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const congress = await prisma.event.findFirst({
    where: { tenantId: tenantBySlug.get('ufba-demo')!.id, slug: EVENT_SLUG },
    select: { id: true },
  });

  if (!congress) {
    console.error(
      [
        '',
        `  ✖ RECUSADO: o evento "${EVENT_SLUG}" não existe em ufba-demo.`,
        '',
        '    Os papéis com escopo de evento precisam dele. Rode:  npm run db:seed',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  // ── Senha: um único hash para todas as contas ──────────────────────────────
  /**
   * O hash é scrypt do Better Auth (`account.password`), e não o `user.passwordHash`
   * — este último é um campo legado que a biblioteca não usa. A conta de
   * credencial fica em `account` com `providerId = 'credential'`.
   */
  const passwordHash = await hashPassword(PASSWORD);

  let created = 0;
  let updated = 0;

  for (const account of ACCOUNTS) {
    const email = emailFor(account.id);

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    const userId =
      existing?.id ??
      (
        await prisma.user.create({
          data: { id: randomUUID(), name: account.name, email, emailVerified: true },
          select: { id: true },
        })
      ).id;

    if (existing) updated += 1;
    else created += 1;

    // Nome sempre sincronizado com a definição (útil quando o texto muda).
    await prisma.user.update({ where: { id: userId }, data: { name: account.name } });

    // ── Conta de credencial: é AQUI que a senha vive ─────────────────────────
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: userId } },
      create: {
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: passwordHash,
      },
      // Re-grava a senha a cada execução: é o caminho de recuperação quando ela
      // foi trocada na interface durante um teste.
      update: { password: passwordHash },
    });

    // ── Governança da plataforma ─────────────────────────────────────────────
    if (account.superAdmin) {
      const granted = await prisma.roleAssignment.findFirst({
        where: { userId, scope: 'PLATFORM', tenantId: null, revokedAt: null },
        select: { id: true },
      });

      if (!granted) {
        await prisma.roleAssignment.create({
          data: {
            id: randomUUID(),
            tenantId: null,
            userId,
            role: 'SUPERADMIN',
            scope: 'PLATFORM',
            reason: SEED_REASON,
          },
        });
      }
    }

    // ── Vínculos e papéis ────────────────────────────────────────────────────
    for (const link of account.links ?? []) {
      const tenant = tenantBySlug.get(link.tenantSlug)!;

      await inTenant(tenant.id, async () => {
        await prisma.userTenantProfile.upsert({
          where: { tenantId_userId: { tenantId: tenant.id, userId } },
          create: {
            id: randomUUID(),
            tenantId: tenant.id,
            userId,
            status: link.status,
            joinedAt: link.status === 'ACTIVE' ? new Date() : null,
          },
          // Reafirma o estado a cada execução: o teste de "suspenso" precisa
          // continuar suspenso mesmo depois de alguém mexer na tela.
          update: {
            status: link.status,
            deletedAt: null,
            joinedAt: link.status === 'ACTIVE' ? new Date() : null,
          },
        });

        /**
         * Convergência: as concessões DESTE script são apagadas e recriadas.
         *
         * É o que permite mudar o escopo de uma conta aqui (de EVENT para TENANT,
         * por exemplo) sem deixar a concessão antiga vigente ao lado da nova — e
         * sem tocar em papéis concedidos à mão, que têm outro motivo.
         */
        await prisma.roleAssignment.deleteMany({
          where: { tenantId: tenant.id, userId, reason: SEED_REASON },
        });

        for (const grant of link.roles) {
          const eventId = grant.eventSlug ? congress.id : null;

          const already = await prisma.roleAssignment.findFirst({
            where: {
              tenantId: tenant.id,
              userId,
              role: grant.role,
              scope: grant.scope,
              eventId,
              revokedAt: null,
            },
            select: { id: true },
          });

          if (already) continue;

          await prisma.roleAssignment.create({
            data: {
              id: randomUUID(),
              tenantId: tenant.id,
              userId,
              role: grant.role,
              scope: grant.scope,
              eventId,
              reason: SEED_REASON,
            },
          });
        }
      });
    }
  }

  // ── Relatório ──────────────────────────────────────────────────────────────
  console.log(`  ✓ ${created} conta(s) criada(s), ${updated} já existente(s) atualizada(s)\n`);

  const rows: string[][] = [['E-MAIL', 'PERFIL', 'PAPÉIS']];

  for (const account of ACCOUNTS) {
    const roles: string[] = [];

    if (account.superAdmin) roles.push('SUPERADMIN (plataforma)');

    for (const link of account.links ?? []) {
      const suffix =
        link.status === 'ACTIVE' ? '' : ` [vínculo ${link.status}]`;
      const grants = link.roles
        .map((grant) => `${grant.role}${grant.scope === 'EVENT' ? ` (${grant.eventSlug})` : ''}`)
        .join(' + ');

      roles.push(`${grants} em ${link.tenantSlug}${suffix}`);
    }

    rows.push([emailFor(account.id), account.name, roles.join(' · ') || '— nenhum —']);
  }

  const widths = rows[0]!.map((_, index) =>
    Math.max(...rows.map((row) => (row[index] ?? '').length)),
  );

  for (const [index, row] of rows.entries()) {
    const printed = row.map((cell, column) => (cell ?? '').padEnd(widths[column]!)).join('  ');

    console.log(`  ${printed}`);
    if (index === 0) console.log(`  ${widths.map((width) => '─'.repeat(width)).join('  ')}`);
  }

  console.log(
    [
      '',
      `  Senha de TODAS as contas: ${PASSWORD}`,
      '  Interface: http://localhost:3000/login',
      '  Documentação: docs/contas-de-teste.md',
      '',
      '  Para outra senha: SEED_TEST_PASSWORD="..." npm run db:seed:dev',
      '',
    ].join('\n'),
  );
}

main()
  .catch((error) => {
    console.error('\n  ✖ Falha ao criar as contas de teste:\n', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
