/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Comunicação (FASE 15)
 *
 *  Sem banco, sem Redis e sem rede: aqui vive o que é PURO e, portanto, o que pode
 *  ser provado barato todas as vezes:
 *
 *    • todo template renderiza assunto, HTML e TEXTO — e nenhum deixa placeholder;
 *    • texto de usuário entra ESCAPADO (título de trabalho com `<img onerror>` não
 *      vira HTML no e-mail de outra pessoa);
 *    • a paleta do e-mail continua sendo a do `globals.css` (e-mail não resolve
 *      variável CSS, então os valores são copiados — este teste impede a cópia de
 *      envelhecer);
 *    • o driver de envio segue a ordem das regras (produção sem chave NÃO envia);
 *    • convite vencido é derivado do relógio, e aceitar com outro endereço é recusa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EMAIL_DRIVERS,
  EMAIL_STATUS_LABELS,
  emailStatusLabel,
  isEmailDeliveryConfigured,
  isPlausibleEmailAddress,
  isRetryableDeliveryError,
  isSandboxSender,
  maskEmailAddress,
  normalizeEmailAddress,
  resolveEmailDriver,
} from '../../src/domain/communication/email-rules';
import {
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_LABELS,
  escapeHtml,
  renderEmail,
  type EmailPayloads,
  type EmailTemplateKey,
} from '../../src/domain/communication/email-templates';
import { EMAIL_PALETTE, EMAIL_PALETTE_TOKENS } from '../../src/domain/communication/email-theme';
import {
  INVITATION_STATES,
  INVITATION_TTL_DAYS,
  evaluateAcceptance,
  invitationConsequence,
  invitationExpiry,
  invitationState,
  invitationStateLabel,
  invitableRoles,
  isInvitableRole,
  isInvitationLive,
} from '../../src/domain/communication/invitation-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Payloads de exemplo — um por template
// ───────────────────────────────────────────────────────────────────────────────
const PAYLOADS: { [K in EmailTemplateKey]: EmailPayloads[K] } = {
  EMAIL_VERIFICATION: {
    recipientName: 'Ana Souza',
    verifyUrl: 'http://localhost:3000/api/auth/verify-email?token=abc',
    expiresInHours: 24,
  },
  PASSWORD_RESET: {
    recipientName: 'Ana Souza',
    resetUrl: 'http://localhost:3000/redefinir?token=abc',
    expiresInMinutes: 60,
  },
  MEMBER_INVITATION: {
    recipientName: 'Bruno Lima',
    tenantName: 'Universidade Federal da Bahia',
    roleLabel: 'Organizador(a)',
    inviterName: 'Ana Souza',
    message: 'Bem-vindo à equipe!',
    inviteUrl: 'http://localhost:3000/t/ufba/convite?codigo=xyz',
    expiresInDays: INVITATION_TTL_DAYS,
    isReminder: false,
  },
  REVIEW_ASSIGNED: {
    reviewerName: 'Diego Alves',
    submissionTitle: 'Ensino de programação com Rust',
    trackName: 'Tecnologia Educacional',
    dueAtLabel: '12/10/2026 18:00',
    isBlind: true,
    reviewUrl: 'http://localhost:3000/t/ufba/revisoes/sub-1',
  },
  REVIEW_DUE_SOON: {
    reviewerName: 'Diego Alves',
    submissionTitle: 'Ensino de programação com Rust',
    dueAtLabel: '12/10/2026 18:00',
    hoursLeft: 20,
    reviewUrl: 'http://localhost:3000/t/ufba/revisoes/sub-1',
  },
  REVIEW_OVERDUE: {
    reviewerName: 'Diego Alves',
    submissionTitle: 'Ensino de programação com Rust',
    dueAtLabel: '01/10/2026 18:00',
    daysLate: 3,
    reviewUrl: 'http://localhost:3000/t/ufba/revisoes/sub-1',
  },
  CARD_GRANTED: {
    recipientName: 'Ana Souza',
    cardName: 'Mestra do Credenciamento',
    rarityLabel: 'Épica',
    reasonLabel: 'Você fez o credenciamento no evento',
    albumUrl: 'http://localhost:3000/t/ufba/cartas',
  },
  CERTIFICATE_ISSUED: {
    recipientName: 'Ana Souza',
    certificateTitle: 'Certificado de participação',
    eventTitle: 'Congresso de Tecnologia 2026',
    workloadLabel: '8h',
    validationCode: 'CERT-ABC12345',
    certificateUrl: 'http://localhost:3000/t/ufba/certificados',
    validationUrl: 'http://localhost:3000/validar/CERT-ABC12345',
  },
  PARTICIPANT_MESSAGE: {
    recipientName: 'Ana Souza',
    tenantName: 'Universidade Federal da Bahia',
    subject: 'Credenciamento abre às 8h',
    body: 'Chegue com o QR Code em mãos.\n\nEquipe da organização.',
    eventTitle: 'Congresso de Tecnologia 2026',
    senderName: 'Administradora do Evento',
    inboxUrl: 'http://localhost:3000/t/ufba/minhas-mensagens',
  },
  PROPOSAL_RECEIVED: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    callTitle: 'Chamada de minicursos',
    callKindLabel: 'Minicurso',
    proposalTitle: 'Introdução a Rust para cientistas de dados',
    protocol: '2026-AB12',
    proposalsUrl: 'http://localhost:3000/t/ufba/submissoes',
  },
  SPEAKER_INVITATION: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    activityTitle: 'Introdução a Rust para cientistas de dados',
    roleLabel: 'Minicurso',
    inviteUrl: 'http://localhost:3000/t/ufba/palestrante/convite?codigo=abc123',
    expiresInDays: 14,
    startsAtLabel: '01/10/2026 às 14:00',
  },
  /**
   * FASE 34 — os cinco avisos da confirmação de vaga. O checklist do que levar
   * aparece em dois deles: é o texto que a pessoa usa no balcão.
   */
  REGISTRATION_PENDING: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    activityTitle: 'Oficina: Brinquedos reciclados',
    deadlineLabel: '25/09/2026, 23:59',
    requirements: ['Doação: 1 kg de alimento não perecível', 'Item: 1 brinquedo'],
    place: 'Secretaria do bloco B, térreo — das 9h às 18h',
    instructions: 'Traga o comprovante impresso.',
    registrationsUrl: 'http://localhost:3000/t/ufba/minhas-inscricoes',
  },
  REGISTRATION_DUE_SOON: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    activityTitle: 'Oficina: Brinquedos reciclados',
    deadlineLabel: '25/09/2026, 23:59',
    countdownLabel: 'falta 1 dia',
    requirements: ['Doação: 1 kg de alimento não perecível'],
    place: 'Secretaria do bloco B, térreo — das 9h às 18h',
    registrationsUrl: 'http://localhost:3000/t/ufba/minhas-inscricoes',
  },
  REGISTRATION_CONFIRMED: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    activityTitle: 'Oficina: Brinquedos reciclados',
    deadlineLabel: '25/09/2026, 23:59',
    startsAtLabel: '13/10/2026 às 09:00',
    registrationsUrl: 'http://localhost:3000/t/ufba/minhas-inscricoes',
  },
  REGISTRATION_RELEASED: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    activityTitle: 'Oficina: Brinquedos reciclados',
    deadlineLabel: '25/09/2026, 23:59',
    registrationsUrl: 'http://localhost:3000/t/ufba/minhas-inscricoes',
  },
  WAITLIST_PROMOTED: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    activityTitle: 'Oficina: Brinquedos reciclados',
    startsAtLabel: '13/10/2026 às 09:00',
    registrationsUrl: 'http://localhost:3000/t/ufba/minhas-inscricoes',
  },
  /**
   * FASE 36 — a decisão da chamada de propostas (quita a dívida E47). O parecer vai
   * literal: é o que a pessoa lê para saber o que ajustar.
   */
  PROPOSAL_DECIDED: {
    recipientName: 'Ana Souza',
    eventTitle: 'Congresso de Tecnologia 2026',
    callTitle: 'Chamada de minicursos',
    proposalTitle: 'Introdução a Rust para cientistas de dados',
    protocol: '2026-AB12',
    decisionLabel: 'Ajustes solicitados',
    outcome: 'O comitê pediu ajustes antes de decidir.',
    notes: 'Detalhar a carga horária e a ementa do minicurso.',
    proposalsUrl: 'http://localhost:3000/t/ufba/submissoes',
  },
};

