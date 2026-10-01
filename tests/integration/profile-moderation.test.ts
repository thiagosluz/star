/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes de INTEGRAÇÃO — DENÚNCIA E MODERAÇÃO DO PERFIL (FASE 56 · dívida E62)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a denúncia NASCE sob RLS, com o `tenantId` de quem denunciou, e entra na
 *      trilha daquela instituição;
 *    • a decisão é da PLATAFORMA: `HIDE` grava `User.publicProfileHiddenAt` (o efeito
 *      vale para todas as casas) e a trilha do ato fica SEM tenant — é em
 *      `/superadmin/auditoria` que ela aparece;
 *    • o perfil oculto deixa de aparecer: `getPublicProfile` devolve `hiddenReason` e
 *      o pacote VAZIO (nem um campo a mais), e o diretório para de listá-lo;
 *    • decidir duas vezes é recusado pelo BANCO (`UPDATE` condicional em `status =
 *      'OPEN'`), e não por uma checagem que a corrida poderia furar;
 *    • as recusas de mérito (auto-denúncia, denúncia repetida, detalhe curto em
 *      `OTHER`) saem com CÓDIGO, e a ordem delas é contrato: a duplicidade é a última.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DOS CASOS IMPORTA, E É DECLARADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O arquivo roda em série (o `fileParallelism` do Vitest já é `false`) e cada caso
 *  depende do estado deixado pelo anterior — denunciar, listar, decidir, ocultar. É
 *  o mesmo desenho de `public-profile.test.ts`, e a alternativa (recriar todo o
 *  cenário em cada `it`) faria o teste medir fixture, não comportamento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listAuditLog } from '../../src/lib/admin/audit';
import { reportPublicProfile, listOwnFiledReports } from '../../src/lib/profile/profile-report-service';
import {
  countOpenReports,
  decideReport,
  listModerationQueue,
} from '../../src/lib/platform/profile-moderation';
import {
  getPublicProfile,
  listDirectoryProfiles,
} from '../../src/lib/profile/public-profile-service';
import type { ProfileReportCategory } from '../../src/domain/profile/profile-moderation-rules';

const RUN = randomUUID().slice(0, 8);

let tenantA: string;
let tenantB: string;
let slugA: string;
let slugB: string;

/** Ana é o perfil DENUNCIADO; Felipe é o segundo, para o desfecho sem ação. */
let ana: string;
let felipe: string;
let bruno: string;
let elisa: string;
let carla: string;
/** Duda existe na plataforma e NÃO participa de instituição nenhuma. */
let duda: string;

const HANDLE_ANA = `ana-moderacao-${RUN}`;
const HANDLE_FELIPE = `felipe-moderacao-${RUN}`;
const HANDLE_DUDA = `duda-moderacao-${RUN}`;

/** O `reportId` da denúncia de Bruno — os casos seguintes decidem sobre ele. */
let brunoReportId = '';
/** A denúncia de Elisa, que fica ABERTA enquanto a de Bruno é decidida. */
let elisaReportId = '';

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function createUser(name: string, handle?: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: {
      id,
      name,
      email: `f56mod.${RUN}.${id.slice(0, 8)}@exemplo.test`,
      emailVerified: true,
      ...(handle ? { publicHandle: handle } : {}),
    },
  });

  return id;
}

async function addMember(input: {
  userId: string;
  tenantId: string;
  /** Ana entra no diretório para o teste provar que ela SAI dele ao ser ocultada. */
  listedInDirectory?: boolean;
}): Promise<void> {
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      status: 'ACTIVE',
      kind: 'PARTICIPANT',
      joinedAt: new Date(),
      listedInDirectory: input.listedInDirectory ?? false,
    },
  });
}

/** A trilha da denúncia, na instituição (a que a tela de auditoria da casa lê). */
async function reportAudit(tenantId: string, action: string) {
  const entries = await listAuditLog(tenantId, { limit: 200 });

  return entries.filter((entry) => entry.entityType === 'profile_report' && entry.action === action);
}

