/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — AS RESPOSTAS NÃO SAEM EM SUPERFÍCIE DE TERCEIRO (FASE 70)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO ESCRITA DO HUMANO, PRESA CONTRA O BANCO REAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "As respostas do formulário do organizador NÃO saem no CSV de participantes da
 *  F49 nem no perfil público da F44." Isso é uma decisão, e decisão sem catraca é
 *  promessa: quem acrescentar uma coluna ao CSV ou um campo ao pacote do perfil
 *  precisa VER este teste mudar.
 *
 *  As duas superfícies são exercitadas pelo caminho de PRODUÇÃO — o pedido de
 *  exportação com prazo (`data_exports`) e a leitura do perfil pelo serviço público —,
 *  com um campo declarado preenchido com um marcador que não existe em nenhum outro
 *  lugar do dado. Se a resposta vazar, ela vaza com o marcador no meio.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveEvent } from '../../src/lib/admin/catalog-service';
import { applyRegistrationFormOperationOnEvent } from '../../src/lib/admin/registration-form-service';
import { registerForEvent } from '../../src/lib/events/registration-service';
import { buildDataExportFile, createDataExport } from '../../src/lib/exports/export-service';
import { PARTICIPANT_CSV_HEADER } from '../../src/lib/participants/participant-service';
import { getPublicProfile, savePublicProfile } from '../../src/lib/profile/public-profile-service';
import { DEFAULT_PROFILE_AUDIENCES } from '../../src/domain/profile/public-profile-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

/**
 * O marcador é o que torna o teste não-vacuoso: procuramos por ele no arquivo e no
 * pacote, e não pelo nome da chave — a chave sozinha poderia aparecer num rótulo de
 * coluna sem que o VALOR tivesse vazado.
 */
const MARKER = `MARCADOR-F70-${RUN}`;
const DECLARED_KEY = 'restricao';
const HANDLE = `f70-sup-${RUN}`;

let tenantId: string;
let tenantSlug: string;
let eventId: string;
let pessoa: string;
let organizerId: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

beforeAll(async () => {
  tenantId = randomUUID();
  tenantSlug = `f70-superficies-${RUN}`;

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: tenantSlug,
      name: `Instituição das Superfícies ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
      maxEvents: 50,
    },
  });

  pessoa = randomUUID();
  organizerId = randomUUID();

  await adminPrisma.user.createMany({
    data: [
      {
        id: pessoa,
        name: `Pessoa das Superfícies ${RUN}`,
        email: `f70sup.pessoa.${RUN}@exemplo.test`,
        emailVerified: true,
        publicHandle: HANDLE,
      },
      {
        id: organizerId,
        name: `Organizadora das Superfícies ${RUN}`,
        email: `f70sup.org.${RUN}@exemplo.test`,
        emailVerified: true,
      },
    ],
  });

  /** O vínculo é o que põe a pessoa no diretório de participantes (F32). */
  await adminPrisma.userTenantProfile.create({
    data: {
      id: randomUUID(),
      tenantId,
      userId: pessoa,
      status: 'ACTIVE',
      kind: 'PARTICIPANT',
      joinedAt: new Date(),
    },
  });

  const event = await saveEvent({
    tenantId,
    actorId: organizerId,
    slug: `evento-superficies-${RUN}`,
    title: `Evento das Superfícies ${RUN}`,
    status: 'REGISTRATION_OPEN',
    modality: 'IN_PERSON',
    startsAt: daysFromNow(30),
    endsAt: daysFromNow(33),
    timezone: TIME_ZONE,
    capacity: null,
    registrationOpensAt: daysFromNow(-1),
    registrationClosesAt: daysFromNow(20),
    registrationRequiresMembership: false,
  });

  if (!event.ok) throw new Error(`Falha ao criar o evento: ${event.message}`);

  eventId = event.eventId;

  /** O campo declarado entra pelo serviço REAL da tela do organizador (fatia 3). */
  const saved = await applyRegistrationFormOperationOnEvent({
    tenantId,
    actorId: organizerId,
    eventId,
    operation: {
      kind: 'SAVE',
      originalKey: null,
      field: {
        key: DECLARED_KEY,
        label: 'Restrição alimentar',
        type: 'LONG_TEXT',
        required: false,
        purpose: 'Servir a refeição certa no dia do evento.',
      },
    },
  });

  if (!saved.ok) throw new Error(`Falha ao declarar o campo: ${saved.message}`);

  const inscricao = await registerForEvent({
    tenantId,
    eventSlug: `evento-superficies-${RUN}`,
    userId: pessoa,
    consentData: true,
    formResponses: { [DECLARED_KEY]: MARKER, cpf: '52998224725' },
  });

  if (!inscricao.ok) throw new Error(`Falha ao inscrever: ${inscricao.message}`);

  /** O perfil público existe e é rico: o pacote não pode estar vazio por acaso. */
  const perfil = await savePublicProfile({
    tenantId,
    userId: pessoa,
    username: HANDLE,
    headline: `Pesquisadora ${RUN}`,
    bio: 'Bio que sai no perfil público.',
    interests: ['Dados abertos'],
    siteUrl: null,
    orcidId: null,
    lattesId: null,
    audiences: Object.fromEntries(
      Object.keys(DEFAULT_PROFILE_AUDIENCES).map((field) => [field, 'PUBLIC']),
    ),
    indexable: false,
    listedInDirectory: true,
    publicNameInResults: false,
    publicEventIds: [],
  });

  if (!perfil.ok) throw new Error(`Falha ao salvar o perfil: ${perfil.message}`);
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f70sup.` } } });
});