const CONTEXT = { brandName: 'Universidade Federal da Bahia' };

describe('templates de e-mail — todo tipo renderiza assunto, HTML e texto', () => {
  it('cobre todos os templates do catálogo (enumeração exaustiva)', () => {
    /** 11 da FASE 15/33 + 5 da confirmação de vaga (FASE 34) + 1 da decisão da proposta (FASE 36). */
    expect(EMAIL_TEMPLATE_KEYS).toHaveLength(17);

    for (const key of EMAIL_TEMPLATE_KEYS) {
      expect(EMAIL_TEMPLATE_LABELS[key], `rótulo ausente para ${key}`).toBeTruthy();
    }
  });

  it.each(EMAIL_TEMPLATE_KEYS)('%s produz as três partes preenchidas', (key) => {
    const rendered = renderEmail(key, PAYLOADS[key], CONTEXT);

    expect(rendered.subject.trim().length).toBeGreaterThan(3);
    expect(rendered.html).toContain('<!DOCTYPE html>');
    expect(rendered.html).toContain(CONTEXT.brandName);
    expect(rendered.text.trim().length).toBeGreaterThan(10);

    // Nenhum placeholder sobrou no HTML nem no texto.
    expect(rendered.html).not.toMatch(/\{\{|\}\}/);
    expect(rendered.text).not.toMatch(/\{\{|\}\}/);
  });

  it('o texto puro carrega o link, para quem lê sem HTML', () => {
    const rendered = renderEmail('MEMBER_INVITATION', PAYLOADS.MEMBER_INVITATION, CONTEXT);
    expect(rendered.text).toContain(PAYLOADS.MEMBER_INVITATION.inviteUrl);

    const certificate = renderEmail('CERTIFICATE_ISSUED', PAYLOADS.CERTIFICATE_ISSUED, CONTEXT);
    expect(certificate.text).toContain(PAYLOADS.CERTIFICATE_ISSUED.validationCode);
  });

  it('não deixa MARCAÇÃO escapar como texto (o defeito do negrito visível)', () => {
    /**
     * Este teste nasceu de um defeito real da implementação inicial: os templates
     * montavam `strong(...)` DENTRO de uma função que escapa, e o cliente de e-mail
     * mostrava `<strong style="color:#181c24">` como texto no meio da frase. O HTML
     * era válido, o texto é que ficava feio — nada quebraria sem uma trava olhando
     * para isso.
     */
    for (const key of EMAIL_TEMPLATE_KEYS) {
      const rendered = renderEmail(key, PAYLOADS[key], CONTEXT);

      for (const tag of ['&lt;strong', '&lt;p ', '&lt;table', '&lt;a ', '&lt;/']) {
        expect(rendered.html, `${key} escapou marcação (${tag})`).not.toContain(tag);
      }
    }
  });

  it('o negrito do conteúdo aparece como marcação de verdade', () => {
    const rendered = renderEmail('CARD_GRANTED', PAYLOADS.CARD_GRANTED, CONTEXT);
    const marked = rendered.html.replace(/\s+/g, ' ');

    expect(marked).toContain('<strong style="color:#181c24;font-weight:600;">Mestra do Credenciamento</strong>');
  });

  it('ESCAPA texto de usuário — título de trabalho não pode virar HTML', () => {
    const malicious = '<img src=x onerror="alert(1)"> & "aspas"';

    const rendered = renderEmail(
      'REVIEW_ASSIGNED',
      { ...PAYLOADS.REVIEW_ASSIGNED, submissionTitle: malicious },
      CONTEXT,
    );

    // O conteúdo hostil NÃO aparece cru...
    expect(rendered.html).not.toContain('<img src=x');
    // ...e aparece escapado, que é o que o cliente de e-mail mostra como texto.
    expect(rendered.html).toContain('&lt;img src=x');
    expect(rendered.html).toContain('&amp;');
  });

  it('escapeHtml cobre os cinco caracteres perigosos', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    expect(escapeHtml('sem nada')).toBe('sem nada');
  });

  it('o lembrete de convite tem assunto próprio (reconhecível na caixa de entrada)', () => {
    const first = renderEmail('MEMBER_INVITATION', PAYLOADS.MEMBER_INVITATION, CONTEXT);
    const reminder = renderEmail(
      'MEMBER_INVITATION',
      { ...PAYLOADS.MEMBER_INVITATION, isReminder: true },
      CONTEXT,
    );

    expect(reminder.subject).not.toBe(first.subject);
    expect(reminder.subject.toLowerCase()).toContain('lembrete');
  });
});

