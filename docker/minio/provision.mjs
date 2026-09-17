#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  provision.mjs — provisionamento idempotente de buckets S3/MinIO
 *
 *  Executado automaticamente pelo serviço `minio-init` do docker-compose,
 *  após o MinIO estar saudável. Pode ser rodado quantas vezes quiser.
 *
 *  O que faz, para cada bucket:
 *    1. cria, se não existir                    (mc mb --ignore-existing)
 *    2. garante versionamento                   (mc version enable)
 *    3. aplica a policy de acesso correta
 *    4. registra quota de retenção por lifecycle quando faz sentido
 *    5. imprime um relatório final verificável
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POLÍTICA DE ACESSO — decisão de segurança deliberada
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NENHUM bucket de conteúdo é público.
 *
 *  • submissions  -> PRIVADO. Contém artigos científicos não publicados, com
 *                    versões cegas e identificadas. Vazamento = quebra de
 *                    confidencialidade do peer review. Só acessível por URL
 *                    assinada (presigned URL) de curta duração.
 *  • certificates -> PRIVADO. O PDF tem dados pessoais. A validação pública
 *                    NÃO expõe o objeto: ela consulta o banco pelo
 *                    validationCode e só então gera uma URL assinada. Assim o
 *                    código do certificado não é adivinhável nem indexável.
 *  • avatars      -> PRIVADO com URL assinada (dado pessoal, LGPD).
 *  • assets       -> PÚBLICO para leitura. São logos, banners e imagens de
 *                    patrocinadores que precisam aparecer na landing page
 *                    pública sem assinatura. Nunca coloque dado pessoal aqui.
 *  • temp         -> PRIVADO + expiração automática de 7 dias.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const ALIAS = 'eventflow';

// ───────────────────────────────────────────────────────────────────────────────
//  Configuração
// ───────────────────────────────────────────────────────────────────────────────
const endpoint = process.env.S3_ENDPOINT ?? 'http://minio:9000';
const accessKey = process.env.S3_ACCESS_KEY;
const secretKey = process.env.S3_SECRET_KEY;

if (!accessKey || !secretKey) {
  console.error('✗ S3_ACCESS_KEY e S3_SECRET_KEY são obrigatórios.');
  process.exit(1);
}

/**
 * Definição dos buckets.
 *  visibility: 'private' | 'public-read'
 *  expiryDays: remove objetos mais antigos que N dias (0 = sem expiração)
 */
const BUCKETS = [
  {
    name: process.env.S3_BUCKET_SUBMISSIONS ?? 'eventflow-submissions',
    visibility: 'private',
    expiryDays: 0,
    purpose: 'PDFs de submissões (versão cega e identificada), material suplementar',
  },
  {
    name: process.env.S3_BUCKET_CERTIFICATES ?? 'eventflow-certificates',
    visibility: 'private',
    expiryDays: 0,
    purpose: 'Certificados emitidos (PDF assinado) — acesso só por URL assinada',
  },
  {
    name: process.env.S3_BUCKET_ASSETS ?? 'eventflow-assets',
    visibility: 'public-read',
    expiryDays: 0,
    purpose: 'Logos, banners, imagens de patrocinadores e capas de evento',
  },
  {
    name: process.env.S3_BUCKET_AVATARS ?? 'eventflow-avatars',
    visibility: 'private',
    expiryDays: 0,
    purpose: 'Fotos de perfil dos participantes',
  },
  {
    name: process.env.S3_BUCKET_TEMP ?? 'eventflow-temp',
    visibility: 'private',
    expiryDays: 7,
    purpose: 'Uploads em andamento e artefatos descartáveis',
  },
];

const line = '─'.repeat(78);

