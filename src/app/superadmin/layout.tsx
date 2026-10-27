import type { Metadata } from 'next';

import { AccountBlock } from '@/components/shell/account-block';
import { AppShell } from '@/components/shell/app-shell';
import { buildPlatformNav, PLATFORM_NAV_GROUP } from '@/components/shell/tenant-nav';
import { loadMemberships } from '@/lib/auth/session';
import { requirePlatformPermission } from '@/lib/platform/guard';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LAYOUT DO PAINEL DE PLATAFORMA — `/superadmin` (FASE 11A: shell do sistema)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA FICA NO LAYOUT, NÃO EM CADA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma rota nova dentro de `/superadmin` nasce protegida — não há como esquecer a
 *  checagem, porque ela não é escrita de novo em lugar nenhum. Foi o mesmo
 *  raciocínio da RLS: a garantia tem que estar no caminho, não na disciplina de
 *  quem escreve a próxima tela.
 *
 *  A resposta é 404 (`notFound()`), e não 403: um 403 confirmaria a existência do
 *  painel para quem não pode vê-lo. Ver `guard.ts`.
 *
 *  Desde a FASE 11A este painel usa o MESMO shell do painel da instituição, com o
 *  acento de plataforma. Governança e operação serem o mesmo produto não é
 *  detalhe estético: é o que permite aprender a interface uma vez só.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: 'Governança da plataforma',
  robots: { index: false, follow: false },
};

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const operator = await requirePlatformPermission();

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  A PORTA DE VOLTA DO OPERADOR (FASE 82 · fatia 3)
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O BECO QUE ESTE BLOCO FECHA
   * ─────────────────────────────────────────────────────────────────────────────
   *  O `AccountBlock` era montado SEM `memberships`, e o valor ausente apagava o
   *  menu de conta inteiro. Quem entrava direto em `/superadmin` ficava sem
   *  caminho para `/conta` e sem caminho de volta para a instituição: a única
   *  saída era o botão de sair ou digitar a URL de novo. O bloco de conta é o
   *  único lugar do produto que existe em TODAS as telas — é dele que essa porta
   *  tem de sair.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE A LEITURA ACONTECE AQUI, E NÃO EM `getRequestContext()`
   * ─────────────────────────────────────────────────────────────────────────────
   *  `loadMemberships` é o MESMO leitor que a casca da instituição já usa (ela o
   *  alcança por `getRequestContext()`), e roda UMA vez por render de página de
   *  plataforma — no layout, nunca no corpo de cada tela e nunca no caminho de
   *  toda página de instituição. O que NÃO se paga é a leitura do caminho
   *  inverso (levar o flag de plataforma para o render de toda página da
   *  instituição): isso custaria uma consulta administrativa em cada render do
   *  produto, e é a razão pela qual o link "Painel da plataforma" dentro da
   *  área da instituição fica FORA desta fase (declarado no documento dela).
   *
   *  Não há consulta nova de espécie nenhuma: `loadMemberships` já é a leitura
   *  canônica dos vínculos do usuário, escopada pelo `userId` da sessão, e é o
   *  que o `switchTenantAction` usa para validar uma troca. A alternativa —
   *  abrir uma segunda consulta administrativa só para esta tela — seria a
   *  duplicata que a casa evita.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE SEM `currentSlug`
   * ─────────────────────────────────────────────────────────────────────────────
   *  O operador não está "dentro" de instituição nenhuma: ele está na governança.
   *  Sem slug atual, o `TenantMenu` lista TODOS os vínculos como botão (a linha
   *  inteira, com o nome da instituição — inclusive quando há um só) — é o
   *  caminho direto de volta para `/t/<slug>/dashboard`, pelo mesmo
   *  `switchTenantAction` de sempre.
   */
  const memberships = await loadMemberships(operator.userId);

  return (
    <AppShell
      variant="platform"
      brand={{ label: 'EventFlow', tagline: 'Governança da plataforma' }}
      context={{ name: PLATFORM_NAV_GROUP, detail: operator.email, testId: 'platform-operator' }}
      navGroups={buildPlatformNav()}
      account={
        <AccountBlock
          user={{ name: operator.name, email: operator.email }}
          memberships={memberships}
        />
      }
    >
      {children}
    </AppShell>
  );
}