describe('paleta do e-mail — cópia fiel dos tokens', () => {
  it('cada cor espelha o valor declarado no globals.css', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

    for (const [key, token] of Object.entries(EMAIL_PALETTE_TOKENS)) {
      const value = EMAIL_PALETTE[key as keyof typeof EMAIL_PALETTE];
      const declaration = new RegExp(`${token}:\\s*([^;]+);`).exec(css);

      expect(declaration, `token ${token} ausente no globals.css`).toBeTruthy();
      expect(
        declaration?.[1]?.trim().toLowerCase(),
        `${token} divergiu: o e-mail usa ${value} e o globals.css tem ${declaration?.[1]?.trim()}`,
      ).toBe(value.toLowerCase());
    }
  });
});

describe('driver de envio — a ordem das regras protege endereço real', () => {
  it('EMAIL_DRIVER explícito manda, mesmo em produção', () => {
    expect(resolveEmailDriver({ EMAIL_DRIVER: 'log', NODE_ENV: 'production', RESEND_API_KEY: 'k' })).toBe('log');
    expect(resolveEmailDriver({ EMAIL_DRIVER: 'resend', NODE_ENV: 'development' })).toBe('resend');
    expect(resolveEmailDriver({ EMAIL_DRIVER: 'LOG' })).toBe('log');
  });

  it('sem declaração, só produção COM chave envia de verdade', () => {
    expect(resolveEmailDriver({ NODE_ENV: 'production', RESEND_API_KEY: 'k' })).toBe('resend');
    expect(resolveEmailDriver({ NODE_ENV: 'production' })).toBe('log');
    expect(resolveEmailDriver({ NODE_ENV: 'development', RESEND_API_KEY: 'k' })).toBe('log');
    expect(resolveEmailDriver({})).toBe('log');
  });

  it('valor desconhecido cai na regra padrão (não vira envio acidental)', () => {
    expect(resolveEmailDriver({ EMAIL_DRIVER: 'sendgrid' })).toBe('log');
    expect(resolveEmailDriver({ EMAIL_DRIVER: '  ' })).toBe('log');
  });

  it('isEmailDeliveryConfigured só é verdadeiro com resend + chave', () => {
    expect(isEmailDeliveryConfigured({ EMAIL_DRIVER: 'resend', RESEND_API_KEY: 'k' })).toBe(true);
    expect(isEmailDeliveryConfigured({ EMAIL_DRIVER: 'resend' })).toBe(false);
    expect(isEmailDeliveryConfigured({ EMAIL_DRIVER: 'log', RESEND_API_KEY: 'k' })).toBe(false);
  });

  it('o catálogo de drivers e o de situações são fechados', () => {
    expect([...EMAIL_DRIVERS]).toEqual(['resend', 'log']);
    expect(Object.keys(EMAIL_STATUS_LABELS).sort()).toEqual(['FAILED', 'QUEUED', 'SENT', 'SKIPPED']);
    expect(emailStatusLabel('SENT')).toBe('Enviado');
    expect(emailStatusLabel('DESCONHECIDO')).toBe('DESCONHECIDO');
  });

  it('reconhece o remetente de TESTE do Resend (sem domínio verificado)', () => {
    // A conta de teste do Resend só aceita `onboarding@resend.dev` como remetente e só
    // ENTREGA para o endereço dono da conta. A tela precisa reconhecer isso para avisar,
    // em vez de o operador ver um "Falhou" sem explicação.
    expect(isSandboxSender('EventFlow <onboarding@resend.dev>')).toBe(true);
    expect(isSandboxSender('ONBOARDING@RESEND.DEV')).toBe(true);
    expect(isSandboxSender('EventFlow <nao-responda@eventflow.com.br>')).toBe(false);
  });
});

