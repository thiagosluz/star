# ═══════════════════════════════════════════════════════════════════════════════
#  EventFlow — imagem de produção
#
#  Build multi-stage, com o modo `standalone` do Next.js:
#
#    deps     instala dependências (cacheável enquanto o lockfile não muda)
#    builder  roda `prisma generate` e `next build`
#    runner   servidor mínimo: apenas `.next/standalone` + estáticos + Prisma
#    worker   mesma base do runner, mas o processo é o worker do BullMQ
#
#  ─────────────────────────────────────────────────────────────────────────────
#  TRÊS DETALHES QUE ESSA IMAGEM PRECISA RESPEITAR (FASES 1 E 2)
#  ─────────────────────────────────────────────────────────────────────────────
#
#  1. O gerador `prisma-client` do Prisma 7 emite **código TypeScript** em
#     `src/generated/prisma`, não JavaScript compilado. Por isso:
#       • os estágios `deps`/`builder` precisam do diretório completo de fontes;
#       • `prisma generate` roda no builder, antes do `next build`;
#       • o cliente gerado é copiado explicitamente para o estágio final, porque
#         o output standalone não o inclui por padrão.
#
#  2. `NEXT_TELEMETRY_DISABLED=1` — não enviamos telemetria em build de imagem.
#
#  3. O usuário não é root (`nextjs`, uid 1001). Containers de aplicação não
#     devem rodar privilegiados.
# ═══════════════════════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────────────────────
#  Estágio 1 — dependências
# ───────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps

# `libc6-compat` é exigido pelos binários nativos que o Prisma/swc carregam.
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

# `--ignore-scripts` evita que o postinstall do Prisma tente baixar engines:
# usamos driver adapter (`@prisma/adapter-pg`), que é JavaScript puro e dispensa
# o engine binário. Dependências ficam determinísticas e o build mais rápido.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ───────────────────────────────────────────────────────────────────────────────
#  Estágio 2 — build
# ───────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# ───────────────────────────────────────────────────────────────────────────────
#  Segredo de COMPILAÇÃO (não é usado em runtime)
# ───────────────────────────────────────────────────────────────────────────────
#  A etapa `Collecting page data` do `next build` IMPORTA os módulos das rotas
#  para analisá-las. Nessa importação `src/lib/auth/auth.ts` é avaliado, e o
#  Better Auth lança:
#
#      BetterAuthError: You are using the default secret.
#
#  fazendo o build falhar com "Failed to collect page data".
#
#  Este valor existe apenas para a compilação. Ele NÃO chega à imagem final com
#  efeito: o estágio `runner` não herda o `ENV` do `builder`, e o docker-compose
#  injeta o `BETTER_AUTH_SECRET` real em runtime.
ARG BUILD_BETTER_AUTH_SECRET=build-time-placeholder-not-used-at-runtime-000000
ENV BETTER_AUTH_SECRET=$BUILD_BETTER_AUTH_SECRET

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Gera o cliente Prisma antes do build: o TypeScript da aplicação importa tipos
# de `src/generated/prisma`, então o diretório precisa existir para o `tsc`.
RUN npx prisma generate

# `next build` roda, por padrão, o `prisma generate` de novo via `postinstall`?
# Não — o Next apenas compila. Mas o type-check do build precisa do client, que
# já foi gerado acima.
RUN npm run build

# ───────────────────────────────────────────────────────────────────────────────
#  Estágio 3 — runtime da aplicação web
# ───────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# O servidor standalone já traz o node_modules mínimo que o Next rastreou.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Assets estáticos servidos pelo próprio servidor.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Arquivos públicos (favicon, imagens, robots.txt). Opcional: só existe se houver.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Cliente Prisma gerado + schema + migrations.
# Necessários em runtime para: (a) o adapter carregar o client, (b) rodar
# `prisma migrate deploy` dentro do container quando desejado.
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs

EXPOSE 3000

# O healthcheck é definido no docker-compose (que pode passar variáveis de
# ambiente); aqui deixamos o container apenas pronto para receber tráfego.

CMD ["node", "server.js"]

# ───────────────────────────────────────────────────────────────────────────────
#  Estágio 4 — worker de background (BullMQ)
# ───────────────────────────────────────────────────────────────────────────────
#  Não serve HTTP: consome filas (certificados, e-mails, distribuição de cards).
#  Compartilha a mesma base do runner para que o cliente Prisma e as constantes
#  de conexão sejam idênticas às da aplicação — nada de duas implementações
#  divergindo.
#
#  Diferente do servidor web, o worker executa o código-fonte TypeScript
#  diretamente (via `tsx`), porque ele não passa pelo empacotamento do Next.
#  Por isso copiamos `src/` (incluindo `src/generated`) e o `tsconfig.json`,
#  que é quem define o alias `@/*` usado pelos módulos de domínio.
# ───────────────────────────────────────────────────────────────────────────────
FROM runner AS worker

USER root

# `tsx` executa TypeScript sem passo de compilação, respeitando os `paths` do
# tsconfig (necessário para os imports `@/...`).
RUN npm install --no-save --ignore-scripts tsx@4.23.13

# Código-fonte da aplicação + tsconfig (define o alias `@/*`).
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

USER nextjs

ENV NODE_ENV=production
ENV WORKER_CONCURRENCY=4

# O entrypoint real: valida Redis e PostgreSQL, registra o shutdown gracioso e
# permanece vivo. As filas do BullMQ entram nas FASES 5 e 6.
CMD ["node_modules/.bin/tsx", "src/workers/index.ts"]
