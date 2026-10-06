/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Segmentos, campanha e descadastro (FASE 67 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (dado real no PostgreSQL, não dublê)
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • CADA CONDIÇÃO DO CATÁLOGO, NOS DOIS SENTIDOS: seleciona quem deve e NÃO
 *      seleciona quem não deve. Cada caso traz testemunhas explícitas — e as
 *      testemunhas negativas são "quase-acertos" (o da lista de espera, o que já
 *      confirmou, o que voltou à tarde), porque é aí que o filtro erra;
 *    • a JANELA DE HORÁRIO no FUSO DO EVENTO: o dia é 2027-03-15 em America/Bahia
 *      (UTC-3), o check-in da manhã é 09:00 local (12:00Z) e o da tarde, 14:00
 *      local (17:00Z). Um filtro que usasse UTC selecionaria outro conjunto;
 *    • a COMPOSIÇÃO no banco: todas as condições valem E o "exceto quem…" subtrai;
 *    • a CONTAGEM, o DESCADSATRO (quem saiu não recebe, e a volta o traz de volta)
 *      e a MÁSCARA da ocultação da F60 na lista interna;
 *    • o ISOLAMENTO entre instituições nas tabelas novas;
 *    • o DISPARO: uma linha por destinatário no outbox da FASE 15, em LOTES, com
 *      o limite de ritmo parando a passada — e o REENVIO não duplicando, que é a
 *      prova do `dedupeKey`.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import type { RateLimitStorage } from '../../src/lib/auth/rate-limit-storage';
import {
  SEGMENT_CONDITION_IDS,
  composeSegment,
  type SegmentConditionId,
  type SegmentParams,
} from '../../src/domain/communication/segments';
import { campaignDedupeKey, campaignDedupePrefix } from '../../src/domain/communication/campaign-rules';
import { evaluateSegment } from '../../src/lib/communication/segment-service';
import {
  createCampaign,
  dispatchCampaign,
  listCampaigns,
} from '../../src/lib/communication/campaign-service';
import {
  readUnsubscribePage,
  readUnsubscribeState,
  resubscribeByToken,
  resubscribeByUnsubscribeToken,
  resolveUnsubscribeUser,
  unsubscribeByToken,
  unsubscribePerson,
  unsubscribeUrlFor,
} from '../../src/lib/communication/unsubscribe-service';
import { notifyConfirmationRequired } from '../../src/lib/events/registration-notices';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
/** O nome da instituição criada no `beforeAll` — usado por asserções de texto. */
let tenantName: string;
let vizinhoId: string;
let eventoId: string;
let eventoVizinhoId: string;

let oficinaId: string;
let abertaId: string;
let aprovadaAtividadeId: string;
let salaAId: string;
let salaBId: string;
let trilhaId: string;
let chamadaId: string;
let cartaAId: string;
let organizadorId: string;

/** 09:00 em Salvador (UTC-3) do dia 15/03/2027. */
const NOVE_HORAS = new Date('2027-03-15T12:00:00.000Z');
/** 09:50 local. */
const NOVE_CINQUENTA = new Date('2027-03-15T12:50:00.000Z');
/** 14:00 local. */
const QUATORZE_HORAS = new Date('2027-03-15T17:00:00.000Z');
/** 16:00 local. */
const DEZESSEIS_HORAS = new Date('2027-03-15T19:00:00.000Z');
const DIA_DO_EVENTO = '2027-03-15';

/**
 * As pessoas do cenário, por PAPEL — o teste fala de fatos, e não de nomes.
 *
 * Preenchido em `beforeAll`; os nomes são escolhidos para que a máscara da F60
 * seja visível (`Marta Nogueira` → `Marta N.`).
 */
const P: Record<string, string> = {};

const userIds: string[] = [];

async function criarPessoa(papel: string, tenant: string, nome: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name: nome, email: `f67.${papel}.${RUN}@exemplo.test` },
  });
  await adminPrisma.userTenantProfile.create({
    data: { tenantId: tenant, userId: id, status: 'ACTIVE', kind: 'PARTICIPANT' },
  });

  userIds.push(id);
  P[papel] = id;

  return id;
}

async function inscrever(input: {
  userId: string;
  activityId: string | null;
  status: string;
  eventId?: string;
}): Promise<void> {
  await adminPrisma.registration.create({
    data: {
      tenantId: tenantId,
      eventId: input.eventId ?? eventoId,
      activityId: input.activityId,
      userId: input.userId,
      status: input.status as 'PENDING',
    },
  });
}

async function presenca(input: {
  userId: string;
  activityId: string;
  checkedInAt: Date;
  checkedOutAt: Date;
  minutes: number;
}): Promise<void> {
  await adminPrisma.attendance.create({
    data: {
      tenantId,
      eventId: eventoId,
      activityId: input.activityId,
      userId: input.userId,
      status: 'PRESENT',
      source: 'QR_CODE_CHECKIN',
      checkedInAt: input.checkedInAt,
      checkedOutAt: input.checkedOutAt,
      minutesAttended: input.minutes,
    },
  });
}

/** Avalia um segmento composto e devolve os ids selecionados. */
async function selecionar(
  conditions: readonly { id: SegmentConditionId; params?: SegmentParams }[],
  options: { excepta?: { id: SegmentConditionId; params?: SegmentParams }; eventId?: string | null; tenant?: string } = {},
): Promise<string[]> {
  const composition = composeSegment({ conditions, except: options.excepta ?? null });

  expect(composition.ok, composition.issues.map((issue) => issue.message).join(' | ')).toBe(true);

  const result = await evaluateSegment({
    tenantId: options.tenant ?? tenantId,
    eventId: options.eventId === undefined ? eventoId : options.eventId,
    definition: composition.definition,
    limit: null,
  });

  expect(result.ok, result.ok ? '' : result.message).toBe(true);
  if (!result.ok) throw new Error(result.message);

  return result.people.map((person) => person.userId);
}

/** Um limitador de ritmo de teste: libera `max` mensagens e depois recusa. */
function limitadorDeRitmo(max: number): RateLimitStorage {
  let usados = 0;

  return {
    async consume() {
      usados += 1;
      return usados <= max ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: 30 };
    },
  };
}

/** O outbox da campanha, sob RLS, pela chave do fato. */
async function mensagensDaCampanha(campaignId: string, tenant = tenantId) {
  return withTenant(tenant, (tx) =>
    tx.emailMessage.findMany({
      where: { dedupeKey: { startsWith: campaignDedupePrefix(campaignId) } },
      select: { id: true, to: true, toUserId: true, template: true, dedupeKey: true, subject: true },
      orderBy: { createdAt: 'asc' },
    }),
  );
}

