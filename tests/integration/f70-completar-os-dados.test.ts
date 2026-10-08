/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — "COMPLETAR MEUS DADOS" COLETA O QUE O ORGANIZADOR PEDIU
 *  (FASE 70 · o fecho da lacuna de produto)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LACUNA QUE ESTES CASOS FECHAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição na ATIVIDADE passou a materializar a linha do EVENTO — e essa linha
 *  nasce com `formResponses` herdado (vazio), porque o formulário da atividade não tem
 *  CPF. A porta "Completar meus dados" era a única que essa pessoa tinha, e ela pedia
 *  só CPF e necessidades: o organizador montava o formulário, o participante que vinha
 *  pela oficina nunca via as perguntas, e o dado não era coletado de quem veio por ali.
 *
 *  O que estes casos prendem, contra o PostgreSQL real:
 *    • os campos DECLARADOS chegam à porta de quem veio pela atividade, com o mesmo
 *      validador do domínio e a MESMA leitura de configuração que a tela usa;
 *    • a MESCLA preserva o que já existia — responder de novo não apaga o que não foi
 *      respondido nesta passada;
 *    • a chave RESERVADA do sistema não é sobrescrita: `cpf` continua sendo o CPF, e o
 *      spec que tenta declará-lo é recusado pelo leitor antes de virar campo.
 *
 *  Requer: docker compose up -d && npm run db:setup
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveActivity, saveEvent } from '../../src/lib/admin/catalog-service';
import { applyRegistrationFormOperationOnEvent } from '../../src/lib/admin/registration-form-service';
import {
  readEventRegistrationFields,
  registerForActivity,
  registerForEvent,
  updateEventRegistrationData,
} from '../../src/lib/events/registration-service';
import {
  composeFormResponses,
  formResponseFieldName,
  readRegistrationForm,
  validateFormResponses,
} from '../../src/domain/events/registration-form-spec-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
/** O CPF do sistema — válido, para o teste provar que ele é o que fica. */
const CPF_DO_SISTEMA = '52998224725';
/** O CPF que o campo DECLARADO (hostil) tentaria gravar por cima. */
const CPF_DO_CAMPO = '11144477735';

let tenantId: string;
let organizerId: string;

/** O evento com o formulário declarado, compartilhado pelos dois primeiros casos. */
let eventId: string;
let eventSlug: string;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function createUser(label: string): Promise<string> {
  const id = randomUUID();
  await adminPrisma.user.create({
    data: { id, name: `Pessoa ${label} ${RUN}`, email: `f70dados.${label}.${RUN}@exemplo.test` },
  });
  return id;
}

/** A linha do EVENTO da pessoa, com o depósito de respostas. */
async function eventLineOf(userId: string, targetEventId: string = eventId) {
  return withTenant(tenantId, (tx) =>
    tx.registration.findFirst({
      where: { eventId: targetEventId, userId, activityId: null, deletedAt: null },
      select: {
        id: true,
        status: true,
        formResponses: true,
        accessibilityNotes: true,
      },
    }),
  );
}

/** Declara UM campo pelo serviço REAL do organizador — o caminho da tela. */
async function declareField(input: {
  targetEventId: string;
  key: string;
  label: string;
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'YES_NO' | 'NUMBER' | 'DATE';
  required?: boolean;
  purpose?: string;
  options?: readonly string[];
}): Promise<void> {
  const saved = await applyRegistrationFormOperationOnEvent({
    tenantId,
    actorId: organizerId,
    eventId: input.targetEventId,
    operation: {
      kind: 'SAVE',
      originalKey: null,
      field: {
        key: input.key,
        label: input.label,
        type: input.type,
        required: input.required ?? false,
        ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        ...(input.options !== undefined ? { options: [...input.options] } : {}),
      },
    },
  });

  if (!saved.ok) throw new Error(`Falha ao declarar o campo ${input.key}: ${saved.message}`);
}

