'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Certificação
 *
 *  Três operações, três públicos:
 *    • `requestMyCertificateAction`  — o participante pede o PRÓPRIO certificado;
 *    • `issueEventCertificatesAction` — a equipe emite em lote para o evento;
 *    • `revokeCertificateAction`      — a equipe revoga (fraude comprovada).
 *
 *  A autorização é verificada aqui, não na página: uma Server Action é um endpoint
 *  HTTP como qualquer outro, e esconder botão nunca foi controle de acesso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { CERTIFICATE_KINDS, type CertificateKind } from '@/domain/certificates/certificate-rules';
import { CERTIFICATE_POLICY_AGGREGATION } from '@/domain/certificates/certificate-policy-rules';
import { saveCertificatePolicy } from '@/lib/certificates/certificate-policy-service';
import {
  backgroundFitNotice,
  buildLayoutFromRows,
  certificatePreviewSample,
  defaultLayout,
  normalizeLayout,
  parsePageFormat,
  validateLayout,
  type CertificateBackground,
} from '@/domain/certificates/certificate-layout-rules';
import {
  clearTemplateBackground,
  deleteCertificateTemplate,
  getCertificateTemplate,
  readTemplateBackground,
  saveCertificateTemplate,
  setTemplateBackground,
  type SavedLayoutInput,
} from '@/lib/certificates/certificate-template-service';
import { renderCertificateLayoutSvg } from '@/lib/certificates/layout-renderer';
import {
  issueCertificate,
  requestEventCertificates,
  revokeCertificate,
  getCertificateDownloadUrl,
} from '@/lib/certificates/certificate-service';

export interface CertificateActionState {
  ok: boolean;
  code?: string;
  message?: string;
  /** Motivos por campo, quando a recusa vem de um validador do domínio. */
  details?: readonly string[];
  data?: Record<string, unknown>;
  values?: {
    minRatioPercent?: string;
    minMinutes?: string;
  };
}


// ───────────────────────────────────────────────────────────────────────────────
//  Participante: pedir o próprio certificado
// ───────────────────────────────────────────────────────────────────────────────
const requestSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  kind: z.enum(CERTIFICATE_KINDS as unknown as [CertificateKind, ...CertificateKind[]]),
  activityId: z.string().uuid().optional(),
});

