import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarRange } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { saveEventAction } from '@/app/actions/admin-actions';
import { SectionHeading } from '@/components/ui';
import { toLocalInput } from '@/lib/events/activity-presentation';
import { onlineRoomFieldVisibility } from '@/domain/events/event-form-defaults';
import { EVENT_MODALITY_OPTIONS } from '@/domain/events/event-modality-rules';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';

/**
 * A lista `MODALITY` que morava AQUI virou a fonte única do domínio (FASE 69):
 * `EVENT_MODALITY_OPTIONS` (`src/domain/events/event-modality-rules.ts`). A lista era a
 * mesma nas três telas de administração, e três cópias concordando hoje divergem no dia
 * em que um valor novo entra no enum.
 */

const EVENT_STATUS = [
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'PUBLISHED', label: 'Publicado' },
  { value: 'REGISTRATION_OPEN', label: 'Inscrições abertas' },
  { value: 'REGISTRATION_CLOSED', label: 'Inscrições encerradas' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'FINISHED', label: 'Encerrado' },
  { value: 'CANCELED', label: 'Cancelado' },
  { value: 'ARCHIVED', label: 'Arquivado' },
];


export const metadata = { title: 'Dados do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DADOS DO EVENTO — A IDENTIDADE (FASE 55, fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Era uma sanfona no meio de outras três, na raiz do evento — e destoava do resto
 *  da tela, onde cada área é um CARTÃO que leva a uma tela. Aqui mora a identidade
 *  do evento: nome, datas, local, modalidade, capacidade e os PRAZOS DE INSCRIÇÃO.
 *
 *  Os prazos ficam aqui, e não com as chamadas, por decisão do humano: a janela de
 *  submissão é da CHAMADA (e tem tela própria em `/chamadas`), mas a janela de
 *  INSCRIÇÃO é do evento — quem se inscreve precisa dela para saber até quando.
 *
 *  O `data-testid="event-details"` da seção antiga NÃO foi preservado como sanfona:
 *  virou um cartão e uma página. Os specs que o usavam foram reapontados (ADR-302).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventDataPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O CAMPO DO ENDEREÇO DA SALA ONLINE APARECE? (FASE 68 · ajuste do humano)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A decisão é do SERVIDOR, na renderização: nada de CSS escondendo campo que
   *  continua obrigatório, nada de estado de cliente para divergir da regra. Duas
   *  condições fazem o campo aparecer (`onlineRoomFieldVisibility`):
   *
   *    • a modalidade do EVENTO é Online ou Híbrida — é quando o endereço é parte do
   *      que se preenche;
   *    • **ou** já existe endereço gravado — porque esconder o campo esconderia o
   *      DADO, e o organizador precisa poder VER e LIMPAR o que está salvo. É este o
   *      caso em que a frase `notice` aparece acima do campo.
   *
   *  Quando o campo não é desenhado, o `<form>` sai sem `onlineUrl` — e o serviço
   *  trata o ausente como "não mexa nesta coluna" (`saveEvent`). Sem essa metade, a
   *  modalidade presencial apagaria em silêncio o endereço de quem já o tinha.
   */
  const salaOnline = onlineRoomFieldVisibility({
    modality: event.modality,
    existingUrl: event.onlineUrl,
  });

  return (
    <main className="max-w-3xl space-y-8" data-testid="event-data-page">
      <div className="space-y-2">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Voltar ao evento
          </Link>
        </nav>

        <SectionHeading
          title="Dados do evento"
          description="Nome, datas, local, modalidade, capacidade e os prazos de inscrição."
        />
      </div>

      <section data-testid="event-details">
          <AdminForm action={saveEventAction} submitLabel="Salvar evento" testId="edit-event">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={event.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Identificador" name="slug" required defaultValue={event.slug} />
              <Field label="Título" name="title" required defaultValue={event.title} />
              <Field label="Resumo" name="summary" defaultValue={event.summary} />
              <Field label="Local" name="venueName" defaultValue={event.venueName} />
              {/**
                * FASE 68: o escritor de `Event.onlineUrl`. O endereço é o da TRANSMISSÃO
                * do evento; a atividade pode ter o próprio (na programação), e repetir
                * o do evento é decisão do organizador — não herança.
                *
                * O campo só é desenhado em evento Online/Híbrido ou quando já há
                * endereço gravado (ver `onlineRoomFieldVisibility`, acima).
                */}
              {salaOnline.show ? (
                <Field
                  label="Endereço da sala online"
                  name="onlineUrl"
                  type="url"
                  defaultValue={event.onlineUrl}
                  placeholder="https://sala.exemplo.com/entrar"
                  notice={salaOnline.notice}
                  hint={salaOnline.hint}
                />
              ) : null}
              <Field label="Cidade" name="city" defaultValue={event.city} />
              <Field label="UF" name="state" defaultValue={event.state} />
              <Field label="Início" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(event.startsAt)} />
              <Field label="Término" name="endsAt" type="datetime-local" required defaultValue={toLocalInput(event.endsAt)} />
              <Field label="Fuso horário" name="timezone" required defaultValue={event.timezone} />
              <Field label="Vagas" name="capacity" type="number" min={0} defaultValue={event.capacity} />
              <Field label="Cor principal" name="primaryColor" defaultValue={event.primaryColor} />
              <Field label="Inscrições abrem em" name="registrationOpensAt" type="datetime-local" defaultValue={toLocalInput(event.registrationOpensAt)} />
              <Field label="Inscrições fecham em" name="registrationClosesAt" type="datetime-local" defaultValue={toLocalInput(event.registrationClosesAt)} />
              {/**
                * FASE 68: os dois campos da janela de submissão SAÍRAM daqui. Eles
                * conviviam com o aviso logo abaixo, que manda para `/chamadas` — dois
                * lugares para o mesmo fato, e o daqui ninguém escrevia. Ficou o
                * interruptor, que é do EVENTO: ele decide se a chamada é cobrada.
                */}
              <CheckboxField
                label="Este evento recebe trabalhos"
                name="usesCall"
                hint="Ligue para receber propostas: a janela, a rubrica e as trilhas ficam em “Chamadas de trabalhos”."
                defaultChecked={event.usesCall}
              />
              <SelectField label="Situação" name="status" options={EVENT_STATUS} defaultValue={event.status} />
              <SelectField label="Modalidade" name="modality" options={EVENT_MODALITY_OPTIONS} defaultValue={event.modality} />
              {/**
                * FASE 12 (item I3): a instituição escolhe entre evento ABERTO (padrão
                * desde a FASE 10) e restrito à própria comunidade. Sem esta caixa, a
                * FASE 10 teria tirado da instituição o direito de fechar um evento.
                */}
              <CheckboxField
                label="Exigir vínculo com a instituição para se inscrever"
                name="registrationRequiresMembership"
                hint="Desmarcado, qualquer pessoa com conta pode se inscrever (evento aberto)."
                defaultChecked={event.registrationRequiresMembership}
              />
            </div>
          </AdminForm>
      </section>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarRange className="size-3.5 shrink-0" aria-hidden />
        A janela da CHAMADA de trabalhos fica em{' '}
        <Link
          href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/chamadas`)}
          className="underline underline-offset-4"
        >
          Chamadas de trabalhos
        </Link>
        .
      </p>
    </main>
  );
}
