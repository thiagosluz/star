/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LEITURA DO ESTADO DA BARRA LATERAL — servidor (FASE 59)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A LEITURA É DO SERVIDOR, E NÃO UM `useState`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O estado precisa sobreviver à NAVEGAÇÃO. Um `useState` sobrevive até a
 *  próxima rota: o layout é re-renderizado no servidor, o cliente remonta e o
 *  menu volta a abrir sem ninguém ter pedido. O cookie atravessa a navegação
 *  porque quem o lê é o servidor, ANTES de desenhar — e é por isso que as
 *  classes de largura e a presença dos rótulos saem prontas no HTML.
 *
 *  Isso também é o que faz a barra funcionar SEM JavaScript: o botão é um
 *  `<form>` com Server Action, o cookie muda, `revalidatePath` redesenha, e o
 *  navegador não precisou hidratar nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { cookies } from 'next/headers';

import { NAV_MODE_COOKIE, navModeFromValue, type NavMode } from '@/lib/shell/nav-mode';

/**
 * O estado da barra desta requisição.
 *
 * Não lança quando o cookie não existe: ausência é o estado padrão (`full`), e a
 * decisão de qual é o padrão é da regra pura, não desta leitura.
 */
export async function readNavMode(): Promise<NavMode> {
  const cookieStore = await cookies();

  return navModeFromValue(cookieStore.get(NAV_MODE_COOKIE)?.value);
}
