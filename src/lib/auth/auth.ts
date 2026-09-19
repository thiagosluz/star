/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Configuração do Better Auth
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DECISÕES
 *  ─────────────────────────────────────────────────────────────────────────────
 *
 *  • **Adapter Prisma com driver adapter.** No Prisma 7 a conexão é injetada via
 *    `@prisma/adapter-pg`; o Better Auth recebe o `PrismaClient` já configurado.
 *
 *  • **Sessão NÃO guarda o tenant ativo.** O Better Auth só conhece `user` e
 *    `session`. O "contexto ativo" é um conceito da nossa camada de aplicação
 *    (`ActiveTenantContext`), persistido por cookie assinado e validado a cada
 *    requisição. Motivo: o tenant ativo precisa ser revalidado contra os
 *    vínculos do usuário a cada request — confiar em um valor gravado no banco
 *    abriria uma janela em que um usuário removido continuaria com contexto.
 *    Trocar de contexto também passa a ser O(1), sem escrita no banco.
 *
 *  • **E-mail + senha habilitados.** O hash é delegado ao Better Auth (scrypt).
 *    Provedores sociais (Google, ORCID, GitHub) entram como plugins depois, sem
 *    mudança estrutural — a tabela `account` já os suporta.
 *
 *  • **`trustedOrigins` restrito.** O domínio raiz e seus subdomínios, para que
 *    um tenant não sirva uma página que consiga emitir requisições autenticadas
 *    em nome de outro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { adminPrisma } from '@/lib/db/admin-client';
import { createRedisRateLimitStorage } from '@/lib/auth/rate-limit-storage';
import { RESET_TOKEN_MINUTES, VERIFICATION_TOKEN_HOURS, sendAccountEmail } from '@/lib/communication/account-mail';

const rootDomain = process.env.ROOT_DOMAIN ?? 'lvh.me';
const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

/** Origens confiáveis: a URL da app, o domínio raiz e qualquer subdomínio dele. */
function buildTrustedOrigins(): string[] {
  const origins = new Set<string>([appUrl, `http://${rootDomain}`, `https://${rootDomain}`]);

  const protocol = appUrl.startsWith('https') ? 'https' : 'http';
  origins.add(`${protocol}://*.${rootDomain}`);

  // Em desenvolvimento aceitamos localhost em qualquer porta.
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
    origins.add('http://localhost:3001');
  }

  return [...origins];
}

