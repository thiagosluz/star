/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LINKS ABSOLUTOS DOS E-MAILS
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE EM VEZ DE REUSAR `publicBaseUrl()`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `publicBaseUrl()` mora em `certificate-service.ts` — e o serviço de notificação é
 *  chamado POR ele (aviso de certificado emitido). Importá-lo daqui criaria um ciclo
 *  de módulos (certificado → notificação → certificado) que o Node resolve de um
 *  jeito e o bundler do Next de outro: o sintoma clássico é `undefined is not a
 *  function` em produção, longe da causa.
 *
 *  São cinco linhas de configuração. O ciclo custa mais caro do que a duplicação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { tenantPath } from '@/domain/tenancy/resolution';

/** Base pública da aplicação (a mesma que o QR Code do certificado usa). */
export function appBaseUrl(): string {
  return (
    process.env.APP_URL?.replace(/\/+$/, '') ??
    process.env.BETTER_AUTH_URL?.replace(/\/+$/, '') ??
    'http://localhost:3000'
  );
}

/** URL absoluta de uma tela da instituição — e-mail precisa de endereço completo. */
export function tenantUrl(slug: string, path: string): string {
  return `${appBaseUrl()}${tenantPath(slug, path)}`;
}

/** URL absoluta fora do contexto de instituição (verificação de e-mail, convite). */
export function appUrl(path: string): string {
  return `${appBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