beforeAll(async () => {
  // A suíte nunca envia e-mail de verdade: o driver `log` grava no outbox.
  process.env.EMAIL_DRIVER = 'log';

  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f67-${RUN}`,
      name: `Instituição F67 ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  tenantId = tenant.id;
  tenantName = `Instituição F67 ${RUN}`;

  const vizinho = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f67-vizinho-${RUN}`,
      name: `Instituição vizinha ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  vizinhoId = vizinho.id;

  const evento = await adminPrisma.event.create({
    data: {
      tenantId,
      slug: `f67-evento-${RUN}`,
      title: 'Congresso F67',
      status: 'PUBLISHED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  eventoId = evento.id;

  const eventoVizinho = await adminPrisma.event.create({
    data: {
      tenantId: vizinhoId,
      slug: `f67-evento-vizinho-${RUN}`,
      title: 'Congresso do vizinho',
      status: 'PUBLISHED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  eventoVizinhoId = eventoVizinho.id;

  const salaA = await adminPrisma.room.create({
    data: { tenantId, eventId: eventoId, name: 'Sala A' },
    select: { id: true },
  });
  salaAId = salaA.id;

  const salaB = await adminPrisma.room.create({
    data: { tenantId, eventId: eventoId, name: 'Sala B' },
    select: { id: true },
  });
  salaBId = salaB.id;

  const oficina = await adminPrisma.activity.create({
    data: {
      tenantId,
      eventId: eventoId,
      slug: `oficina-${RUN}`,
      title: 'Oficina com vaga retida',
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      roomId: salaAId,
      capacity: 10,
      /** Exige confirmação: é o que faz a inscrição nascer RETIDA. */
      confirmationPolicy: 'REQUIRED',
      confirmationWindowDays: 7,
      workloadMinutes: 120,
    },
    select: { id: true },
  });
  oficinaId = oficina.id;

  const aberta = await adminPrisma.activity.create({
    data: {
      tenantId,
      eventId: eventoId,
      slug: `aberta-${RUN}`,
      title: 'Palestra aberta',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      roomId: salaBId,
      capacity: 100,
      workloadMinutes: 120,
    },
    select: { id: true },
  });
  abertaId = aberta.id;

  const aprovada = await adminPrisma.activity.create({
    data: {
      tenantId,
      eventId: eventoId,
      slug: `sessao-aprovada-${RUN}`,
      title: 'Sessão dos trabalhos aprovados',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      roomId: salaBId,
      workloadMinutes: 60,
    },
    select: { id: true },
  });
  aprovadaAtividadeId = aprovada.id;

  const trilha = await adminPrisma.track.create({
    data: { tenantId, eventId: eventoId, slug: `trilha-${RUN}`, name: 'Trilha de Tecnologia' },
    select: { id: true },
  });
  trilhaId = trilha.id;

  const chamada = await adminPrisma.callForProposals.create({
    data: {
      tenantId,
      eventId: eventoId,
      kind: 'MINICOURSE',
      slug: `chamada-${RUN}`,
      title: 'Chamada de minicursos',
      isPublished: true,
      trackId: trilhaId,
    },
    select: { id: true },
  });
  chamadaId = chamada.id;

  const carta = await adminPrisma.cardTemplate.create({
    data: {
      tenantId,
      slug: `carta-${RUN}`,
      name: 'Carta do Credenciamento',
      rarity: 'RARE',
      trigger: 'CHECKIN',
    },
    select: { id: true },
  });
  cartaAId = carta.id;

  // ── Pessoas ────────────────────────────────────────────────────────────────
  organizadorId = await criarPessoa('organizador', tenantId, 'Olga Organizadora');
  await criarPessoa('pendente', tenantId, 'Paula Pendente');
  await criarPessoa('confirmado', tenantId, 'Caio Confirmado');
  await criarPessoa('espera', tenantId, 'Ester Espera');
  await criarPessoa('cancelou', tenantId, 'Carla Cancelou');
  await criarPessoa('manha', tenantId, 'Marta Nogueira');
  await criarPessoa('tarde', tenantId, 'Beto Alves');
  await criarPessoa('soTarde', tenantId, 'Sofia Tarde');
  await criarPessoa('nuncaCheckin', tenantId, 'Nuno Ausente');
  await criarPessoa('autorSemMaterial', tenantId, 'Artur Sem Material');
  await criarPessoa('autorComMaterial', tenantId, 'Alice Com Material');
  await criarPessoa('autorSemAtividade', tenantId, 'Alex Sem Sessão');
  await criarPessoa('revisorPendente', tenantId, 'Rita Revisora');
  await criarPessoa('revisorPronto', tenantId, 'Rui Pontual');
  await criarPessoa('rascunho', tenantId, 'Rafa Rascunho');
  await criarPessoa('chamadaEnviada', tenantId, 'Clara Enviada');
  await criarPessoa('comCertificado', tenantId, 'Cida Certificada');
  await criarPessoa('perfilIncompleto', tenantId, 'Inácio Incompleto');
  await criarPessoa('perfilCompleto', tenantId, 'Iara Completa');
  await criarPessoa('xpAlto', tenantId, 'Xênia Experiente');
  await criarPessoa('xpBaixo', tenantId, 'Xavier Novato');
  await criarPessoa('comCarta', tenantId, 'Célia Colecionadora');

  // ── Inscrições (o fato de VAGA) ────────────────────────────────────────────
  await inscrever({ userId: P.pendente!, activityId: oficinaId, status: 'PENDING' });
  await inscrever({ userId: P.confirmado!, activityId: oficinaId, status: 'CONFIRMED' });
  await inscrever({ userId: P.espera!, activityId: oficinaId, status: 'WAITLISTED' });
  await inscrever({ userId: P.cancelou!, activityId: oficinaId, status: 'CANCELED' });
  await inscrever({ userId: P.manha!, activityId: oficinaId, status: 'ATTENDED' });
  await inscrever({ userId: P.tarde!, activityId: oficinaId, status: 'ATTENDED' });
  await inscrever({ userId: P.nuncaCheckin!, activityId: oficinaId, status: 'CONFIRMED' });
  await inscrever({ userId: P.soTarde!, activityId: abertaId, status: 'ATTENDED' });
  await inscrever({ userId: P.comCertificado!, activityId: abertaId, status: 'ATTENDED' });

  // ── Presenças (o fato de FREQUÊNCIA) ───────────────────────────────────────
  await presenca({
    userId: P.manha!,
    activityId: oficinaId,
    checkedInAt: NOVE_HORAS,
    checkedOutAt: NOVE_CINQUENTA,
    minutes: 50,
  });
  await presenca({
    userId: P.tarde!,
    activityId: oficinaId,
    checkedInAt: NOVE_HORAS,
    checkedOutAt: NOVE_CINQUENTA,
    minutes: 50,
  });
  await presenca({
    userId: P.tarde!,
    activityId: oficinaId,
    checkedInAt: QUATORZE_HORAS,
    checkedOutAt: DEZESSEIS_HORAS,
    minutes: 120,
  });
  await presenca({
    userId: P.soTarde!,
    activityId: abertaId,
    checkedInAt: QUATORZE_HORAS,
    checkedOutAt: DEZESSEIS_HORAS,
    minutes: 120,
  });
  await presenca({
    userId: P.comCertificado!,
    activityId: abertaId,
    checkedInAt: QUATORZE_HORAS,
    checkedOutAt: DEZESSEIS_HORAS,
    minutes: 120,
  });

  // ── Acadêmico: submissões, material de palestrante e pareceres ──────────────
  const subAvaliar = await adminPrisma.submission.create({
    data: {
      tenantId,
      eventId: eventoId,
      trackId: trilhaId,
      protocol: `AV${RUN}`,
      title: 'Trabalho em avaliação',
      abstract: 'Resumo.',
      status: 'UNDER_REVIEW',
      submittedById: P.rascunho!,
      submittedAt: NOVE_HORAS,
    },
    select: { id: true },
  });

  await adminPrisma.submission.createMany({
    data: [
      {
        tenantId,
        eventId: eventoId,
        trackId: trilhaId,
        activityId: aprovadaAtividadeId,
        protocol: `AP1${RUN}`,
        title: 'Aprovado sem material',
        abstract: 'Resumo.',
        status: 'ACCEPTED',
        submittedById: P.autorSemMaterial!,
        submittedAt: NOVE_HORAS,
      },
      {
        tenantId,
        eventId: eventoId,
        trackId: trilhaId,
        activityId: aprovadaAtividadeId,
        protocol: `AP2${RUN}`,
        title: 'Aprovado com material',
        abstract: 'Resumo.',
        status: 'ACCEPTED',
        submittedById: P.autorComMaterial!,
        submittedAt: NOVE_HORAS,
      },
      {
        tenantId,
        eventId: eventoId,
        /** Sem sessão: não existe onde o material viver (decisão documentada). */
        protocol: `AP3${RUN}`,
        title: 'Aprovado sem sessão',
        abstract: 'Resumo.',
        status: 'ACCEPTED',
        submittedById: P.autorSemAtividade!,
        submittedAt: NOVE_HORAS,
      },
      {
        tenantId,
        eventId: eventoId,
        callId: chamadaId,
        protocol: `RA${RUN}`,
        title: 'Proposta em rascunho',
        abstract: 'Resumo.',
        status: 'DRAFT',
        submittedById: P.rascunho!,
      },
      {
        tenantId,
        eventId: eventoId,
        callId: chamadaId,
        protocol: `EN${RUN}`,
        title: 'Proposta enviada',
        abstract: 'Resumo.',
        status: 'SUBMITTED',
        submittedById: P.chamadaEnviada!,
        submittedAt: NOVE_HORAS,
      },
    ],
  });

  const perfilComMaterial = await adminPrisma.speakerProfile.create({
    data: {
      tenantId,
      name: 'Alice Com Material',
      email: `f67.perfil.${RUN}@exemplo.test`,
      userId: P.autorComMaterial!,
    },
    select: { id: true },
  });

  await adminPrisma.speakerMaterial.create({
    data: {
      tenantId,
      activityId: aprovadaAtividadeId,
      speakerProfileId: perfilComMaterial.id,
      title: 'Slides da sessão',
      kind: 'SLIDES',
      visibility: 'ATTENDEES_ONLY',
    },
  });

  await adminPrisma.reviewAssignment.createMany({
    data: [
      {
        tenantId,
        submissionId: subAvaliar.id,
        reviewerId: P.revisorPendente!,
        status: 'INVITED',
      },
      {
        tenantId,
        submissionId: subAvaliar.id,
        reviewerId: P.revisorPronto!,
        status: 'SUBMITTED',
        respondedAt: NOVE_HORAS,
      },
    ],
  });

  // ── Certificado, perfil, XP e carta ────────────────────────────────────────
  await adminPrisma.certificate.create({
    data: {
      tenantId,
      eventId: eventoId,
      userId: P.comCertificado!,
      activityId: abertaId,
      kind: 'ATTENDANCE',
      status: 'ISSUED',
      validationCode: `CERT${RUN}`,
      title: 'Certificado de participação',
      recipientName: 'Cida Certificada',
      bodyText: 'Participou.',
      issuedAt: NOVE_HORAS,
    },
  });

  await adminPrisma.user.update({
    where: { id: P.perfilCompleto! },
    data: { image: 'https://exemplo.test/foto.webp', bio: 'Pesquisadora.' },
  });

  await adminPrisma.userXpProfile.createMany({
    data: [
      { tenantId, userId: P.xpAlto!, totalXp: 500 },
      { tenantId, userId: P.xpBaixo!, totalXp: 10 },
    ],
  });

  await adminPrisma.userCard.create({
    data: { tenantId, userId: P.comCarta!, cardTemplateId: cartaAId, source: 'CHECKIN' },
  });

  // ── Instituição vizinha: um fato IGUAL, e que não pode aparecer do lado de cá ─
  const vizinhoXp = await criarPessoa('vizinhoXp', vizinhoId, 'Vera Vizinha');
  await adminPrisma.userXpProfile.create({
    data: { tenantId: vizinhoId, userId: vizinhoXp, totalXp: 900 },
  });
  await adminPrisma.registration.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      userId: vizinhoXp,
      status: 'PENDING',
    },
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  A INSTITUIÇÃO VIZINHA REPETE **TODOS** OS FATOS DO CATÁLOGO (FASE 67 · fatia 4)
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE O VIZINHO PRECISA DE FATO EM TODAS AS CONDIÇÕES
   *  ─────────────────────────────────────────────────────────────────────────────
   *  A tabela `user` é GLOBAL e a RLS não a protege — a única coisa que separa a
   *  gente de uma casa da outra é a CERCA de instituição que cada construtor
   *  carrega (`institutionFence`), mais o `tenantId` nas relações. Um construtor que
   *  esquecesse a cerca devolveria gente da casa vizinha, e é o defeito mais caro
   *  possível numa tela de envio: a campanha de uma instituição sairia para o
   *  público da outra.
   *
   *  Com UM vizinho que só tem XP, o teste de isolamento provaria uma condição e
   *  deixaria catorze sem prova. Aqui ele recebe o MESMO fato que cada condição
   *  procura — a mesma inscrição retida, a mesma presença fora da janela, a mesma
   *  submissão aprovada sem material, o mesmo parecer pendente, o mesmo perfil
   *  incompleto, o mesmo certificado, o mesmo XP e a mesma carta —, e o teste pergunta,
   *  condição por condição, se algum deles vaza para o lado de cá.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const vizinhoCompleto = await criarPessoa('vizinhoCompleto', vizinhoId, 'Vítor Completo');

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  UMA INSCRIÇÃO VIVA POR ATIVIDADE — E É O BANCO QUE MANDA NISSO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A primeira versão deste cenário tentou semear as quatro inscrições do vizinho
   *  no MESMO evento com `activityId` nulo, e o `db:setup` reprovou na hora:
   *  `registrations_live_event_user_key` é ÚNICO por (evento, pessoa) enquanto o
   *  status é vivo — cancelamento é terminal e não conta, mas `PENDING`,
   *  `WAITLISTED` e `ATTENDED` contam. Ou seja: não existe, no modelo do produto,
   *  "a mesma pessoa esperando vaga E inscrita E presente na mesma atividade".
   *
   *  Então cada estado vivo ganha a PRÓPRIA atividade — que é o que o índice está
   *  dizendo —, e a linha cancelada fica no nível do EVENTO, que é o único lugar
   *  onde uma segunda linha da mesma pessoa cabe.
   */
  const vizinhaAtividadeEspera = await adminPrisma.activity.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      slug: `sessao-espera-vizinha-${RUN}`,
      title: 'Sessão vizinha (espera)',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      workloadMinutes: 60,
    },
    select: { id: true },
  });

  const vizinhaAtividadePresenca = await adminPrisma.activity.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      slug: `sessao-presenca-vizinha-${RUN}`,
      title: 'Sessão vizinha (presença)',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      workloadMinutes: 60,
    },
    select: { id: true },
  });

  /**
   * A submissão aprovada do vizinho precisa de ATIVIDADE: sem ela a condição
   * `autor-aprovado-sem-material` não o alcança NEM na casa dele (o construtor exige
   * `activityId IS NOT NULL`, porque sem sessão não existe onde o material viver), e
   * o teste de isolamento seria VACUOSO — passaria sem provar nada.
   */
  const vizinhaAtividade = await adminPrisma.activity.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      slug: `sessao-vizinha-${RUN}`,
      title: 'Sessão vizinha',
      type: 'LECTURE',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      workloadMinutes: 60,
    },
    select: { id: true },
  });

  await adminPrisma.registration.createMany({
    data: [
      {
        tenantId: vizinhoId,
        eventId: eventoVizinhoId,
        activityId: vizinhaAtividadeEspera.id,
        userId: vizinhoCompleto,
        status: 'WAITLISTED',
      },
      {
        tenantId: vizinhoId,
        eventId: eventoVizinhoId,
        activityId: vizinhaAtividadePresenca.id,
        userId: vizinhoCompleto,
        status: 'ATTENDED',
      },
      {
        tenantId: vizinhoId,
        eventId: eventoVizinhoId,
        userId: vizinhoCompleto,
        status: 'CANCELED',
      },
      {
        tenantId: vizinhoId,
        eventId: eventoVizinhoId,
        activityId: vizinhaAtividade.id,
        userId: vizinhoCompleto,
        status: 'PENDING',
      },
    ],
  });

  // A presença do vizinho cai FORA da janela da manhã e dentro da tarde — o
  // "quase-acerto" que a condição `presenca-manha-sem-tarde` não pode pegar.
  await adminPrisma.attendance.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      activityId: vizinhaAtividadePresenca.id,
      userId: vizinhoCompleto,
      status: 'PRESENT',
      source: 'QR_CODE_CHECKIN',
      checkedInAt: QUATORZE_HORAS,
      checkedOutAt: DEZESSEIS_HORAS,
      minutesAttended: 120,
    },
  });

  const vizinhoTrilha = await adminPrisma.track.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      slug: `trilha-vizinho-${RUN}`,
      name: 'Trilha vizinha',
    },
    select: { id: true },
  });

  /**
   * A submissão aprovada do vizinho precisa de ATIVIDADE: sem ela a condição
   * `autor-aprovado-sem-material` não o alcança NEM na casa dele (o construtor exige
   * `activityId IS NOT NULL`, porque sem sessão não existe onde o material viver), e
   * o teste de isolamento seria VACUOSO — passaria sem provar nada.
   */
  const vizinhoSubmissao = await adminPrisma.submission.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      trackId: vizinhoTrilha.id,
      activityId: vizinhaAtividade.id,
      protocol: `VZ${RUN}`,
      title: 'Aprovado sem material (vizinho)',
      abstract: 'Resumo.',
      status: 'ACCEPTED',
      submittedById: vizinhoCompleto,
      submittedAt: NOVE_HORAS,
    },
    select: { id: true },
  });

  await adminPrisma.reviewAssignment.create({
    data: {
      tenantId: vizinhoId,
      submissionId: vizinhoSubmissao.id,
      reviewerId: vizinhoCompleto,
      status: 'INVITED',
    },
  });

  const vizinhaChamada = await adminPrisma.callForProposals.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      kind: 'MINICOURSE',
      slug: `chamada-vizinho-${RUN}`,
      title: 'Chamada vizinha',
      isPublished: true,
    },
    select: { id: true },
  });

  await adminPrisma.submission.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      callId: vizinhaChamada.id,
      protocol: `VR${RUN}`,
      title: 'Proposta em rascunho (vizinho)',
      abstract: 'Resumo.',
      status: 'DRAFT',
      submittedById: vizinhoCompleto,
    },
  });

  await adminPrisma.certificate.create({
    data: {
      tenantId: vizinhoId,
      eventId: eventoVizinhoId,
      userId: vizinhoCompleto,
      kind: 'ATTENDANCE',
      status: 'ISSUED',
      validationCode: `VCERT${RUN}`,
      title: 'Certificado do vizinho',
      recipientName: 'Vítor Completo',
      bodyText: 'Participou.',
      issuedAt: NOVE_HORAS,
    },
  });

  const vizinhaCarta = await adminPrisma.cardTemplate.create({
    data: {
      tenantId: vizinhoId,
      slug: `carta-vizinha-${RUN}`,
      name: 'Carta da casa vizinha',
      rarity: 'COMMON',
      trigger: 'CHECKIN',
    },
    select: { id: true },
  });

  await adminPrisma.userCard.create({
    data: {
      tenantId: vizinhoId,
      userId: vizinhoCompleto,
      cardTemplateId: vizinhaCarta.id,
      source: 'CHECKIN',
    },
  });

  /**
   * ── A PESSOA DO CASO DO DESCADASTRO DE PONTA A PONTA (fatia 3) ────────────────
   *
   *  Ela precisa de uma atividade PRÓPRIA, e não da oficina do cenário: as contagens
   *  de "quem tem vaga na oficina" (5 pessoas) são o contrato de sete casos desta
   *  suíte, e acrescentar uma sexta pessoa ali obrigaria a reescrever todos eles —
   *  reescrever a régua para caber a fixture é o caminho mais curto para a régua
   *  deixar de medir. Uma segunda atividade com o MESMO `confirmationPolicy` dá o
   *  mesmo fato (uma vaga retida com prazo) sem mexer em nada do que já passava.
   */
  const retidaActivity = await adminPrisma.activity.create({
    data: {
      tenantId,
      eventId: eventoId,
      slug: `retida-${RUN}`,
      title: 'Atividade com vaga retida (descadastro)',
      type: 'WORKSHOP',
      status: 'SCHEDULED',
      modality: 'IN_PERSON',
      startsAt: NOVE_HORAS,
      endsAt: DEZESSEIS_HORAS,
      roomId: salaBId,
      capacity: 10,
      confirmationPolicy: 'REQUIRED',
      confirmationWindowDays: 7,
      workloadMinutes: 120,
    },
    select: { id: true },
  });

  await criarPessoa('descadastra', tenantId, 'Denise Descadastra');
  /** A segunda pessoa da mesma atividade: é ela que prova "corpos DIFERENTES". */
  await criarPessoa('descadastraDois', tenantId, 'Beto Boas-Vindas');

  await adminPrisma.registration.create({
    data: {
      tenantId,
      eventId: eventoId,
      activityId: retidaActivity.id,
      userId: P.descadastraDois!,
      status: 'PENDING',
      confirmationDueAt: new Date('2027-03-20T23:59:00.000Z'),
    },
  });

  const inscricaoRetida = await adminPrisma.registration.create({
    data: {
      tenantId,
      eventId: eventoId,
      activityId: retidaActivity.id,
      userId: P.descadastra!,
      status: 'PENDING',
      confirmationDueAt: new Date('2027-03-20T23:59:00.000Z'),
    },
    select: { id: true },
  });

  P.inscricaoRetida = inscricaoRetida.id;
  P.atividadeRetida = retidaActivity.id;
});

