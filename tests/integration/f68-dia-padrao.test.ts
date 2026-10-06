/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — O DIA COMO PADRÃO E O DEFEITO DE DATA (FASE 68 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES CASOS PRENDEM (e por que cada um existe)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o par que o formulário SUGERE (09:00 → 18:00 no mesmo dia) **passa** na régua do
 *    serviço e é GRAVADO de volta pelos valores reais — a metade que o teste de
 *    unidade não pode provar, porque ele compara com o predicado e não com o serviço;
 *  • a **negativa**: `endsAt == startsAt` continua sendo `INVALID_INPUT` (a régua não
 *    foi afrouxada para caber no padrão novo);
 *  • o **rótulo da raiz do painel** — a mesma régua da página pública
 *    (`formatEventPeriod`) trata o mesmo dia e formata no fuso do EVENTO, e não no do
 *    processo que roda a suíte.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { getAdminEvent, saveEvent } from '../../src/lib/admin/catalog-service';
import { defaultEventPeriod } from '../../src/domain/events/event-form-defaults';
import { formatEventPeriod } from '../../src/domain/events/event-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let actorId: string;

beforeAll(async () => {
  tenantId = randomUUID();
  actorId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f68-dia-${RUN}`,
      name: `Instituição do Dia Padrão ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizadora F68 Dia', email: `f68dia.${RUN}@exemplo.test` },
  });

  await withTenant(tenantId, (tx) =>
    tx.roleAssignment.create({
      data: { id: randomUUID(), tenantId, userId: actorId, role: 'ORGANIZER', scope: 'TENANT' },
    }),
  );
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f68dia.${RUN}` } } });
});

describe('o evento nasce com um dia (fatia 4)', () => {
  it('o par sugerido pelo formulário é ACEITO pelo serviço e gravado como veio', async () => {
    /**
     * O instante do render é FIXO de propósito: o caso mede o PADRÃO, e não o relógio
     * de quem roda a suíte. O `agora` abaixo reproduz o print do humano (12:27) — o
     * minuto que antes virava a hora do início.
     */
    const { startsAt, endsAt } = defaultEventPeriod(new Date('2026-11-05T12:27:43.812'));

    const criado = await saveEvent({
      tenantId,
      actorId,
      slug: `evento-um-dia-${RUN}`,
      title: `Evento de um dia ${RUN}`,
      status: 'DRAFT',
      modality: 'IN_PERSON',
      startsAt,
      endsAt,
      timezone: TIME_ZONE,
    });

    expect(criado.ok, criado.ok ? 'ok' : criado.message).toBe(true);
    if (!criado.ok) return;

    const detalhe = await getAdminEvent(tenantId, criado.eventId);

    expect(detalhe?.startsAt.getTime()).toBe(startsAt.getTime());
    expect(detalhe?.endsAt.getTime()).toBe(endsAt.getTime());

    /** E o mesmo dia, no relógio local — a leitura que o organizador faz do painel. */
    expect(detalhe?.endsAt.getDate()).toBe(detalhe?.startsAt.getDate());
  });

  it('a janela de UM dia formata como UM dia — e não como duas datas iguais', async () => {
    const { startsAt, endsAt } = defaultEventPeriod(new Date('2026-11-05T12:27:43.812'));

    const criado = await saveEvent({
      tenantId,
      actorId,
      slug: `evento-recorte-${RUN}`,
      title: `Evento do recorte ${RUN}`,
      status: 'DRAFT',
      modality: 'IN_PERSON',
      startsAt,
      endsAt,
      timezone: TIME_ZONE,
    });

    expect(criado.ok, criado.ok ? 'ok' : criado.message).toBe(true);
    if (!criado.ok) return;

    const detalhe = await getAdminEvent(tenantId, criado.eventId);
    expect(detalhe).not.toBeNull();
    if (!detalhe) return;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O ANTES E O DEPOIS, NO MESMO TESTE
     * ─────────────────────────────────────────────────────────────────────────────
     *  A raiz do painel escrevia `toLocaleDateString('pt-BR')` colado dos dois lados:
     *  com um dia, o rótulo dizia "05/12/2026 a 05/12/2026" — a MESMA data duas vezes,
     *  porque o `defaultEventPeriod` parte do dia do render (trinta dias à frente) e
     *  não de uma data fixa. O valor antigo é reproduzido aqui para o teste dizer QUAL
     *  era o defeito, e a régua nova é afirmada logo abaixo — no fuso do EVENTO, que é
     *  o que `formatEventPeriod` usa.
     */
    const dataLocal = detalhe.startsAt.toLocaleDateString('pt-BR');
    const comoEra = `${dataLocal} a ${detalhe.endsAt.toLocaleDateString('pt-BR')}`;

    expect(comoEra).toBe(`${dataLocal} a ${dataLocal}`);

    const comoE = formatEventPeriod(detalhe, detalhe.timezone);

    expect(comoE).toContain('09:00');
    expect(comoE).toContain('18:00');

    /**
     * O DIA aparece UMA vez. As duas réguas escrevem a data em formatos diferentes
     * (`toLocaleDateString` faz "05/12/2026" e `formatEventPeriod` faz "05 de dezembro
     * de 2026"), então a comparação é pelo DIA — "5 de dezembro" —, e não pela string
     * inteira: prender o formato do domínio aqui seria prender a régua errada, que já
     * tem teste próprio.
     */
    const dia = `${detalhe.startsAt.getDate()} de`;

    expect(comoE).toContain(dia);
    expect(comoE.match(new RegExp(dia, 'g'))).toHaveLength(1);
    /** E o formato antigo não volta: nada de "… a …" entre duas datas. */
    expect(comoE).not.toContain(' a ');
  });

  it('término IGUAL ao início continua recusado — a régua não foi afrouxada', async () => {
    const { startsAt } = defaultEventPeriod(new Date('2026-11-05T12:27:43.812'));

    const recusado = await saveEvent({
      tenantId,
      actorId,
      slug: `evento-instantaneo-${RUN}`,
      title: `Evento instantâneo ${RUN}`,
      status: 'DRAFT',
      modality: 'IN_PERSON',
      startsAt,
      endsAt: new Date(startsAt.getTime()),
      timezone: TIME_ZONE,
    });

    expect(recusado.ok).toBe(false);
    if (recusado.ok) return;

    expect(recusado.code).toBe('INVALID_INPUT');
    expect(recusado.message).toContain('depois do início');
  });
});
