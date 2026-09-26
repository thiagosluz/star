'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO — Autenticação
 *
 *  Encapsulam o Better Auth em Server Actions com validação de entrada (Zod) e
 *  tradução de erro. As páginas não conhecem a biblioteca de auth; conhecem
 *  estes casos de uso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/lib/auth/auth';
import { ACTIVE_TENANT_COOKIE, serializeActiveTenant } from '@/lib/auth/session';
import { cookies } from 'next/headers';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  normalizeBackupCode,
  normalizeTotpCode,
  passwordsMatch,
} from '@/domain/account/account-rules';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

export interface ActionState {
  ok: boolean;
  message?: string;
  /**
   * Código do erro, quando a tela precisa reagir de forma diferente da mensagem
   * (FASE 47: `INVALID_TOKEN` no link vencido, `SESSION_NOT_FRESH` na conta).
   */
  code?: string;
  fieldErrors?: Record<string, string[]>;
}

const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Informe seu nome completo (mínimo 3 caracteres).')
    .max(160),
  email: z.email('Informe um e-mail válido.').max(255).toLowerCase(),
  password: z
    .string()
    .min(10, 'A senha deve ter ao menos 10 caracteres.')
    .max(128, 'A senha é longa demais.'),
});

const signInSchema = z.object({
  email: z.email('Informe um e-mail válido.').max(255).toLowerCase(),
  password: z.string().min(1, 'Informe sua senha.'),
});

/** Traduz erros do Better Auth para mensagens em português, sem vazar detalhes. */
function translateAuthError(message: string | undefined): string {
  const normalized = (message ?? '').toLowerCase();

  if (normalized.includes('invalid email or password')) {
    return 'E-mail ou senha incorretos.';
  }
  if (normalized.includes('user already exists') || normalized.includes('already exists')) {
    return 'Já existe uma conta com este e-mail.';
  }
  if (normalized.includes('password') && normalized.includes('least')) {
    return 'A senha não atende ao tamanho mínimo exigido.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Muitas tentativas em sequência. Aguarde um minuto e tente novamente.';
  }
  return 'Não foi possível concluir a operação. Tente novamente.';
}

/**
 * Extrai a mensagem de um erro do Better Auth.
 *
 * O Better Auth lança `APIError`, cujo `message` é genérico ("Bad Request") e o
 * texto real vem em `body.message`. Quando a aplicação roda em produção, uma
 * resposta 429 do rate limiter precisa chegar ao usuário como "aguarde um
 * minuto", não como uma falha genérica.
 */
function authErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const body = (error as { body?: { message?: unknown } }).body;
    if (body && typeof body.message === 'string') return body.message;

    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cadastro
// ───────────────────────────────────────────────────────────────────────────────
export async function signUpAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      },
      headers: await headers(),
    });
  } catch (error) {
    return {
      ok: false,
      message: translateAuthError(authErrorMessage(error)),
    };
  }

  /**
   * Um visitante que se cadastra a partir da página de uma atividade deve voltar
   * para lá, não para o seletor genérico. Aceitamos apenas caminho relativo.
   */
  const intendedDestination = formData.get('redirectTo');
  if (
    typeof intendedDestination === 'string' &&
    intendedDestination.startsWith('/') &&
    !intendedDestination.startsWith('//')
  ) {
    redirect(intendedDestination);
  }

  redirect('/selecionar-instituicao');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Login
// ───────────────────────────────────────────────────────────────────────────────
export async function signInAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  /**
   * Slug da instituição que originou o login. Quando o usuário entra por
   * `ufba.lvh.me/login`, já sabemos o contexto desejado — e o definimos ANTES
   * de redirecionar, para que ele caia direto no painel certo.
   */
  const intendedTenant = formData.get('tenantSlug');
  const redirectTo = typeof formData.get('redirectTo') === 'string'
    ? String(formData.get('redirectTo'))
    : null;

  let result: unknown;

  try {
    result = await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    return {
      ok: false,
      message: translateAuthError(authErrorMessage(error)),
    };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  SEGUNDO FATOR: A SESSÃO AINDA NÃO EXISTE (FASE 47)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Com o segundo fator ligado, a senha correta NÃO cria sessão: a biblioteca
   *  responde `twoFactorRedirect` e deixa um cookie assinado de curta duração que
   *  autoriza apenas o desafio. A sessão nasce quando o código for aceito.
   *
   *  O contexto (instituição de origem e destino) viaja na URL porque o cookie do
   *  tenant só pode ser gravado no FIM — gravá-lo agora entregaria contexto a quem
   *  ainda não provou o segundo fator.
   */
  if ((result as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect === true) {
    const params = new URLSearchParams();
    if (typeof intendedTenant === 'string' && intendedTenant.length > 0) {
      params.set('tenantSlug', intendedTenant);
    }
    if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
      params.set('redirectTo', redirectTo);
    }

    const query = params.toString();
    redirect(`/login/dois-fatores${query ? `?${query}` : ''}`);
  }

  if (typeof intendedTenant === 'string' && intendedTenant.length > 0) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_TENANT_COOKIE, serializeActiveTenant(intendedTenant), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    redirect(redirectTo && redirectTo.startsWith('/') ? redirectTo : '/dashboard');
  }

  redirect('/selecionar-instituicao');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Segundo fator — desafio do login
// ───────────────────────────────────────────────────────────────────────────────
const twoFactorChallengeSchema = z.object({
  code: z.string().trim().min(1, 'Informe o código.'),
  tenantSlug: z.string().trim().max(63).optional(),
  redirectTo: z.string().trim().max(1024).optional(),
});

