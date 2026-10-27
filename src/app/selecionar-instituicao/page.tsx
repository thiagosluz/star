import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { signOutAction } from '@/app/actions/auth-actions';
import { PageHeader } from '@/components/ui';
import { TenantSwitcher } from '@/components/tenancy/tenant-switcher';
import { ENTRY_DISCOVERY_PATH } from '@/domain/platform/entry-destination-rules';
import { tenantDashboardPath } from '@/domain/platform/vitrine-account-rules';

export const metadata = { title: 'Selecionar instituição' };

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  O RÓTULO DIZ O DESTINO (FASE 82 · fatia 3)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aqui havia "Página inicial" apontando para `/` — e `/` é a VITRINE da
 *  plataforma desde a F75, que não redireciona mais ninguém. Com UM vínculo a
 *  linha do seletor é um `<span>` "Contexto atual" (ver `tenant-switcher.tsx`),
 *  não um botão: a tela inteira não oferecia um único caminho para o painel. O
 *  rótulo antigo mentia duas vezes — no nome e no endereço —, então ele passa a
 *  nomear o que o link faz.
 */
const PANEL_LINK_LABEL = 'Ir ao painel da instituição';

/**
 * O rótulo do caminho de quem ainda não tem painel.
 *
 * É o nome da tela de destino (`/eventos` se apresenta como "Explore eventos e
 * instituições"), e não um "voltar" genérico: quem não tem vínculo precisa saber
 * que há algo para FAZER dali — encontrar um evento e se inscrever, inscrição que
 * cria justamente o vínculo que falta.
 */
const DISCOVERY_LINK_LABEL = 'Explorar eventos';

/**
 * Seletor de instituição.
 *
 * Ponto de encontro de um usuário multi-instituição: mostra todos os vínculos
 * e permite entrar em cada um sem novo login. Também é a tela do convite
 * pendente — por isso ela NÃO virou um redirect puro na FASE 82: quem foi
 * convidado precisa vê-lo aqui para aceitá-lo.
 */
export default async function SelectTenantPage() {
  const context = await getRequestContext();

  if (!context) {
    redirect('/login');
  }

  const { user, memberships, activeTenant } = context;

  if (memberships.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
        <PageHeader
          title="Nenhuma instituição vinculada"
          icon={<Building2 className="size-6 text-muted-foreground" aria-hidden />}
          description="Sua conta ainda não está ligada a nenhuma instituição. Peça um convite ao organizador do evento, ou aguarde a aprovação do seu cadastro."
        />

        {/**
         * ─────────────────────────────────────────────────────────────────────────
         *  SEM VÍNCULO, A SAÍDA É A DESCOBERTA — E NÃO "SAIR DA CONTA" (FASE 82)
         * ─────────────────────────────────────────────────────────────────────────
         *  Este ramo só oferecia o botão de sair: uma pessoa autenticada, sem
         *  vínculo, com uma única porta que a DESLOGAVA. `/eventos` é público,
         *  entrega descoberta e inscrição, e a inscrição pública cria o vínculo
         *  `ACTIVE` que esta tela diz estar faltando — é o degrau 5 da regra de
         *  entrada (`resolveEntryDestination`), e a tela precisa oferecer o MESMO
         *  destino que a entrada escolheu.
         */}
        <footer className="flex items-center justify-between gap-4 text-sm">
          <Link
            href={ENTRY_DISCOVERY_PATH}
            className="text-muted-foreground underline underline-offset-4"
          >
            {DISCOVERY_LINK_LABEL}
          </Link>

          <form action={signOutAction}>
            <button
              type="submit"
              className="text-muted-foreground underline underline-offset-4"
            >
              Sair da conta
            </button>
          </form>
        </footer>
      </main>
    );
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  DOIS CASOS, DOIS DESTINOS — E NUNCA `/dashboard` CRU (FASE 82 · fatia 3)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Com vínculo ATIVO, o caminho é o painel da instituição ATIVA, montado por
   *  `tenantDashboardPath` — o mesmo `/t/<slug>/dashboard` que o redirect de
   *  entrada e o CTA "Minha área" usam. O literal `/dashboard` sozinho responde
   *  404 no proxy quando não há host de instituição (`proxy.ts`), e o endereço
   *  por path é o que funciona em desenvolvimento e nos testes.
   *
   *  Sem vínculo ATIVO (só convite pendente), não existe painel para onde ir: o
   *  seletor continua sendo onde o convite aparece, mas o link de saída aponta
   *  para a descoberta — o mesmo `/eventos` do ramo acima.
   */
  const exitLink = activeTenant
    ? { href: tenantDashboardPath(activeTenant.tenantSlug), label: PANEL_LINK_LABEL }
    : { href: ENTRY_DISCOVERY_PATH, label: DISCOVERY_LINK_LABEL };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
      <PageHeader
        title={`Olá, ${user.name.split(' ')[0]}`}
        description={
          <>
            Você tem acesso a {memberships.length}{' '}
            {memberships.length === 1 ? 'instituição' : 'instituições'}. Escolha onde deseja
            trabalhar — você pode trocar a qualquer momento sem sair da conta.
          </>
        }
      />

      <TenantSwitcher
        options={memberships}
        currentSlug={activeTenant?.tenantSlug ?? null}
        redirectTo="/dashboard"
      />

      <footer className="flex items-center justify-between text-sm">
        <Link
          href={exitLink.href}
          className="text-muted-foreground underline underline-offset-4"
        >
          {exitLink.label}
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-muted-foreground underline underline-offset-4"
          >
            Sair da conta
          </button>
        </form>
      </footer>
    </main>
  );
}