async function mc(args, { allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await run('mc', args, { maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: (stdout + stderr).trim() };
  } catch (error) {
    if (allowFailure) return { ok: false, out: (error.stdout + error.stderr).trim() };
    throw new Error(`mc ${args.join(' ')} falhou: ${error.message}\n${error.stdout}${error.stderr}`);
  }
}

/** Aguarda o MinIO aceitar conexões. Tolera o MinIO ainda subindo. */
async function waitForMinio(maxAttempts = 30) {
  process.stdout.write('  → aguardando MinIO ficar pronto');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ready = await mc(['ready', ALIAS], { allowFailure: true });
    if (ready.ok) {
      process.stdout.write(` ok (tentativa ${attempt})\n`);
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  process.stdout.write('\n');
  return false;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Execução
// ───────────────────────────────────────────────────────────────────────────────
console.log(`\n${line}\n  PROVISIONAMENTO DE BUCKETS S3 / MinIO\n${line}`);
console.log(`  endpoint: ${endpoint}`);
console.log(`  buckets:  ${BUCKETS.length}\n`);

const report = [];
let hasFailure = false;

try {
  // Alias apontando para o MinIO. O binário `mc` é copiado na imagem.
  await mc(['alias', 'set', ALIAS, endpoint, accessKey, secretKey]);

  if (!(await waitForMinio())) {
    throw new Error('MinIO não ficou pronto dentro do tempo limite.');
  }

  console.log('');

  for (const bucket of BUCKETS) {
    const entry = { name: bucket.name, created: false, versioning: false, policy: '—' };

    // 1. Criação idempotente ---------------------------------------------------
    const exists = await mc(['ls', `${ALIAS}/${bucket.name}`], { allowFailure: true });
    if (!exists.ok) {
      await mc(['mb', `${ALIAS}/${bucket.name}`]);
      entry.created = true;
    }

    // 2. Versionamento ---------------------------------------------------------
    // Protege contra sobrescrita acidental de PDFs de submissão.
    const ver = await mc(['version', 'enable', `${ALIAS}/${bucket.name}`], {
      allowFailure: true,
    });
    entry.versioning = ver.ok;

    // 3. Policy de acesso ------------------------------------------------------
    if (bucket.visibility === 'private') {
      await mc(['anonymous', 'set', 'none', `${ALIAS}/${bucket.name}`], {
        allowFailure: true,
      });
      entry.policy = 'private';
    } else {
      await mc(['anonymous', 'set', 'download', `${ALIAS}/${bucket.name}`], {
        allowFailure: true,
      });
      entry.policy = 'public-read';
    }

    // 4. Expiração automática --------------------------------------------------
    if (bucket.expiryDays > 0) {
      await mc(
        ['ilm', 'rule', 'add', `${ALIAS}/${bucket.name}`, '--expire-days', String(bucket.expiryDays), '--prefix', ''],
        { allowFailure: true },
      );
    }

    report.push(entry);
    console.log(
      `  ✓ ${bucket.name.padEnd(28)} ${entry.created ? 'criado' : 'já existia'}` +
        `  policy=${entry.policy}  versioning=${entry.versioning ? 'on' : 'off'}` +
        (bucket.expiryDays > 0 ? `  expira=${bucket.expiryDays}d` : ''),
    );
  }

  // ── Verificação final: confirma que a policy realmente pegou ────────────────
  console.log('');
  for (const bucket of BUCKETS) {
    const info = await mc(['anonymous', 'get', `${ALIAS}/${bucket.name}`], {
      allowFailure: true,
    });
    const isPublic = info.ok && /download|public/i.test(info.out);
    const expectedPublic = bucket.visibility === 'public-read';

    if (isPublic !== expectedPublic) {
      hasFailure = true;
      console.log(
        `  ✗ ${bucket.name}: esperado ${expectedPublic ? 'público' : 'privado'}, ` +
          `obtido ${isPublic ? 'público' : 'privado'}`,
      );
    }
  }
} catch (error) {
  hasFailure = true;
  console.error(`\n  ✗ ${error.message}\n`);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Relatório
// ───────────────────────────────────────────────────────────────────────────────
console.log(`\n${line}`);
if (hasFailure) {
  console.log('  PROVISIONAMENTO FALHOU\n');
  console.log(line + '\n');
  process.exit(1);
}

console.log('  Buckets provisionados e verificados.\n');
for (let i = 0; i < BUCKETS.length; i += 1) {
  console.log(`    ${BUCKETS[i].name.padEnd(28)} ${BUCKETS[i].purpose}`);
}
console.log(`\n  Console web: http://localhost:9001\n${line}\n`);
