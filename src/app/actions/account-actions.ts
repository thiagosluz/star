'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO — Área de conta (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TODA ESCRITA USA O `userId` DA SESSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nenhuma destas actions aceita um id de pessoa vindo do formulário: o dono sai de
 *  `getAuthenticatedUser()`, que lê o cookie de sessão. É o invariante nº 4 aplicado à
 *  identidade — sem isso, a área de conta viraria uma porta para trocar a senha (ou o
 *  segundo fator) de outra pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM CONFERE SENHA, CÓDIGO E TOKEN É A BIBLIOTECA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As actions chamam `auth.api.*` (scrypt, TOTP, tokens de verificação) e traduzem o
 *  resultado para português. Reimplementar qualquer uma dessas conferências aqui
 *  criaria uma segunda régua — e a que vale é a que o servidor aplica de verdade.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTAS MUDANÇAS NÃO ENTRAM NA TRILHA DA INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `audit_logs` tem `tenantId` e RLS: ela registra o que acontece DENTRO de uma
 *  instituição. A identidade é global (ADR-002), então trocar senha ou ligar o segundo
 *  fator não tem onde ser auditado hoje — está declarado como limite no documento da
 *  fase, e não escondido.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import QRCode from 'qrcode';

import { auth } from '@/lib/auth/auth';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  getAccountOverview,
  type AccountOverview,
} from '@/lib/auth/account-service';
import {
  confirmUserAvatarUpload,
  removeUserAvatar,
  requestUserAvatarUpload,
  type UserAvatarTicket,
} from '@/lib/auth/user-avatar-service';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isSameEmail,
  normalizeTotpCode,
  passwordsMatch,
  totpSecretFromUri,
} from '@/domain/account/account-rules';

export interface AccountActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Apoio
// ───────────────────────────────────────────────────────────────────────────────
const NOT_AUTHENTICATED: AccountActionState = {
  ok: false,
  code: 'NOT_AUTHENTICATED',
  message: 'Sessão expirada. Entre novamente.',
};

/**
 * Mensagem de erro da biblioteca, em português.
 *
 * O Better Auth lança `APIError` com `message` genérica ("Bad Request") e o texto real
 * em `body.message`/`body.code` — é de lá que sai a diferença entre "senha incorreta" e
 * "tente novamente em instantes".
 */
function authMessage(error: unknown): { message: string; code?: string } {
  const body = (error as { body?: { message?: unknown } } | null)?.body;
  const raw =
    typeof body?.message === 'string'
      ? body.message
      : typeof (error as { message?: unknown } | null)?.message === 'string'
        ? String((error as { message?: unknown }).message)
        : '';
  const normalized = raw.toLowerCase();

  if (normalized.includes('invalid password') || normalized.includes('invalid credentials')) {
    return { message: 'A senha atual está incorreta.', code: 'INVALID_PASSWORD' };
  }
  if (normalized.includes('invalid code') || normalized.includes('invalid otp')) {
    return { message: 'Código incorreto. Confira o número no aplicativo e tente de novo.', code: 'INVALID_CODE' };
  }
  if (normalized.includes('too many attempts')) {
    return { message: 'Tentativas demais neste código. Entre de novo para gerar outro.', code: 'TOO_MANY_ATTEMPTS' };
  }
  if (normalized.includes('temporarily locked') || normalized.includes('locked')) {
    return { message: 'A conta ficou bloqueada por tentativas erradas. Aguarde alguns minutos.', code: 'LOCKED' };
  }
  if (normalized.includes('password') && normalized.includes('least')) {
    return { message: `A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`, code: 'WEAK_PASSWORD' };
  }
  if (normalized.includes('same password')) {
    return { message: 'A senha nova é igual à atual. Escolha outra.', code: 'SAME_PASSWORD' };
  }
  if (normalized.includes('same') && normalized.includes('email')) {
    return { message: 'Este já é o e-mail da sua conta.', code: 'SAME_EMAIL' };
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return { message: 'Muitas tentativas em sequência. Aguarde um minuto.', code: 'RATE_LIMIT' };
  }
  if (normalized.includes('two factor') && normalized.includes('not enabled')) {
    return { message: 'O segundo fator ainda não está ativo nesta conta.', code: 'TWO_FACTOR_NOT_ENABLED' };
  }
  if (normalized.includes('already set')) {
    return {
      message: 'Sua conta já tem senha. Use a troca de senha abaixo.',
      code: 'PASSWORD_ALREADY_SET',
    };
  }
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A SESSÃO PRECISA SER RECENTE PARA ESTAS OPERAÇÕES
   * ─────────────────────────────────────────────────────────────────────────────
   *  Trocar senha, criar senha e confirmar a senha atual (na troca de e-mail) passam
   *  pelo `sensitiveSessionMiddleware` da biblioteca, que exige sessão criada nas
   *  últimas 24 horas. Não é um estorvo gratuito: é o que impede que uma sessão
   *  abandonada num computador alheio vire troca de senha. A resposta tem de dar o
   *  caminho de volta — a mensagem diz o que fazer, e a tela oferece o link.
   */
  if (normalized.includes('not fresh') || normalized.includes('session is not fresh')) {
    return {
      message: 'Por segurança, esta operação pede uma sessão recente. Entre novamente para continuar.',
      code: 'SESSION_NOT_FRESH',
    };
  }

  return { message: 'Não foi possível concluir a operação. Tente novamente.' };
}

