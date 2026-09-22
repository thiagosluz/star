import Link from 'next/link';
import { ArrowLeft, Award, Layers, Mail, Sparkles, UserRound } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getRequestContext } from '@/lib/auth/session';
import { headers } from 'next/headers';
import { getParticipantProfile } from '@/lib/participants/participant-service';
import { ENGAGEMENT_LABELS, PARTICIPANT_ORIGIN_LABELS } from '@/domain/participants/participant-rules';
import { MessageComposer } from '@/components/participants/message-composer';
import { sendParticipantMessageAction } from '@/app/actions/participant-actions';

export const metadata = { title: 'Ficha do participante' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FICHA DO PARTICIPANTE (FASE 32)
 *  `/t/<slug>/participantes/<userId>`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA MOSTRA, E EM QUE ORDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pergunta de quem abre a ficha é "esta pessoa veio, e o que ela levou daqui?".
 *  Por isso a ordem é: QUEM É (identificação e vínculo) → O QUE VIVEU (números,
 *  eventos e frequência) → O QUE RECEBEU (certificados, cartas, XP) → O QUE NÓS
 *  FALAMOS (mensagens e e-mails).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LEITURA VAI PARA A TRILHA, E A TELA DIZ ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `getParticipantProfile` grava `AuditAction.READ` com o autor. A tela avisa em voz
 *  alta: quem consulta dado pessoal precisa saber que a consulta é um fato
 *  registrado — é o que separa "conferir" de "vasculhar".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AUSÊNCIA DE DADO NÃO É ZERO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Taxa de comparecimento e média de minutos vêm `null` quando não há denominador, e
 *  a tela mostra "—". Inventar "0%" para quem não teve oportunidade é afirmar um fato
 *  que não aconteceu (a mesma regra do ADR-139, do outro lado do balcão).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function ParticipantProfilePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; userId: string }>;
}) {
  const { tenantSlug, userId } = await params;

  const { tenantId, tenantName, userId: actorId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PARTICIPANT_READ,
    fallbackPath: '/participantes',
  });

  const [context, headerList] = await Promise.all([getRequestContext(), headers()]);

  const canMessage =
    can(context?.principal ?? null, PERMISSIONS.PARTICIPANT_MESSAGE, { scope: 'TENANT' }) === true;

  const result = await getParticipantProfile({
    tenantId,
    userId,
    actorId,
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  });

  if (!result.ok) {
    return (
      <main className="max-w-4xl space-y-4">
        <Link
          href={tenantPath(tenantSlug, '/participantes')}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4"
        >
          <ArrowLeft className="size-3" aria-hidden />
          Participantes
        </Link>

        <p className="rounded-lg border border-border bg-card p-6 text-sm" data-testid="profile-not-found">
          {result.message}
        </p>
      </main>
    );
  }

  const { profile } = result;

  return (
    <main className="max-w-5xl space-y-6" data-testid="participant-profile">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/participantes')}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Participantes
          </Link>
        </nav>

        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <UserRound className="size-6 text-primary" aria-hidden />
          {profile.name}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="profile-identity">
          {profile.email} · {PARTICIPANT_ORIGIN_LABELS[profile.origin]}
          {profile.profile ? ` · vínculo ${profile.profile.status.toLowerCase()}` : ''}
          {profile.isPublicProfile ? ' · autoriza o nome no resultado público' : ' · nome mascarado no resultado público'}
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {profile.engagement.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground"
            >
              {ENGAGEMENT_LABELS[tag]}
            </li>
          ))}
        </ul>
      </header>

      {/* ── Números ───────────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="profile-totals">
        <Stat label="Eventos" value={String(profile.totals.events)} hint={`${profile.totals.attendedEvents} com presença`} />
        <Stat
          label="Comparecimento"
          value={profile.totals.rate.hasData ? `${profile.totals.rate.percent}%` : '—'}
          hint={`${profile.totals.attended} de ${profile.totals.confirmed} confirmadas`}
        />
        <Stat
          label="Frequência"
          value={`${profile.totals.minutes} min`}
          hint={
            profile.totals.averageMinutes !== null
              ? `${profile.totals.visits} visita(s) · média ${profile.totals.averageMinutes} min`
              : 'nenhuma visita registrada'
          }
        />
        <Stat
          label="Entrega"
          value={`${profile.totals.certificates} certificado(s)`}
          hint={
            profile.totals.coverage !== null
              ? `cobre ${profile.totals.coverage}% dos eventos com presença`
              : 'sem evento com presença'
          }
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="Cartas" value={String(profile.totals.cards)} hint="cartas conquistadas" />
        <Stat label="XP" value={String(profile.totals.xp)} hint={`nível ${profile.totals.level}`} />
        <Stat
          label="Comunicação"
          value={`${profile.totals.messages} recado(s)`}
          hint={`${profile.totals.unreadMessages} não lido(s) · ${profile.totals.emails} e-mail(s)`}
        />
      </section>

      {/* ── Recado ────────────────────────────────────────────────────────────── */}
      {canMessage ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="profile-messaging">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="size-4 text-primary" aria-hidden />
            Enviar recado para {profile.name}
          </h2>
          <MessageComposer
            tenantSlug={tenantSlug}
            userIds={[profile.userId]}
            action={sendParticipantMessageAction}
            label="Enviar recado"
          />
        </section>
      ) : null}

      {/* ── Eventos ───────────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Eventos e atividades</h2>

        {profile.events.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Esta pessoa ainda não tem inscrição nesta instituição.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm" data-testid="profile-events">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Evento</th>
                  <th className="px-3 py-2 text-left">Inscrição</th>
                  <th className="px-3 py-2 text-left">Presença</th>
                  <th className="px-3 py-2 text-left">Minutos</th>
                </tr>
              </thead>
              <tbody>
                {profile.events.map((row, index) => (
                  <tr key={`${row.eventId}-${row.activityTitle ?? 'evento'}-${index}`} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.startsAt.toLocaleDateString('pt-BR')}
                        {row.activityTitle ? ` · ${row.activityTitle}` : ' · inscrição no evento'}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.registrationStatus.toLowerCase()}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.checkedInAt ? row.checkedInAt.toLocaleDateString('pt-BR') : '—'}
                      {row.visits > 0 ? ` · ${row.visits} visita(s)` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.minutes > 0 ? `${row.minutes} min` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Certificados, cartas e XP ─────────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Award className="size-4 text-primary" aria-hidden />
            Certificados
          </h2>

          {profile.certificates.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Nenhum certificado emitido para esta pessoa.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="profile-certificates">
              {profile.certificates.map((row) => (
                <li key={row.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="font-medium">{row.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.eventTitle ?? '—'}
                    {row.activityTitle ? ` · ${row.activityTitle}` : ''} · {row.status.toLowerCase()}
                    {row.workloadMinutes ? ` · ${row.workloadMinutes} min` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">Código {row.validationCode}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="size-4 text-primary" aria-hidden />
            Cartas e XP
          </h2>

          {profile.cards.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Nenhuma carta conquistada.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="profile-cards">
              {profile.cards.map((row) => (
                <li key={row.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="font-medium">
                    {row.name} {row.isFoil ? '· foil' : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.rarity.toLowerCase()} · {row.quantity} cópia(s) · {row.eventTitle ?? '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {profile.xpRecent.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground" data-testid="profile-xp">
              {profile.xpRecent.slice(0, 8).map((row) => (
                <li key={row.id} className="flex items-center gap-2">
                  <Sparkles className="size-3" aria-hidden />
                  {row.amount > 0 ? '+' : ''}
                  {row.amount} XP · {row.reason} · {row.createdAt.toLocaleDateString('pt-BR')}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {/* ── Comunicação ───────────────────────────────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Recados enviados</h2>

          {profile.messages.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Nenhum recado enviado a esta pessoa.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="profile-messages">
              {profile.messages.map((row) => (
                <li key={row.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="font-medium">{row.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.sentAt.toLocaleString('pt-BR')}
                    {row.sentByName ? ` · ${row.sentByName}` : ''} ·{' '}
                    {row.readAt ? `lido em ${row.readAt.toLocaleDateString('pt-BR')}` : 'não lido'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-semibold">E-mails da plataforma</h2>

          {profile.emails.length === 0 ? (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              Nenhum e-mail registrado para esta pessoa.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="profile-emails">
              {profile.emails.map((row) => (
                <li key={row.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="font-medium">{row.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.to} · {row.template.toLowerCase()} · {row.status.toLowerCase()}
                    {row.sentAt ? ` · ${row.sentAt.toLocaleString('pt-BR')}` : ''}
                  </p>
                  {row.error ? <p className="text-xs text-destructive">{row.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        A abertura desta ficha foi registrada na trilha de auditoria com o seu nome e o instante da
        consulta.
      </p>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

