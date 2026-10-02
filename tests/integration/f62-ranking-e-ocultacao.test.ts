/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — O RANKING NÃO CITA QUEM A MODERAÇÃO OCULTOU
 *  (FASE 62 · dívida E80)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a decisão da moderação (`decideReport`, o serviço REAL da plataforma) grava
 *      `User.publicProfileHiddenAt`, e o efeito atravessa `getLeaderboard` — o
 *      serviço que alimenta a tela `/t/<slug>/conquistas`;
 *    • a linha da pessoa ocultada CONTINUA na lista, com a posição e o XP dela: a
 *      identidade sai, o FATO fica (a decisão da dívida, ver o PORQUÊ em
 *      `src/domain/gamification/leaderboard-rules.ts`);
 *    • a contagem do painel (`rank`/`rankedCount`, do `getXpProfile`) continua igual
 *      à da lista — é o argumento de que remover a pessoa faria a tela mentir;
 *    • quem NÃO foi ocultado continua com nome, `@handle` e foto: a régua é da
 *      PESSOA, e não um blecaute do ranking.
 *
 *  A ordem dos cenários É o teste: mostrar (antes) → decidir → mascarar (depois).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getLeaderboard, getXpProfile } from '../../src/lib/gamification/xp-service';
import { decideReport } from '../../src/lib/platform/profile-moderation';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';

const RUN = randomUUID().slice(0, 8);

const TENANT_SLUG = `f62-ranking-${RUN}`;
const HANDLE_ANA = `ana-f62-${RUN}`;
const HANDLE_BRUNO = `bruno-f62-${RUN}`;
const FOTO_ANA = `https://acervo.exemplo.test/${RUN}/ana.webp`;
const NOTA = 'O perfil publica dado de terceiro sem autorizacao; medida confirmada na analise.';

const XP_ANA = 4_120;
const XP_BRUNO = 1_850;

let tenantId: string;