/** Estado da conta para a tela (a página usa; as actions devolvem pedaços). */
export async function loadAccount(): Promise<AccountOverview | null> {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  return getAccountOverview(user.id);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Dados da conta
// ───────────────────────────────────────────────────────────────────────────────
const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Informe seu nome completo (mínimo 3 caracteres).')
    .max(160, 'O nome é longo demais.'),
});

export async function updateAccountProfileAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = profileSchema.safeParse({ name: formData.get('name') });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  try {
    /**
     * `updateUser` da biblioteca, e não um `UPDATE` nosso: é ela que mantém a sessão e
     * o objeto do usuário coerentes (o nome aparece no cabeçalho do shell).
     */
    await auth.api.updateUser({
      body: { name: parsed.data.name },
      headers: await headers(),
    });
  } catch (error) {
    return { ok: false, code: 'INTERNAL', message: authMessage(error).message };
  }

  revalidatePath('/conta');
  return { ok: true, message: 'Nome atualizado.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  E-mail
// ───────────────────────────────────────────────────────────────────────────────
const emailSchema = z.object({
  email: z.email('Informe um e-mail válido.').max(255).toLowerCase(),
  password: z.string().min(1, 'Confirme a sua senha atual.'),
});

/**
 * Troca de e-mail — exige a SENHA ATUAL e confirma no endereço NOVO.
 *
 * A biblioteca não pede a senha nesta operação. Nós pedimos, e a razão é o que está em
 * jogo: quem troca o e-mail passa a receber a redefinição de senha; uma sessão roubada
 * (ou um XSS) bastaria para tomar a conta de forma definitiva. A senha é conferida por
 * `auth.api.verifyPassword` — nunca por comparação nossa.
 *
 * A troca NÃO acontece aqui: vai um link para o endereço novo, e a troca só se aplica
 * no clique. O endereço antigo continua valendo até lá.
 */
export async function requestEmailChangeAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = emailSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  if (isSameEmail(user.email, parsed.data.email)) {
    return {
      ok: false,
      code: 'SAME_EMAIL',
      message: 'Este já é o e-mail da sua conta.',
    };
  }

  const requestHeaders = await headers();

  try {
    await auth.api.verifyPassword({
      body: { password: parsed.data.password },
      headers: requestHeaders,
    });
  } catch (error) {
    return { ok: false, code: 'INVALID_PASSWORD', message: authMessage(error).message };
  }

  try {
    await auth.api.changeEmail({
      body: { newEmail: parsed.data.email, callbackURL: '/conta?email=confirmado' },
      headers: requestHeaders,
    });
  } catch (error) {
    const { message, code } = authMessage(error);
    return { ok: false, code: code ?? 'INTERNAL', message };
  }

  return {
    ok: true,
    message: `Enviamos um link de confirmação para ${parsed.data.email}. O e-mail da conta só muda depois do clique.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Senha
// ───────────────────────────────────────────────────────────────────────────────
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
      .max(PASSWORD_MAX_LENGTH, 'A senha é longa demais.'),
    confirmation: z.string().min(1, 'Repita a senha nova.'),
  })
  .refine(
    (value) => passwordsMatch(value.newPassword, value.confirmation),
    { message: 'A confirmação não confere com a senha nova.', path: ['confirmation'] },
  );

export async function changeAccountPasswordAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmation: formData.get('confirmation'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  try {
    /**
     * `revokeOtherSessions: true` — trocar a senha ENCERRA as outras sessões.
     *
     * É a razão de existir a troca em uma área de segurança: quem troca a senha está
     * dizendo "algo pode ter vazado". Manter os outros dispositivos conectados
     * esvaziaria a decisão. A sessão de quem está trocando continua viva (a
     * biblioteca cuida disso), senão a pessoa seria expulsa da própria tela.
     */
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });
  } catch (error) {
    const { message, code } = authMessage(error);
    return { ok: false, code: code ?? 'INTERNAL', message };
  }

  revalidatePath('/conta');
  return {
    ok: true,
    message: 'Senha alterada. As outras sessões foram encerradas.',
  };
}

const setPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
      .max(PASSWORD_MAX_LENGTH, 'A senha é longa demais.'),
    confirmation: z.string().min(1, 'Repita a senha.'),
  })
  .refine((value) => passwordsMatch(value.newPassword, value.confirmation), {
    message: 'A confirmação não confere com a senha.',
    path: ['confirmation'],
  });

/**
 * Cria a PRIMEIRA senha da conta (contas de convite e do seed não têm uma).
 *
 * Sem a senha atual porque não há o que conferir — a posse da conta é a própria sessão,
 * e o caminho alternativo (a redefinição por e-mail) exige acesso ao endereço, que é
 * exatamente o que quem está aqui já tem.
 */
export async function setAccountPasswordAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = setPasswordSchema.safeParse({
    newPassword: formData.get('newPassword'),
    confirmation: formData.get('confirmation'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  try {
    await auth.api.setPassword({
      body: { newPassword: parsed.data.newPassword },
      headers: await headers(),
    });
  } catch (error) {
    const { message, code } = authMessage(error);
    return { ok: false, code: code ?? 'INTERNAL', message };
  }

  revalidatePath('/conta');
  return { ok: true, message: 'Senha criada. Agora você pode entrar com e-mail e senha.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Segundo fator
// ───────────────────────────────────────────────────────────────────────────────
const passwordOnlySchema = z.object({
  password: z.string().min(1, 'Confirme a sua senha.'),
});

/**
 * Passo 1 do enrollment: gera o segredo e devolve o URI + os códigos de recuperação.
 *
 * O segundo fator NÃO está ligado aqui — a biblioteca grava o segredo com
 * `verified: false` e só liga quando um código válido confirmar (`confirmTwoFactor`).
 * Sem esse passo, quem lê o QR errado (ou o digita errado) se tranca fora no minuto
 * seguinte, e é por isso que `skipVerificationOnEnable` ficou desligado no `auth.ts`.
 *
 * Os códigos de recuperação aparecem UMA vez: a biblioteca guarda o hash deles. A tela
 * avisa isso, e o teste E2E prova que eles servem para entrar sem o aplicativo.
 */
export async function startTwoFactorAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = passwordOnlySchema.safeParse({ password: formData.get('password') });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Confirme a sua senha.',
    };
  }

  try {
    const result = await auth.api.enableTwoFactor({
      body: { password: parsed.data.password },
      headers: await headers(),
    });

    const payload = result as unknown as { totpURI?: string; backupCodes?: string[] };

    if (!payload.totpURI || !payload.backupCodes) {
      return {
        ok: false,
        code: 'UNSUPPORTED_METHOD',
        message: 'Não foi possível gerar o código do aplicativo autenticador.',
      };
    }

    /**
     * O QR é gerado AQUI, no servidor, e o que desce para a tela é a imagem.
     *
     * O URI do `otpauth://` carrega a semente do TOTP: mandá-lo para o navegador
     * significaria deixá-lo no DOM (e em qualquer log de rede) quando o que a pessoa
     * precisa é só apontar a câmera. A chave digitável sai separada, porque quem não
     * consegue ler o QR precisa dela — e ela é a mesma informação, oferecida de forma
     * explícita em vez de embutida em um link.
     */
    const qrDataUrl = await QRCode.toDataURL(payload.totpURI, { margin: 1, width: 320 });

    return {
      ok: true,
      message: 'Escaneie o código no aplicativo e confirme com o número de seis dígitos.',
      data: {
        qrDataUrl,
        manualKey: totpSecretFromUri(payload.totpURI),
        backupCodes: payload.backupCodes,
      },
    };
  } catch (error) {
    const { message, code } = authMessage(error);
    return { ok: false, code: code ?? 'INTERNAL', message };
  }
}