/** Cria um evento com o formulário declarado do jeito que a tela o monta. */
async function createEventWithForm(input: {
  slug: string;
  fields: readonly {
    key: string;
    label: string;
    type: 'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'YES_NO' | 'NUMBER' | 'DATE';
    required?: boolean;
    purpose?: string;
    options?: readonly string[];
  }[];
}): Promise<string> {
  const result = await saveEvent({
    tenantId,
    actorId: organizerId,
    slug: input.slug,
    title: `Evento ${input.slug}`,
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

  if (!result.ok) throw new Error(`Falha ao criar o evento: ${result.message}`);

  for (const field of input.fields) {
    await declareField({ targetEventId: result.eventId, ...field });
  }

  return result.eventId;
}

/** A atividade com inscrição PRÓPRIA — a porta por onde a pessoa entra. */
async function createActivity(targetEventId: string, slug: string): Promise<string> {
  const result = await saveActivity({
    tenantId,
    actorId: organizerId,
    eventId: targetEventId,
    slug,
    title: `Oficina ${slug}`,
    type: 'WORKSHOP',
    status: 'SCHEDULED',
    modality: 'IN_PERSON',
    startsAt: daysFromNow(31),
    endsAt: new Date(daysFromNow(31).getTime() + 3_600_000),
    workloadMinutes: 60,
    capacity: null,
    waitlistEnabled: false,
    requiresRegistration: true,
    confirmationPolicy: 'AUTO',
    confirmationWindowDays: null,
  });

  if (!result.ok) throw new Error(`Falha ao criar a atividade: ${result.message}`);
  return result.activityId;
}

/**
 * A pessoa entra pela ATIVIDADE e devolve o `userId` — é o caminho que a fase conserta,
 * e é ele que faz a linha do evento nascer com o depósito VAZIO.
 */
async function entrarPelaAtividade(slug: string, label: string): Promise<string> {
  const userId = await createUser(label);

  const entrada = await registerForActivity({
    tenantId,
    eventSlug: slug,
    activitySlug: `oficina-${slug}`,
    userId,
    consentData: true,
    consentImage: false,
    accessibilityNotes: 'Preciso de rampa de acesso',
  });

  if (!entrada.ok) throw new Error(`Falha ao entrar pela atividade: ${entrada.message}`);

  return userId;
}

beforeAll(async () => {
  tenantId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f70-dados-${RUN}`,
      name: `Instituição do Completar ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
      /** Sem quota de eventos: cada caso monta o próprio cenário. */
      maxEvents: 50,
    },
  });

  organizerId = await createUser('organizadora');

  eventSlug = `evento-dados-${RUN}`;

  eventId = await createEventWithForm({
    slug: eventSlug,
    fields: [
      {
        key: 'instituicao',
        label: 'Instituição de origem',
        type: 'SHORT_TEXT',
        required: true,
      },
      {
        key: 'restricao',
        label: 'Restrição alimentar',
        type: 'SHORT_TEXT',
      },
      {
        key: 'chegada',
        label: 'Horário previsto de chegada',
        type: 'SINGLE_CHOICE',
        options: ['Manhã', 'Tarde'],
      },
      {
        key: 'observacoes',
        label: 'Observações para a organização',
        type: 'LONG_TEXT',
        purpose: 'Registrar pedidos que não cabem nas outras perguntas.',
      },
    ],
  });

  await createActivity(eventId, `oficina-${eventSlug}`);
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f70dados.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('os campos declarados chegam à porta de quem veio pela atividade', () => {
  it('a pessoa vê os campos declarados e consegue respondê-los depois', async () => {
    const pessoa = await entrarPelaAtividade(eventSlug, 'a');

    /** A linha do evento NASCEU do caminho da atividade, e sem resposta nenhuma. */
    const antes = await eventLineOf(pessoa);
    expect(antes).not.toBeNull();
    expect(antes?.status).toBe('CONFIRMED');
    expect(antes?.formResponses).toEqual({});

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A LEITURA É A MESMA QUE A TELA USA — e é isto que faz a pessoa VER os campos
     * ─────────────────────────────────────────────────────────────────────────────
     *  `readEventRegistrationFields` lê `Event.settings` pelo leitor tolerante do
     *  domínio, que é exatamente o que a projeção pública do evento entrega ao
     *  componente. Se as duas leituras divergissem, a tela desenharia um campo que o
     *  servidor recusaria — ou o contrário.
     */
    const campos = await readEventRegistrationFields({ tenantId, eventSlug });

    expect(campos.map((field) => field.key)).toEqual([
      'instituicao',
      'restricao',
      'chegada',
      'observacoes',
    ]);
    expect(campos[0]?.required).toBe(true);

    /**
     * As respostas passam pelo MESMO validador do domínio, como na tela de inscrição —
     * e o aceito é o que o serviço grava.
     */
    const declarado = validateFormResponses(campos, {
      instituicao: 'UFBA',
      restricao: 'Sem glúten',
      chegada: 'Manhã',
      observacoes: 'Chego às 9h.',
    });

    expect(declarado.ok).toBe(true);
    if (!declarado.ok) return;

    const salvo = await updateEventRegistrationData({
      tenantId,
      userId: pessoa,
      eventSlug,
      consentData: true,
      consentImage: false,
      accessibilityNotes: null,
      formResponses: composeFormResponses({
        declared: declarado.accepted,
        system: { cpf: CPF_DO_SISTEMA },
      }),
    });

    expect(salvo.ok, salvo.ok ? 'ok' : salvo.message).toBe(true);

    const depois = await eventLineOf(pessoa);

    expect(depois?.formResponses).toEqual({
      instituicao: 'UFBA',
      restricao: 'Sem glúten',
      chegada: 'Manhã',
      observacoes: 'Chego às 9h.',
      cpf: CPF_DO_SISTEMA,
    });
    /** A inscrição continua a MESMA linha: completar dados não cria inscrição nova. */
    expect(depois?.id).toBe(antes?.id);
  });

  it('o merge NÃO apaga o que já existia — responder de novo não é recomeçar', async () => {
    const pessoa = await entrarPelaAtividade(eventSlug, 'b');

    const campos = await readEventRegistrationFields({ tenantId, eventSlug });

    /** Primeira passada: três campos, incluindo o obrigatório. */
    const primeira = validateFormResponses(campos, {
      instituicao: 'IFBA',
      restricao: 'Vegano',
      chegada: 'Tarde',
    });

    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;

    await updateEventRegistrationData({
      tenantId,
      userId: pessoa,
      eventSlug,
      consentData: true,
      consentImage: false,
      accessibilityNotes: 'Cadeira com apoio',
      formResponses: composeFormResponses({ declared: primeira.accepted, system: {} }),
    });

    /**
     * Segunda passada: a pessoa volta à porta e responde SÓ o obrigatório. O
     * `validateFormResponses` devolve apenas o que foi respondido — e é por isso que a
     * mescla do serviço é a diferença entre "atualizar" e "recomeçar".
     */
    const segunda = validateFormResponses(campos, { instituicao: 'UFBA' });

    expect(segunda.ok).toBe(true);
    if (!segunda.ok) return;

    /** O aceito da segunda passada tem UMA chave — é o dado que a mescla vai receber. */
    expect(segunda.acceptedKeys).toEqual(['instituicao']);

    await updateEventRegistrationData({
      tenantId,
      userId: pessoa,
      eventSlug,
      consentData: true,
      consentImage: false,
      /** A tela reenvia a nota gravada (o campo vem preenchido) — nada é apagado. */
      accessibilityNotes: 'Cadeira com apoio',
      formResponses: composeFormResponses({ declared: segunda.accepted, system: {} }),
    });

    const depois = await eventLineOf(pessoa);

    expect(depois?.formResponses).toEqual({
      instituicao: 'UFBA',
      restricao: 'Vegano',
      chegada: 'Tarde',
    });
    /** E a nota de acessibilidade continua onde estava — o formulário a devolve igual. */
    expect(depois?.accessibilityNotes).toBe('Cadeira com apoio');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a chave RESERVADA do sistema não é sobrescrita', () => {
  it('a composição deixa o CPF do sistema com a última palavra', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O CASO É CONSTRUÍDO À MÃO, E É O ÚNICO JEITO DE PROVAR A PROMESSA
     * ─────────────────────────────────────────────────────────────────────────────
     *  A camada de cima (`validateRegistrationFormSpec`) RECUSA `cpf` como
     *  identificador de campo — então, no caminho real, o `accepted` nunca traz essa
     *  chave. Esta asserção passa o objeto hostil de propósito: é a segunda camada
     *  (a ORDEM da composição) que está sendo medida, e ela é a que protege uma chave
     *  de sistema nova que alguém esqueça de acrescentar à lista de reservadas.
     */
    const composto = composeFormResponses({
      declared: { cpf: CPF_DO_CAMPO, instituicao: 'UFBA' },
      system: { cpf: CPF_DO_SISTEMA },
    });

    expect(composto).toEqual({ cpf: CPF_DO_SISTEMA, instituicao: 'UFBA' });
    expect(composto.cpf).not.toBe(CPF_DO_CAMPO);
  });

  it('um evento com campo `cpf` declarado cai no formulário de sempre — sem campo nenhum', async () => {
    const hostilSlug = `evento-hostil-${RUN}`;

    const criado = await saveEvent({
      tenantId,
      actorId: organizerId,
      slug: hostilSlug,
      title: 'Evento hostil',
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

    if (!criado.ok) throw new Error(`Falha ao criar o evento hostil: ${criado.message}`);

    /**
     * A configuração hostil entra pelo BANCO, e não pelo serviço do organizador: o
     * serviço recusaria a gravação, e o que este caso mede é o LEITOR diante de um
     * `settings` que alguém escreveu por fora (migração, script, versão futura).
     */
    await withTenant(tenantId, (tx) =>
      tx.event.update({
        where: { id: criado.eventId },
        data: {
          settings: {
            registrationForm: [
              { key: 'cpf', label: 'CPF do participante', type: 'SHORT_TEXT', required: true },
              { key: 'instituicao', label: 'Instituição de origem', type: 'SHORT_TEXT' },
            ],
          },
        },
      }),
    );

    /** O leitor do domínio recusa o spec INTEIRO — e diz por quê. */
    const leitura = await withTenant(tenantId, (tx) =>
      tx.event.findFirstOrThrow({
        where: { id: criado.eventId },
        select: { settings: true },
      }),
    );

    const lido = readRegistrationForm(leitura.settings);

    expect(lido.source).toBe('DEFAULT');
    expect(lido.fields).toEqual([]);
    expect(lido.problems.map((problem) => problem.code)).toContain('RESERVED_KEY');

    /** E a leitura do SERVIÇO — a que a action usa para validar — diz o mesmo. */
    const campos = await readEventRegistrationFields({ tenantId, eventSlug: hostilSlug });
    expect(campos).toEqual([]);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  E O CPF DO SISTEMA CONTINUA SENDO O CPF — COM O POST CRU NA MÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A pessoa está inscrita no evento hostil, então a porta de completar abre. O que
     *  se mede aqui é o que a ACTION faz com o `<form>`: `typed` é montado percorrendo
     *  as chaves dos campos LIDOS (nenhuma) e procurando `resposta_<key>` no `FormData`.
     *  Com a lista vazia, um `resposta_cpf` no POST não tem por onde entrar — e o que a
     *  ação grava é a composição, com o CPF do sistema por último.
     *
     *  O `FormData` de verdade entra no lugar do formulário do navegador de propósito:
     *  um objeto montado à mão provaria menos do que o caminho que o navegador usa.
     */
    const pessoa = await createUser('hostil');

    const inscricao = await registerForEvent({
      tenantId,
      eventSlug: hostilSlug,
      userId: pessoa,
      consentData: true,
      consentImage: false,
      accessibilityNotes: null,
    });

    expect(inscricao.ok, inscricao.ok ? 'ok' : inscricao.message).toBe(true);

    const camposDoEvento = await readEventRegistrationFields({
      tenantId,
      eventSlug: hostilSlug,
    });
    expect(camposDoEvento).toEqual([]);

    /** O POST cru: o campo hostil chega com o nome prefixado, como o `<form>` manda. */
    const post = new FormData();
    post.set(formResponseFieldName('cpf'), CPF_DO_CAMPO);
    post.set('cpf', CPF_DO_SISTEMA);

    const typedDoPost: Record<string, string> = {};

    for (const field of camposDoEvento) {
      const raw = post.get(formResponseFieldName(field.key));
      if (typeof raw === 'string') typedDoPost[field.key] = raw;
    }

    expect(typedDoPost).toEqual({});

    const declarado = validateFormResponses(camposDoEvento, typedDoPost);
    expect(declarado.ok).toBe(true);
    if (!declarado.ok) return;

    const salvo = await updateEventRegistrationData({
      tenantId,
      userId: pessoa,
      eventSlug: hostilSlug,
      consentData: true,
      consentImage: false,
      accessibilityNotes: null,
      formResponses: composeFormResponses({
        declared: declarado.accepted,
        system: { cpf: String(post.get('cpf')) },
      }),
    });

    expect(salvo.ok, salvo.ok ? 'ok' : salvo.message).toBe(true);

    const linha = await eventLineOf(pessoa, criado.eventId);

    /** O depósito tem o CPF DO SISTEMA — o do campo hostil não passou por lugar nenhum. */
    expect(linha?.formResponses).toEqual({ cpf: CPF_DO_SISTEMA });
    expect(JSON.stringify(linha?.formResponses)).not.toContain(CPF_DO_CAMPO);
  });
});