let ana: string;
let bruno: string;
let denunciante: string;
let moderador: string;

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(input: {
  name: string;
  image?: string | null;
  platformRole?: boolean;
}): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name: input.name,
      email: `f62.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
      image: input.image ?? null,
    },
  });

  if (input.platformRole) {
    await adminPrisma.roleAssignment.create({
      data: {
        id: randomUUID(),
        tenantId: null,
        userId: id,
        role: 'SUPERADMIN',
        scope: 'PLATFORM',
        reason: 'Moderador do teste de integração da FASE 62',
      },
    });
  }

  return id;
}

async function addMember(userId: string): Promise<void> {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId,
      status: 'ACTIVE',
      kind: 'MEMBER',
      joinedAt: new Date(),
    },
  });
}

/** O perfil de XP é o que coloca a pessoa no ranking (`totalXp > 0`). */
async function giveXp(userId: string, totalXp: number): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.userXpProfile.create({
      data: { id: randomUUID(), tenantId, userId, totalXp, level: 3, cardsCollected: 2 },
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do Ranking ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  ana = await createUser({ name: 'Ana Souza', image: FOTO_ANA });
  bruno = await createUser({ name: 'Bruno Visivel', image: null });
  denunciante = await createUser({ name: 'Quem Denuncia' });
  moderador = await createUser({ name: 'Moderador da Plataforma', platformRole: true });

  await addMember(ana);
  await addMember(bruno);

  await giveXp(ana, XP_ANA);
  await giveXp(bruno, XP_BRUNO);

  /** O `@handle` é o endereço público da pessoa — a identidade que a medida tira do ar. */
  await adminPrisma.user.update({ where: { id: ana }, data: { publicHandle: HANDLE_ANA } });
  await adminPrisma.user.update({ where: { id: bruno }, data: { publicHandle: HANDLE_BRUNO } });
});

afterAll(async () => {
  const reports = await adminPrisma.profileReport.findMany({
    where: { tenantId },
    select: { id: true },
  });

  /** A trilha da decisão é de PLATAFORMA (sem tenant) e não cai com a exclusão. */
  await adminPrisma.auditLog.deleteMany({
    where: { entityType: 'profile_report', entityId: { in: reports.map((row) => row.id) } },
  });

  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('antes da decisão, o ranking cita as duas pessoas por inteiro', () => {
  it('Ana aparece em 1º com nome, @handle e foto; Bruno em 2º', async () => {
    const board = await getLeaderboard(tenantId, { currentUserId: bruno });

    expect(board.ok, board.ok ? 'ok' : board.message).toBe(true);
    if (!board.ok) return;

    expect(board.entries.map((entry) => entry.userId)).toEqual([ana, bruno]);
    expect(board.entries[0]).toMatchObject({
      position: 1,
      name: 'Ana Souza',
      publicHandle: HANDLE_ANA,
      image: FOTO_ANA,
      totalXp: XP_ANA,
      isCurrentUser: false,
    });
    expect(board.entries[1]).toMatchObject({
      position: 2,
      name: 'Bruno Visivel',
      publicHandle: HANDLE_BRUNO,
      isCurrentUser: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a decisão da moderação (serviço real da plataforma)', () => {
  it('a denúncia entra na fila e o OCULTAR grava o efeito no perfil', async () => {
    const reported = await reportPublicProfile({
      tenantId,
      reporterUserId: denunciante,
      username: HANDLE_ANA,
      category: 'PRIVACY',
      details: 'O perfil publica o telefone de uma terceira pessoa, sem autorização dela.',
    });

    expect(reported.ok, reported.ok ? 'ok' : reported.message).toBe(true);
    if (!reported.ok) return;

    const decidida = await decideReport({
      reportId: reported.reportId,
      action: 'HIDE',
      note: NOTA,
      actorId: moderador,
    });

    expect(decidida.ok, decidida.ok ? 'ok' : decidida.message).toBe(true);
    if (!decidida.ok) return;

    expect(decidida.hiddenProfile).toBe(true);

    /** O efeito é lido do BANCO: ocultar NÃO apaga — nem o perfil, nem o XP. */
    const pessoa = await adminPrisma.user.findUniqueOrThrow({
      where: { id: ana },
      select: { publicProfileHiddenAt: true, publicHandle: true },
    });

    expect(pessoa.publicProfileHiddenAt).not.toBeNull();
    expect(pessoa.publicHandle).toBe(HANDLE_ANA);

    const perfil = await withTenant(tenantId, (tx) =>
      tx.userXpProfile.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId: ana } } }),
    );

    expect(perfil.totalXp).toBe(XP_ANA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o ranking depois da decisão', () => {
  it('a pessoa continua na lista, na MESMA posição, sem identidade', async () => {
    const board = await getLeaderboard(tenantId, { currentUserId: bruno });

    expect(board.ok, board.ok ? 'ok' : board.message).toBe(true);
    if (!board.ok) return;

    /** A lista NÃO encolhe: é o que a decisão de mascarar (e não remover) preserva. */
    expect(board.entries.map((entry) => entry.userId)).toEqual([ana, bruno]);

    expect(board.entries[0]).toMatchObject({
      position: 1,
      name: 'Ana S.',
      publicHandle: null,
      image: null,
      totalXp: XP_ANA,
    });
  });

  it('nem no JSON do ranking sobra a identidade de quem foi ocultado', async () => {
    const board = await getLeaderboard(tenantId, {});

    expect(board.ok).toBe(true);
    if (!board.ok) return;

    /**
     * A checagem é sobre o JSON inteiro: o campo `masked` da régua de domínio NÃO é
     * publicado na resposta — a tela não anuncia a decisão da plataforma (a lição do
     * link selado da carta), e por isso ela não pode vazar por um campo a mais.
     */
    const serialized = JSON.stringify(board.entries);

    expect(serialized).not.toContain('Ana Souza');
    expect(serialized).not.toContain(HANDLE_ANA);
    expect(serialized).not.toContain(FOTO_ANA);
    expect(serialized).not.toContain('masked');
    expect(serialized).toContain('Ana S.');
  });

  it('quem NÃO foi ocultado continua aparecendo por inteiro (a régua é da pessoa)', async () => {
    const board = await getLeaderboard(tenantId, { currentUserId: bruno });

    expect(board.ok).toBe(true);
    if (!board.ok) return;

    const linha = board.entries.find((entry) => entry.userId === bruno);

    expect(linha).toMatchObject({
      position: 2,
      name: 'Bruno Visivel',
      publicHandle: HANDLE_BRUNO,
      isCurrentUser: true,
    });
  });

  it('a contagem do painel continua batendo com a lista (posição e total são o conteúdo)', async () => {
    /**
     * ─── POR QUE ESTE CASO EXISTE ───────────────────────────────────────────────
     *
     *  O cabeçalho da tela de conquistas mostra `rank` e `rankedCount`, calculados
     *  pelo `getXpProfile` contando TODOS os perfis com XP. Se o ranking REMOVESSE a
     *  pessoa ocultada, o "1º de 2" do painel conviveria com uma lista de uma linha —
     *  é a razão número dois da decisão de mascarar, presa aqui contra o banco.
     */
    const perfil = await getXpProfile(tenantId, bruno);

    expect(perfil.ok, perfil.ok ? 'ok' : perfil.message).toBe(true);
    if (!perfil.ok) return;

    const board = await getLeaderboard(tenantId, { currentUserId: bruno });

    expect(board.ok).toBe(true);
    if (!board.ok) return;

    expect(perfil.profile.rankedCount).toBe(board.entries.length);
    expect(perfil.profile.rank).toBe(
      board.entries.find((entry) => entry.userId === bruno)?.position ?? null,
    );
  });
});
