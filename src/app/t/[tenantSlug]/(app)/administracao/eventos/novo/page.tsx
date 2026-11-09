import type { Metadata } from 'next';
import { CalendarPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
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
import { EVENT_CATEGORY_OPTIONS } from '@/domain/events/event-category-rules';
import { toLocalInput } from '@/lib/events/activity-presentation';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata: Metadata = { title: 'Novo evento' };
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CADASTRO DE NOVO EVENTO — `/t/<slug>/administracao/eventos/novo` (FASE 90)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA DEDICADA, E NÃO MODAL NEM NA LISTAGEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 89, o formulário de 17 campos convivia na mesma tela da lista de
 *  eventos (`/administracao/eventos`). Quando uma instituição acumula eventos,
 *  o formulário competia com o acervo e ficava empurrado para o rodapé.
 *
 *  A criação de evento é um ato de foco: exige datas, modalidade, fuso, URLs e
 *  regras de inscrição. Uma página dedicada oferece espaço adequado (grid de 2
 *  colunas), sem risco de perda de dados acidental por clique fora (risco de modal),
 *  com breadcrumbs semânticos e retorno nativo pelo PageHeader.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function NewAdminEventPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const { startsAt: defaultStart, endsAt: defaultEnd } = defaultEventPeriod(new Date());
  const modalidadePadrao: EventModalityValue = 'IN_PERSON';
  const salaOnline = onlineRoomFieldVisibility({ modality: modalidadePadrao });

  return (
    <main className="max-w-4xl space-y-8">
      <PageHeader
        title="Cadastrar novo evento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<CalendarPlus className="size-6 text-primary" aria-hidden />}
        description="Defina as informações básicas do evento. Após a criação, você poderá configurar a programação, salas, palestrantes, formulários e certificados."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: 'Novo evento' },
        ]}
      />

      <section className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm" aria-labelledby="novo-evento">
        <h2 id="novo-evento" className="text-base font-semibold tracking-tight text-foreground">
          Dados do evento
        </h2>

        <AdminForm
          action={saveEventAction}
          submitLabel="Criar evento"
          testId="create-event"
          backHref={tenantPath(tenantSlug, '/administracao/eventos')}
          backLabel="Ver eventos"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Identificador (URL)" name="slug" required placeholder="congresso-2027" />
            <Field label="Título" name="title" required placeholder="Congresso de Tecnologia 2027" />
            <Field label="Resumo" name="summary" placeholder="Uma linha sobre o evento" />
            <Field label="Local" name="venueName" placeholder="Centro de Convenções" />

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

            <Field
              label="Início"
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={toLocalInput(defaultStart)}
            />
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

            <CheckboxField
              label="Este evento recebe trabalhos"
              name="usesCall"
              hint="Ligue para receber propostas: a janela, a rubrica e as trilhas ficam em “Chamadas de trabalhos”."
            />
            <SelectField label="Situação" name="status" options={STATUS_LABELS} defaultValue="DRAFT" />
            <SelectField label="Modalidade" name="modality" options={EVENT_MODALITY_OPTIONS} defaultValue={modalidadePadrao} />
            <SelectField
              label="Categoria temática"
              name="category"
              options={[{ value: '', label: 'Sem categoria específica' }, ...EVENT_CATEGORY_OPTIONS]}
              defaultValue=""
            />
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

