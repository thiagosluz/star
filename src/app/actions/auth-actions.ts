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
import { adminPrisma } from '@/lib/db/admin-client';
import { recordIdentityEvent } from '@/lib/auth/identity-audit';
import { maskEmail } from '@/domain/participants/participant-rules';
import { ACTIVE_TENANT_COOKIE, serializeActiveTenant } from '@/lib/auth/session';
import { resolveEntryDestinationForUser } from '@/lib/auth/entry-destination';
import { isSafeEntryRedirect } from '@/domain/platform/entry-destination-rules';
import { SELECT_INSTITUTION_PATH } from '@/domain/platform/vitrine-account-rules';
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

/**
 * O id do usuário na resposta da biblioteca (`{ token, user }` ou
 * `{ twoFactorRedirect: true }`).
 *
 * A resposta é tipada pela própria biblioteca, mas o formato do objeto de usuário
 * é grande e muda entre versões menores: ler só o que a aplicação usa, com
 * `typeof`, evita `any` e evita depender de um campo que pode não vir. `null`
 * significa "a biblioteca não devolveu o usuário" — e quem chama decide o que
 * fazer sem ele.
 */
function userIdFromAuthResult(result: unknown): string | null {
  const user = (result as { user?: { id?: unknown } } | null)?.user;
  return typeof user?.id === 'string' ? user.id : null;
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

  let createdUserId: string | null = null;

  try {
    const created = await auth.api.signUpEmail({
      body: {
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      },
      headers: await headers(),
    });

    createdUserId = userIdFromAuthResult(created);
  } catch (error) {
    return {
      ok: false,
      message: translateAuthError(authErrorMessage(error)),
    };
  }

  /**
   * Um visitante que se cadastra a partir da página de uma atividade deve voltar
   * para lá, não para o destino padrão. A validação passou a ser a MESMA da regra
   * (`isSafeEntryRedirect`), no lugar das duas comparações ad-hoc que aceitavam
   * `/login` (laço) e `/\evil.test` (open redirect no navegador).
   *
   * O branch continua AQUI, e não só dentro da regra, por um motivo medido: quem
   * chegou com um destino válido não precisa pagar a leitura de vínculos nem a
   * consulta ADMINISTRATIVA de plataforma para saber para onde ir. A equivalência
   * com o degrau 1 da regra é total — as duas chamam `isSafeEntryRedirect`.
   */
  const intendedDestination =
    typeof formData.get('redirectTo') === 'string' ? String(formData.get('redirectTo')) : null;

  if (isSafeEntryRedirect(intendedDestination)) {
    redirect(intendedDestination);
  }

  /**
   * Sem destino, QUEM entrou decide: operador de plataforma → governança; vínculo
   * ativo → painel da instituição; convite pendente → seletor; nada → descoberta.
   * Antes, o fim era `/selecionar-instituicao` para todo mundo — o SuperAdmin caía
   * no seletor e quem não tinha vínculo caía numa tela sem caminho para `/eventos`.
   */
  if (createdUserId) {
    redirect(
      await resolveEntryDestinationForUser(createdUserId, { redirectTo: intendedDestination }),
    );
  }

  redirect(SELECT_INSTITUTION_PATH);
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
   *
   * O `redirectTo` NÃO depende desta prop (FASE 82): nenhuma tela passa
   * `tenantSlug` ao `AuthForm`, então amarrar o destino a ela era o mesmo que
   * ignorar o destino — era o defeito que esta fatia fecha.
   */
  const intendedTenant = formData.get('tenantSlug');
  const redirectTo =
    typeof formData.get('redirectTo') === 'string' ? String(formData.get('redirectTo')) : null;

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
    if (isSafeEntryRedirect(redirectTo)) {
      params.set('redirectTo', redirectTo);
    }

    const query = params.toString();
    redirect(`/login/dois-fatores${query ? `?${query}` : ''}`);
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A VOLTA PARA ONDE A PESSOA ESTAVA — DEGRAU 1 DA PRECEDÊNCIA (FASE 82)
   * ─────────────────────────────────────────────────────────────────────────────
   *  É a única pergunta cuja resposta o USUÁRIO escolheu: quem clicou em "entrar e
   *  continuar" numa atividade, num convite ou numa chamada volta para lá. Vem
   *  antes do contexto de instituição e antes da regra padrão — e é o que faz o
   *  `redirectTo` voltar a funcionar, porque até aqui ele só era lido dentro do
   *  branch de `tenantSlug`, que ninguém preenche.
   *
   *  O `redirect()` fica FORA do `try`: ele sinaliza por exceção especial e um
   *  `catch` em volta o engoliria.
   */
  if (isSafeEntryRedirect(redirectTo)) {
    redirect(redirectTo);
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
    redirect('/dashboard');
  }

  /**
   * A REGRA ÚNICA decide o resto: operador de plataforma → governança; vínculo
   * ativo (o do cookie, revalidado) → painel da instituição; convite pendente →
   * seletor; nada → descoberta. Antes era `/selecionar-instituicao` para todos.
   */
  const signedInUserId = userIdFromAuthResult(result);
  if (signedInUserId) {
    redirect(await resolveEntryDestinationForUser(signedInUserId, { redirectTo }));
  }

  redirect(SELECT_INSTITUTION_PATH);
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

  let verifiedUserId: string | null = null;

  try {
    if (totp) {
      const verified = await auth.api.verifyTOTP({ body: { code: totp }, headers: await headers() });
      verifiedUserId = userIdFromAuthResult(verified);
    } else {
      const verified = await auth.api.verifyBackupCode({
        body: { code: backup! },
        headers: await headers(),
      });
      verifiedUserId = userIdFromAuthResult(verified);

      /**
       * Código de recuperação usado = o aplicativo não estava à mão (ou foi perdido).
       * É o fato que explica, meses depois, por que a conta entrou sem o segundo fator
       * — e o único jeito de saber disso é gravar aqui, porque a biblioteca consome o
       * código e não deixa rastro.
       */
      await recordIdentityEvent({
        userId: verifiedUserId,
        event: 'BACKUP_CODE_USED',
      });
    }
  } catch (error) {
    const normalized = (authErrorMessage(error) ?? '').toLowerCase();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A FALHA NO DESAFIO É FATO DE SEGURANÇA (FASE 49)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Tentativa recusada é o sinal que precede invasão de conta. Aqui não há sessão
     *  — o desafio acontece ANTES dela —, então o alvo fica nulo e o que liga as
     *  tentativas entre si é o IP: a trilha mostra a rajada mesmo sem saber de quem.
     *  O bloqueio por conta continua sendo da biblioteca (`failedVerificationCount`).
     */
    await recordIdentityEvent({
      event: 'TWO_FACTOR_CHALLENGE_FAILED',
      details: { motivo: normalized.includes('lock') ? 'conta bloqueada' : 'código recusado' },
    });

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

    redirect(isSafeEntryRedirect(parsed.data.redirectTo) ? parsed.data.redirectTo : '/dashboard');
  }

  /**
   * O segundo fator é uma PORTA DE ENTRADA como as outras (FASE 82): quem chegou
   * com um destino volta para ele — e quem não chegou recebe a decisão da regra
   * (governança, painel do vínculo, seletor do convite ou descoberta) em vez do
   * seletor incondicional. As duas perguntas são independentes de `tenantSlug`,
   * que nenhuma tela envia.
   */
  if (isSafeEntryRedirect(parsed.data.redirectTo)) {
    redirect(parsed.data.redirectTo);
  }

  if (verifiedUserId) {
    redirect(
      await resolveEntryDestinationForUser(verifiedUserId, {
        redirectTo: parsed.data.redirectTo ?? null,
      }),
    );
  }

  redirect(SELECT_INSTITUTION_PATH);
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

  /**
   * O pedido entra na trilha ANTES da resposta neutra — e com o e-mail MASCARADO: o
   * fato "alguém pediu redefinição para a***@ufba.br" é o que a investigação precisa,
   * e a trilha não é lugar de segunda cópia de dado pessoal. A resposta ao usuário
   * continua idêntica exista ou não a conta (não é oráculo).
   */
  const target = await adminPrisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });

  await recordIdentityEvent({
    userId: target?.id ?? null,
    event: 'PASSWORD_RESET_REQUESTED',
    details: { emailMascarado: maskEmail(parsed.data.email), contaEncontrada: Boolean(target) },
  });

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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  QUEM É O ALVO, SE AINDA NÃO HÁ SESSÃO (FASE 49)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A redefinição acontece sem login, e a biblioteca não devolve o usuário. Mas o
   *  token de redefinição é uma linha de `verification` cujo `identifier` é
   *  `reset-password:<token>` e cujo `value` É o `userId` (verificado na
   *  implementação da biblioteca). Lemos ANTES de consumir o token: depois do
   *  `resetPassword`, a linha já não existe.
   */
  const target = await adminPrisma.verification.findFirst({
    where: { identifier: `reset-password:${parsed.data.token}` },
    select: { value: true },
  });

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

  await recordIdentityEvent({
    userId: target?.value ?? null,
    event: 'PASSWORD_RESET_COMPLETED',
  });

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
