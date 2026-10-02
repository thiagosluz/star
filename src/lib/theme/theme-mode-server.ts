/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LEITURA DO TEMA — servidor (FASE 61 · dívida H3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A LEITURA É DO SERVIDOR, E NÃO UM SCRIPT NO `<head>`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O jeito clássico de evitar o "flash" de tema é um script inline que lê o
 *  `localStorage` e escreve a classe antes da primeira pintura. Ele funciona — e
 *  falha exatamente onde este produto não pode falhar: o HTML que o servidor
 *  entrega (o que o E2E, o cache de borda e o leitor de tela enxergam primeiro)
 *  traz a página CLARA, e a decisão só existe depois que o JavaScript roda. Sem
 *  JavaScript — que é como o sistema inteiro foi desenhado nas FASE 38/39/59 — a
 *  escolha simplesmente não aconteceria.
 *
 *  Aqui o cookie é lido ANTES de a marcação nascer: o `<html>` já sai da primeira
 *  resposta com a classe certa, e não há instante em que a página esteja errada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UMA LEITURA SÓ, DEDUPLICADA PELO PRÓPRIO `cookies()`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O layout raiz e o controle de tema leem o MESMO cookie na MESMA requisição. O
 *  `cookies()` do Next é memoizado por requisição, então isso não é uma segunda
 *  ida ao navegador — é o mesmo valor, e não há caminho para as duas leituras
 *  discordarem (o defeito de ter duas fontes para a mesma verdade).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { cookies } from 'next/headers';

import { THEME_COOKIE, themeModeFromValue, type ThemeMode } from '@/lib/theme/theme-mode';

/**
 * O tema desta requisição.
 *
 * Não lança quando o cookie não existe: ausência é o estado padrão (`sistema`), e a
 * decisão de qual é o padrão é da regra pura, não desta leitura.
 */
export async function readThemeMode(): Promise<ThemeMode> {
  const cookieStore = await cookies();

  return themeModeFromValue(cookieStore.get(THEME_COOKIE)?.value);
}
