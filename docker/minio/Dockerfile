# ═══════════════════════════════════════════════════════════════════════════════
#  eventflow/minio-init — provisionamento de buckets + probe de saúde
#
#  Por que este Dockerfile existe:
#
#  1. A imagem oficial do MinIO (cgr.dev/chainguard/minio) é "distroless":
#     não tem shell, curl nem wget. Logo, um healthcheck CMD-SHELL é impossível
#     e um script shell de provisionamento também.
#
#  2. O binário `mc` (MinIO Client) consegue falar HTTP com o servidor e tem o
#     subcomando `mc ready`, que é o probe oficial de prontidão. Colocando `mc`
#     na MESMA imagem compartilhada, tanto o healthcheck quanto o provisionamento
#     usam o mesmo binário.
#
#  3. O provisionamento é escrito em Node (não em shell) para poder validar
#     cada bucket, aplicar policy de leitura pública de forma idempotente e
#     emitir um relatório legível.
# ═══════════════════════════════════════════════════════════════════════════════

FROM cgr.dev/chainguard/minio-client:latest AS mc

FROM node:24-alpine

# `mc` é estático; copiá-lo do estágio distroless é suficiente.
COPY --from=mc /usr/bin/mc /usr/local/bin/mc

# A imagem precisa ser executada como o usuário que o healthcheck usa.
# O node:alpine já traz o usuário `node` (uid 1000).
WORKDIR /opt/provision

COPY --chown=node:node provision.mjs package.json ./

USER node

# Modo padrão: provisionar buckets e encerrar.
CMD ["node", "provision.mjs"]

# Para usar como healthcheck do MinIO, sobrescreva o comando:
#   command: ["mc", "ready", "local"]