describe('endereço de e-mail — normalização, plausibilidade e máscara', () => {
  it('normaliza para comparação e gravação', () => {
    expect(normalizeEmailAddress('  Ana.Souza@Exemplo.TEST ')).toBe('ana.souza@exemplo.test');
  });

  it('aceita endereço plausível e recusa o resto', () => {
    expect(isPlausibleEmailAddress('ana@exemplo.test')).toBe(true);
    expect(isPlausibleEmailAddress('a.b+c@sub.exemplo.org')).toBe(true);
    expect(isPlausibleEmailAddress('ana@exemplo')).toBe(false);
    expect(isPlausibleEmailAddress('ana exemplo@teste.com')).toBe(false);
    expect(isPlausibleEmailAddress('')).toBe(false);
  });

  it('mascara a parte local e preserva o domínio', () => {
    expect(maskEmailAddress('ana@exemplo.test')).toBe('an*@exemplo.test');
    expect(maskEmailAddress('a@exemplo.test')).toBe('a*@exemplo.test');
    expect(maskEmailAddress('sem-arroba')).toBe('***');
  });
});

describe('falha de entrega — o que vale nova tentativa', () => {
  it('trata como transitório o que melhora com espera', () => {
    expect(isRetryableDeliveryError(null, 'socket hang up')).toBe(true);
    expect(isRetryableDeliveryError(429, 'too many requests')).toBe(true);
    expect(isRetryableDeliveryError(503, 'service unavailable')).toBe(true);
    expect(isRetryableDeliveryError(200, 'operation timed out')).toBe(true);
  });

  it('NÃO retenta o que é erro de configuração ou de endereço', () => {
    expect(isRetryableDeliveryError(403, 'API key is invalid')).toBe(false);
    expect(isRetryableDeliveryError(422, 'domain is not verified')).toBe(false);
    expect(isRetryableDeliveryError(400, 'invalid to address')).toBe(false);
  });
});

