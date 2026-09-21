/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BASE PÚBLICA DA APLICAÇÃO
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU UM MÓDULO PRÓPRIO (FASE 29)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra de precedência (`APP_URL` → `BETTER_AUTH_URL` → localhost) nasceu com o
 *  QR Code do certificado. Quando o palco do sorteio passou a precisar de endereço
 *  ABSOLUTO — para exibir o link em QR Code e para o e-mail —, a alternativa era
 *  copiar a regra, e cópia de regra é regra que diverge (armadilha 55): bastaria
 *  alguém ajustar a precedência de um lado para o certificado e o telão apontarem
 *  para hosts diferentes.
 *
 *  Agora existe UMA função. O `certificate-service` a reexporta, então os
 *  consumidores antigos continuam funcionando sem mudança.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Base pública usada em QR Code, e-mail e links que saem da aplicação.
 *
 * Sem variável definida, `localhost:3000` — o ambiente de desenvolvimento. Em
 * produção, `APP_URL` precisa estar certo: um host errado aqui vira QR Code que não
 * abre e link de telão que não carrega.
 */
export function publicBaseUrl(): string {
  return (
    process.env.APP_URL?.replace(/\/+$/, '') ??
    process.env.BETTER_AUTH_URL?.replace(/\/+$/, '') ??
    'http://localhost:3000'
  );
}
