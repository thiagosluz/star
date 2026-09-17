import { redirect } from 'next/navigation';

/**
 * Entrada do painel.
 *
 * O painel abre nas MÉTRICAS consolidadas, que é a primeira pergunta de quem
 * governa ("como está a plataforma?"), e não na lista de instituições. O
 * redirecionamento mantém `/superadmin` como endereço memorizável sem duplicar a
 * tela: uma segunda cópia da visão geral divergiria da primeira no primeiro
 * ajuste.
 */
export default function SuperAdminIndexPage() {
  redirect('/superadmin/metricas');
}
