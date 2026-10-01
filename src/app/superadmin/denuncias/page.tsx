import Link from 'next/link';
import { EyeOff, Flag, ShieldCheck } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/platform/guard';
import { listModerationQueue } from '@/lib/platform/profile-moderation';
import { ModerationDecisionForm } from '@/components/platform/moderation-decision-form';
import { Alert, Badge, Card, EmptyState, PageHeader, SectionHeading, StatCard } from '@/components/ui';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  PROFILE_REPORT_CATEGORIES,
  PROFILE_REPORT_CATEGORY_LABELS,
  PROFILE_REPORT_CATEGORY_MEANINGS,
  profileModerationEffect,
} from '@/domain/profile/profile-moderation-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FILA DE DENÚNCIAS DE PERFIL — `/superadmin/denuncias` (FASE 56 · dívida E62)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FILA É DA PLATAFORMA, E NÃO DA INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A denúncia nasce com a casa em que a pessoa estava, mas o `@handle` é GLOBAL: o
 *  mesmo perfil aparece em todas as instituições. Decidir casa a casa faria o mesmo
 *  conteúdo ser julgado de formas diferentes — e quem foi ocultado numa continuaria
 *  publicado na vizinha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FILA MOSTRA O EFEITO ANTES DA DECISÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada cartão diz, embaixo dos botões, o que CADA ação faz — a consequência vem do
 *  domínio (`profileModerationEffect`), a mesma frase que o serviço aplica. Botão de
 *  moderação sem consequência escrita é o que transforma uma decisão grave em clique.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA FUNCIONA SEM JAVASCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O campo da nota e o botão que nomeia a ação são um `<form>` com `formAction` de
 *  Server Action: com o JavaScript desligado o envio acontece do mesmo jeito, e a
 *  página volta redesenhada pelo `revalidatePath`. O `useActionState` do componente
 *  só ACRESCENTA a resposta em linha.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

function formatMoment(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ');
}

