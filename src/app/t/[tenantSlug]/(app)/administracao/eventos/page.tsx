import Link from 'next/link';
import { CalendarPlus, Plus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Eventos' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GESTÃO DE EVENTOS DA INSTITUIÇÃO — `/t/<slug>/administracao/eventos`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LISTA É O ACERVO; O CADASTRO TEM ROTA PRÓPRIA (FASE 90)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 89, esta página misturava a listagem de eventos com o formulário de
 *  criação de 17 campos em um mesmo documento. O acervo e o cadastro competiam por
 *  atenção, e com vários eventos cadastrados o formulário ficava empurrado para o fim.
 *
 *  A FASE 90 separou as duas intenções:
 *    • `/administracao/eventos` é o cockpit de consulta e acesso rápido aos eventos;
 *    • `/administracao/eventos/novo` é a página dedicada de cadastro do novo evento;
 *    • O botão "Novo evento" vive no slot `actions` do `PageHeader`.
 * ═══════════════════════════════════════════════════════════════════════════════
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

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Eventos"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<CalendarPlus className="size-6 text-primary" aria-hidden />}
        description="O evento é a raiz de tudo: atividades, salas, chamada de trabalhos, inscrições e certificados pertencem a ele."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos' },
        ]}
        actions={
          <Link
            href={tenantPath(tenantSlug, '/administracao/eventos/novo')}
            data-testid="btn-novo-evento"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden />
            Novo evento
          </Link>
        }
      />

      <section className="space-y-3" aria-labelledby="lista-eventos">
        <h2 id="lista-eventos" className="text-lg font-semibold tracking-tight text-foreground">
          Eventos da instituição
        </h2>

        {events.length === 0 ? (
          <div
            className="space-y-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="events-empty"
          >
            <p>
              Nenhum evento cadastrado.{' '}
              <Link
                href={tenantPath(tenantSlug, '/administracao/eventos/novo')}
                className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
              >
                Cadastre o primeiro evento
              </Link>{' '}
              para começar.
            </p>
            {/**
             * ─────────────────────────────────────────────────────────────────────
             *  A PORTA PARA O EXEMPLO (FASE 77 · fatia 3)
             * ─────────────────────────────────────────────────────────────────────
             *  O organizador novo chega nesta tela com a lista vazia e sem saber
             *  como é um evento por dentro. O exemplo é a resposta barata: uma tela
             *  de LEITURA com dados fictícios, que não cria nada, não consome a
             *  quota e não deixa lixo para apagar (o porquê está no documento da
             *  fatia). O link fica AQUI, no estado vazio, e não no menu: ele é uma
             *  ajuda para quem está começando, não uma área do produto.
             */}
            <p>
              <Link
                href={tenantPath(tenantSlug, '/exemplo')}
                data-testid="events-empty-demo-link"
                className="font-medium text-brand underline underline-offset-4"
              >
                Ver um evento de exemplo, sem cadastrar nada
              </Link>{' '}
              — dados fictícios, nada é gravado.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="admin-event-list">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{event.title}</p>
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
    </main>
  );
}
