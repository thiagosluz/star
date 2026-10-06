import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { saveEventAction } from '@/app/actions/admin-actions';
import {
  defaultEventPeriod,
  onlineRoomFieldVisibility,
} from '@/domain/events/event-form-defaults';
import {
  EVENT_MODALITY_OPTIONS,
  type EventModalityValue,
} from '@/domain/events/event-modality-rules';
import { toLocalInput } from '@/lib/events/activity-presentation';

export const metadata = { title: 'Eventos' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS = [
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'PUBLISHED', label: 'Publicado' },
  { value: 'REGISTRATION_OPEN', label: 'Inscrições abertas' },
  { value: 'REGISTRATION_CLOSED', label: 'Inscrições encerradas' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'FINISHED', label: 'Encerrado' },
  { value: 'CANCELED', label: 'Cancelado' },
  { value: 'ARCHIVED', label: 'Arquivado' },
];

/** A lista do `<select>` vem do DOMÍNIO — ver `eventModalityLabel` e `EVENT_MODALITY_OPTIONS`. */

/**
 * O `toLocalInput` que morava AQUI foi para `src/lib/events/activity-presentation.ts`.
 *
 * Ele era uma TERCEIRA cópia da mesma conversão (a página de dados do evento e a de
 * programação já importavam a de lá), e a FASE 68 precisou exatamente dele para o
 * padrão de um dia — três cópias é onde a divergência nasce.
 */

