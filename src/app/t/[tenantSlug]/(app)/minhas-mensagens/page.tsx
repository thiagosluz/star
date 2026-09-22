import Link from 'next/link';
import { ArrowLeft, Inbox } from 'lucide-react';

import { requirePersonalPage } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listOwnMessages } from '@/lib/participants/message-service';
import { OwnInbox, type InboxEntry } from '@/components/participants/own-inbox';
import { markMessageReadAction } from '@/app/actions/participant-actions';

export const metadata = { title: 'Minhas mensagens' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MINHAS MENSAGENS — a caixa de entrada do participante (FASE 32)
 *  `/t/<slug>/minhas-mensagens`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PORTA É PESSOAL (E NÃO UMA PERMISSÃO DE INSTITUIÇÃO)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que abre esta tela não é um papel: é a PESSOA. `requirePersonalPage` aceita
 *  qualquer conta com a permissão pessoal básica (`registration:read:own`, que todo
 *  participante tem) e o serviço filtra por `userId` da SESSÃO — quem não tem vínculo
 *  ativo na instituição é redirecionado pelo próprio guarda.
 *
 *  É a mesma decisão do portal do palestrante (FASE 25): a permissão abre a porta, a
 *  POSSE decide o que está atrás dela. Sem isso, um recado dirigido a uma pessoa
 *  ficaria visível para quem tem `participant:read` — que é justamente quem ESCREVE,
 *  não quem recebe.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function MyMessagesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId, tenantName, userId } = await requirePersonalPage({
    tenantSlug,
    permission: PERMISSIONS.REGISTRATION_READ_OWN,
    fallbackPath: '/dashboard',
  });

  const result = await listOwnMessages({ tenantId, userId });

  const entries: InboxEntry[] =
    result.ok === true
      ? result.entries.map((row) => ({
          id: row.id,
          subject: row.subject,
          body: row.body,
          sentAtLabel: row.sentAt.toLocaleString('pt-BR'),
          readAtLabel: row.readAt ? row.readAt.toLocaleDateString('pt-BR') : null,
          eventTitle: row.eventTitle,
          sentByName: row.sentByName,
        }))
      : [];

  return (
    <main className="max-w-3xl space-y-6">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/dashboard')}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Painel
          </Link>
        </nav>

        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Inbox className="size-6 text-primary" aria-hidden />
          Minhas mensagens
        </h1>
        <p className="text-sm text-muted-foreground">
          Os recados que a instituição enviou para você. Eles ficam aqui mesmo que o e-mail não tenha
          chegado.
        </p>
      </header>

      {!result.ok ? (
        <p className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {result.message}
        </p>
      ) : result.entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="inbox-empty">
          Você ainda não recebeu nenhum recado desta instituição.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="inbox-summary">
            {result.entries.length} mensagem(ns) · {result.unread} não lida(s)
          </p>

          <OwnInbox entries={entries} tenantSlug={tenantSlug} action={markMessageReadAction} />
        </>
      )}
    </main>
  );
}
