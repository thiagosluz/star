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

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { CERTIFICATE_KINDS, type CertificateKind } from '@/domain/certificates/certificate-rules';
import {
  backgroundFitNotice,
  buildLayoutFromRows,
  defaultLayout,
  normalizeLayout,
  parsePageFormat,
  sampleVariableValues,
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
  data?: Record<string, unknown>;
}

async function guard(input: {
  tenantSlug: string;
  permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
  requiresOwnership?: boolean;
}): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: CertificateActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Você não tem vínculo ativo com esta instituição.',
      },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  const allowed = can(
    principal,
    input.permission,
    { scope: 'TENANT' },
    input.requiresOwnership ? { ownerId: user.id } : undefined,
  );

  if (!allowed) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: `Permissão negada: ${input.permission}.` },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
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

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
    requiresOwnership: true,
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

  const auth = await guard({
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

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/certificados'));

  return {
    ok: true,
    message: `${result.requested} certificado(s) solicitado(s) — ${generated} gerado(s) agora, o restante na fila.${
      result.skipped > 0 ? ` ${result.skipped} participante(s) não elegível(is).` : ''
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

  const auth = await guard({
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

  const auth = await guard({
    tenantSlug: parsed.data.tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_READ_OWN,
    requiresOwnership: true,
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

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const hasRows = formData.getAll('elementKind').length > 0;

  const result = await saveCertificateTemplate({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    templateId: parsed.data.templateId ?? null,
    name: parsed.data.name,
    eventId: parsed.data.eventId ?? null,
    kind: parsed.data.kind ?? null,
    presetId: parsed.data.presetId ?? null,
    rows: hasRows ? layoutRowsFromForm(formData) : null,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/certificados/modelos'));

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
    redirect(
      tenantPath(
        parsed.data.tenantSlug,
        `/administracao/certificados/modelos?modelo=${result.templateId}&salvo=1`,
      ),
    );
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

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
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

  const svg = renderCertificateLayoutSvg({
    values: sampleVariableValues(),
    layout,
    backgroundBytes,
    issuedAt: new Date('2026-01-01T12:00:00.000Z'),
  });

  return {
    ok: true,
    message: 'Prévia atualizada.',
    data: { previewSvg: svg, notice: layout.background ? backgroundFitNotice(layout.background, layout.page) : null },
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

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const file = formData.get('background');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Escolha o arquivo da arte de fundo.' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await setTemplateBackground({
    tenantId: auth.tenantId,
    templateId: parsed.data.templateId,
    bytes,
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message, details: result.details };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/certificados/modelos'));

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

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const result = await clearTemplateBackground({ tenantId: auth.tenantId, templateId: parsed.data.templateId });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/certificados/modelos'));

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

  const auth = await guard({ tenantSlug: parsed.data.tenantSlug, permission: PERMISSIONS.EVENT_MANAGE });
  if (!auth.ok) return auth.state;

  const result = await deleteCertificateTemplate({ tenantId: auth.tenantId, templateId: parsed.data.templateId });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  revalidatePath(tenantPath(parsed.data.tenantSlug, '/administracao/certificados/modelos'));

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
