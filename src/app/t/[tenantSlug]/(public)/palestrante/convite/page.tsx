import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Mic, ShieldCheck } from 'lucide-react';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getTenantContext } from '@/lib/events/event-repository';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { loadSpeakerPendingInvites } from '@/lib/speakers/speaker-portal-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { PageHeader } from '@/components/ui';
import { ClaimInviteForm } from '@/components/speakers/portal-forms';
import { claimSpeakerInviteAction } from '@/app/actions/speaker-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ACEITE DO CONVITE DE PALESTRANTE (FASE 25)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA ROTA NÃO ESTÁ DENTRO DO SHELL AUTENTICADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem vai aceitar o convite, muitas vezes, NÃO tem vínculo com a instituição —
 *  é o convidado externo, que acabou de criar a conta. O layout de `/t/<slug>/(app)`
 *  exige vínculo ATIVO (e redireciona para "selecionar instituição" sem ele), então
 *  o formulário de aceite dentro do portal criaria um impasse: sem vínculo não se
 *  aceita o convite, e sem aceitar o convite não se ganha o vínculo.
 *
 *  Aqui a prova é o CÓDIGO (ou o e-mail cadastrado pela organização), conferida no
 *  servidor contra o hash gravado — e o vínculo nasce COMO CONSEQUÊNCIA do aceite.
 *
 *  A página é pública porque o convite é que autoriza; exige apenas estar
 *  autenticado, e diz isso a quem chega deslogado, preservando o destino.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOPO VEM DO `PageHeader` — E SEM `eyebrow` DE INSTITUIÇÃO (FASE 78 · fatia 4)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O nome da instituição era um `<p>` acima do título; ele sai, porque o
 *  `PublicHeader` da casca já mostra a casa — e o convite é sobre o que a PESSOA
 *  ganha ao aceitar, não sobre quem convidou. Título, ícone e descrição cabem nos
 *  slots do componente, e o `data-testid` do código (`invite-code-present`)
 *  continua na página porque ele é ESTADO do convite, não topo.
 *
 *  De quebra, a descrição deixou de ser `opacity-80` e passou ao token de tinta
 *  secundária: `opacity` COMPÕE o texto com o fundo (foi o defeito de contraste
 *  medido na F67), enquanto `text-muted-foreground` escolhe uma cor de texto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Convite de palestrante' };

export default async function SpeakerInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ codigo?: string }>;
}) {
  const { tenantSlug } = await params;
  const { codigo } = await searchParams;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const user = await getAuthenticatedUser();
  const portalHref = tenantPath(tenantSlug, '/palestrante');
  const here = tenantPath(tenantSlug, '/palestrante/convite');

  const token = codigo?.trim() ?? '';

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  QUEM JÁ TEM CONTA NÃO PRECISA TER GUARDADO O CÓDIGO (revisão da FASE 25)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A lista de convites é montada pelo E-MAIL DA CONTA, não pelo código: quem foi
   *  convidado e já tinha conta (ou acabou de criar uma) vê o convite esperando por
   *  ele. É esta rota, e não o portal, que atende quem ainda NÃO tem vínculo com a
   *  instituição — o vínculo nasce do aceite.
   */
  const pendingInvites = user
    ? await loadSpeakerPendingInvites({ tenantId: tenant.tenantId, userEmail: user.email })
    : [];

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <PageHeader
        title="Convite de palestrante"
        icon={<Mic className="size-6" aria-hidden />}
        description="A organização cadastrou você como palestrante. Ao aceitar, você passa a editar seu perfil público, publicar materiais das atividades que ministra e emitir seu certificado."
      />

      {!user ? (
        <div className="ef-card space-y-3 p-5">
          <p className="font-medium">Entre na sua conta para aceitar</p>
          <p className="text-sm opacity-75">
            Use a conta do e-mail que recebeu o convite. Se ainda não tem conta, crie uma agora — o
            convite continua valendo depois.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/login?redirectTo=${encodeURIComponent(`${here}${token ? `?codigo=${token}` : ''}`)}`}
              className="ef-button"
            >
              Entrar e continuar
            </Link>
            <Link
              href={`/signup?redirectTo=${encodeURIComponent(`${here}${token ? `?codigo=${token}` : ''}`)}`}
              className="ef-button-outline"
            >
              Criar conta
            </Link>
          </div>
        </div>
      ) : (
        <>
          {token ? (
            <p className="flex items-center gap-2 text-xs opacity-70" data-testid="invite-code-present">
              <ShieldCheck className="size-3.5" aria-hidden />
              Código recebido. Confirme abaixo para assumir o perfil.
            </p>
          ) : null}

          <ClaimInviteForm
            tenantSlug={tenantSlug}
            pendingInvites={pendingInvites.map((invite) => ({
              ...invite,
              inviteExpiresAt: invite.inviteExpiresAt?.toISOString() ?? null,
            }))}
            action={claimSpeakerInviteAction}
            defaultToken={token}
            redirectTo={portalHref}
          />
        </>
      )}
    </main>
  );
}
