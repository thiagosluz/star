# ═══════════════════════════════════════════════════════════════════════════════
#  EventFlow — imagem de produção
#
#  Build multi-stage, com o modo `standalone` do Next.js:
#
#    deps     instala dependências (cacheável enquanto o lockfile não muda)
#    deps-prod  a mesma árvore SEM as dependências de desenvolvimento (o worker)
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
#  Estágio 1b — dependências de PRODUÇÃO (o worker roda a partir daqui)
# ───────────────────────────────────────────────────────────────────────────────
#  O worker executa `src/**` DIRETO (via `tsx`), não o bundle do Next. O
#  `node_modules` do `.next/standalone` NÃO serve: ele é o traço PARCIAL do que os
#  bundles do servidor tocaram — `ioredis`, `minio` e `resend` nem aparecem, e
#  pacotes traçados pela metade ficam sem `package.json` (era assim com `dotenv`,
#  cujo subcaminho `dotenv/config` não resolvia). O worker precisa da árvore
#  COMPLETA de produção.
#
#  `npm prune --omit=dev` REMOVE as dependências de desenvolvimento já instaladas
#  pelo `npm ci` acima: não baixa nada, então funciona com o registro fora de
#  alcance (armadilha 61) — diferente de um `npm ci --omit=dev` novo.
FROM deps AS deps-prod

RUN npm prune --omit=dev --offline --no-audit --no-fund

# ───────────────────────────────────────────────────────────────────────────────
#  Estágio 2 — build
# ───────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# ───────────────────────────────────────────────────────────────────────────────
#  O BUILD NÃO SONDAR A REDE (armadilha 61)
# ───────────────────────────────────────────────────────────────────────────────
#  `npx` e o próprio Prisma consultam o registro / o `checkpoint.prisma.io` ao
#  subir. Com o registro fora de alcance, essa sondagem vira MINUTOS parados no
#  passo de `generate` (não é o comando que trava: é a espera antes dele).
#  O binário LOCAL é chamado direto e a telemetria fica desligada — assim o build
#  não depende de serviço externo nenhum além das fontes do `next/font`.
ENV CHECKPOINT_DISABLE=1

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
# O binário é chamado pelo CAMINHO, não por `npx` (que sondaria o registro).
RUN ./node_modules/.bin/prisma generate

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
#  que é quem define o alias `@/*` usado pelos módulos de domínio — e por isso
#  ele NÃO usa o `node_modules` do standalone: usa o de produção inteiro
#  (estágio 1b).
# ───────────────────────────────────────────────────────────────────────────────
FROM runner AS worker

USER root

# ───────────────────────────────────────────────────────────────────────────────
#  `tsx` num prefixo ISOLADO (`/tools`), COPIADO do estágio `deps`
# ───────────────────────────────────────────────────────────────────────────────
#  Não há instalação aqui de propósito, por DUAS razões:
#
#  1. O build da imagem NÃO alcança o registro npm (armadilha 61): o `npm ci` do
#     estágio `deps` só continua funcionando porque está em CACHE. Qualquer
#     `npm install` novo aqui fica pendurado até estourar.
#  2. Mesmo com rede, instalar `tsx` dentro de `/app` obriga o npm a resolver a
#     árvore inteira do `.next/standalone` — 22 dependências SEM lockfile para
#     ancorar as versões — e o passo levava minutos para trazer três pacotes.
#
#  O `tsx` é AUTOCONTIDO (o `dist/` já traz as ferramentas empacotadas); só o
#  `esbuild` fica de fora. Copiamos exatamente esses e, em seguida, RODAMOS o
#  binário num arquivo TypeScript de prova: se faltar qualquer peça, o build
#  FALHA aqui, em vez de o worker morrer no primeiro job.
#
#  O `tsx` é AUTOCONTIDO (o `dist/` já traz as ferramentas empacotadas); só o
#  `esbuild` fica de fora. Copiamos exatamente esses e, em seguida, RODAMOS o
#  binário num arquivo TypeScript de prova: se faltar qualquer peça, o build
#  FALHA aqui, em vez de o worker morrer no primeiro job.
COPY --from=deps /app/node_modules/tsx /tools/node_modules/tsx
COPY --from=deps /app/node_modules/esbuild /tools/node_modules/esbuild
COPY --from=deps /app/node_modules/@esbuild /tools/node_modules/@esbuild

# A prova de que o `tsx` está inteiro: um arquivo com anotação de tipo só roda
# depois de o `esbuild` transformar — uma peça faltando derruba o BUILD.
RUN printf 'const n: number = 1\nconst t: { a: string } = { a: "ok" }\nconsole.log("tsx pronto:", n, t.a)\n' > /tmp/prova.ts \
 && node /tools/node_modules/tsx/dist/cli.mjs /tmp/prova.ts \
 && rm /tmp/prova.ts

WORKDIR /app

# ───────────────────────────────────────────────────────────────────────────────
#  O `node_modules` do worker é o de PRODUÇÃO COMPLETO — não o do standalone
# ───────────────────────────────────────────────────────────────────────────────
#  O estágio `runner` trouxe o `node_modules` parcial do `.next/standalone`, que
#  serve ao servidor Next e NÃO ao worker (ver o estágio 1b). Trocamos por inteiro:
#  deixar os dois misturados esconderia a peça que falta atrás de um diretório
#  meio-copiado.
RUN rm -rf /app/node_modules
COPY --from=deps-prod --chown=nextjs:nodejs /app/node_modules ./node_modules

# Código-fonte da aplicação + tsconfig (define o alias `@/*`).
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

# ───────────────────────────────────────────────────────────────────────────────
#  Prova de que o GRAFO DE MÓDULOS do worker carrega (peça faltando = build quebra)
# ───────────────────────────────────────────────────────────────────────────────
#  Sem Redis no build, o worker morre em ~1 s com "não foi possível conectar" —
#  depois de já ter IMPORTADO `dotenv/config`, `ioredis`, `bullmq` e o logger.
#  O que se afirma aqui é o TIPO da falha: `ERR_MODULE_NOT_FOUND` é peça faltando
#  no `node_modules` (build PARA); qualquer outra coisa significa que o grafo
#  carregou inteiro. Foi exatamente esta prova que faltava quando `dotenv/config`
#  só existia pela metade.
RUN cd /app && timeout 30 node /tools/node_modules/tsx/dist/cli.mjs src/workers/index.ts > /tmp/worker-boot.log 2>&1; \
    if grep -q 'ERR_MODULE_NOT_FOUND\|Cannot find module\|Cannot find package' /tmp/worker-boot.log; then \
      echo '--- o worker não carrega: falta módulo no node_modules ---'; cat /tmp/worker-boot.log; exit 1; \
    fi; \
    echo 'grafo de módulos do worker carregado por inteiro'; rm -f /tmp/worker-boot.log

USER nextjs

ENV NODE_ENV=production
ENV WORKER_CONCURRENCY=4

# O entrypoint real: valida Redis e PostgreSQL, registra o shutdown gracioso e
# permanece vivo. As filas do BullMQ entram nas FASES 5 e 6.
CMD ["node", "/tools/node_modules/tsx/dist/cli.mjs", "src/workers/index.ts"]