export async function confirmTwoFactorAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const code = normalizeTotpCode(formData.get('code'));

  if (!code) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Informe o número de seis dígitos do aplicativo.',
    };
  }

  try {
    await auth.api.verifyTOTP({ body: { code }, headers: await headers() });
  } catch (error) {
    const { message, code: errorCode } = authMessage(error);
    return { ok: false, code: errorCode ?? 'INTERNAL', message };
  }

  revalidatePath('/conta');
  return {
    ok: true,
    message: 'Segundo fator ativo. Guarde os códigos de recuperação em lugar seguro.',
  };
}

export async function disableTwoFactorAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = passwordOnlySchema.safeParse({ password: formData.get('password') });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Confirme a sua senha.',
    };
  }

  try {
    await auth.api.disableTwoFactor({
      body: { password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    const { message, code } = authMessage(error);
    return { ok: false, code: code ?? 'INTERNAL', message };
  }

  revalidatePath('/conta');
  return { ok: true, message: 'Segundo fator desligado. Sua conta volta a entrar só com a senha.' };
}

/** Gera um jogo NOVO de códigos (o anterior deixa de valer, por desenho da biblioteca). */
export async function regenerateBackupCodesAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = passwordOnlySchema.safeParse({ password: formData.get('password') });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Confirme a sua senha.',
    };
  }

  try {
    const result = await auth.api.generateBackupCodes({
      body: { password: parsed.data.password },
      headers: await headers(),
    });

    const payload = result as unknown as { backupCodes?: string[] };

    if (!payload.backupCodes) {
      return { ok: false, code: 'INTERNAL', message: 'Não foi possível gerar os códigos.' };
    }

    return {
      ok: true,
      message: 'Códigos novos gerados. Os anteriores não funcionam mais.',
      data: { backupCodes: payload.backupCodes },
    };
  } catch (error) {
    const { message, code } = authMessage(error);
    return { ok: false, code: code ?? 'INTERNAL', message };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Sessões
// ───────────────────────────────────────────────────────────────────────────────
const sessionSchema = z.object({ token: z.string().trim().min(1).max(512) });

export async function revokeSessionAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = sessionSchema.safeParse({ token: formData.get('token') });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Sessão não identificada.' };
  }

  try {
    /**
     * A biblioteca confere que o token é de uma sessão DESTA pessoa — é por isso que
     * não fazemos o `delete` por conta própria: um token vindo do formulário não pode
     * encerrar a sessão de outra conta.
     */
    await auth.api.revokeSession({
      body: { token: parsed.data.token },
      headers: await headers(),
    });
  } catch (error) {
    const { message } = authMessage(error);
    return { ok: false, code: 'INTERNAL', message };
  }

  revalidatePath('/conta');
  return { ok: true, message: 'Sessão encerrada.' };
}

