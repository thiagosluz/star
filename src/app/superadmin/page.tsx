import { redirect } from 'next/navigation';

/**
 * Entrada do painel.
 *
 * O painel abre nas MÉTRICAS consolidadas, que é a primeira pergunta de quem
 * governa ("como está a plataforma?"), e não na lista de instituições. O
 * redirecionamento mantém `/superadmin` como endereço memorizável sem duplicar a
 * tela: uma segunda cópia da visão geral divergiria da primeira no primeiro
 * ajuste.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ONDE FICA A ENTRADA DA FILA DE DENÚNCIAS (FASE 56 · dívida E62)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Em `/superadmin/metricas` — o destino deste redirecionamento —, como atalho com
 *  a contagem de denúncias abertas, e na navegação da plataforma (item "Denúncias"),
 *  que aparece em todas as telas do painel.
 *
 *  Aqui não há cartão porque aqui não há TELA: um redirecionamento não desenha nada,
 *  e transformar esta página numa segunda visão geral para caber um cartão é
 *  exatamente o que o parágrafo acima recusa.
 */
export default function SuperAdminIndexPage() {
  redirect('/superadmin/metricas');
}
