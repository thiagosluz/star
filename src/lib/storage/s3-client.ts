/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INFRAESTRUTURA — Cliente de object storage (S3 / MinIO)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DECISÃO CENTRAL: O ARQUIVO NÃO PASSA PELO SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O upload vai DIRETO do navegador para o storage, usando uma URL pré-assinada.
 *
 *  Por que não enviar via Server Action:
 *    • memória — um PDF de 20 MB seria carregado inteiro no processo Node;
 *    • tempo — o corpo inteiro atravessa a aplicação antes de chegar ao storage;
 *    • limites — o `bodySizeLimit` das Server Actions é um teto artificial.
 *
 *  O risco dessa escolha é que a aplicação NÃO VÊ o conteúdo. Por isso o fluxo
 *  tem três etapas e a última é uma conferência explícita:
 *
 *      1. `createUploadUrl`   → URL assinada com tipo e tamanho LIMITADOS
 *      2. (navegador → storage, fora da aplicação)
 *      3. `inspectObject`     → confere tamanho; o checksum é validado no
 *                               domínio (`verifyStoredObject`)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEGURANÇA DA URL PRÉ-ASSINADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A assinatura trava três coisas:
 *    • a CHAVE exata do objeto (não dá para gravar em outro caminho);
 *    • o tamanho máximo declarado;
 *    • o tempo de validade (curto).
 *
 *  Isso impede que a URL vire um canal de upload arbitrário para o bucket.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ───────────────────────────────────────────────────────────────────────────────
//  Configuração
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Lê uma variável de ambiente obrigatória — SOMENTE quando o cliente é construído.
 *
 * ─── POR QUE A AVALIAÇÃO É PREGUIÇOSA ────────────────────────────────────────
 * O `next build` IMPORTA os módulos das rotas para coletar dados das páginas.
 * Nessa importação, qualquer `throw` no nível do módulo derruba o build com
 * "Failed to collect page data" — mesmo que a rota nunca use a funcionalidade em
 * tempo de compilação.
 *
 * Foi exatamente o que aconteceu: as variáveis `S3_*` não existem durante o
 * build da imagem Docker, e o módulo lançava ao ser importado.
 *
 * Adiar a validação para o momento do USO mantém a falha ruidosa (onde importa,
 * em runtime) e permite que o build rode sem credenciais de storage — que não
 * são necessárias para compilar.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não definida. Copie .env.example para .env.`,
    );
  }
  return value;
}

function buildClient(endpoint?: string): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: endpoint ?? requireEnv('S3_ENDPOINT'),
    credentials: {
      accessKeyId: requireEnv('S3_ACCESS_KEY'),
      secretAccessKey: requireEnv('S3_SECRET_KEY'),
    },
    /**
     * MinIO (e a maioria dos S3-compatíveis) exige path-style:
     *   http://minio:9000/bucket/key
     * em vez de virtual-hosted:
     *   http://bucket.minio:9000/key
     *
     * Sem isso, o hostname resolveria para `bucket.minio`, que não existe na
     * rede do Docker.
     */
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  });
}

const globalForS3 = globalThis as unknown as {
  __eventflowS3?: S3Client;
  __eventflowS3Public?: S3Client;
};

/** Cliente interno, criado sob demanda (ver nota em `requireEnv`). */
function internalClient(): S3Client {
  if (!globalForS3.__eventflowS3) {
    globalForS3.__eventflowS3 = buildClient();
  }
  return globalForS3.__eventflowS3;
}

/**
 * Cliente "público": assina URLs usando um endpoint alcançável pelo NAVEGADOR.
 *
 * Em Docker o servidor fala `http://minio:9000`, mas o navegador não resolve
 * esse hostname — ele precisa de `http://localhost:9000`. Assinar com o cliente
 * interno geraria URLs inacessíveis ao usuário, um erro que só aparece em
 * execução e é fácil confundir com problema de CORS.
 */
function publicClient(): S3Client {
  if (!globalForS3.__eventflowS3Public) {
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT;
    globalForS3.__eventflowS3Public = buildClient(publicEndpoint);
  }
  return globalForS3.__eventflowS3Public;
}

/** Cliente interno. Use `internalClient()` em código novo. */
export const s3 = {
  send: (...args: Parameters<S3Client['send']>) => internalClient().send(...args),
} as unknown as S3Client;

// ───────────────────────────────────────────────────────────────────────────────
//  Buckets
// ───────────────────────────────────────────────────────────────────────────────
export const BUCKETS = {
  submissions: () => requireEnv('S3_BUCKET_SUBMISSIONS'),
  certificates: () => requireEnv('S3_BUCKET_CERTIFICATES'),
  assets: () => requireEnv('S3_BUCKET_ASSETS'),
  avatars: () => requireEnv('S3_BUCKET_AVATARS'),
  temp: () => requireEnv('S3_BUCKET_TEMP'),
} as const;