/**
 * Aceita o código do aplicativo OU um código de recuperação, no MESMO campo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM CAMPO SÓ
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem perdeu o celular está no pior momento possível para escolher entre abas: o
 *  código de recuperação tem 10 caracteres e o do aplicativo tem 6 dígitos, então a
 *  própria forma distingue os dois. Reduzir a dois links "não tenho o aplicativo" é
 *  uma decisão de tela; distinguir o código é aritmética.
 *
 *  O `redirect` fica FORA do `try`: ele funciona lançando um erro especial, e um
 *  `catch` em volta o engoliria — o login terminaria em silêncio, sem sair da tela.
 */
export async function verifyTwoFactorLoginAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = twoFactorChallengeSchema.safeParse({
    code: formData.get('code'),
    tenantSlug: formData.get('tenantSlug') || undefined,
    redirectTo: formData.get('redirectTo') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Código inválido.' };
  }

  const totp = normalizeTotpCode(parsed.data.code);
  const backup = totp ? null : normalizeBackupCode(parsed.data.code);

  if (!totp && !backup) {
    return {
      ok: false,
      message: 'Informe o número de seis dígitos do aplicativo ou um código de recuperação.',
    };
  }

  try {
    if (totp) {
      await auth.api.verifyTOTP({ body: { code: totp }, headers: await headers() });
    } else {
      await auth.api.verifyBackupCode({ body: { code: backup! }, headers: await headers() });
    }
  } catch (error) {
    const normalized = (authErrorMessage(error) ?? '').toLowerCase();

    if (normalized.includes('too many attempts')) {
      return {
        ok: false,
        message: 'Tentativas demais neste desafio. Entre novamente com a senha para gerar outro.',
      };
    }
    if (normalized.includes('lock')) {
      return {
        ok: false,
        message: 'A conta ficou bloqueada por tentativas erradas. Aguarde alguns minutos.',
      };
    }
    if (normalized.includes('invalid two factor cookie') || normalized.includes('expired')) {
      return {
        ok: false,
        message: 'O desafio expirou. Entre novamente com a senha.',
      };
    }

    return { ok: false, message: 'Código incorreto. Confira o número no aplicativo e tente de novo.' };
  }

  // Só DEPOIS do código aceito o contexto da instituição é gravado.
  if (parsed.data.tenantSlug) {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_TENANT_COOKIE, serializeActiveTenant(parsed.data.tenantSlug), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    redirect(
      parsed.data.redirectTo && parsed.data.redirectTo.startsWith('/')
        ? parsed.data.redirectTo
        : '/dashboard',
    );
  }

  redirect('/selecionar-instituicao');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Redefinição de senha
// ─────────────────────────────────────────────────────────────────────────────
const requestResetSchema = z.object({
  email: z.email('Informe um e-mail válido.').max(255).toLowerCase(),
});

/**
 * Pedido de redefinição.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A RESPOSTA É A MESMA, EXISTA OU NÃO A CONTA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Dizer "não existe conta com este e-mail" transformaria esta tela num oráculo para
 *  descobrir quem tem conta na plataforma — e a plataforma é multi-tenant. A
 *  biblioteca já responde igual nos dois casos; a tela também responde: quem tem
 *  conta recebe o link, quem não tem recebe a mesma frase.
 *
 *  O `redirectTo` aponta para a PÁGINA DO FORMULÁRIO (não para a API): o link do
 *  e-mail passa pela rota da biblioteca, que valida o token e devolve para cá com
 *  `?token=` — ou `?error=INVALID_TOKEN`, quando venceu.
 */
export async function requestPasswordResetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get('email') });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Informe um e-mail válido.' };
  }

  try {
    await auth.api.requestPasswordReset({
      body: { email: parsed.data.email, redirectTo: `${appUrl()}/redefinir-senha` },
      headers: await headers(),
    });
  } catch {
    /**
     * Falha aqui (limite de taxa, provedor fora) NÃO muda a resposta: informar
     * "não deu" só para quem tem conta entregaria a existência dela. A tela orienta
     * a tentar de novo em alguns minutos.
     */
  }

  return {
    ok: true,
    message:
      'Se este e-mail tiver conta aqui, o link para definir uma nova senha chega em instantes. Confira também a caixa de spam.',
  };
}

const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, 'O link está incompleto. Peça outro.'),
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

export async function resetPasswordAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    newPassword: formData.get('newPassword'),
    confirmation: formData.get('confirmation'),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  try {
    await auth.api.resetPassword({
      body: { newPassword: parsed.data.newPassword, token: parsed.data.token },
      headers: await headers(),
    });
  } catch (error) {
    const normalized = (authErrorMessage(error) ?? '').toLowerCase();

    if (normalized.includes('token')) {
      return {
        ok: false,
        code: 'INVALID_TOKEN',
        message: 'Este link já foi usado ou venceu. Peça um novo link de redefinição.',
      };
    }
    if (normalized.includes('least')) {
      return {
        ok: false,
        message: `A senha precisa ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      };
    }

    return { ok: false, message: 'Não foi possível definir a nova senha. Tente novamente.' };
  }

  redirect('/login?senha=redefinida');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Logout
// ───────────────────────────────────────────────────────────────────────────────
export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();

  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Mesmo que o Better Auth falhe (sessão já expirada), limpamos os cookies
    // locais: o usuário pediu para sair e deve sair.
  }

  cookieStore.delete(ACTIVE_TENANT_COOKIE);
  redirect('/login');
}