describe('as respostas declaradas não saem em superfície de terceiro', () => {
  it('o CSV de participantes da F49 não traz o campo declarado nem o valor', async () => {
    const created = await createDataExport({
      tenantId,
      actorId: organizerId,
      kind: 'PARTICIPANTS_CSV',
      filters: {},
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const file = await buildDataExportFile({
      tenantId,
      exportId: created.exportId,
      tenantSlug,
      actorId: organizerId,
    });

    expect(file.ok, file.ok ? 'ok' : file.message).toBe(true);
    if (!file.ok) return;

    /** O arquivo é real e tem a pessoa — a prova não é um arquivo vazio. */
    expect(file.csv).toContain('Nome;E-mail;Origem');
    expect(file.csv).toContain(`Pessoa das Superfícies ${RUN}`);

    /** E o valor digitado não está lá, nem sob o nome do campo. */
    expect(file.csv).not.toContain(MARKER);
    expect(file.csv).not.toContain(DECLARED_KEY);

    /**
     * A catraca do cabeçalho: a ordem das colunas é CONTRATO (quem importa a
     * planilha o faz por posição, `participant-service.ts`), e nenhuma delas é — nem
     * pode passar a ser — resposta de formulário.
     */
    expect([...PARTICIPANT_CSV_HEADER]).not.toContain(DECLARED_KEY);
    expect([...PARTICIPANT_CSV_HEADER]).not.toContain('formResponses');
  });

  it('o pacote do perfil público da F44 não traz o campo declarado nem o valor', async () => {
    /** Anônimo: a superfície mais larga — qualquer um com o endereço. */
    const anonimo = await getPublicProfile({
      tenantSlug,
      username: HANDLE,
      viewerUserId: null,
    });

    expect(anonimo.ok, anonimo.ok ? 'ok' : anonimo.message).toBe(true);
    if (!anonimo.ok) return;

    const pacote = JSON.stringify(anonimo.page);

    /** O pacote tem o que a pessoa autorizou — não é um 404 disfarçado. */
    expect(pacote).toContain(`Pesquisadora ${RUN}`);
    expect(pacote).toContain('Bio que sai no perfil público.');

    expect(pacote).not.toContain(MARKER);
    expect(pacote).not.toContain(DECLARED_KEY);

    /** E o mesmo vale para quem é da casa: a visibilidade não abre o formulário. */
    const daCasa = await getPublicProfile({
      tenantSlug,
      username: HANDLE,
      viewerUserId: organizerId,
    });

    expect(daCasa.ok).toBe(true);
    if (!daCasa.ok) return;

    expect(JSON.stringify(daCasa.page)).not.toContain(MARKER);

    /** O dono também não: o perfil é a VITRINE, e o formulário não é público. */
    const dono = await getPublicProfile({
      tenantSlug,
      username: HANDLE,
      viewerUserId: pessoa,
    });

    expect(dono.ok).toBe(true);
    if (!dono.ok) return;

    expect(JSON.stringify(dono.page)).not.toContain(MARKER);
  });

  it('o dado EXISTE no banco — o teste não passa por o valor não ter sido gravado', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CONTRA-PROVA, SEM A QUAL OS DOIS CASOS ACIMA NÃO PROVAM NADA
     * ─────────────────────────────────────────────────────────────────────────────
     *  "não está no CSV" é trivialmente verdadeiro para um dado que nunca foi
     *  gravado. Este caso prende que a resposta ESTÁ em `registrations.formResponses`
     *  — e é por isso que a ausência nas duas superfícies é uma decisão, e não um
     *  acidente de fixture.
     */
    const linha = await withTenant(tenantId, (tx) =>
      tx.registration.findFirstOrThrow({
        where: { eventId, userId: pessoa, activityId: null, deletedAt: null },
        select: { formResponses: true },
      }),
    );

    expect(linha.formResponses).toEqual({ [DECLARED_KEY]: MARKER, cpf: '52998224725' });
  });
});
