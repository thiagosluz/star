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

export interface ActionState {
  ok: boolean;
  message?: string;
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

  try {
    await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (error) {
    return {
      ok: false,
      message: translateAuthError(authErrorMessage(error)),
    };
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