export default async function AdminEventsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const events = await listAdminEvents(tenantId);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O EVENTO NOVO NASCE COM UM DIA (FASE 68 · fatia 4)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O DIA vem do relógio (não há outra fonte para "quando o organizador está criando
   *  isto"), e a HORA não: 09:00 → 18:00 no MESMO dia, decididos em
   *  `defaultEventPeriod`. Antes, o término era `início + 3 dias` e a hora do início
   *  era o MINUTO DO RENDER — o print do humano mostrou "12:27", e todo evento criado
   *  assim passava a anunciar três dias na página pública.
   */
  const { startsAt: defaultStart, endsAt: defaultEnd } = defaultEventPeriod(new Date());

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A MODALIDADE COM QUE O EVENTO NOVO NASCE — E O QUE ELA ESCONDE (FASE 68)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O valor é NOMEADO porque duas coisas dependem dele: o `<select>` de Modalidade e
   *  a decisão de desenhar o campo do endereço da sala online (que só aparece em
   *  Online/Híbrido — ou quando já existe endereço gravado, o que num evento NOVO
   *  nunca acontece). Um literal solto em cada lugar permitiria que a tela escondesse
   *  um campo que a modalidade mostrada pede.
   */
  const modalidadePadrao: EventModalityValue = 'IN_PERSON';

  /**
   * A decisão é do SERVIDOR e acontece aqui, na renderização (o formulário não tem
   * estado de cliente): `show: false` = o campo não é desenhado, e não há CSS nem
   * JavaScript escondendo nada. Ver `onlineRoomFieldVisibility` para as duas
   * condições e para o preço declarado desta escolha.
   */
  const salaOnline = onlineRoomFieldVisibility({ modality: modalidadePadrao });

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Administração
          </Link>
        </nav>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarPlus className="size-6 text-primary" aria-hidden />
          Eventos
        </h1>
        <p className="text-sm text-muted-foreground">
          O evento é a raiz de tudo: atividades, salas, chamada de trabalhos, inscrições e certificados
          pertencem a ele.
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="lista-eventos">
        <h2 id="lista-eventos" className="text-lg font-semibold tracking-tight">
          Eventos da instituição
        </h2>

        {events.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="events-empty"
          >
            Nenhum evento cadastrado. Crie o primeiro no formulário abaixo.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="admin-event-list">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="code-data text-muted-foreground">/t/{tenantSlug}/eventos/{event.slug}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.startsAt.toLocaleDateString('pt-BR')} · {event.status} ·{' '}
                    {event.activityCount} atividade(s) · {event.trackCount} trilha(s) ·{' '}
                    {event.roomCount} sala(s) · {event.registrationCount} inscrição(ões)
                  </p>
                </div>

                <Link
                  href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}`)}
                  data-testid={`manage-${event.slug}`}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
                >
                  Gerenciar
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="novo-evento">
        <h2 id="novo-evento" className="text-lg font-semibold tracking-tight">
          Novo evento
        </h2>

        <AdminForm action={saveEventAction} submitLabel="Criar evento" testId="create-event">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Identificador (URL)" name="slug" required placeholder="congresso-2027" />
            <Field label="Título" name="title" required placeholder="Congresso de Tecnologia 2027" />
            <Field label="Resumo" name="summary" placeholder="Uma linha sobre o evento" />
            <Field label="Local" name="venueName" placeholder="Centro de Convenções" />
            {/**
              * ───────────────────────────────────────────────────────────────────
              *  O ENDEREÇO DA SALA ONLINE (FASE 68)
              * ───────────────────────────────────────────────────────────────────
              *  A coluna existia desde a primeira migração e NÃO tinha escritor: o
              *  bloco de LOCAL da página pública mostrava o endereço a qualquer
              *  visitante, e ninguém conseguia gravá-lo. Este é o campo que faltava.
              *
              *  Ele NÃO é herdado pelas atividades: cada atividade tem o seu (e o
              *  organizador decide se repete). Quem vê o endereço é decidido no
              *  servidor — inscrição viva que não seja de lista de espera, ou a
              *  equipe do evento.
              *
              *  A PRESENÇA do campo é decidida no servidor
              *  (`onlineRoomFieldVisibility`): ele só é desenhado em evento Online ou
              *  Híbrido. Um evento NOVO nunca tem endereço gravado, então aqui basta a
              *  modalidade — e como ela ainda pode ser trocada no `<select>`, o
              *  organizador que escolher "Online" verá o campo no formulário
              *  recarregado, depois de salvar.
              */}
            {salaOnline.show ? (
              <Field
                label="Endereço da sala online"
                name="onlineUrl"
                type="url"
                placeholder="https://sala.exemplo.com/entrar"
                notice={salaOnline.notice}
                hint={salaOnline.hint}
              />
            ) : null}
            <Field label="Cidade" name="city" placeholder="Salvador" />
            <Field label="UF" name="state" placeholder="BA" />
            {/**
              * ───────────────────────────────────────────────────────────────────
              *  UM DIA, COM HORA EXPLÍCITA (FASE 68 · fatia 4)
              * ───────────────────────────────────────────────────────────────────
              *  09:00 → 18:00 no mesmo dia. Os dois valores vêm do MESMO par
              *  (`defaultEventPeriod`), e nenhum deles tem o minuto do render: a única
              *  coisa que o relógio decide aqui é o DIA sugerido.
              */}
            <Field label="Início" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(defaultStart)} />
            <Field
              label="Término"
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={toLocalInput(defaultEnd)}
            />
            <Field label="Fuso horário" name="timezone" required defaultValue="America/Bahia" />
            <Field label="Vagas (vazio = ilimitado)" name="capacity" type="number" min={0} />
            <Field label="Cor principal" name="primaryColor" placeholder="#1d4ed8" hint="Hexadecimal ou oklch()" />
            <Field label="Inscrições abrem em" name="registrationOpensAt" type="datetime-local" />
            <Field label="Inscrições fecham em" name="registrationClosesAt" type="datetime-local" />
            {/**
              * ───────────────────────────────────────────────────────────────────
              *  O INTERRUPTOR DA CHAMADA (FASE 68)
              * ───────────────────────────────────────────────────────────────────
              *  A janela de submissão saiu daqui: ela é da CHAMADA (FASE 33), que tem
              *  tipo, texto, cegueira e limite próprios, e que se cria em
              *  `/chamadas` depois de o evento existir. O que sobra para o evento é o
              *  FATO — ele recebe trabalhos ou não —, e é ele que a prontidão (F53) e
              *  a vitrine leem para distinguir "não usa" de "não configurou".
              */}
            <CheckboxField
              label="Este evento recebe trabalhos"
              name="usesCall"
              hint="Ligue para receber propostas: a janela, a rubrica e as trilhas ficam em “Chamadas de trabalhos”."
            />
            <SelectField label="Situação" name="status" options={STATUS_LABELS} defaultValue="DRAFT" />
            <SelectField label="Modalidade" name="modality" options={EVENT_MODALITY_OPTIONS} defaultValue={modalidadePadrao} />
            <CheckboxField
              label="Exigir vínculo com a instituição para se inscrever"
              name="registrationRequiresMembership"
              hint="Desmarcado, qualquer pessoa com conta pode se inscrever (evento aberto)."
            />
          </div>
        </AdminForm>
      </section>
    </main>
  );
}