export type BucketKey = keyof typeof BUCKETS;

// ───────────────────────────────────────────────────────────────────────────────
//  Chaves de objeto
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Monta a chave do objeto no bucket.
 *
 * O caminho é PARTICIONADO POR TENANT desde o primeiro segmento
 * (`tenants/<id>/...`). Isso permite:
 *   • aplicar políticas de ciclo de vida por instituição;
 *   • auditar e remover os dados de um tenant de forma cirúrgica (LGPD);
 *   • usar um prefixo distinto em cada política de bucket, se necessário.
 *
 * O nome do arquivo enviado pelo usuário é SANITIZADO e nunca usado sozinho:
 * um nome como `../../outro-tenant/arquivo.pdf` tentaria escapar do prefixo.
 */
export function buildObjectKey(input: {
  tenantId: string;
  eventId: string;
  submissionId: string;
  kind: string;
  version: number;
  fileName: string;
}): string {
  const safeName = sanitizeFileName(input.fileName);
  return [
    'tenants',
    input.tenantId,
    'eventos',
    input.eventId,
    'submissoes',
    input.submissionId,
    input.kind.toLowerCase(),
    `v${input.version}`,
    safeName,
  ].join('/');
}

/** Remove qualquer coisa que permita escapar do prefixo do bucket. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120);

  return base.length > 0 ? base : 'arquivo.pdf';
}

// ───────────────────────────────────────────────────────────────────────────────
//  URL pré-assinada de upload
// ───────────────────────────────────────────────────────────────────────────────
export interface UploadTicket {
  /** URL para o navegador fazer PUT. */
  uploadUrl: string;
  /** Chave do objeto no bucket (o cliente devolve na confirmação). */
  objectKey: string;
  bucket: string;
  /** Cabeçalhos que o navegador DEVE enviar, senão a assinatura não confere. */
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
}

/** Validade curta: 10 minutos é suficiente para iniciar um upload. */
export const UPLOAD_URL_TTL_SECONDS = 600;

/**
 * Cria a URL pré-assinada para upload direto.
 *
 * `ContentLength` é incluído na assinatura: o storage rejeita um corpo que não
 * case com o tamanho assinado. Isso impede que alguém use a URL para enviar um
 * arquivo muito maior que o declarado.
 */
export async function createUploadUrl(input: {
  bucket: string;
  objectKey: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<UploadTicket> {
  const expiresIn = input.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS;

  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    ContentType: input.contentType,
    ContentLength: input.contentLength,
  });

  const uploadUrl = await getSignedUrl(publicClient(), command, {
    expiresIn,
    // Assina também o tipo de conteúdo: o navegador precisa enviar exatamente
    // este `Content-Type`.
    signableHeaders: new Set(['content-type', 'content-length']),
  });

  return {
    uploadUrl,
    objectKey: input.objectKey,
    bucket: input.bucket,
    requiredHeaders: {
      'Content-Type': input.contentType,
    },
    expiresInSeconds: expiresIn,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inspeção e operações
// ───────────────────────────────────────────────────────────────────────────────
export interface StoredObjectInfo {
  exists: boolean;
  sizeBytes: number;
  contentType: string | null;
  /** Checksum reportado pelo storage, quando disponível. */
  checksum: string | null;
  etag: string | null;
  lastModified: Date | null;
}

/**
 * Confere o que realmente chegou ao storage.
 *
 * O checksum pode vir em dois formatos, dependendo do backend:
 *   • `ChecksumSHA256` — base64, quando o cliente enviou o checksum;
 *   • `Metadata['x-amz-meta-sha256']` — hex, quando definimos em metadados.
 *
 * Normalizamos para hex minúsculo; se nada estiver disponível, devolvemos `null`
 * e a validação do domínio se apoia no tamanho (que o storage sempre reporta).
 */
export async function inspectObject(
  bucket: string,
  objectKey: string,
): Promise<StoredObjectInfo> {
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
    );

    return {
      exists: true,
      sizeBytes: head.ContentLength ?? 0,
      contentType: head.ContentType ?? null,
      checksum: normalizeChecksum(head),
      etag: head.ETag ?? null,
      lastModified: head.LastModified ?? null,
    };
  } catch (error) {
    // `NotFound` e `NoSuchKey` significam "o upload não chegou" — que é um
    // resultado de negócio válido, não uma falha de infraestrutura.
    if (isNotFound(error)) {
      return {
        exists: false,
        sizeBytes: 0,
        contentType: null,
        checksum: null,
        etag: null,
        lastModified: null,
      };
    }
    throw error;
  }
}