export async function requestMyCertificateAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = requestSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    kind: formData.get('kind'),
    activityId: (formData.get('activityId') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para emitir o certificado.' };
  }

  const auth = await guardAction<CertificateActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
  });

  if (!auth.ok) return auth.state;

  /**
   * O certificado é SEMPRE do usuário da sessão. Não existe parâmetro `userId`
   * vindo do formulário: aceitar um id de terceiro permitiria emitir certificado
   * de presença para quem nunca apareceu.
   */
  const result = await issueCertificate({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    userId: auth.userId,
    kind: parsed.data.kind,
    activityId: parsed.data.activityId ?? null,
    actorId: auth.userId,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/certificados'));

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.generated
      ? 'Certificado emitido e pronto para download.'
      : result.existing
        ? 'Certificado já emitido — veja a lista abaixo.'
        : 'Certificado em processamento. Recarregue em alguns instantes.',
    data: {
      certificateId: result.certificateId,
      validationCode: result.validationCode,
      generated: result.generated,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Equipe: emissão em lote
// ───────────────────────────────────────────────────────────────────────────────
const batchSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  kinds: z.string().trim().min(1),
});

export async function issueEventCertificatesAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = batchSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    kinds: formData.getAll('kinds').join(','),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione o evento e ao menos um tipo.' };
  }

  const kinds = parsed.data.kinds
    .split(',')
    .map((kind) => kind.trim().toUpperCase())
    .filter((kind): kind is CertificateKind => (CERTIFICATE_KINDS as readonly string[]).includes(kind));

  if (kinds.length === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Selecione ao menos um tipo de certificado.' };
  }

  const auth = await guardAction<CertificateActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  });

  if (!auth.ok) return auth.state;

  const result = await requestEventCertificates({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    kinds,
    actorId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  /**
   * A geração do arquivo é enfileirada em seguida — ou feita na hora, se a fila
   * estiver indisponível. O lote pode ser grande, então cada certificado é
   * processado uma vez (o `jobId` é o id do certificado e evita duplicidade).
   */
  let generated = 0;

  for (const certificate of result.certificates) {
    const issued = await issueCertificate({
      tenantId: auth.tenantId,
      eventId: parsed.data.eventId,
      userId: certificate.userId,
      kind: certificate.kind,
      actorId: auth.userId,
    });

    if (issued.ok && issued.generated) generated += 1;
  }

  /**
   * A tela que DISPAROU o lote é a do evento (FASE 85), e o inventário é onde os
   * documentos emitidos aparecem. Revalidar `/certificados` — a tela pessoal — era
   * o endereço antigo do painel e não mostra resultado de lote nenhum.
   */
  revalidatePath(
    tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/certificados`),
  );
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/certificados'));

  return {
    ok: true,
    message: `${result.requested} certificado(s) solicitado(s) — ${generated} gerado(s) agora, o restante na fila.${
      result.discarded.length > 0
        ? ` ${result.discarded.length} tentativa(s) descartada(s) por falta de fato — a lista com o motivo está na simulação acima.`
        : ''
    }`,
    data: { requested: result.requested, skipped: result.skipped, generated },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Equipe: revogação
// ───────────────────────────────────────────────────────────────────────────────
const revokeSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  certificateId: z.string().uuid(),
  reason: z.string().trim().min(8, 'Descreva o motivo da revogação (mínimo 8 caracteres).').max(400),
});

export async function revokeCertificateAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = revokeSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    certificateId: formData.get('certificateId'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos para revogar.',
    };
  }

  const auth = await guardAction<CertificateActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_REVOKE,
  });

  if (!auth.ok) return auth.state;

  const result = await revokeCertificate({
    tenantId: auth.tenantId,
    certificateId: parsed.data.certificateId,
    reason: parsed.data.reason,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/certificados'));

  return {
    ok: true,
    message: 'Certificado revogado. A página pública passará a exibir o documento como inválido.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Equipe: a política de presença do evento (FASE 86 · fatia 5)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os campos do formulário, em UNIDADES HUMANAS.
 *
 * `minRatioPercent` é percentual (50–100) e o domínio guarda FRAÇÃO (0,5–1,0): a
 * conversão acontece AQUI, num lugar só, para a tela falar a língua da regra que
 * ela anuncia ("75 % da carga") enquanto o dado gravado mantém a forma que a
 * emissão consome. `z.coerce` é necessário porque `formData` entrega texto; um
 * campo vazio vira 0 e o DOMÍNIO recusa (0 % é proibido de propósito), devolvendo
 * o motivo em vez de um "campo obrigatório" genérico.
 *
 * `requireCheckOut` e `aggregateBy` NÃO vêm do formulário: esta versão não os
 * deixa escolher, e o servidor os força (ver o cabeçalho de
 * `certificate-policy-rules.ts`). Aceitá-los da requisição abriria a porta que o
 * domínio fecha.
 */
const certificatePolicySchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  minRatioPercent: z.coerce.number().finite(),
  minMinutes: z.coerce.number().finite(),
});

export async function saveCertificatePolicyAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const rawRatio = formData.get('minRatioPercent');
  const rawMinutes = formData.get('minMinutes');
  const values = {
    minRatioPercent: typeof rawRatio === 'string' ? rawRatio : '',
    minMinutes: typeof rawMinutes === 'string' ? rawMinutes : '',
  };

  const parsed = certificatePolicySchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    minRatioPercent: rawRatio,
    minMinutes: rawMinutes,
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe o percentual mínimo (50 a 100) e o piso em minutos (1 a 240).',
      values,
    };
  }

  /**
   * A guarda é `event:manage`, e nos DOIS escopos: coordenar o evento pela
   * instituição e ser a equipe do evento são o caso normal — exigir o escopo largo
   * recusaria quem organiza o dia. A permissão da PÁGINA é `certificate:issue`
   * (quem lê a política); a de EDITAR é esta, mais estreita.
   */
  const auth = await guardAction<CertificateActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
    eventId: parsed.data.eventId,
    allowedScopes: ['TENANT', 'EVENT'],
  });

  if (!auth.ok) return auth.state;

  const result = await saveCertificatePolicy({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    actorId: auth.userId,
    policy: {
      minRatio: parsed.data.minRatioPercent / 100,
      minMinutes: parsed.data.minMinutes,
      // Forçados pelo servidor — o formulário não os envia (ver o comentário acima).
      requireCheckOut: true,
      aggregateBy: CERTIFICATE_POLICY_AGGREGATION,
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: result.message,
      details: result.details,
      values,
    };
  }

  revalidatePath(
    tenantPath(
      parsed.data.tenantSlug,
      `/administracao/eventos/${parsed.data.eventId}/certificados`,
    ),
  );

  return {
    ok: true,
    message:
      'Política de presença salva. A simulação e a próxima emissão já usam esta regra.',
    data: {
      minRatio: result.policy.minRatio,
      minMinutes: result.policy.minMinutes,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Download autenticado (o público é a rota por código)
// ───────────────────────────────────────────────────────────────────────────────
export async function requestCertificateDownloadAction(
  _prev: CertificateActionState | null,
  formData: FormData,
): Promise<CertificateActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      certificateId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      certificateId: formData.get('certificateId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para o download.' };
  }

  const auth = await guardAction<CertificateActionState>({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
  });

  if (!auth.ok) return auth.state;

  const result = await getCertificateDownloadUrl({
    tenantId: auth.tenantId,
    certificateId: parsed.data.certificateId,
    userId: auth.userId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return { ok: true, message: 'Download pronto.', data: { url: result.url, fileName: result.fileName } };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODELO VISUAL DO CERTIFICADO — FASE 40
//
//  Cinco operações, um público: quem administra a instituição e responde pela
//  identidade dos documentos. A permissão é `event:manage` e não `certificate:issue`:
//  emitir é do dia do evento, desenhar o documento é ato de configuração da
//  instituição — quem só emite não deve poder mudar a cara do certificado.
//
//  TODA autorização é verificada aqui. A tela esconder o formulário não protege nada.
// ═══════════════════════════════════════════════════════════════════════════════
export interface CertificateTemplateActionState {
  ok: boolean;
  code?: string;
  message?: string;
  /** Problemas item a item (layout recusado, arte recusada). */
  details?: readonly string[];
  /**
   * A MESMA forma de `AdminActionState` — é o que permite usar a moldura de
   * formulário do painel (`AdminForm`) sem um componente paralelo que ficaria para
   * trás no primeiro ajuste. `previewSvg` e `notice` viajam aqui dentro.
   */
  data?: Record<string, unknown>;
}

/**
 * Lê as linhas do formulário.
 *
 * O formulário manda as listas por `getAll`, na mesma ordem de propósito: um array
 * por coluna, e o índice é a linha. Um JSON num campo oculto seria mais simples — e
 * transformaria qualquer divergência de ordem em desenho errado gravado em silêncio.
 */
function layoutRowsFromForm(formData: FormData): SavedLayoutInput {
  const list = (name: string): string[] => formData.getAll(name).map((value) => String(value));

  return {
    page: String(formData.get('page') ?? 'A4_LANDSCAPE'),
    ids: list('elementId'),
    kinds: list('elementKind'),
    texts: list('elementText'),
    variables: list('elementVariable'),
    xMm: list('elementX'),
    yMm: list('elementY'),
    widthMm: list('elementWidth'),
    heightMm: list('elementHeight'),
    aligns: list('elementAlign'),
    fonts: list('elementFont'),
    sizePt: list('elementSize'),
    colors: list('elementColor'),
    lineHeights: list('elementLineHeight'),
  };
}

const templateBaseSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  templateId: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(120),
  eventId: z.string().uuid().optional(),
  kind: z.string().trim().max(40).optional(),
  presetId: z.string().trim().max(60).optional(),
});

/**
 * O caminho da tela de modelos do alvo.
 *
 * O modelo do EVENTO mora na rota do evento (FASE 86) e o padrão da instituição na
 * rota histórica. Depois de salvar, a pessoa tem de cair NA TELA ONDE ESTAVA — o
 * redirecionamento para a rota da instituição arrancaria o organizador do evento no
 * primeiro salvamento.
 */
function templatesPath(tenantSlug: string, eventId: string | null): string {
  return eventId
    ? tenantPath(tenantSlug, `/administracao/eventos/${eventId}/certificados/modelos`)
    : tenantPath(tenantSlug, '/administracao/certificados/modelos');
}

/**
 * O alvo que o formulário declara, com a distinção que o `FormData` não faz:
 * campo AUSENTE é "não sei" (`undefined`), campo vazio é "padrão da instituição"
 * (`null`) e o valor é o evento. A distinção importa porque o serviço usa
 * `undefined` para não filtrar e `null` para exigir o padrão.
 */
function scopedEventId(formData: FormData): string | null | undefined {
  if (!formData.has('eventId')) return undefined;

  const raw = String(formData.get('eventId') ?? '').trim();
  return raw || null;
}

export async function saveCertificateTemplateAction(
  _prev: CertificateTemplateActionState | null,
  formData: FormData,
): Promise<CertificateTemplateActionState> {
  const parsed = templateBaseSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    templateId: (formData.get('templateId') as string) || undefined,
    name: formData.get('name'),
    eventId: (formData.get('eventId') as string) || undefined,
    kind: (formData.get('kind') as string) || undefined,
    presetId: (formData.get('presetId') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para salvar o modelo.' };
  }

  const auth = await guardAction<CertificateActionState>({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const hasRows = formData.getAll('elementKind').length > 0;
  const eventId = parsed.data.eventId ?? null;

  const result = await saveCertificateTemplate({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    templateId: parsed.data.templateId ?? null,
    name: parsed.data.name,
    eventId,
    kind: parsed.data.kind ?? null,
    presetId: parsed.data.presetId ?? null,
    rows: hasRows ? layoutRowsFromForm(formData) : null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidatePath(templatesPath(parsed.data.tenantSlug, eventId));

  /**
   * ─── O MODELO NOVO CAI NO PRÓPRIO ENDEREÇO (e não numa mensagem na tela) ────────
   *
   *  Salvar um modelo NOVO pelo formulário deixava a página onde ela estava: a URL
   *  continuava `?novo=<modelo pronto>`, e é a URL que monta o editor. O resultado era
   *  o modelo existindo no banco enquanto a tela seguia desenhando "modelo novo" — a
   *  caixa de arte dizia "salve o modelo primeiro" **depois** de salvar, o `templateId`
   *  não existia para o upload e o organizador tinha de recarregar para continuar.
   *
   *  Navegar para `?modelo=<id>` resolve as três coisas de uma vez: a tela reabre com o
   *  identificador, com a arte que houver e com o layout gravado. É o mesmo caminho do
   *  rascunho de submissão (revisão da FASE 4): depois de criar, a pessoa está NA coisa
   *  criada. O aviso de sucesso viaja na URL porque o estado da ação não sobrevive à
   *  navegação.
   */
  if (!parsed.data.templateId) {
    redirect(`${templatesPath(parsed.data.tenantSlug, eventId)}?modelo=${result.templateId}&salvo=1`);
  }

  return {
    ok: true,
    message: 'Modelo salvo. Os certificados já emitidos continuam com o desenho que tinham.',
    data: { templateId: result.templateId },
  };
}

/**
 * Prévia fiel: o SVG sai do MESMO renderizador que gera o arquivo emitido.
 *
 * A prévia montada na tela (com as caixas arrastáveis) serve para POSICIONAR; quem
 * mostra o documento é esta renderização. Se ela viesse de um desenho paralelo no
 * navegador, o organizador aprovaria na tela um certificado que não é o que sai.
 */
export async function previewCertificateTemplateAction(
  _prev: CertificateTemplateActionState | null,
  formData: FormData,
): Promise<CertificateTemplateActionState> {
  const parsed = templateBaseSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    templateId: (formData.get('templateId') as string) || undefined,
    name: formData.get('name') ?? 'Prévia',
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para a prévia.' };
  }

  const auth = await guardAction<CertificateActionState>({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const current = parsed.data.templateId
    ? await getCertificateTemplate(auth.tenantId, parsed.data.templateId)
    : null;

  const layout = buildPreviewLayout({
    rows: formData.getAll('elementKind').length > 0 ? layoutRowsFromForm(formData) : null,
    background: current?.layout.background ?? null,
  });

  const verdict = validateLayout(layout);
  if (!verdict.ok) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A prévia não pôde ser gerada: o modelo tem problemas.',
      details: verdict.issues.map((issue) => issue.message),
    };
  }

  const backgroundBytes = await readTemplateBackground(layout);

  const full = certificatePreviewSample(layout, 'FULL');
  const worst = certificatePreviewSample(layout, 'WORST_CASE');

  const renderVariants = (values: typeof full.values): string =>
    renderCertificateLayoutSvg({
      /**
       * A amostra resolve o CORPO do gabarito (FASE 86): o renderizador imprime
       * `values.corpo` e não reinterpreta o elemento `BODY`, então entregar o exemplo do
       * catálogo faria a prévia mostrar a frase de mentira no lugar do texto que o
       * organizador escreveu.
       */
      values,
      layout,
      backgroundBytes,
      issuedAt: new Date('2026-01-01T12:00:00.000Z'),
    });

  return {
    ok: true,
    message: 'Prévia atualizada.',
    data: {
      previewSvg: renderVariants(full.values),
      previewWorstSvg: renderVariants(worst.values),
      notice: layout.background ? backgroundFitNotice(layout.background, layout.page) : null,
    },
  };
}

/** Monta o layout da prévia sem tocar no banco: linhas do formulário e/ou arte atual. */
function buildPreviewLayout(input: { rows: SavedLayoutInput | null; background: CertificateBackground | null }) {
  if (!input.rows) {
    return normalizeLayout({ ...defaultLayout(), background: input.background });
  }

  return buildLayoutFromRows({
    page: parsePageFormat(input.rows.page) ?? 'A4_LANDSCAPE',
    background: input.background,
    ids: input.rows.ids,
    kinds: input.rows.kinds,
    texts: input.rows.texts,
    variables: input.rows.variables,
    xMm: input.rows.xMm,
    yMm: input.rows.yMm,
    widthMm: input.rows.widthMm,
    heightMm: input.rows.heightMm,
    aligns: input.rows.aligns,
    fonts: input.rows.fonts,
    sizePt: input.rows.sizePt,
    colors: input.rows.colors,
    lineHeights: input.rows.lineHeights,
  });
}

/**
 * Upload da arte de fundo.
 *
 * O arquivo chega pelo FormData (e não por URL assinada) porque a validação precisa
 * dos BYTES: o tipo que vale é o detectado pela assinatura do arquivo, e as medidas
 * que decidem o recorte saem do próprio JPEG. O limite de corpo da Server Action já
 * cobre o teto da arte.
 */
export async function uploadTemplateBackgroundAction(
  _prev: CertificateTemplateActionState | null,
  formData: FormData,
): Promise<CertificateTemplateActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      templateId: z.string().uuid(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      templateId: formData.get('templateId'),
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Modelo não identificado.' };
  }

  const auth = await guardAction<CertificateActionState>({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const file = formData.get('background');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Escolha o arquivo da arte de fundo.' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const eventId = scopedEventId(formData);

  const result = await setTemplateBackground({
    tenantId: auth.tenantId,
    templateId: parsed.data.templateId,
    bytes,
    eventId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidatePath(templatesPath(parsed.data.tenantSlug, eventId ?? null));

  return {
    ok: true,
    message: 'Arte de fundo aplicada ao modelo.',
    data: { templateId: parsed.data.templateId, notice: result.notice },
  };
}

export async function clearTemplateBackgroundAction(
  _prev: CertificateTemplateActionState | null,
  formData: FormData,
): Promise<CertificateTemplateActionState> {
  const parsed = z
    .object({ tenantSlug: z.string().trim().min(1).max(63), templateId: z.string().uuid() })
    .safeParse({ tenantSlug: formData.get('tenantSlug'), templateId: formData.get('templateId') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Modelo não identificado.' };
  }

  const auth = await guardAction<CertificateActionState>({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const eventId = scopedEventId(formData);

  const result = await clearTemplateBackground({
    tenantId: auth.tenantId,
    templateId: parsed.data.templateId,
    eventId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(templatesPath(parsed.data.tenantSlug, eventId ?? null));

  return { ok: true, message: 'Arte removida. O modelo volta ao fundo branco.' };
}

export async function deleteCertificateTemplateAction(
  _prev: CertificateTemplateActionState | null,
  formData: FormData,
): Promise<CertificateTemplateActionState> {
  const parsed = z
    .object({ tenantSlug: z.string().trim().min(1).max(63), templateId: z.string().uuid() })
    .safeParse({ tenantSlug: formData.get('tenantSlug'), templateId: formData.get('templateId') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Modelo não identificado.' };
  }

  const auth = await guardAction<CertificateActionState>({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const eventId = scopedEventId(formData);

  const result = await deleteCertificateTemplate({
    tenantId: auth.tenantId,
    templateId: parsed.data.templateId,
    eventId,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(templatesPath(parsed.data.tenantSlug, eventId ?? null));

  return {
    ok: true,
    message: 'Modelo excluído. Os certificados que usaram este desenho continuam válidos e inalterados.',
  };
}

/**
 * A porta para o `<form action={...}>` da galeria.
 *
 * O `<form action>` do React só aceita `(formData) => void`; a ação com
 * `useActionState` recebe `(prev, formData)`. Em vez de escolher uma das duas — e
 * perder o "excluir" sem JavaScript ou o aviso de resultado — as duas portas chamam
 * o MESMO serviço (mesma decisão da FASE 38).
 */
export async function deleteCertificateTemplateFormAction(formData: FormData): Promise<void> {
  await deleteCertificateTemplateAction(null, formData);
}