describe('regras do convite — estado derivado e aceite condicionado', () => {
  const base = {
    email: 'convidada@exemplo.test',
    status: 'PENDING',
    expiresAt: new Date('2026-10-10T12:00:00Z'),
    acceptedAt: null,
    revokedAt: null,
  };
  const now = new Date('2026-10-05T12:00:00Z');

  it('o estado pendente vence pelo relógio, sem agendador', () => {
    expect(invitationState(base, now)).toBe('PENDING');
    expect(isInvitationLive(base, now)).toBe(true);

    const afterExpiry = new Date('2026-10-11T12:00:00Z');
    expect(invitationState(base, afterExpiry)).toBe('EXPIRED');
    expect(isInvitationLive(base, afterExpiry)).toBe(false);
  });

  it('aceito e revogado mandam no estado, mesmo dentro do prazo', () => {
    expect(invitationState({ ...base, acceptedAt: now, status: 'ACCEPTED' }, now)).toBe('ACCEPTED');
    expect(invitationState({ ...base, revokedAt: now, status: 'REVOKED' }, now)).toBe('REVOKED');
  });

  it('todo estado tem rótulo legível', () => {
    for (const state of INVITATION_STATES) {
      expect(invitationStateLabel(state)).not.toBe(state);
    }
  });

  it('aceita quando o endereço confere e não há vínculo ativo', () => {
    expect(
      evaluateAcceptance({
        invitation: base,
        now,
        userEmail: 'CONVIDADA@exemplo.test ',
        alreadyMember: false,
      }).ok,
    ).toBe(true);
  });

  it('recusa com o motivo certo em cada caso', () => {
    const wrongEmail = evaluateAcceptance({
      invitation: base,
      now,
      userEmail: 'outra@exemplo.test',
      alreadyMember: false,
    });
    expect(wrongEmail.ok).toBe(false);
    if (!wrongEmail.ok) expect(wrongEmail.code).toBe('WRONG_EMAIL');

    const expired = evaluateAcceptance({
      invitation: base,
      now: new Date('2026-10-11T12:00:00Z'),
      userEmail: base.email,
      alreadyMember: false,
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.code).toBe('EXPIRED');

    const revoked = evaluateAcceptance({
      invitation: { ...base, status: 'REVOKED', revokedAt: now },
      now,
      userEmail: base.email,
      alreadyMember: false,
    });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.code).toBe('REVOKED');

    const accepted = evaluateAcceptance({
      invitation: { ...base, status: 'ACCEPTED', acceptedAt: now },
      now,
      userEmail: base.email,
      alreadyMember: false,
    });
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) expect(accepted.code).toBe('ALREADY_ACCEPTED');

    const member = evaluateAcceptance({
      invitation: base,
      now,
      userEmail: base.email,
      alreadyMember: true,
    });
    expect(member.ok).toBe(false);
    if (!member.ok) expect(member.code).toBe('ALREADY_MEMBER');
  });

  it('a recusa de endereço errado vem ANTES da de já-membro', () => {
    // Quem não é o dono do convite não deve descobrir o estado do vínculo de outra
    // pessoa por uma mensagem mais específica.
    const verdict = evaluateAcceptance({
      invitation: base,
      now,
      userEmail: 'curiosa@exemplo.test',
      alreadyMember: true,
    });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('WRONG_EMAIL');
  });

  it('convida papéis de equipe, e NÃO convida OWNER nem SUPERADMIN nem PARTICIPANT', () => {
    const invitable = invitableRoles();

    expect(invitable).toContain('ADMIN');
    expect(invitable).toContain('ORGANIZER');
    expect(invitable).toContain('STAFF');
    expect(invitable).not.toContain('OWNER');
    expect(invitable).not.toContain('SUPERADMIN');
    expect(invitable).not.toContain('PARTICIPANT');

    expect(isInvitableRole('CHAIR')).toBe(true);
    expect(isInvitableRole('OWNER')).toBe(false);
    expect(isInvitableRole('qualquer')).toBe(false);
  });

  it('todo papel convidável tem consequência escrita e rótulo', () => {
    for (const role of invitableRoles()) {
      expect(invitationConsequence(role).length, `sem consequência para ${role}`).toBeGreaterThan(10);
    }
  });

  it('o convite vale por 7 dias', () => {
    const expiry = invitationExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(INVITATION_TTL_DAYS * 86_400_000);
    expect(INVITATION_TTL_DAYS).toBe(7);
  });
});