function normalizeChecksum(head: {
  ChecksumSHA256?: string;
  Metadata?: Record<string, string>;
}): string | null {
  // Metadado próprio, em hexadecimal — é o formato que usamos.
  const fromMetadata = head.Metadata?.['sha256'];
  if (fromMetadata && /^[a-f0-9]{64}$/i.test(fromMetadata)) {
    return fromMetadata.toLowerCase();
  }

  if (head.ChecksumSHA256) {
    try {
      return Buffer.from(head.ChecksumSHA256, 'base64').toString('hex').toLowerCase();
    } catch {
      return null;
    }
  }

  return null;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

/** Remove um objeto. Usado ao descartar uploads incompletos. */
export async function deleteObject(bucket: string, objectKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}

/**
 * Envia um objeto GERADO PELO SERVIDOR (não pelo navegador).
 *
 * Diferente do upload de submissões (que usa URL pré-assinada porque o arquivo é
 * do usuário e pode ser grande), o certificado é produzido pela própria
 * aplicação: renderizar em memória e enviar daqui é mais simples e mais seguro —
 * não há URL assinada circulando para um documento com dados pessoais.
 *
 * O `ContentType` é gravado no objeto para que o download saia com o tipo certo
 * mesmo quando a URL assinada não informa `ResponseContentType`.
 */
export async function putObjectBuffer(input: {
  bucket: string;
  objectKey: string;
  body: Buffer;
  contentType: string;
  /** Metadados ficam gravados no objeto — útil para auditoria no bucket. */
  metadata?: Record<string, string>;
}): Promise<{ sizeBytes: number; checksum: string }> {
  const checksum = createHash('sha256').update(input.body).digest('hex');

  await s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.length,
      Metadata: { 'sha256-hash': checksum, ...(input.metadata ?? {}) },
    }),
  );

  return { sizeBytes: input.body.length, checksum };
}

/**
 * URL pré-assinada de DOWNLOAD, com validade curta.
 *
 * Nenhum bucket de conteúdo é público: submissões contêm artigos não publicados
 * (inclusive versões cegas) e certificados contêm dados pessoais. O acesso é
 * sempre mediado por uma URL assinada e temporária.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

export async function createDownloadUrl(input: {
  bucket: string;
  objectKey: string;
  fileName?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    ...(input.fileName
      ? {
          ResponseContentDisposition: `attachment; filename="${sanitizeFileName(input.fileName)}"`,
        }
      : {}),
  });

  return getSignedUrl(publicClient(), command, {
    expiresIn: input.expiresInSeconds ?? DOWNLOAD_URL_TTL_SECONDS,
  });
}

/**
 * Lê um objeto em FLUXO (sem carregar o arquivo inteiro na memória).
 *
 * ─── POR QUE ISTO EXISTE (FASE 36) ────────────────────────────────────────────
 *  Dois caminhos precisam dos BYTES do objeto, e não de uma URL assinada:
 *
 *    • a **inspeção antivírus**, que repassa o conteúdo ao clamd em blocos — um PDF
 *      de 20 MB não pode ser carregado inteiro para ser inspecionado;
 *    • o **ZIP de certificados**, que transmite cada PDF para o navegador enquanto
 *      ele é lido (a memória fica limitada a UM arquivo, não ao evento inteiro).
 *
 *  Os dois usam esta função justamente para não repetir a lógica de erro.
 */
export async function getObjectStream(
  bucket: string,
  objectKey: string,
): Promise<NodeJS.ReadableStream> {
  const response = await internalClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
  );

  const body = response.Body;

  if (!body) {
    throw new Error(`Objeto vazio ou inexistente: ${bucket}/${objectKey}`);
  }

  return body as unknown as NodeJS.ReadableStream;
}

/** Lê um objeto inteiro em memória. Use só quando o tamanho é conhecido e pequeno. */
export async function getObjectBuffer(bucket: string, objectKey: string): Promise<Buffer> {
  const stream = await getObjectStream(bucket, objectKey);
  const chunks: Buffer[] = [];

  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

/** Lista objetos sob um prefixo (usado por diagnóstico e limpeza). */export async function listObjects(
  bucket: string,
  prefix: string,
  maxKeys = 50,
): Promise<{ key: string; sizeBytes: number }[]> {
  const result = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: maxKeys }),
  );

  return (result.Contents ?? []).map((item) => ({
    key: item.Key ?? '',
    sizeBytes: item.Size ?? 0,
  }));
}

/** Verifica se o storage está acessível. Usado pelo healthcheck. */
export async function pingStorage(): Promise<{ ok: boolean; message: string }> {
  try {
    await s3.send(new ListObjectsV2Command({ Bucket: BUCKETS.submissions(), MaxKeys: 1 }));
    return { ok: true, message: 'Storage acessível.' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Falha ao acessar o storage.',
    };
  }
}