export async function revokeOtherSessionsAction(): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch (error) {
    const { message } = authMessage(error);
    return { ok: false, code: 'INTERNAL', message };
  }

  revalidatePath('/conta');
  return { ok: true, message: 'As outras sessões foram encerradas. Esta continua ativa.' };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Foto
// ───────────────────────────────────────────────────────────────────────────────
const avatarRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.coerce.number().int().positive(),
  magicBytes: z.array(z.coerce.number().int().min(0).max(255)).max(16).optional(),
});

export async function requestAccountAvatarUploadAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const magicRaw = formData.get('magicBytes');

  const parsed = avatarRequestSchema.safeParse({
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType') ?? '',
    sizeBytes: Number(formData.get('sizeBytes')),
    ...(typeof magicRaw === 'string' && magicRaw.length > 0
      ? { magicBytes: magicRaw.split(',').map(Number) }
      : {}),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do envio inválidos.' };
  }

  const result = await requestUserAvatarUpload({
    userId: user.id,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    magicBytes: parsed.data.magicBytes ?? null,
  });

  if (!result.ok) return result;

  const ticket: UserAvatarTicket = result;

  return {
    ok: true,
    data: {
      uploadUrl: ticket.uploadUrl,
      objectKey: ticket.objectKey,
      bucket: ticket.bucket,
      requiredHeaders: ticket.requiredHeaders,
      mimeType: ticket.mimeType,
      maxBytes: ticket.maxBytes,
    },
  };
}

const avatarConfirmSchema = z.object({
  objectKey: z.string().trim().min(1).max(1024),
  bucket: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(300),
  mimeType: z.string().trim().max(120),
  sizeBytes: z.coerce.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i, 'Checksum SHA-256 inválido.'),
});

export async function confirmAccountAvatarUploadAction(
  _prev: AccountActionState | null,
  formData: FormData,
): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const parsed = avatarConfirmSchema.safeParse({
    objectKey: formData.get('objectKey'),
    bucket: formData.get('bucket'),
    fileName: formData.get('fileName'),
    mimeType: formData.get('mimeType') ?? '',
    sizeBytes: Number(formData.get('sizeBytes')),
    checksum: formData.get('checksum'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados da confirmação inválidos.' };
  }

  const result = await confirmUserAvatarUpload({ userId: user.id, ...parsed.data });

  if (!result.ok) return result;

  revalidatePath('/conta');
  return {
    ok: true,
    message: 'Foto atualizada.',
    data: { url: result.url, sizeBytes: result.sizeBytes, sourceBytes: result.sourceBytes },
  };
}

export async function removeAccountAvatarAction(): Promise<AccountActionState> {
  const user = await getAuthenticatedUser();
  if (!user) return NOT_AUTHENTICATED;

  const result = await removeUserAvatar(user.id);

  if (!result.ok) return result;

  revalidatePath('/conta');
  return { ok: true, message: 'Foto removida da sua conta.' };
}
