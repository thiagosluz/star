/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TEMPLATES DE E-MAIL — funções puras, sem React e sem rede
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO UM MOTOR DE TEMPLATE (E POR QUE NÃO REACT EMAIL)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um e-mail transacional é o artefato mais auditável da plataforma: é o que saiu,
 *  literalmente, para uma pessoa de fora. Neste desenho ele é o resultado de uma
 *  função pura `(payload) => { subject, html, text }`:
 *
 *    • testável sem rede, sem renderizador e sem banco;
 *    • o HTML é GRAVADO no outbox no momento do enfileiramento, então o registro
 *      mostra o que realmente saiu — renderizar na entrega faria uma correção de
 *      template reescrever o passado;
 *    • React Email traria dependências e um passo de build para produzir algo que
 *      aqui é concatenação de string com estilo embutido (cliente de e-mail não
 *      resolve variável CSS — ver `email-theme.ts`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PAYLOAD SÓ CARREGA STRING
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Datas e rótulos chegam JÁ FORMATADOS pelo serviço que dispara (inclusive o fuso
 *  do evento). O template não decide idioma, formato de data nem regra de negócio:
 *  ele monta. Isso mantém o renderizador determinístico — o mesmo payload produz
 *  sempre o mesmo HTML, que é o que permite gravá-lo como registro do envio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { EMAIL_FONT_STACK, EMAIL_PALETTE as P } from './email-theme';

// ───────────────────────────────────────────────────────────────────────────────
//  Payloads
// ───────────────────────────────────────────────────────────────────────────────
export interface EmailPayloads {
  /** A5 — confirmação do endereço (Better Auth). */
  EMAIL_VERIFICATION: {
    recipientName: string;
    verifyUrl: string;
    expiresInHours: number;
  };

  /** D1 — redefinição de senha (Better Auth). */
  PASSWORD_RESET: {
    recipientName: string;
    resetUrl: string;
    expiresInMinutes: number;
  };

  /** D2 — convite para entrar na equipe da instituição. */
  MEMBER_INVITATION: {
    recipientName: string | null;
    tenantName: string;
    roleLabel: string;
    inviterName: string | null;
    message: string | null;
    inviteUrl: string;
    expiresInDays: number;
    isReminder: boolean;
  };

  /** D3 — o comitê atribuiu uma submissão a este revisor. */
  REVIEW_ASSIGNED: {
    reviewerName: string;
    submissionTitle: string;
    trackName: string | null;
    dueAtLabel: string | null;
    isBlind: boolean;
    reviewUrl: string;
  };

  /** D4 — o prazo do parecer está chegando. */
  REVIEW_DUE_SOON: {
    reviewerName: string;
    submissionTitle: string;
    dueAtLabel: string;
    hoursLeft: number;
    reviewUrl: string;
  };

  /** D4 — o prazo venceu e o parecer não foi enviado. */
  REVIEW_OVERDUE: {
    reviewerName: string;
    submissionTitle: string;
    dueAtLabel: string;
    daysLate: number;
    reviewUrl: string;
  };

  /** D5 — carta conquistada. */
  CARD_GRANTED: {
    recipientName: string;
    cardName: string;
    rarityLabel: string;
    reasonLabel: string;
    albumUrl: string;
  };

  /** D6 — certificado emitido. */
  CERTIFICATE_ISSUED: {
    recipientName: string;
    certificateTitle: string;
    eventTitle: string;
    workloadLabel: string | null;
    validationCode: string;
    certificateUrl: string;
    validationUrl: string;
  };

  /**
   * FASE 32 — recado da instituição para o participante.
   *
   * O ASSUNTO é escrito por uma pessoa da instituição, e não pelo sistema: por isso
   * ele chega aqui como dado (já validado no domínio, com o tamanho limitado) e é
   * escapado na montagem. O corpo vai como TEXTO (`markup`), com os parágrafos
   * separados — o recado não é HTML de autoria livre, senão a caixa de saída da
   * instituição viraria um vetor de injeção no e-mail de terceiros.
   */
  PARTICIPANT_MESSAGE: {
    recipientName: string;
    tenantName: string;
    subject: string;
    body: string;
    eventTitle: string | null;
    senderName: string | null;
    inboxUrl: string;
  };
}

export type EmailTemplateKey = keyof EmailPayloads;

export const EMAIL_TEMPLATE_KEYS: readonly EmailTemplateKey[] = Object.freeze([
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'MEMBER_INVITATION',
  'REVIEW_ASSIGNED',
  'REVIEW_DUE_SOON',
  'REVIEW_OVERDUE',
  'CARD_GRANTED',
  'CERTIFICATE_ISSUED',
  'PARTICIPANT_MESSAGE',
] as const);

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Utilidades de montagem
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Escapa o que veio do banco antes de entrar no HTML.
 *
 * Não é paranoia: título de submissão, nome de carta e recado do convite são texto
 * de USUÁRIO. Sem escape, um título com `<img onerror=...>` sairia no e-mail de
 * outra pessoa — e cliente de e-mail é exatamente onde isso passa desapercebido.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface LayoutInput {
  /** Assinatura no topo: a instituição quando há uma, a plataforma quando não há. */
  brandName: string;
  preheader: string;
  title: string;
  /** Parágrafos já escapados. */
  paragraphs: string[];
  details?: { label: string; value: string }[];
  callToAction?: { label: string; url: string };
  notice?: string;
  footerNote: string;
}

/**
 * Moldura única de todos os e-mails.
 *
 * Tabela com estilo embutido — não é falta de estilo, é o único layout que
 * sobrevive ao Outlook. O `preheader` é o texto que o cliente mostra no resumo da
 * caixa de entrada; sem ele, o resumo vira o primeiro texto do corpo.
 */
function renderLayout(input: LayoutInput): string {
  const details =
    input.details && input.details.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 20px;border-collapse:collapse;">
${input.details
  .map(
    (row) => `          <tr>
            <td style="padding:10px 0;border-bottom:1px solid ${P.border};font:400 13px/20px ${EMAIL_FONT_STACK};color:${P.muted};">${row.label}</td>
            <td align="right" style="padding:10px 0;border-bottom:1px solid ${P.border};font:600 13px/20px ${EMAIL_FONT_STACK};color:${P.foreground};">${row.value}</td>
          </tr>`,
  )
  .join('\n')}
        </table>`
      : '';

  const button = input.callToAction
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;">
          <tr>
            <td align="center" bgcolor="${P.primary}" style="border-radius:10px;">
              <a href="${input.callToAction.url}" style="display:inline-block;padding:13px 26px;font:600 15px/20px ${EMAIL_FONT_STACK};color:#ffffff;text-decoration:none;border-radius:10px;">${input.callToAction.label}</a>
            </td>
          </tr>
        </table>`
    : '';

  const notice = input.notice
    ? `<p style="margin:0 0 20px;padding:12px 14px;background:${P.surfaceLow};border-left:3px solid ${P.primary};font:400 13px/20px ${EMAIL_FONT_STACK};color:${P.muted};border-radius:6px;">${input.notice}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:${P.surface};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:${P.card};border:1px solid ${P.border};border-radius:14px;border-collapse:separate;">
          <tr>
            <td style="padding:22px 28px;border-bottom:1px solid ${P.border};">
              <span style="font:700 15px/22px ${EMAIL_FONT_STACK};color:${P.primaryText};letter-spacing:-0.01em;">${escapeHtml(input.brandName)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;font:700 22px/30px ${EMAIL_FONT_STACK};color:${P.foreground};letter-spacing:-0.02em;">${escapeHtml(input.title)}</h1>
${input.paragraphs.map((paragraph) => `              <p style="margin:0 0 14px;font:400 15px/24px ${EMAIL_FONT_STACK};color:${P.muted};">${paragraph}</p>`).join('\n')}
              ${details}
              ${notice}
              ${button}
              <p style="margin:0;font:400 12px/18px ${EMAIL_FONT_STACK};color:${P.muted};">${input.footerNote}</p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;font:400 11px/16px ${EMAIL_FONT_STACK};color:${P.muted};">
          EventFlow · mensagem automática, não responda a este endereço.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Parágrafo já escapado (o escape é do texto, não do HTML montado). */
function paragraph(text: string): string {
  return escapeHtml(text);
}

/**
 * Parágrafo que JÁ contém marcação (negrito, link) montada aqui dentro.
 *
 * Existe porque `paragraph()` escapa o que recebe — e passar uma string com
 * `<strong>` por ele faria o cliente de e-mail MOSTRAR a tag em vez de aplicar o
 * negrito. O defeito é silencioso (o HTML é válido, o texto é que fica feio), e foi
 * um teste que o pegou: o conteúdo chegava escapado onde deveria virar marcação.
 */
function markup(html: string): string {
  return html;
}

function strong(text: string): string {
  return `<strong style="color:${P.foreground};font-weight:600;">${escapeHtml(text)}</strong>`;
}

function greeting(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? `Olá, ${escapeHtml(first)}!` : 'Olá!';
}

function detailsBlock(rows: { label: string; value: string }[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join('\n');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Renderizador
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Renderiza a mensagem. O `switch` é exaustivo por TIPO: template novo sem
 * implementação não compila (mesma trava dos rótulos de atividade).
 */
export function renderEmail<K extends EmailTemplateKey>(
  template: K,
  payload: EmailPayloads[K],
  context: { brandName: string },
): RenderedEmail {
  const brand = context.brandName;

  switch (template) {
    case 'EMAIL_VERIFICATION': {
      const data = payload as EmailPayloads['EMAIL_VERIFICATION'];
      return {
        subject: `Confirme seu e-mail no ${brand}`,
        html: renderLayout({
          brandName: brand,
          preheader: 'Um clique confirma que este endereço é seu.',
          title: 'Confirme seu e-mail',
          paragraphs: [
            paragraph(greeting(data.recipientName)),
            paragraph(
              'Falta um passo para a sua conta ficar completa: confirmar que este endereço é seu. É o que permite recuperar a senha e receber os avisos do evento.',
            ),
          ],
          callToAction: { label: 'Confirmar e-mail', url: data.verifyUrl },
          notice: `O link vale por ${data.expiresInHours} horas. Se você não criou a conta, ignore esta mensagem — nada acontece sem o clique.`,
          footerNote: 'Se o botão não funcionar, copie e cole este endereço no navegador: ' +
            `<span style="word-break:break-all;">${escapeHtml(data.verifyUrl)}</span>`,
        }),
        text: [
          greeting(data.recipientName),
          '',
          'Confirme seu e-mail para completar a conta:',
          data.verifyUrl,
          '',
          `O link vale por ${data.expiresInHours} horas. Se você não criou a conta, ignore esta mensagem.`,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'PASSWORD_RESET': {
      const data = payload as EmailPayloads['PASSWORD_RESET'];
      return {
        subject: `Redefinir a senha — ${brand}`,
        html: renderLayout({
          brandName: brand,
          preheader: 'Link para definir uma nova senha.',
          title: 'Redefinir a sua senha',
          paragraphs: [
            paragraph(greeting(data.recipientName)),
            paragraph(
              'Recebemos um pedido para redefinir a senha desta conta. Se foi você, use o botão abaixo; a senha atual continua valendo até que a nova seja definida.',
            ),
          ],
          callToAction: { label: 'Definir nova senha', url: data.resetUrl },
          notice: `O link vale por ${data.expiresInMinutes} minutos e só pode ser usado uma vez. Se não foi você, ignore esta mensagem.`,
          footerNote: 'Ninguém da equipe pede a sua senha por e-mail ou telefone.',
        }),
        text: [
          greeting(data.recipientName),
          '',
          'Defina uma nova senha neste endereço:',
          data.resetUrl,
          '',
          `O link vale por ${data.expiresInMinutes} minutos. Se não foi você, ignore esta mensagem.`,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'MEMBER_INVITATION': {
      const data = payload as EmailPayloads['MEMBER_INVITATION'];
      const inviter = data.inviterName ? `${data.inviterName} convidou você` : 'Você foi convidado(a)';
      return {
        subject: data.isReminder
          ? `Lembrete: convite para a equipe de ${data.tenantName}`
          : `${inviter} para a equipe de ${data.tenantName}`,
        html: renderLayout({
          brandName: data.tenantName,
          preheader: `Convite para integrar a equipe como ${data.roleLabel}.`,
          title: `Convite para a equipe de ${data.tenantName}`,
          paragraphs: [
            paragraph(greeting(data.recipientName)),
            paragraph(
              `${inviter} para integrar a equipe de ${data.tenantName} no EventFlow, com o papel de ${data.roleLabel}. O acesso é liberado quando você aceitar o convite.`,
            ),
            ...(data.message ? [paragraph(`Recado de quem convidou: “${data.message}”`)] : []),
          ],
          details: [
            { label: 'Instituição', value: escapeHtml(data.tenantName) },
            { label: 'Papel', value: escapeHtml(data.roleLabel) },
          ],
          callToAction: { label: 'Aceitar convite', url: data.inviteUrl },
          notice: `O convite vale por ${data.expiresInDays} dias. Se você ainda não tem conta, o próprio link leva ao cadastro com este endereço já preenchido.`,
          footerNote:
            'Você recebeu este convite porque alguém da instituição informou este endereço. Se não era para você, ignore: o acesso não é criado sem o aceite.',
        }),
        text: [
          greeting(data.recipientName),
          '',
          `${inviter} para integrar a equipe de ${data.tenantName} como ${data.roleLabel}.`,
          ...(data.message ? ['', `Recado: “${data.message}”`] : []),
          '',
          'Aceite neste endereço:',
          data.inviteUrl,
          '',
          `O convite vale por ${data.expiresInDays} dias.`,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'REVIEW_ASSIGNED': {
      const data = payload as EmailPayloads['REVIEW_ASSIGNED'];
      return {
        subject: `Nova avaliação atribuída: ${data.submissionTitle}`,
        html: renderLayout({
          brandName: brand,
          preheader: 'Um trabalho foi atribuído a você para avaliação.',
          title: 'Você recebeu um trabalho para avaliar',
          paragraphs: [
            paragraph(greeting(data.reviewerName)),
            markup(
              `O comitê atribuiu a você a avaliação do trabalho ${strong(data.submissionTitle)}.` +
                (data.isBlind
                  ? ' A avaliação é CEGA: os dados de autoria não são exibidos.'
                  : ''),
            ),
          ],
          details: [
            ...(data.trackName ? [{ label: 'Trilha', value: escapeHtml(data.trackName) }] : []),
            ...(data.dueAtLabel ? [{ label: 'Prazo', value: escapeHtml(data.dueAtLabel) }] : []),
          ],
          callToAction: { label: 'Abrir a avaliação', url: data.reviewUrl },
          notice:
            'Avalie pelos critérios da rubrica da trilha. Conflito de interesse? Declare na própria tela antes de emitir o parecer.',
          footerNote: 'O parecer é confidencial: os comentários ao comitê não são visíveis ao autor.',
        }),
        text: [
          greeting(data.reviewerName),
          '',
          `Trabalho atribuído: ${data.submissionTitle}`,
          ...detailsBlock([
            ...(data.trackName ? [{ label: 'Trilha', value: data.trackName }] : []),
            ...(data.dueAtLabel ? [{ label: 'Prazo', value: data.dueAtLabel }] : []),
          ])
            .split('\n')
            .filter((row) => row.length > 0),
          '',
          'Abra a avaliação:',
          data.reviewUrl,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'REVIEW_DUE_SOON': {
      const data = payload as EmailPayloads['REVIEW_DUE_SOON'];
      return {
        subject: `Prazo do parecer em ${data.hoursLeft}h: ${data.submissionTitle}`,
        html: renderLayout({
          brandName: brand,
          preheader: `O prazo vence em ${data.dueAtLabel}.`,
          title: 'Seu parecer está perto do prazo',
          paragraphs: [
            paragraph(greeting(data.reviewerName)),
            markup(
              `A avaliação de ${strong(data.submissionTitle)} vence em ${strong(data.dueAtLabel)} — faltam cerca de ${data.hoursLeft} horas.`,
            ),
            paragraph(
              'Se você não puder avaliar, decline na tela: o trabalho volta para a fila do comitê e outra pessoa assume. O silêncio trava a decisão da trilha.',
            ),
          ],
          callToAction: { label: 'Enviar o parecer', url: data.reviewUrl },
          footerNote: 'Este aviso é enviado uma única vez por prazo.',
        }),
        text: [
          greeting(data.reviewerName),
          '',
          `O parecer de "${data.submissionTitle}" vence em ${data.dueAtLabel} (cerca de ${data.hoursLeft}h).`,
          '',
          'Envie ou decline:',
          data.reviewUrl,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'REVIEW_OVERDUE': {
      const data = payload as EmailPayloads['REVIEW_OVERDUE'];
      const days = data.daysLate === 1 ? '1 dia' : `${data.daysLate} dias`;
      return {
        subject: `Parecer vencido há ${days}: ${data.submissionTitle}`,
        html: renderLayout({
          brandName: brand,
          preheader: `O prazo era ${data.dueAtLabel}.`,
          title: 'Parecer com prazo vencido',
          paragraphs: [
            paragraph(greeting(data.reviewerName)),
            markup(
              `O prazo da avaliação de ${strong(data.submissionTitle)} era ${strong(data.dueAtLabel)} — venceu há ${days}.`,
            ),
            paragraph(
              'O trabalho continua esperando por este parecer. Se não for possível avaliar agora, decline na tela para liberar a vaga.',
            ),
          ],
          callToAction: { label: 'Resolver agora', url: data.reviewUrl },
          footerNote: 'O comitê científico também é avisado dos prazos vencidos.',
        }),
        text: [
          greeting(data.reviewerName),
          '',
          `O parecer de "${data.submissionTitle}" venceu em ${data.dueAtLabel} (há ${days}).`,
          '',
          'Resolva em:',
          data.reviewUrl,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'CARD_GRANTED': {
      const data = payload as EmailPayloads['CARD_GRANTED'];
      return {
        subject: `Você conquistou a carta ${data.cardName}`,
        html: renderLayout({
          brandName: brand,
          preheader: `Carta ${data.rarityLabel} desbloqueada no seu álbum.`,
          title: 'Carta desbloqueada!',
          paragraphs: [
            paragraph(greeting(data.recipientName)),
            markup(`${strong(data.cardName)} entrou no seu álbum. ${escapeHtml(data.reasonLabel)}`),
          ],
          details: [{ label: 'Raridade', value: escapeHtml(data.rarityLabel) }],
          callToAction: { label: 'Ver no álbum', url: data.albumUrl },
          notice: 'A carta já está no seu perfil — este e-mail é só a celebração.',
          footerNote: 'As conquistas ficam registradas no seu perfil público da instituição.',
        }),
        text: [
          greeting(data.recipientName),
          '',
          `Você conquistou a carta ${data.cardName} (${data.rarityLabel}).`,
          data.reasonLabel,
          '',
          'Veja no álbum:',
          data.albumUrl,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'CERTIFICATE_ISSUED': {
      const data = payload as EmailPayloads['CERTIFICATE_ISSUED'];
      return {
        subject: `Seu certificado está pronto: ${data.eventTitle}`,
        html: renderLayout({
          brandName: brand,
          preheader: 'O documento já pode ser baixado e validado.',
          title: 'Seu certificado foi emitido',
          paragraphs: [
            paragraph(greeting(data.recipientName)),
            markup(
              `O certificado de ${strong(data.certificateTitle)} do evento ${strong(data.eventTitle)} está pronto para download.`,
            ),
          ],
          details: [
            ...(data.workloadLabel
              ? [{ label: 'Carga horária', value: escapeHtml(data.workloadLabel) }]
              : []),
            { label: 'Código de validação', value: escapeHtml(data.validationCode) },
          ],
          callToAction: { label: 'Baixar o certificado', url: data.certificateUrl },
          notice:
            'O código de validação permite que qualquer pessoa confira a autenticidade do documento — inclusive quem não tem conta.',
          footerNote: `Validação pública: <span style="word-break:break-all;">${escapeHtml(data.validationUrl)}</span>`,
        }),
        text: [
          greeting(data.recipientName),
          '',
          `Certificado emitido: ${data.certificateTitle} — ${data.eventTitle}.`,
          ...(data.workloadLabel ? [`Carga horária: ${data.workloadLabel}`] : []),
          `Código de validação: ${data.validationCode}`,
          '',
          'Baixe em:',
          data.certificateUrl,
          '',
          `Validação pública: ${data.validationUrl}`,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }

    case 'PARTICIPANT_MESSAGE': {
      const data = payload as EmailPayloads['PARTICIPANT_MESSAGE'];
      /**
       * O ASSUNTO da instituição viaja no assunto do e-mail — é o que a pessoa lê na
       * caixa dela. Antes do nome da instituição, para que a lista de mensagens não
       * vire uma fileira de "EventFlow".
       *
       * O corpo é quebrado em parágrafos e escapado: recado é TEXTO, e um `<script>`
       * digitado no campo vira texto literal em vez de marcação no cliente de quem
       * recebe (o mesmo cuidado do escape da etiqueta do crachá, FASE 31).
       */
      const paragraphs = data.body
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter((block) => block.length > 0);

      return {
        subject: `${data.subject} — ${data.tenantName}`,
        html: renderLayout({
          brandName: brand,
          /**
           * O `preheader` é TEXTO e o layout já o escapa (`escapeHtml`): passar
           * marcação aqui imprimiria `&lt;p …&gt;` no resumo da caixa de entrada — o
           * defeito do negrito visível, que o teste unitário prende.
           */
          preheader: data.subject,
          title: escapeHtml(data.subject),
          paragraphs: [
            paragraph(greeting(data.recipientName)),
            ...paragraphs.map((block) => paragraph(markup(escapeHtml(block).replace(/\n/g, '<br />')))),
          ],
          details: [
            ...(data.eventTitle ? [{ label: 'Evento', value: escapeHtml(data.eventTitle) }] : []),
            ...(data.senderName ? [{ label: 'Enviado por', value: escapeHtml(data.senderName) }] : []),
          ],
          callToAction: { label: 'Abrir na plataforma', url: data.inboxUrl },
          notice:
            'Este recado também fica guardado na sua área do participante, em "Minhas mensagens" — inclusive se você perder este e-mail.',
          footerNote: `Você recebeu esta mensagem de ${escapeHtml(data.tenantName)}.`,
        }),
        text: [
          greeting(data.recipientName),
          '',
          data.subject,
          '',
          ...paragraphs,
          ...(data.eventTitle ? ['', `Evento: ${data.eventTitle}`] : []),
          ...(data.senderName ? [`Enviado por: ${data.senderName}`] : []),
          '',
          'Abra na plataforma:',
          data.inboxUrl,
          '',
          `— ${brand}`,
        ].join('\n'),
      };
    }
  }
}

/**
 * Assuntos e chamadas para a LISTA da caixa de saída, sem precisar renderizar.
 * Usado pelos testes e pela tela de comunicação para descrever cada tipo.
 */
export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  EMAIL_VERIFICATION: 'Confirmação de e-mail',
  PASSWORD_RESET: 'Redefinição de senha',
  MEMBER_INVITATION: 'Convite de equipe',
  REVIEW_ASSIGNED: 'Avaliação atribuída',
  REVIEW_DUE_SOON: 'Prazo de parecer próximo',
  REVIEW_OVERDUE: 'Parecer vencido',
  CARD_GRANTED: 'Carta conquistada',
  CERTIFICATE_ISSUED: 'Certificado emitido',
  PARTICIPANT_MESSAGE: 'Recado ao participante',
};