export const auth = betterAuth({
  appName: 'EventFlow',
  baseURL: appUrl,
  secret: process.env.BETTER_AUTH_SECRET,

  database: prismaAdapter(adminPrisma, {
    provider: 'postgresql',
  }),

  emailAndPassword: {
    enabled: true,
    // Mínimo alinhado à política de senha documentada. O Better Auth faz o hash
    // com scrypt e nunca armazena a senha em claro.
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  `requireEmailVerification: false` — DECISÃO CONSCIENTE (FASE 15)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A verificação de e-mail existe, é enviada e confirma o endereço de verdade
     *  (ver `emailVerification` abaixo). O que ela NÃO faz é bloquear o login.
     *
     *  Ligar o bloqueio hoje trancaria fora TODA conta já existente — inclusive as 16
     *  contas de teste e qualquer usuário cadastrado antes desta fase —, porque
     *  `emailVerified` nasce falso e ninguém foi convidado a confirmar. Um fluxo de
     *  bloqueio exige aviso prévio, prazo e caminho de recuperação: é mudança de
     *  produto, não consequência de ligar um provedor de e-mail.
     *
     *  O que a plataforma faz agora: envia a confirmação no cadastro, mostra o aviso
     *  para quem não confirmou e permite reenviar. O endereço confirmado passa a ser
     *  um sinal de confiança para o convite de equipe que se apoia nele (dívida E30).
     */
    requireEmailVerification: false,
    resetPasswordTokenExpiresIn: RESET_TOKEN_MINUTES * 60,
    /**
     * Redefinição de senha (D1). O fluxo já existia na biblioteca e não tinha como
     * avisar ninguém: o pedido era aceito, o token criado e a pessoa nunca sabia.
     * Agora sai pelo mesmo outbox das demais mensagens.
     */
    sendResetPassword: async ({ user, url }) => {
      await sendAccountEmail({
        template: 'PASSWORD_RESET',
        user: { id: user.id, email: user.email, name: user.name },
        url,
      });
    },
  },

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  VERIFICAÇÃO DE E-MAIL (A5)
   *  ─────────────────────────────────────────────────────────────────────────────
   *  `sendOnSignUp: true` faz o cadastro já disparar a confirmação — sem isso, a
   *  pessoa só descobriria o recurso se procurasse por ele. O token vale 24 h (o
   *  padrão da biblioteca é 1 h, curto demais para um e-mail que chega no meio de
   *  uma aula).
   *
   *  O envio NÃO pode derrubar o cadastro: `sendAccountEmail` engole qualquer falha
   *  (a conta existe, o e-mail é consequência dela).
   */
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: VERIFICATION_TOKEN_HOURS * 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAccountEmail({
        template: 'EMAIL_VERIFICATION',
        user: { id: user.id, email: user.email, name: user.name },
        url,
      });
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 dias
    updateAge: 60 * 60 * 24, // renova a validade 1x por dia
    cookieCache: {
      enabled: true,
      // Cacheia a sessão no cookie por 5 min para evitar um SELECT por request.
      // `getSession` continua sendo a fonte da verdade quando precisamos dela.
      maxAge: 60 * 5,
    },
  },

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  RATE LIMITING
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O limitador padrão do Better Auth é EM MEMÓRIA e por processo: com várias
   *  instâncias da aplicação, cada uma tem seu próprio contador, então ele não
   *  protege nada de verdade em produção.
   *
   *  Pior: em desenvolvimento e nos testes E2E ele atrapalha. O limite padrão
   *  derruba o cadastro após poucas tentativas do MESMO IP (todos os testes vêm
   *  de 127.0.0.1), e a resposta 429 deixa o formulário preso em "Processando…"
   *  — um modo de falha confuso e que consome tempo de depuração.
   *
   *  Decisão: desabilitado fora de produção. Em produção o limitador vem do Redis
   *  (já na stack), com chave por IP + rota, para valer ENTRE instâncias — ver
   *  `src/lib/auth/rate-limit-storage.ts`, que conta e decide em uma operação
   *  atômica (é o contrato do Better Auth 1.7: `consume(key, { window, max })`).
   *
   *  `RATE_LIMIT_ENABLED=false` permite desligar também em produção — usado
   *  pelos testes E2E, que rodam contra o container de produção e disparam
   *  dezenas de cadastros do mesmo IP (127.0.0.1).
   * ─────────────────────────────────────────────────────────────────────────────
   */
  rateLimit: {
    enabled:
      process.env.NODE_ENV === 'production' &&
      process.env.RATE_LIMIT_ENABLED !== 'false',
    window: 60,
    max: 100,
    customStorage: createRedisRateLimitStorage(),
    /**
     * Regras por rota: autenticação é o alvo natural de força bruta, e o padrão de
     * 100/minuto é generoso para adivinhar senha. Os números valem por IP.
     */
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 300, max: 3 },
    },
  },

  user: {
    additionalFields: {
      publicHandle: { type: 'string', required: false, input: true },
      headline: { type: 'string', required: false, input: true },
      country: { type: 'string', required: false, input: true },
    },
  },

  advanced: {
    database: {
      /**
       * Gera UUIDs em vez de nanoids.
       *
       * POR QUE ISSO É OBRIGATÓRIO AQUI
       * O padrão do Better Auth são IDs curtos estilo nanoid (ex.:
       * "bgi3nD9cwZyjM15p4jxksCCuVvXK1RQG"). Nossas colunas `id` são
       * `@db.Uuid` no PostgreSQL, então um nanoid é rejeitado pelo banco com
       * "invalid input syntax for type uuid" — o cadastro falhava com 422.
       *
       * A alternativa seria `generateId: false` e deixar o `@default(uuid(7))`
       * do Prisma agir, mas depender de ID gerado no banco é frágil com alguns
       * adapters e o ganho (UUIDv7 ordenável por tempo) não compensa o risco
       * agora. UUIDv4 é suficiente para chaves de identidade.
       */
      generateId: 'uuid',

      // Habilita JOINs no adapter Prisma: o `getSession` passa a resolver
      // usuário + sessão em uma única query em vez de duas.
      joins: true,
    },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      // Em produção com HTTPS o cookie é Secure. Em dev (http) precisa ser false,
      // senão o navegador descarta o cookie e o login "não gruda".
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  },

  trustedOrigins: buildTrustedOrigins(),

  // `nextCookies` DEVE ser o último plugin: ele intercepta a resposta para
  // escrever os cookies de sessão em Server Actions.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