afterAll(async () => {
  // O tenant leva junto tudo o que é dele (cascata); as pessoas são globais.
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, vizinhoId] } } });
  await adminPrisma.user.deleteMany({ where: { id: { in: userIds } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Cada condição, nos dois sentidos
// ═══════════════════════════════════════════════════════════════════════════════
interface Caso {
  nome: string;
  conditions: readonly { id: SegmentConditionId; params?: () => SegmentParams }[];
  inclui: readonly string[];
  exclui: readonly string[];
}

describe('cada condição do catálogo seleciona quem deve e não seleciona quem não deve', () => {
  /**
   * Cada caso declara as TESTEMUNHAS: quem a condição tem de pegar e quem ela não
   * pode pegar. As negativas são "quase-acertos" de propósito — o da lista de
   * espera, o que já confirmou, o que voltou à tarde, o que tem material —, porque
   * é exatamente aí que um filtro errado passaria despercebido.
   */
  const casos: Caso[] = [
    {
      nome: 'inscricao-sem-confirmacao — vaga retida, sem confirmação',
      conditions: [{ id: 'inscricao-sem-confirmacao' }],
      inclui: ['pendente'],
      exclui: ['confirmado', 'espera', 'cancelou', 'manha'],
    },
    {
      nome: 'inscricao-em-espera — lista de espera',
      conditions: [{ id: 'inscricao-em-espera' }],
      inclui: ['espera'],
      exclui: ['pendente', 'confirmado', 'manha'],
    },
    {
      nome: 'inscricao-cancelada — quem cancelou',
      conditions: [{ id: 'inscricao-cancelada' }],
      inclui: ['cancelou'],
      exclui: ['confirmado', 'espera', 'pendente'],
    },
    {
      nome: 'presenca-manha-sem-tarde — manhã sem tarde, no fuso do evento',
      conditions: [{ id: 'presenca-manha-sem-tarde', params: () => ({ dia: DIA_DO_EVENTO }) }],
      inclui: ['manha'],
      exclui: ['tarde', 'soTarde', 'nuncaCheckin', 'confirmado'],
    },
    {
      nome: 'nunca-credenciado — inscrito sem nenhuma presença',
      conditions: [{ id: 'nunca-credenciado' }],
      inclui: ['nuncaCheckin', 'pendente'],
      exclui: ['manha', 'soTarde', 'cancelou'],
    },
    {
      nome: 'minutos-abaixo — soma de minutos abaixo do limite',
      conditions: [{ id: 'minutos-abaixo', params: () => ({ minutos: 60 }) }],
      inclui: ['manha', 'nuncaCheckin'],
      exclui: ['tarde', 'soTarde', 'cancelou'],
    },
    {
      nome: 'autor-aprovado-sem-material — aprovado sem material na sessão',
      conditions: [{ id: 'autor-aprovado-sem-material' }],
      inclui: ['autorSemMaterial'],
      exclui: ['autorComMaterial', 'autorSemAtividade', 'confirmado'],
    },
    {
      nome: 'revisor-com-parecer-pendente — parecer atribuído e não enviado',
      conditions: [{ id: 'revisor-com-parecer-pendente' }],
      inclui: ['revisorPendente'],
      exclui: ['revisorPronto', 'confirmado'],
    },
    {
      nome: 'proposta-em-rascunho — proposta começada e não enviada',
      conditions: [{ id: 'proposta-em-rascunho' }],
      inclui: ['rascunho'],
      exclui: ['chamadaEnviada', 'confirmado'],
    },
    {
      nome: 'inscrito-na-atividade — quem tem vaga na atividade',
      conditions: [{ id: 'inscrito-na-atividade', params: () => ({ atividade: oficinaId }) }],
      inclui: ['confirmado', 'manha'],
      exclui: ['espera', 'cancelou', 'soTarde'],
    },
    {
      nome: 'inscrito-na-sala — quem está na sala, e não em outra',
      conditions: [{ id: 'inscrito-na-sala', params: () => ({ sala: salaAId }) }],
      inclui: ['confirmado'],
      exclui: ['soTarde', 'comCertificado', 'espera'],
    },
    {
      nome: 'presenca-sem-certificado — participou e não tem certificado',
      conditions: [{ id: 'presenca-sem-certificado' }],
      inclui: ['manha', 'tarde'],
      exclui: ['comCertificado', 'nuncaCheckin', 'confirmado'],
    },
    {
      nome: 'perfil-incompleto — sem foto ou sem bio, na instituição inteira',
      conditions: [{ id: 'perfil-incompleto' }],
      inclui: ['perfilIncompleto'],
      exclui: ['perfilCompleto'],
    },
    {
      nome: 'xp-acima — XP acumulado nesta instituição',
      conditions: [{ id: 'xp-acima', params: () => ({ xp: 400 }) }],
      inclui: ['xpAlto'],
      exclui: ['xpBaixo', 'confirmado', 'vizinhoXp'],
    },
    {
      nome: 'carta-conquistada — quem já tem a carta',
      conditions: [{ id: 'carta-conquistada', params: () => ({ carta: cartaAId }) }],
      inclui: ['comCarta'],
      exclui: ['confirmado', 'xpAlto'],
    },
  ];

  for (const caso of casos) {
    it(caso.nome, async () => {
      const selecionados = await selecionar(
        caso.conditions.map((condition) => ({
          id: condition.id,
          params: condition.params ? condition.params() : {},
        })),
      );

      for (const papel of caso.inclui) {
        expect(selecionados, `${caso.nome}: deveria incluir ${papel}`).toContain(P[papel]);
      }

      for (const papel of caso.exclui) {
        expect(selecionados, `${caso.nome}: NÃO deveria incluir ${papel}`).not.toContain(P[papel]);
      }
    });
  }

  it('a janela da manhã usa o FUSO DO EVENTO, e não UTC', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE CASO EXISTE SEPARADO DA TABELA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Em UTC, 12:00Z é "meio-dia" — e o check-in da manhã (12:00Z) cairia FORA da
     *  janela da manhã, que terminaria às 12:00Z. Ou seja: com o fuso errado, a
     *  condição selecionaria NINGUÉM. Este caso prende isso comparando as duas
     *  leituras do mesmo dia.
     */
    const porFusoDoEvento = await selecionar([
      { id: 'presenca-manha-sem-tarde', params: { dia: DIA_DO_EVENTO, manha: '12:00' } },
    ]);

    expect(porFusoDoEvento).toContain(P.manha);

    // Sem o dia informado, vale o dia da ABERTURA do evento (a régua do domínio).
    const semDia = await selecionar([{ id: 'presenca-manha-sem-tarde', params: {} }]);
    expect(semDia).toContain(P.manha);

    // O dia seguinte não tem check-in nenhum: a janela é do DIA, não "das últimas horas".
    const outroDia = await selecionar([
      { id: 'presenca-manha-sem-tarde', params: { dia: '2027-03-16' } },
    ]);
    expect(outroDia).toEqual([]);
  });

  it('o parâmetro recorta de verdade: a MESMA condição com e sem filtro', async () => {
    const todas = await selecionar([{ id: 'inscricao-sem-confirmacao', params: {} }]);
    const soDaOficina = await selecionar([
      { id: 'inscricao-sem-confirmacao', params: { atividade: oficinaId } },
    ]);

    expect(todas).toContain(P.pendente);
    expect(soDaOficina).toEqual([P.pendente]);
  });

  it('a contagem acompanha a seleção e o "N de M" do descadastro aparece', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    expect(composition.ok).toBe(true);
    if (!composition.ok) return;

    const result = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    /**
     * Cinco pessoas têm vaga na oficina: a vaga retida (pendente), as duas
     * confirmadas, a que compareceu e a que nunca apareceu. É essa a lista que a
     * tela mostra ANTES de enviar.
     */
    expect(result.count).toBe(5);
    expect(result.unsubscribed).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.people).toHaveLength(5);
    expect(result.explanation[0]).toContain('Oficina com vaga retida');
  });

  it('lista limitada informa que truncou, e a contagem continua sendo a do banco', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const result = await evaluateSegment({
      tenantId,
      eventId: eventoId,
      definition: composition.definition,
      limit: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.count).toBe(5);
    expect(result.people).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('composição no banco — todas valem, e o "exceto quem…" subtrai', () => {
  it('a exclusão tira do resultado quem a condição de exclusão pega', async () => {
    const semExclusao = await selecionar([
      { id: 'inscrito-na-atividade', params: { atividade: oficinaId } },
    ]);

    expect(semExclusao).toContain(P.pendente);

    const comExclusao = await selecionar(
      [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
      { excepta: { id: 'inscricao-sem-confirmacao', params: {} } },
    );

    expect(comExclusao).not.toContain(P.pendente);
    expect(comExclusao).toContain(P.confirmado);
  });

  it('duas condições valem AO MESMO TEMPO (interseção, não união)', async () => {
    const selecionados = await selecionar([
      { id: 'inscrito-na-atividade', params: { atividade: oficinaId } },
      { id: 'minutos-abaixo', params: { minutos: 60 } },
    ]);

    // Da oficina: pendente (0 min), confirmado (0), manha (50), tarde (170).
    expect(selecionados).toEqual(expect.arrayContaining([P.pendente, P.manha, P.confirmado]));
    expect(selecionados).not.toContain(P.tarde);
  });

  it('condição de evento sem evento é RECUSADA (não vira "todo mundo")', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const result = await evaluateSegment({ tenantId, eventId: null, definition: composition.definition });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('EVENT_REQUIRED');
  });

  it('evento de OUTRA instituição não é encontrado (a leitura é sob RLS)', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const result = await evaluateSegment({
      tenantId: vizinhoId,
      eventId: eventoId,
      definition: composition.definition,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('NOT_FOUND');
  });

  it('snapshot com condição que o catálogo não tem é RECUSADO — e não vira erro interno', async () => {
    /**
     * A definição chega do BANCO: ela é dado de entrada como qualquer outro. Um
     * snapshot de uma versão antiga do produto (ou editado à mão) não pode
     * derrubar a avaliação com "falha interna" — nem, muito menos, ser avaliado
     * como se a condição inexistente não existisse.
     */
    const result = await evaluateSegment({
      tenantId,
      eventId: eventoId,
      definition: {
        conditions: [{ id: 'condicao-que-nao-existe' as never, params: {} }],
        except: null,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_SEGMENT');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('máscara da lista interna (F60)', () => {
  it('quem a moderação ocultou recebe, mas sai abreviado na lista', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const antes = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(antes.ok).toBe(true);
    if (!antes.ok) return;

    const visivel = antes.people.find((person) => person.userId === P.tarde);
    expect(visivel?.name).toBe('Beto Alves');
    expect(visivel?.masked).toBe(false);
    // A lista interna NÃO carrega contato: o endereço é do disparo, não da tela.
    expect(Object.keys(visivel ?? {})).not.toContain('email');

    await adminPrisma.user.update({
      where: { id: P.manha! },
      data: { publicProfileHiddenAt: NOVE_HORAS },
    });

    const depois = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(depois.ok).toBe(true);
    if (!depois.ok) return;

    const oculta = depois.people.find((person) => person.userId === P.manha);
    expect(oculta?.name).toBe('Marta N.');
    expect(oculta?.masked).toBe(true);
    /** A pessoa CONTINUA na lista e continua recebendo: a ocultação é pública. */
    expect(depois.count).toBe(antes.count);

    await adminPrisma.user.update({
      where: { id: P.manha! },
      data: { publicProfileHiddenAt: null },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('descadastro', () => {
  it('quem saiu não é mais selecionado, e o caminho de volta o traz de volta', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const antes = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(antes.ok && antes.count).toBe(5);

    const saiu = await unsubscribePerson({
      tenantId,
      userId: P.confirmado!,
      channel: 'LINK',
      reason: 'Recebo muitos e-mails.',
    });
    expect(saiu.ok).toBe(true);
    if (!saiu.ok) return;

    const estado = await readUnsubscribeState({ tenantId, userId: P.confirmado! });
    expect(estado.ok && estado.isOut).toBe(true);

    const depois = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(depois.ok).toBe(true);
    if (!depois.ok) return;

    expect(depois.count).toBe(4);
    expect(depois.unsubscribed).toBe(1);
    expect(depois.people.map((person) => person.userId)).not.toContain(P.confirmado);

    // Sair de novo não duplica a linha nem falha.
    const deNovo = await unsubscribePerson({ tenantId, userId: P.confirmado!, channel: 'EMAIL' });
    expect(deNovo.ok && deNovo.alreadyOut).toBe(true);

    const linhas = await withTenant(tenantId, (tx) =>
      tx.communicationUnsubscribe.count({ where: { userId: P.confirmado! } }),
    );
    expect(linhas).toBe(1);

    // ── O caminho de volta ────────────────────────────────────────────────────
    const volta = await resubscribeByToken({ tenantId, token: saiu.token });
    expect(volta.ok && volta.changed).toBe(true);

    const voltou = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(voltou.ok && voltou.count).toBe(5);

    // O token é de uso único na prática: a segunda volta não muda nada.
    const segundaVolta = await resubscribeByToken({ tenantId, token: saiu.token });
    expect(segundaVolta.ok && segundaVolta.changed).toBe(false);

    // Token com forma impossível é recusado sem tocar no banco.
    const invalido = await resubscribeByToken({ tenantId, token: 'curto' });
    expect(invalido.ok).toBe(false);
  });

  it('o descadastro é por INSTITUIÇÃO: sair de uma não cala a outra', async () => {
    const vizinho = await withTenant(vizinhoId, (tx) =>
      tx.communicationUnsubscribe.count({ where: { userId: P.confirmado! } }),
    );

    expect(vizinho).toBe(0);
  });

  it('o token em claro NÃO fica no banco (só o hash)', async () => {
    const saida = await unsubscribePerson({ tenantId, userId: P.xpBaixo!, channel: 'MANUAL' });
    expect(saida.ok).toBe(true);
    if (!saida.ok) return;

    const linhas = await withTenant(tenantId, (tx) =>
      tx.communicationUnsubscribe.findMany({
        where: { userId: P.xpBaixo! },
        select: { tokenHash: true },
      }),
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(linhas[0]?.tokenHash).not.toBe(saida.token);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('campanha e disparo', () => {
  it('a campanha grava o ATO com os FATOS (e não a lista de ids)', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'Material da oficina',
      body: 'O material da oficina já está no portal.',
    });

    expect(criada.ok).toBe(true);
    if (!criada.ok) return;

    expect(criada.count).toBe(5);

    const row = await withTenant(tenantId, (tx) =>
      tx.communicationCampaign.findUniqueOrThrow({
        where: { id: criada.campaignId },
        select: { definition: true, explanation: true, status: true, recipientCount: true, createdById: true },
      }),
    );

    expect(row.status).toBe('DRAFT');
    expect(row.recipientCount).toBe(5);
    expect(row.createdById).toBe(organizadorId);
    expect(row.explanation.length).toBeGreaterThan(0);
    expect(row.explanation[0]).toContain('Oficina com vaga retida');

    /**
     * A prova de que o snapshot são os FATOS: nenhum id de pessoa aparece nele. É o
     * que permite explicar a campanha seis meses depois sem guardar uma lista de
     * gente no banco.
     */
    const serializado = JSON.stringify(row.definition);
    expect(serializado).toContain('inscrito-na-atividade');
    expect(serializado).not.toContain(P.confirmado);
    expect(serializado).not.toContain(P.manha);
  });

  it('texto inválido não cria campanha', async () => {
    const composition = composeSegment({ conditions: [{ id: 'xp-acima', params: { xp: 400 } }] });
    if (!composition.ok) throw new Error('composição inválida');

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      definition: composition.definition,
      subject: '',
      body: 'corpo',
    });

    expect(criada.ok).toBe(false);
    if (criada.ok) return;

    expect(criada.code).toBe('INVALID_INPUT');
  });

  it('dispara em LOTES, uma linha por destinatário no outbox, e o reenvio NÃO duplica', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'Sua vaga na oficina',
      body: 'Confirme a vaga até sexta.',
    });
    if (!criada.ok) throw new Error(criada.message);

    const primeira = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      batchSize: 2,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });

    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;

    expect(primeira.evaluated).toBe(5);
    expect(primeira.queued).toBe(5);
    expect(primeira.duplicates).toBe(0);
    expect(primeira.failed).toBe(0);
    expect(primeira.remaining).toBe(0);
    expect(primeira.batches).toBe(3);
    expect(primeira.rateLimited).toBe(false);
    expect(primeira.status).toBe('SENT');

    const primeiraLeva = await mensagensDaCampanha(criada.campaignId);
    expect(primeiraLeva).toHaveLength(5);
    expect(primeiraLeva.every((row) => row.template === 'CAMPAIGN_MESSAGE')).toBe(true);
    expect(primeiraLeva.every((row) => row.subject === 'Sua vaga na oficina')).toBe(true);
    // UMA linha por destinatário: nada de lista no "Para:".
    expect(new Set(primeiraLeva.map((row) => row.toUserId)).size).toBe(5);
    expect(primeiraLeva.map((row) => row.dedupeKey)).toContain(
      campaignDedupeKey(criada.campaignId, P.confirmado!),
    );

    // ── A PROVA DO `dedupeKey`: reenviar a MESMA campanha não duplica ─────────
    const segunda = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      batchSize: 3,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });

    expect(segunda.ok).toBe(true);
    if (!segunda.ok) return;

    expect(segunda.queued).toBe(0);
    expect(segunda.duplicates).toBe(5);
    expect(segunda.failed).toBe(0);

    const depoisDoReenvio = await mensagensDaCampanha(criada.campaignId);
    expect(depoisDoReenvio).toHaveLength(5);
    expect(depoisDoReenvio.map((row) => row.id).sort()).toEqual(primeiraLeva.map((row) => row.id).sort());
  });

  it('o limite de ritmo para a passada, e a passada seguinte conclui sem repetir', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'Lembrete da oficina',
      body: 'Falta pouco para a oficina começar.',
    });
    if (!criada.ok) throw new Error(criada.message);

    const parcial = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      batchSize: 2,
      /** Só duas mensagens cabem na janela: o resto fica para a próxima passada. */
      rateLimit: limitadorDeRitmo(2),
      wait: async () => {},
    });

    expect(parcial.ok).toBe(true);
    if (!parcial.ok) return;

    expect(parcial.rateLimited).toBe(true);
    expect(parcial.queued).toBe(2);
    expect(parcial.remaining).toBe(3);
    expect(await mensagensDaCampanha(criada.campaignId)).toHaveLength(2);

    /** A passada seguinte recomeça do zero — e a chave do fato protege quem já saiu. */
    const conclusao = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      batchSize: 25,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });

    expect(conclusao.ok).toBe(true);
    if (!conclusao.ok) return;

    expect(conclusao.queued).toBe(3);
    expect(conclusao.duplicates).toBe(2);
    expect(conclusao.remaining).toBe(0);
    expect(await mensagensDaCampanha(criada.campaignId)).toHaveLength(5);
  });

  it('o disparo PULA quem saiu, e a campanha registra quantos foram pulados', async () => {
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const saida = await unsubscribePerson({ tenantId, userId: P.tarde!, channel: 'EMAIL' });
    expect(saida.ok).toBe(true);

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'Último aviso da oficina',
      body: 'As vagas retidas serão liberadas amanhã.',
    });
    if (!criada.ok) throw new Error(criada.message);

    expect(criada.count).toBe(4);
    expect(criada.unsubscribed).toBe(1);

    const disparo = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });

    expect(disparo.ok).toBe(true);
    if (!disparo.ok) return;

    expect(disparo.evaluated).toBe(4);
    expect(disparo.skippedUnsubscribed).toBe(1);

    const mensagens = await mensagensDaCampanha(criada.campaignId);
    expect(mensagens).toHaveLength(4);
    expect(mensagens.map((row) => row.toUserId)).not.toContain(P.tarde);

    const row = await withTenant(tenantId, (tx) =>
      tx.communicationCampaign.findUniqueOrThrow({
        where: { id: criada.campaignId },
        select: { status: true, recipientCount: true, skippedCount: true, reachedCount: true, finishedAt: true },
      }),
    );

    expect(row.status).toBe('SENT');
    expect(row.recipientCount).toBe(4);
    expect(row.skippedCount).toBe(1);
    expect(row.reachedCount).toBe(4);
    expect(row.finishedAt).not.toBeNull();

    /** O histórico da instituição lê a campanha; o do vizinho não a enxerga. */
    const historico = await listCampaigns({ tenantId });
    expect(historico.some((campaign) => campaign.id === criada.campaignId)).toBe(true);

    const doVizinho = await listCampaigns({ tenantId: vizinhoId });
    expect(doVizinho).toHaveLength(0);

    /** A volta traz a pessoa de volta também para o DISPARO. */
    const volta = await resubscribeByToken({ tenantId, token: saida.ok ? saida.token : '' });
    expect(volta.ok).toBe(true);
  });

  it('campanha inexistente e campanha em envio recente são recusadas com motivo', async () => {    const inexistente = await dispatchCampaign({
      tenantId,
      campaignId: randomUUID(),
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(10),
      wait: async () => {},
    });

    expect(inexistente.ok).toBe(false);
    if (inexistente.ok) return;
    expect(inexistente.code).toBe('NOT_FOUND');

    const composition = composeSegment({ conditions: [{ id: 'xp-acima', params: { xp: 400 } }] });
    if (!composition.ok) throw new Error('composição inválida');

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      definition: composition.definition,
      subject: 'Parabéns pelo XP',
      body: 'Você acumulou bastante XP neste semestre.',
    });
    if (!criada.ok) throw new Error(criada.message);

    // Reserva recente: a segunda tentativa NÃO pode entrar.
    await withTenant(tenantId, (tx) =>
      tx.communicationCampaign.update({
        where: { id: criada.campaignId },
        data: { status: 'SENDING', startedAt: new Date() },
      }),
    );

    const emEnvio = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(10),
      wait: async () => {},
    });

    expect(emEnvio.ok).toBe(false);
    if (emEnvio.ok) return;
    expect(emEnvio.code).toBe('ALREADY_RUNNING');

    // Reserva VENCIDA: a passada retoma (a lição da FASE 36).
    await withTenant(tenantId, (tx) =>
      tx.communicationCampaign.update({
        where: { id: criada.campaignId },
        data: { startedAt: new Date(Date.now() - 31 * 60 * 1000) },
      }),
    );

    const retomada = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(10),
      wait: async () => {},
    });

    expect(retomada.ok).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  OS MARCADORES POR DESTINATÁRIO (FASE 67 · fatia 3)
  // ═══════════════════════════════════════════════════════════════════════════
  it('duas pessoas recebem CORPOS DIFERENTES, e o outbox guarda o de cada uma', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE CASO OLHA O OUTBOX, E NÃO O RETORNO DO DISPARO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A prova de que a personalização existe é o que ficou GRAVADO. O outbox é o
     *  registro do que saiu (FASE 15): se o HTML dele tiver o nome de cada pessoa e
     *  não o marcador, a personalização aconteceu no momento certo — antes do
     *  enfileiramento —, e não na entrega (que gravaria um HTML genérico).
     */
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: P.atividadeRetida! } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'A sua vaga, {nome}',
      body: 'Olá, {nome}! A sua vaga em {evento} está retida. — {instituicao}',
    });
    if (!criada.ok) throw new Error(criada.message);

    const disparo = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });
    if (!disparo.ok) throw new Error(disparo.message);

    const mensagens = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findMany({
        where: { dedupeKey: { startsWith: campaignDedupePrefix(criada.campaignId) } },
        select: { toUserId: true, to: true, subject: true, html: true, text: true },
      }),
    );

    expect(mensagens.length).toBeGreaterThan(1);

    for (const mensagem of mensagens) {
      /**
       * O MARCADOR NÃO SOBRA NO TEXTO — e o `html` é conferido por outra via: o
       * assunto (`A sua vaga, {nome}`) é literal e aparece no `<title>` da moldura,
       * então procurar `{nome}` no HTML encontraria o ASSUNTO, não o corpo. O que
       * prova o corpo é o TEXTO, que é montado a partir do corpo personalizado.
       */
      expect(mensagem.text).not.toContain('{nome}');
      expect(mensagem.text).not.toContain('{instituicao}');
      expect(mensagem.text).not.toContain('{evento}');
      expect(mensagem.text).toContain('A sua vaga em Congresso F67 está retida.');
      expect(mensagem.text).toContain(tenantName);
    }

    /** Os corpos são DIFERENTES entre si — um por pessoa, com o nome dela dentro. */
    const corpos = mensagens.map((mensagem) => mensagem.text);
    expect(new Set(corpos).size).toBe(mensagens.length);

    const daDenise = mensagens.find((mensagem) => mensagem.toUserId === P.descadastra);
    expect(daDenise).toBeDefined();
    expect(daDenise?.text).toContain('Olá, Denise!');

    const outro = mensagens.find((mensagem) => mensagem.toUserId !== P.descadastra);
    expect(outro?.text).not.toContain('Denise');

    /**
     * O ASSUNTO **NÃO** É PERSONALIZADO, e é decisão: ele viaja em cabeçalho, e o
     * `subject` do outbox é a chave pela qual a operação reconhece a campanha. Um
     * assunto com nome faria "Sua vaga, Ana" e "Sua vaga, Bruno" parecerem duas
     * campanhas na caixa de saída.
     */
    expect(mensagens.every((mensagem) => mensagem.subject === 'A sua vaga, {nome}')).toBe(true);
  });

  it('marcador DESCONHECIDO sai literal e NÃO quebra o envio nem esvazia o texto', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  AS DUAS ALTERNATIVAS ERRADAS, E O QUE FICOU NO LUGAR
     * ─────────────────────────────────────────────────────────────────────────────
     *  Apagar o marcador desconhecido produziria "nos vemos em ." — um e-mail que
     *  parece pronto e diz menos. Recusar o envio faria uma chave a mais no texto
     *  derrubar uma campanha de mil pessoas já revisada; o marcador é enfeite, e
     *  enfeite não derruba fluxo (invariante nº 8). O que fica é ele LITERAL: quem
     *  recebe vê `{cidade}` e avisa, e quem escreveu descobre o erro onde pode
     *  corrigi-lo.
     */
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: oficinaId } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'Encontro no {cidade}',
      body: 'Olá, {nome}! Nos vemos em {cidade}, no dia 20. Traga o crachá.',
    });
    if (!criada.ok) throw new Error(criada.message);

    const disparo = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });

    expect(disparo.ok).toBe(true);
    if (!disparo.ok) return;

    // O envio NÃO foi interrompido: todos os destinatários do segmento entraram.
    expect(disparo.failed).toBe(0);
    expect(disparo.queued).toBe(disparo.evaluated);

    const mensagens = await mensagensDaCampanha(criada.campaignId);
    const comMarcador = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findMany({
        where: { dedupeKey: { startsWith: campaignDedupePrefix(criada.campaignId) } },
        select: { text: true, html: true },
      }),
    );

    expect(mensagens).toHaveLength(disparo.evaluated);
    expect(comMarcador.every((mensagem) => mensagem.text.includes('{cidade}'))).toBe(true);
    // E o resto da frase continua lá: nada foi esvaziado.
    expect(comMarcador.every((mensagem) => mensagem.text.includes('no dia 20'))).toBe(true);
    expect(comMarcador.every((mensagem) => mensagem.html.includes('{cidade}'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  O DESCADASTRO DE PONTA A PONTA (FASE 67 · fatia 3)
// ═══════════════════════════════════════════════════════════════════════════════
describe('descadastro de ponta a ponta — o token do rodapé', () => {
  it('o endereço do rodapé resolve a pessoa, e não resolve mais ninguém', async () => {
    const endereco = unsubscribeUrlFor({
      tenantSlug: 'f67-casa',
      tenantId,
      userId: P.descadastra!,
    });

    expect(endereco).not.toBeNull();
    if (!endereco) return;

    const token = endereco.split('/').pop() ?? '';

    // A pessoa CERTA resolve.
    expect(await resolveUnsubscribeUser({ tenantId, token })).toBe(P.descadastra);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  AS QUATRO RECUSAS, E POR QUE TODAS ELAS SÃO A MESMA RESPOSTA
     * ─────────────────────────────────────────────────────────────────────────────
     *  Token torto, token de OUTRA PESSOA (aqui, derivado de verdade, com o mesmo
     *  segredo), token de OUTRA INSTITUIÇÃO e token vazio. As quatro devolvem `null`,
     *  e a página responde 404 às quatro: distinguir os casos contaria a quem sonda
     *  que ele acertou o formato — a mesma régua do link selado da carta (FASE 48).
     */
    const tokenDeOutraPessoa = unsubscribeUrlFor({
      tenantSlug: 'f67-casa',
      tenantId,
      userId: P.confirmado!,
    })
      ?.split('/')
      .pop();

    expect(tokenDeOutraPessoa).toBeDefined();
    expect(await resolveUnsubscribeUser({ tenantId, token: tokenDeOutraPessoa! })).toBe(P.confirmado);
    expect(await resolveUnsubscribeUser({ tenantId, token: tokenDeOutraPessoa! })).not.toBe(
      P.descadastra,
    );

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O TOKEN DA CASA VIZINHA, E O TOKEN DE CÁ NA CASA VIZINHA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O primeiro caso é o que importa: um token derivado para a casa vizinha
     *  (instituição B + pessoa A) NÃO resolve cá, mesmo com o mesmo formato e o mesmo
     *  segredo — o `tenantId` entra no HMAC, e é ele que separa as duas casas. Sem
     *  isso, o slug na URL seria a única barreira, e o slug é público.
     *
     *  O segundo fecha o outro lado: gente da NOSSA casa não é alcançável pela URL da
     *  vizinha, porque a resolução só olha os vínculos ATIVOS da instituição do
     *  endereço.
     */
    const tokenDoVizinho = unsubscribeUrlFor({
      tenantSlug: 'f67-vizinha',
      tenantId: vizinhoId,
      userId: P.descadastra!,
    })
      ?.split('/')
      .pop();

    expect(tokenDoVizinho).toBeDefined();

    // O token da pessoa é dela: muda o token, muda (ou some) a resposta.
    expect(await resolveUnsubscribeUser({ tenantId, token: tokenDoVizinho! })).toBeNull();
    expect(await resolveUnsubscribeUser({ tenantId: vizinhoId, token })).toBeNull();
    expect(tokenDoVizinho).not.toBe(token);

    // Um caractere trocado no fim: HMAC errado, e nenhuma linha é lida.
    const torto = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(await resolveUnsubscribeUser({ tenantId, token: torto })).toBeNull();
    expect(await resolveUnsubscribeUser({ tenantId, token: '' })).toBeNull();
    expect(await resolveUnsubscribeUser({ tenantId, token: 'x'.repeat(43) })).toBeNull();
  });

  it('sair pelo token é idempotente e o estado vigente é o do banco', async () => {
    const token =
      unsubscribeUrlFor({ tenantSlug: 'f67-casa', tenantId, userId: P.descadastra! })
        ?.split('/')
        .pop() ?? '';

    const antes = await readUnsubscribePage({ tenantId, token, tenantName: 'Casa F67' });
    expect(antes.ok && antes.isOut).toBe(false);

    const primeira = await unsubscribeByToken({ tenantId, token });
    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;
    expect(primeira.alreadyOut).toBe(false);
    expect(primeira.userId).toBe(P.descadastra);

    /** A SEGUNDA vez não muda nada — e responde a mesma coisa. */
    const segunda = await unsubscribeByToken({ tenantId, token });
    expect(segunda.ok && segunda.alreadyOut).toBe(true);

    const linhas = await withTenant(tenantId, (tx) =>
      tx.communicationUnsubscribe.count({ where: { userId: P.descadastra! } }),
    );
    expect(linhas).toBe(1);

    const estado = await readUnsubscribeState({ tenantId, userId: P.descadastra! });
    expect(estado.ok && estado.isOut).toBe(true);
    expect(estado.ok && estado.channel).toBe('LINK');

    const depois = await readUnsubscribePage({ tenantId, token, tenantName: 'Casa F67' });
    expect(depois.ok && depois.isOut).toBe(true);
    expect(depois.ok && depois.keepsReceiving.length).toBeGreaterThan(0);
  });

  it('quem saiu SOME do segmento, e o TRANSACIONAL continua chegando', async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════════════
     *  A PROVA É PELO SERVIÇO, E NÃO PELA TELA
     * ═════════════════════════════════════════════════════════════════════════════
     *  O que a fatia precisa demonstrar é que as duas rotas de e-mail DISCORDAM de
     *  propósito: a campanha pula quem saiu, e o aviso de vaga retida continua
     *  saindo. Medir isso na tela mediria o desenho; aqui as duas coisas são chamadas
     *  de verdade — o disparo e o serviço de aviso — e o que se lê é o OUTBOX.
     */
    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: P.atividadeRetida! } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const antes = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(antes.ok).toBe(true);
    if (!antes.ok) return;

    expect(antes.people.map((pessoa) => pessoa.userId)).not.toContain(P.descadastra);

    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'Aviso da oficina',
      body: 'O material já está disponível.',
    });
    if (!criada.ok) throw new Error(criada.message);

    const disparo = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });
    if (!disparo.ok) throw new Error(disparo.message);

    const daCampanha = await mensagensDaCampanha(criada.campaignId);
    expect(daCampanha.map((linha) => linha.toUserId)).not.toContain(P.descadastra);
    expect(disparo.skippedUnsubscribed).toBeGreaterThan(0);

    // ── O TRANSACIONAL: o aviso da VAGA RETIDA, pelo serviço real ──────────────
    const aviso = await notifyConfirmationRequired({
      tenantId,
      registrationId: P.inscricaoRetida!,
    });

    expect(aviso.ok, aviso.ok ? '' : aviso.message).toBe(true);

    const transacional = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findFirst({
        where: {
          tenantId,
          toUserId: P.descadastra!,
          template: 'REGISTRATION_PENDING',
        },
        select: { id: true, subject: true, html: true },
      }),
    );

    expect(transacional).not.toBeNull();
    expect(transacional?.subject).toContain('Confirme sua vaga');
    /**
     * E o transacional NÃO leva rodapé de descadastro: ele é obrigação da
     * instituição com a pessoa, e não recado em massa. A prova é o que o template
     * dele produz — o `html` gravado no outbox.
     */
    expect(transacional?.html).not.toContain('recados em massa');
    expect(transacional?.html).not.toContain('/descadastro/');

    // E o aviso também entrou na caixa de entrada da pessoa (FASE 34).
    const naCaixa = await withTenant(tenantId, (tx) =>
      tx.participantMessage.count({ where: { tenantId, userId: P.descadastra! } }),
    );
    expect(naCaixa).toBeGreaterThan(0);
  });

  it('o caminho de volta devolve a pessoa ao segmento E ao disparo', async () => {
    const token =
      unsubscribeUrlFor({ tenantSlug: 'f67-casa', tenantId, userId: P.descadastra! })
        ?.split('/')
        .pop() ?? '';

    const composition = composeSegment({
      conditions: [{ id: 'inscrito-na-atividade', params: { atividade: P.atividadeRetida! } }],
    });
    if (!composition.ok) throw new Error('composição inválida');

    const antes = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(antes.ok).toBe(true);
    if (!antes.ok) return;

    const contagemFora = antes.count;
    const foraAntes = antes.unsubscribed;

    const volta = await resubscribeByUnsubscribeToken({ tenantId, token });
    expect(volta.ok && volta.changed).toBe(true);

    const depois = await evaluateSegment({ tenantId, eventId: eventoId, definition: composition.definition });
    expect(depois.ok).toBe(true);
    if (!depois.ok) return;

    expect(depois.count).toBe(contagemFora + 1);
    expect(depois.people.map((pessoa) => pessoa.userId)).toContain(P.descadastra);
    /**
     * O "N de M" cai em UM: quem voltou deixa de ser contado como quem saiu. A
     * contagem absoluta não é zero porque OUTRA pessoa desta suíte saiu antes (o
     * caso do token sorteado) e continua fora — o que se mede aqui é a VARIAÇÃO.
     */
    expect(depois.unsubscribed).toBe(foraAntes - 1);

    /** Voltar de novo não muda nada (idempotente, como a saída). */
    const segunda = await resubscribeByUnsubscribeToken({ tenantId, token });
    expect(segunda.ok && segunda.changed).toBe(false);

    /**
     * ── O DEPOIS DA VOLTA: o disparo alcança de novo ─────────────────────────────
     *  A ordem é medida aqui porque é o defeito que se quer evitar: a volta ser
     *  registrada e o disparo continuar pulando a pessoa (a condição de "está fora"
     *  precisa ser a MESMA nos dois caminhos).
     */
    const criada = await createCampaign({
      tenantId,
      actorId: organizadorId,
      eventId: eventoId,
      definition: composition.definition,
      subject: 'Voltamos a falar',
      body: 'Este é o recado de quem tinha saído da lista.',
    });
    if (!criada.ok) throw new Error(criada.message);

    const disparo = await dispatchCampaign({
      tenantId,
      campaignId: criada.campaignId,
      actorId: organizadorId,
      rateLimit: limitadorDeRitmo(100),
      wait: async () => {},
    });
    if (!disparo.ok) throw new Error(disparo.message);

    const mensagens = await mensagensDaCampanha(criada.campaignId);
    expect(mensagens.map((linha) => linha.toUserId)).toContain(P.descadastra);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento entre instituições', () => {
  it('a seleção de uma casa não enxerga a gente da outra', async () => {
    const doLadoDeCa = await selecionar([{ id: 'xp-acima', params: { xp: 400 } }]);
    const doLadoDeLa = await selecionar([{ id: 'xp-acima', params: { xp: 400 } }], {
      tenant: vizinhoId,
      eventId: null,
    });

    expect(doLadoDeCa).toContain(P.xpAlto);
    expect(doLadoDeCa).not.toContain(P.vizinhoXp);

    expect(doLadoDeLa).toContain(P.vizinhoXp);
    expect(doLadoDeLa).not.toContain(P.xpAlto);
  });

  it('a inexecução de uma instituição não é alcançável pela outra', async () => {
    const doVizinho = await withTenant(vizinhoId, (tx) =>
      tx.communicationUnsubscribe.findMany({ where: { userId: P.xpBaixo! } }),
    );

    expect(doVizinho).toHaveLength(0);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  A CERCA DA INSTITUIÇÃO, CONDICÇÃO POR CONDIÇÃO (FASE 67 · fatia 4)
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ESTE CASO EXISTE, SE JÁ HÁ UM DE ISOLAMENTO ACIMA
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O caso anterior prova o isolamento de UMA condição (`xp-acima`) e de uma
   *  tabela. O que a auditoria da fatia 4 perguntou foi outra coisa: **cada um dos
   *  quinze construtores carrega a cerca?** São quinze consultas escritas à mão —
   *  quatro delas em SQL —, e é exatamente o tipo de código em que uma cerca
   *  esquecida passa despercebida: o filtro continua parecendo certo, a contagem
   *  continua plausível, e a campanha sai para o público de outra instituição.
   *
   *  O vizinho desta classe recebeu o MESMO fato que cada condição procura (ver o
   *  `beforeAll`), então o caso percorre o CATÁLOGO inteiro e pergunta, para cada
   *  condição, com os parâmetros que ela exige: "alguma gente da casa vizinha
   *  aparece nesta seleção?".
   */
  it('nenhuma das 15 condições deixa vazar gente da instituição vizinha', async () => {
    const paramsPorCondicao: Readonly<Record<SegmentConditionId, SegmentParams>> = {
      'inscricao-sem-confirmacao': {},
      'inscricao-em-espera': {},
      'inscricao-cancelada': {},
      'presenca-manha-sem-tarde': { dia: DIA_DO_EVENTO },
      'nunca-credenciado': {},
      'minutos-abaixo': { minutos: 10_000 },
      'autor-aprovado-sem-material': {},
      'revisor-com-parecer-pendente': {},
      'proposta-em-rascunho': {},
      'inscrito-na-atividade': { atividade: oficinaId },
      'inscrito-na-sala': { sala: salaAId },
      'presenca-sem-certificado': {},
      'perfil-incompleto': {},
      'xp-acima': { xp: 1 },
      'carta-conquistada': { carta: cartaAId },
    };

    /**
     * A prova de que a lista cobre o catálogo: `Record<SegmentConditionId, …>` já
     * obriga o `tsc`, e esta linha obriga em tempo de execução — um catálogo que
     * cresça sem caso aqui reprova em vez de passar em silêncio.
     */
    expect(Object.keys(paramsPorCondicao).sort()).toEqual([...SEGMENT_CONDITION_IDS].sort());

    for (const id of SEGMENT_CONDITION_IDS) {
      const selecionados = await selecionar([{ id, params: paramsPorCondicao[id] }]);

      expect(
        selecionados,
        `"${id}" selecionou gente da instituição vizinha — a cerca da instituição falhou`,
      ).not.toContain(P.vizinhoCompleto);

      expect(selecionados, `"${id}" vazou o vizinho de XP`).not.toContain(P.vizinhoXp);
    }
  });

  it('os fatos do vizinho EXISTEM (sem isso o caso acima passaria por vacuidade)', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A GUARDA CONTRA O TESTE QUE PASSA PORQUE NÃO HÁ O QUE ENCONTRAR
     * ─────────────────────────────────────────────────────────────────────────────
     *  "A seleção não trouxe ninguém de fora" é verdade também quando o vizinho não
     *  tem fato nenhum. Esta leitura conta o que o `beforeAll` semeou do lado de lá —
     *  e é o que separa "a cerca funciona" de "não havia nada para vazar".
     */
    const [inscricoes, presencas, submissoes, pareceres, certificados, cartas, xp] =
      await Promise.all([
        withTenant(vizinhoId, (tx) =>
          tx.registration.count({ where: { userId: P.vizinhoCompleto! } }),
        ),
        withTenant(vizinhoId, (tx) =>
          tx.attendance.count({ where: { userId: P.vizinhoCompleto! } }),
        ),
        withTenant(vizinhoId, (tx) =>
          tx.submission.count({ where: { submittedById: P.vizinhoCompleto! } }),
        ),
        withTenant(vizinhoId, (tx) =>
          tx.reviewAssignment.count({ where: { reviewerId: P.vizinhoCompleto! } }),
        ),
        withTenant(vizinhoId, (tx) =>
          tx.certificate.count({ where: { userId: P.vizinhoCompleto! } }),
        ),
        withTenant(vizinhoId, (tx) => tx.userCard.count({ where: { userId: P.vizinhoCompleto! } })),
        withTenant(vizinhoId, (tx) =>
          tx.userXpProfile.count({ where: { userId: P.vizinhoXp! } }),
        ),
      ]);

    expect(inscricoes).toBe(4);
    expect(presencas).toBe(1);
    expect(submissoes).toBe(2);
    expect(pareceres).toBe(1);
    expect(certificados).toBe(1);
    expect(cartas).toBe(1);
    expect(xp).toBe(1);
  });
});