/** A trilha da DECISÃO, que é de plataforma — logo, sem tenant. */
async function platformReportAudit(reportId: string) {
  const rows = await adminPrisma.auditLog.findMany({
    where: { tenantId: null, entityType: 'profile_report', entityId: reportId },
    orderBy: { createdAt: 'desc' },
  });

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantA = randomUUID();
  tenantB = randomUUID();
  slugA = `moderacao-a-${RUN}`;
  slugB = `moderacao-b-${RUN}`;

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantA,
        slug: slugA,
        name: `Instituição A ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: 'America/Bahia',
      },
      {
        id: tenantB,
        slug: slugB,
        name: `Instituição B ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
        timezone: 'America/Bahia',
      },
    ],
  });

  ana = await createUser('Ana Souza', HANDLE_ANA);
  felipe = await createUser('Felipe Andrade', HANDLE_FELIPE);
  bruno = await createUser('Bruno Lima');
  elisa = await createUser('Elisa Prado');
  carla = await createUser('Carla Nunes');
  duda = await createUser('Duda Reis', HANDLE_DUDA);

  await addMember({ userId: ana, tenantId: tenantA, listedInDirectory: true });
  await addMember({ userId: felipe, tenantId: tenantA });
  await addMember({ userId: bruno, tenantId: tenantA });
  await addMember({ userId: elisa, tenantId: tenantA });
  /** Carla PARTICIPA da casa B — é a denunciante de outra instituição. */
  await addMember({ userId: carla, tenantId: tenantB });
  /** Duda não participa de casa nenhuma: o perfil dela não existe para a página. */
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a denúncia nasce com o contexto de quem denunciou', () => {
  it('grava ABERTA, normaliza o @handle e entra na trilha da instituição', async () => {
    const result = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      /** O handle vem CRU da barra de endereços — o serviço normaliza como a página. */
      username: HANDLE_ANA.toUpperCase(),
      category: 'SPAM',
      details: '  O perfil só divulga links comerciais repetidos.  ',
      ipAddress: '203.0.113.9',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    brunoReportId = result.reportId;

    const row = await withTenant(tenantA, (tx) =>
      tx.profileReport.findUniqueOrThrow({
        where: { id: result.reportId },
        select: {
          tenantId: true,
          reportedUserId: true,
          reporterUserId: true,
          category: true,
          details: true,
          status: true,
        },
      }),
    );

    expect(row.tenantId).toBe(tenantA);
    expect(row.reportedUserId).toBe(ana);
    expect(row.reporterUserId).toBe(bruno);
    expect(row.category).toBe('SPAM');
    expect(row.status).toBe('OPEN');
    /** O detalhe é gravado sem os espaços das pontas: a coluna guarda o TEXTO. */
    expect(row.details).toBe('O perfil só divulga links comerciais repetidos.');

    const trilha = await reportAudit(tenantA, 'CREATE');
    const entrada = trilha.find((entry) => entry.entityId === result.reportId);

    expect(entrada).toBeDefined();
    expect(entrada!.actorName).toBe('Bruno Lima');
    /** A trilha guarda o ATO: categoria e alvo, nunca o texto do relato. */
    expect(entrada!.changes.categoria).toEqual({ from: null, to: 'SPAM' });
    expect(entrada!.changes.perfil).toEqual({ from: null, to: `@${HANDLE_ANA}` });
    expect(JSON.stringify(entrada!.changes)).not.toContain('links comerciais');
  });

  it('a página do perfil diz a QUEM DENUNCIOU que a denúncia está em análise', async () => {
    const doDenunciante = await listOwnFiledReports({ tenantId: tenantA, reporterUserId: bruno });

    expect(doDenunciante.map((row) => row.reportId)).toContain(brunoReportId);
    expect(doDenunciante.find((row) => row.reportId === brunoReportId)?.status).toBe('OPEN');

    const pagina = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: bruno,
    });

    expect(pagina.ok, pagina.ok ? 'ok' : pagina.message).toBe(true);
    if (!pagina.ok) return;

    expect(pagina.page.alreadyReported).toBe(true);
    /** O dono e quem nunca denunciou continuam vendo o formulário. */
    expect(pagina.page.hiddenReason).toBeNull();

    const semDenuncia = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: elisa,
    });

    if (semDenuncia.ok) expect(semDenuncia.page.alreadyReported).toBe(false);
  });

  it('handle inexistente responde NOT_FOUND', async () => {
    const result = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      username: `ninguem-${RUN}`,
      category: 'SPAM',
      details: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('denunciar o PRÓPRIO perfil é recusado', async () => {
    const result = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: ana,
      username: HANDLE_ANA,
      category: 'OTHER',
      details: 'Estou testando a minha própria denúncia.',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SELF_REPORT');
      expect(result.message).toMatch(/próprio perfil/i);
    }

    /** E nada foi gravado: a recusa é antes da escrita. */
    const count = await withTenant(tenantA, (tx) =>
      tx.profileReport.count({ where: { tenantId: tenantA, reporterUserId: ana } }),
    );

    expect(count).toBe(0);
  });

  it('a segunda denúncia ABERTA do mesmo denunciante é recusada', async () => {
    const result = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      username: HANDLE_ANA,
      category: 'OFFENSIVE_CONTENT',
      details: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ALREADY_REPORTED');
      expect(result.message).toMatch(/já denunciou/i);
    }

    const abertas = await withTenant(tenantA, (tx) =>
      tx.profileReport.count({
        where: { tenantId: tenantA, reporterUserId: bruno, reportedUserId: ana, status: 'OPEN' },
      }),
    );

    expect(abertas).toBe(1);
  });

  it('OTHER sem detalhes é INVALID_INPUT — e a recusa vem ANTES da duplicidade', async () => {
    /**
     * O caso prova a ORDEM: a denúncia de Bruno contra Ana já está aberta, e mesmo
     * assim a resposta é sobre o relato que falta — quem denuncia precisa ouvir o
     * que corrigir, não "você já denunciou".
     */
    const result = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      username: HANDLE_ANA,
      category: 'OTHER',
      details: '   ',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.message).toMatch(/descreva o motivo/i);
    }

    const curto = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      username: HANDLE_ANA,
      category: 'OTHER',
      details: 'spam',
    });

    expect(curto.ok).toBe(false);
    if (!curto.ok) {
      expect(curto.code).toBe('INVALID_INPUT');
      expect(curto.message).toContain('10');
    }
  });

  it('categoria desconhecida e relato acima do teto são recusados', async () => {
    const categoria = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: elisa,
      username: HANDLE_ANA,
      category: 'QUALQUER_COISA' as ProfileReportCategory,
      details: null,
    });

    expect(categoria.ok).toBe(false);
    if (!categoria.ok) expect(categoria.code).toBe('INVALID_INPUT');

    const longo = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: elisa,
      username: HANDLE_ANA,
      category: 'PRIVACY',
      details: 'a'.repeat(2001),
    });

    expect(longo.ok).toBe(false);
    if (!longo.ok) {
      expect(longo.code).toBe('INVALID_INPUT');
      expect(longo.message).toContain('2000');
    }
  });

  it('perfil de quem NÃO participa desta casa responde NOT_FOUND', async () => {
    /**
     * A página pública de Duda não existe na instituição A (ela não tem vínculo nem
     * inscrição aqui). Aceitar a denúncia encheria a fila de relatos sobre uma página
     * que ninguém viu — e quem triagem não teria como distinguir isso de um relato
     * legítimo. A régua é a MESMA de `getPublicProfile`.
     */
    const result = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      username: HANDLE_DUDA,
      category: 'SPAM',
      details: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');

    /** E a página confirma o 404: a denúncia recusada apontaria para o vazio. */
    const pagina = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_DUDA,
      viewerUserId: null,
    });

    expect(pagina.ok).toBe(false);

    const gravadas = await withTenant(tenantA, (tx) =>
      tx.profileReport.count({ where: { tenantId: tenantA, reportedUserId: duda } }),
    );

    expect(gravadas).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a fila da plataforma', () => {
  it('lista as abertas da mais ANTIGA para a mais nova, com origem e resumo', async () => {
    const outra = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: elisa,
      username: HANDLE_ANA,
      category: 'PRIVACY',
      details: 'O perfil publica o telefone de uma terceira pessoa.',
    });

    expect(outra.ok, outra.ok ? 'ok' : outra.message).toBe(true);
    if (!outra.ok) return;

    elisaReportId = outra.reportId;

    const fila = await listModerationQueue({ limit: 100 });

    expect(fila.ok, fila.ok ? 'ok' : fila.message).toBe(true);
    if (!fila.ok) return;

    const daAna = fila.items.filter((item) => item.reported.userId === ana);

    expect(daAna.length).toBe(2);
    /** Fila é fila: quem esperou mais aparece primeiro. */
    expect(daAna[0]!.reportId).toBe(brunoReportId);
    expect(daAna[1]!.reportId).toBe(elisaReportId);
    expect(daAna[0]!.createdAt.getTime()).toBeLessThanOrEqual(daAna[1]!.createdAt.getTime());

    const primeira = daAna[0]!;

    expect(primeira.reported.handle).toBe(HANDLE_ANA);
    expect(primeira.reported.name).toBe('Ana Souza');
    expect(primeira.reported.isHidden).toBe(false);
    expect(primeira.reporter.name).toBe('Bruno Lima');
    expect(primeira.origin).toEqual({ tenantId: tenantA, name: `Instituição A ${RUN}`, slug: slugA });
    expect(primeira.status).toBe('OPEN');

    expect(fila.summary.byCategory.SPAM).toBeGreaterThanOrEqual(1);
    expect(fila.summary.byCategory.PRIVACY).toBeGreaterThanOrEqual(1);
    /** As categorias sem denúncia entram ZERADAS — zero é uma contagem (FASE 54). */
    expect(fila.summary.byCategory.FALSE_IDENTITY).toBe(0);
    expect(Object.keys(fila.summary.byCategory).sort()).toEqual([
      'FALSE_IDENTITY',
      'OFFENSIVE_CONTENT',
      'OTHER',
      'PRIVACY',
      'SPAM',
    ]);

    const contagem = await countOpenReports();
    expect(contagem).toBeGreaterThanOrEqual(fila.summary.total);
  });

  it('a decisão exige justificativa, nos dois desfechos', async () => {
    const semNota = await decideReport({
      reportId: brunoReportId,
      action: 'HIDE',
      note: '   ',
      actorId: elisa,
    });

    expect(semNota.ok).toBe(false);
    if (!semNota.ok) {
      expect(semNota.code).toBe('INVALID_INPUT');
      expect(semNota.message).toMatch(/justificativa/i);
    }

    /** E o perfil continua no ar: a recusa é antes de qualquer escrita. */
    const perfil = await adminPrisma.user.findUniqueOrThrow({
      where: { id: ana },
      select: { publicProfileHiddenAt: true },
    });

    expect(perfil.publicProfileHiddenAt).toBeNull();
  });

  it('HIDE oculta o perfil e a página pública passa a AVISAR (sem conteúdo)', async () => {
    const NOTA = 'O perfil expõe dados de terceiros e o relato foi confirmado pela equipe.';

    const antes = await getPublicProfile({ tenantSlug: slugA, username: HANDLE_ANA, viewerUserId: null });
    expect(antes.ok).toBe(true);

    const decisao = await decideReport({
      reportId: brunoReportId,
      action: 'HIDE',
      note: NOTA,
      actorId: duda,
    });

    expect(decisao.ok, decisao.ok ? 'ok' : decisao.message).toBe(true);
    if (!decisao.ok) return;

    expect(decisao.status).toBe('ACTIONED');
    expect(decisao.hiddenProfile).toBe(true);

    // ── O EFEITO no perfil: ocultar NÃO apaga o handle ───────────────────────
    const pessoa = await adminPrisma.user.findUniqueOrThrow({
      where: { id: ana },
      select: { publicHandle: true, publicProfileHiddenAt: true, publicProfileHiddenReason: true },
    });

    expect(pessoa.publicProfileHiddenAt).not.toBeNull();
    expect(pessoa.publicProfileHiddenReason).toBe(NOTA);
    expect(pessoa.publicHandle).toBe(HANDLE_ANA);

    // ── A DENÚNCIA decidida ──────────────────────────────────────────────────
    const row = await withTenant(tenantA, (tx) =>
      tx.profileReport.findUniqueOrThrow({
        where: { id: brunoReportId },
        select: { status: true, decidedById: true, decidedAt: true, decisionNote: true },
      }),
    );

    expect(row.status).toBe('ACTIONED');
    expect(row.decidedById).toBe(duda);
    expect(row.decidedAt).not.toBeNull();
    expect(row.decisionNote).toBe(NOTA);

    // ── A PÁGINA: aviso, pacote vazio, nada indexável ────────────────────────
    const anonimo = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: null,
    });

    expect(anonimo.ok, anonimo.ok ? 'ok' : anonimo.message).toBe(true);
    if (!anonimo.ok) return;

    expect(anonimo.page.hiddenReason).toBe(NOTA);
    expect(anonimo.page.visibleFields).toEqual([]);
    expect(anonimo.page.indexable).toBe(false);
    expect(anonimo.page.moreForAttendees).toBe(false);
    /** Só o endereço: nem nome, nem bio, nem nível. */
    expect(Object.keys(anonimo.page.profile)).toEqual(['username']);

    /** O dono vê o AVISO — não uma página normal que ele não entenderia. */
    const dono = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_ANA,
      viewerUserId: ana,
    });

    expect(dono.ok, dono.ok ? 'ok' : dono.message).toBe(true);
    if (dono.ok) {
      expect(dono.page.hiddenReason).toBe(NOTA);
      expect(dono.page.isOwner).toBe(true);
    }

    // ── A TRILHA da decisão é de PLATAFORMA (sem tenant) ─────────────────────
    const plataforma = await platformReportAudit(brunoReportId);
    const entrada = plataforma.find((row) => row.action === 'UPDATE');

    expect(entrada).toBeDefined();
    expect(entrada!.userId).toBe(duda);
    expect((entrada!.changes as Record<string, { to: unknown }>).status).toEqual({
      from: 'OPEN',
      to: 'ACTIONED',
    });
    expect((entrada!.changes as Record<string, { to: unknown }>).perfilOcultado).toEqual({
      from: 'não',
      to: 'sim',
    });

    /** E a denúncia de Elisa continua ABERTA: decidir uma não decide a outra. */
    const restantes = await withTenant(tenantA, (tx) =>
      tx.profileReport.findUniqueOrThrow({
        where: { id: elisaReportId },
        select: { status: true },
      }),
    );

    expect(restantes.status).toBe('OPEN');
  });

  it('o perfil oculto sai do DIRETÓRIO de participantes', async () => {
    /**
     * O diretório é uma vitrine que existe para exibir perfis públicos. Continuar
     * listando o perfil que a moderação tirou do ar seria uma segunda régua de
     * visibilidade — e a que a pessoa ocultada não pode contestar.
     */
    const diretorio = await listDirectoryProfiles({ tenantId: tenantA });

    expect(diretorio.map((row) => row.username)).not.toContain(HANDLE_ANA);
  });

  it('decidir de novo a MESMA denúncia é recusado', async () => {
    const segunda = await decideReport({
      reportId: brunoReportId,
      action: 'DISMISS',
      note: 'Tentativa de reescrever uma decisão já tomada.',
      actorId: elisa,
    });

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) {
      expect(segunda.code).toBe('ALREADY_DECIDED');
      expect(segunda.message).toMatch(/já foi decidida/i);
    }

    /** A decisão original continua intacta. */
    const row = await withTenant(tenantA, (tx) =>
      tx.profileReport.findUniqueOrThrow({
        where: { id: brunoReportId },
        select: { status: true, decidedById: true },
      }),
    );

    expect(row.status).toBe('ACTIONED');
    expect(row.decidedById).toBe(duda);

    const inexistente = await decideReport({
      reportId: randomUUID(),
      action: 'DISMISS',
      note: 'Denúncia que não existe.',
      actorId: elisa,
    });

    expect(inexistente.ok).toBe(false);
    if (!inexistente.ok) expect(inexistente.code).toBe('NOT_FOUND');
  });

  it('DISMISS encerra a denúncia e NÃO oculta o perfil', async () => {
    const denuncia = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      username: HANDLE_FELIPE,
      category: 'OTHER',
      details: 'A foto não parece ser da pessoa que assina o perfil.',
    });

    expect(denuncia.ok, denuncia.ok ? 'ok' : denuncia.message).toBe(true);
    if (!denuncia.ok) return;

    const decisao = await decideReport({
      reportId: denuncia.reportId,
      action: 'DISMISS',
      note: 'A foto é da própria pessoa; o relato não se confirmou.',
      actorId: duda,
    });

    expect(decisao.ok, decisao.ok ? 'ok' : decisao.message).toBe(true);
    if (!decisao.ok) return;

    expect(decisao.status).toBe('DISMISSED');
    expect(decisao.hiddenProfile).toBe(false);

    const pessoa = await adminPrisma.user.findUniqueOrThrow({
      where: { id: felipe },
      select: { publicProfileHiddenAt: true, publicProfileHiddenReason: true },
    });

    expect(pessoa.publicProfileHiddenAt).toBeNull();
    expect(pessoa.publicProfileHiddenReason).toBeNull();

    /** E a página continua sendo uma página: sem aviso e com conteúdo. */
    const pagina = await getPublicProfile({
      tenantSlug: slugA,
      username: HANDLE_FELIPE,
      viewerUserId: null,
    });

    expect(pagina.ok, pagina.ok ? 'ok' : pagina.message).toBe(true);
    if (!pagina.ok) return;

    expect(pagina.page.hiddenReason).toBeNull();
    expect(pagina.page.visibleFields.length).toBeGreaterThan(0);
    expect(pagina.page.profile.displayName).toBe('Felipe Andrade');

    /** A denúncia repetida volta a ser possível depois da decisão (a regra é da ABERTA). */
    const deNovo = await reportPublicProfile({
      tenantId: tenantA,
      reporterUserId: bruno,
      username: HANDLE_FELIPE,
      category: 'OTHER',
      details: 'O relato anterior não se confirmou, mas a foto mudou de novo.',
    });

    expect(deNovo.ok, deNovo.ok ? 'ok' : deNovo.message).toBe(true);
  });

  it('a fila NÃO mistura instituições no que é de cada denúncia', async () => {
    /**
     * A origem é a casa em que a pessoa viu o perfil — e é ela que aparece na fila.
     * A instituição B nunca viu este perfil (Ana não participa de lá), então nem
     * poderia ter denunciado: a régua do serviço é a da página.
     */
    const daB = await reportPublicProfile({
      tenantId: tenantB,
      reporterUserId: carla,
      username: HANDLE_ANA,
      category: 'SPAM',
      details: null,
    });

    expect(daB.ok).toBe(false);
    if (!daB.ok) expect(daB.code).toBe('NOT_FOUND');

    const fila = await listModerationQueue({ limit: 100 });
    expect(fila.ok).toBe(true);
    if (!fila.ok) return;

    const origens = new Set(fila.items.map((item) => item.origin.slug));
    expect(origens.has(slugB)).toBe(false);
  });
});
