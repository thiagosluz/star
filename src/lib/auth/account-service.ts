/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Área de conta (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS LEITURAS USAM A CONEXÃO DE PLATAFORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `user`, `account` e `session` são tabelas de IDENTIDADE: globais por decisão de
 *  arquitetura (ADR-002) e usadas antes de existir instituição ativa. Uma leitura
 *  "sob o contexto de uma instituição" devolveria zero linhas em vez de negar — o
 *  mesmo motivo que levou `src/lib/platform/**` a usar `adminPrisma` (invariante nº 1).
 *
 *  A autorização NÃO mora aqui: as Server Actions conferem a sessão, e cada escrita
 *  usa o `userId` da sessão — nunca um id vindo do formulário.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não confere senha, não gera token e não valida código de segundo fator: isso é da
 *  biblioteca de autenticação, com o crypto dela. Aqui só se LÊ o estado que a tela
 *  precisa mostrar — inclusive o que a tela precisa mostrar para não mentir:
 *  "esta conta tem senha?" e "o segundo fator está ligado?".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import {
  describeSession,
  orderSessionsForDisplay,
  type AccountSession,
} from '@/domain/account/account-rules';

export interface AccountOverview {
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** Foto publicada (a mesma que o perfil público e os cartões de equipe mostram). */
  image: string | null;
  /** Só `true` depois que um código válido confirmou o enrollment. */
  twoFactorEnabled: boolean;
  /**
   * A conta tem senha PRÓPRIA?
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ISTO NÃO É DETALHE
   * ─────────────────────────────────────────────────────────────────────────────
   *  As contas do seed e as criadas por convite nascem sem linha em `account` (não há
   *  senha). Para elas, "trocar a senha" não existe — a tela precisa oferecer CRIAR a
   *  senha, senão a pessoa recebe "senha atual incorreta" para sempre e não entende por
   *  quê. Também é o que decide se o segundo fator pode ser ligado: a biblioteca exige
   *  senha para isso, e sem ela a única saída seria a redefinição por e-mail.
   */
  hasPassword: boolean;
  /** Quantas sessões ativas a conta tem (a tela avisa antes de a pessoa sair de todas). */
  activeSessions: number;
  /** `@handle` do perfil público, quando existe — só para o atalho na tela. */
  publicHandle: string | null;
}

/** Estado da conta para a tela. `null` = conta inexistente (não deveria acontecer). */
export async function getAccountOverview(userId: string): Promise<AccountOverview | null> {
  const [user, credential, activeSessions] = await Promise.all([
    adminPrisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        twoFactorEnabled: true,
        publicHandle: true,
      },
    }),
    adminPrisma.account.findFirst({
      where: { userId, providerId: 'credential' },
      select: { password: true },
    }),
    adminPrisma.session.count({ where: { userId } }),
  ]);

  if (!user) return null;

  return {
    userId,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    twoFactorEnabled: user.twoFactorEnabled,
    hasPassword: credential?.password != null,
    activeSessions,
    publicHandle: user.publicHandle,
  };
}

/**
 * Sessões ativas da conta, prontas para a tela.
 *
 * `currentToken` vem da sessão de quem está olhando: é o que marca a linha "este
 * dispositivo" — a que a pessoa NÃO deve encerrar sem querer. A leitura é direta na
 * tabela (e não pelo `auth.api.listSessions`) para o serviço poder ser exercitado sem
 * requisição; a listagem pela biblioteca continua sendo o caminho das AÇÕES de
 * encerrar, que precisam conferir a posse.
 */
export async function readAccountSessions(input: {
  userId: string;
  currentToken: string | null;
  limit?: number;
}): Promise<AccountSession[]> {
  const rows = await adminPrisma.session.findMany({
    where: { userId: input.userId },
    orderBy: { updatedAt: 'desc' },
    take: input.limit ?? 50,
    select: {
      token: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      updatedAt: true,
      expiresAt: true,
    },
  });

  const sessions: AccountSession[] = rows.map((row) => ({
    token: row.token,
    ...describeSession(row.userAgent),
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isCurrent: input.currentToken !== null && row.token === input.currentToken,
  }));

  return orderSessionsForDisplay(sessions);
}
