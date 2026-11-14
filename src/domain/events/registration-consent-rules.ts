/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Consentimento versionado da inscrição (FASE 110)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SNAPSHOT + VERSÃO NA PRÓPRIA INSCRIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Guardar apenas `consentData = true` e `consentAt` diz QUANDO alguém clicou,
 *  mas não prova O QUÊ a pessoa aceitou se a interface mudar meses depois.
 *  Seguindo o mesmo princípio de `sponsor_scans` (F42) e `certificates` (F40),
 *  toda inscrição grava a versão do termo e o texto exato apresentado no ato.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const REGISTRATION_CONSENT_VERSION = '2026.11-v1';

export const REGISTRATION_DATA_CONSENT_TEXT =
  'Autorizo o tratamento dos meus dados pessoais para fins de organização deste evento.';

export const REGISTRATION_IMAGE_CONSENT_TEXT =
  'Autorizo o uso da minha imagem em registros e divulgação do evento.';

export interface RegistrationConsentSnapshot {
  readonly consentVersion: string;
  readonly consentText: string;
}

export function buildRegistrationConsentSnapshot(input: {
  consentData: boolean;
  consentImage: boolean;
}): RegistrationConsentSnapshot {
  const parts = [
    `[Dados:${input.consentData ? 'ACEITO' : 'RECUSADO'}] ${REGISTRATION_DATA_CONSENT_TEXT}`,
    `[Imagem:${input.consentImage ? 'ACEITO' : 'NAO_AUTORIZADO'}] ${REGISTRATION_IMAGE_CONSENT_TEXT}`,
  ];

  return {
    consentVersion: REGISTRATION_CONSENT_VERSION,
    consentText: parts.join(' | '),
  };
}