export default async function ProfileModerationPage() {
  await requirePlatformPermission();

  const queue = await listModerationQueue({ limit: 100 });

  if (!queue.ok) {
    return (
      <div className="space-y-8" data-testid="moderation-queue">
        <PageHeader
          title="Denúncias de perfil"
          description="Denúncias de perfis públicos aguardando decisão da plataforma."
          breadcrumbs={[{ label: 'Plataforma' }, { label: 'Denúncias' }]}
          badge={<Badge tone="primary">SuperAdmin</Badge>}
        />

        <Alert tone="danger" title="Não foi possível carregar a fila" data-testid="moderation-error">
          {queue.message}
        </Alert>
      </div>
    );
  }

  const { items, summary } = queue;

  return (
    <div className="space-y-8" data-testid="moderation-queue">
      <PageHeader
        title="Denúncias de perfil"
        description="Denúncias abertas contra perfis públicos. A decisão é da PLATAFORMA porque o @handle é o mesmo em todas as instituições — e o efeito vale para todas elas."
        breadcrumbs={[{ label: 'Plataforma' }, { label: 'Denúncias' }]}
        badge={<Badge tone="primary">SuperAdmin</Badge>}
        actions={
          <p className="text-xs text-muted-foreground" data-testid="moderation-generated-at">
            Consulta em {formatMoment(new Date())} UTC
          </p>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Aguardando decisão"
          value={summary.total}
          hint={summary.total > 0 ? 'Da mais antiga para a mais nova' : 'Nenhuma denúncia aberta'}
          icon={<Flag className="size-4" aria-hidden />}
          tone={summary.total > 0 ? 'warning' : 'neutral'}
          data-testid="moderation-total"
          data-value={summary.total}
        />

        {/**
         * O resumo conta TODAS as abertas, e não só as que couberam na página: zero é
         * uma contagem e aparece (a régua da FASE 54) — quem opera precisa saber o que
         * NÃO está chegando, e não apenas o que chegou.
         */}
        {PROFILE_REPORT_CATEGORIES.map((category) => (
          <StatCard
            key={category}
            label={PROFILE_REPORT_CATEGORY_LABELS[category]}
            value={summary.byCategory[category]}
            hint={PROFILE_REPORT_CATEGORY_MEANINGS[category]}
            icon={<ShieldCheck className="size-4" aria-hidden />}
            data-testid={`moderation-count-${category}`}
            data-value={summary.byCategory[category]}
          />
        ))}
      </section>

      {items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nenhuma denúncia aguardando decisão"
          description="Quando alguém denunciar um perfil público pela página dele, a denúncia aparece aqui — da mais antiga para a mais nova, com o motivo e quem relatou."
          data-testid="moderation-empty"
        />
      ) : (
        <section className="space-y-4" data-testid="moderation-list">
          <SectionHeading
            title="Denúncias abertas"
            description="A justificativa é obrigatória nos dois desfechos: quem auditar precisa ler o MOTIVO da decisão, e não apenas o resultado dela."
          />

          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.reportId}>
                <Card className="space-y-4 p-5" data-testid={`moderation-report-${item.reportId}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="warning" size="sm">
                          {PROFILE_REPORT_CATEGORY_LABELS[item.category]}
                        </Badge>
                        {item.reported.isHidden ? (
                          <Badge tone="danger" size="sm" withDot data-testid={`moderation-hidden-${item.reportId}`}>
                            <EyeOff className="mr-1 size-3" aria-hidden />
                            perfil já oculto
                          </Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          aberta em {formatMoment(item.createdAt)} UTC
                        </span>
                      </div>

                      <p className="text-sm">
                        <span className="font-medium text-foreground">{item.reported.name}</span>{' '}
                        {item.reported.handle ? (
                          <Link
                            href={tenantPath(item.origin.slug, `/u/${item.reported.handle}`)}
                            className="code-data text-xs underline underline-offset-4"
                          >
                            @{item.reported.handle}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">sem @handle público</span>
                        )}
                      </p>

                      <p className="text-xs text-muted-foreground">
                        denunciado por <span className="text-foreground">{item.reporter.name}</span> · vista em{' '}
                        <span className="text-foreground">{item.origin.name}</span>{' '}
                        <span className="code-data">({item.origin.slug})</span>
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-surface-low p-3" data-testid={`moderation-details-${item.reportId}`}>
                    <p className="label-caps">O que foi relatado</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {item.details.length > 0 ? item.details : 'Sem detalhes — a categoria escolhida diz o motivo.'}
                    </p>
                  </div>

                  {/**
                   * O perfil já oculto continua na fila: a denúncia aberta ainda precisa
                   * de decisão registrada (é ela que diz se a medida foi por causa
                   * DESTE relato). Os botões aparecem porque o serviço decide a
                   * denúncia, não o estado do perfil.
                   */}
                  <div className="space-y-3 border-t border-border pt-4">
                    <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <p>
                        <span className="text-foreground">Dispensar</span> —{' '}
                        {profileModerationEffect('DISMISS')}
                      </p>
                      <p>
                        <span className="text-foreground">Ocultar</span> — {profileModerationEffect('HIDE')}
                      </p>
                    </div>

                    <ModerationDecisionForm
                      reportId={item.reportId}
                      reportedName={item.reported.name}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length > 0 && summary.total > items.length ? (
        /**
         * O que a tela esconde, ela anuncia (a lição da FASE 50): a fila mostra as 100
         * mais antigas, e deixar isso implícito faria o operador acreditar que decidiu
         * tudo quando ainda há trabalho atrás.
         */
        <Alert tone="info" title="Há mais denúncias do que esta página mostra" data-testid="moderation-truncated">
          Esta lista traz as {items.length} denúncias abertas mais antigas, de {summary.total}. Decida estas
          para que as próximas apareçam.
        </Alert>
      ) : null}

      <footer className="flex items-start gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
        <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p>
          Ocultar um perfil NÃO apaga a conta nem o @handle: a pessoa continua existindo na plataforma, e o
          perfil público sai do ar em todas as instituições. A decisão fica registrada na trilha de
          plataforma, em Auditoria.
        </p>
      </footer>
    </div>
  );
}
