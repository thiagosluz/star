/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  REPROCESSAMENTO DO ACERVO PARA WEBP (FASE 56 · dívida E65)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A esteira da FASE 46 converte para WebP a partir do PRÓXIMO envio: tudo o que já
 *  estava no bucket continua em PNG/JPEG — e não havia como reprocessar. Este CLI é
 *  esse caminho. A REGRA mora no serviço (`reprocessMediaAssets`), que tem teste; aqui
 *  ficam só o recorte de argumentos e o relatório.
 *
 *    npm run media:reprocess                    # converte o que pode ser convertido
 *    npm run media:reprocess -- --dry-run       # só relata o que faria
 *    npm run media:reprocess -- --limit=50      # teto de imagens por instituição
 *    npm run media:reprocess -- --tenant=ufba-demo
 *
 *  Imagem EM USO é pulada de propósito: a conversão troca a chave do objeto, e a URL
 *  está gravada nas referências (capa, logotipo, foto, blocos da página). O relatório
 *  conta quantas ficaram — a pendência é a dívida E78, e ela não pode sumir no silêncio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '../../src/lib/db/admin-client.ts';
import { reprocessMediaAssets } from '../../src/lib/admin/media-reprocess-service.ts';

const line = '─'.repeat(72);
const args = process.argv.slice(2);

const dryRun = args.includes('--dry-run');
const limitArg = args.find((argument) => argument.startsWith('--limit='));
const tenantArg = args.find((argument) => argument.startsWith('--tenant='));

const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) : undefined;
const onlyTenant = tenantArg ? (tenantArg.split('=')[1] ?? null) : null;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const tenants = await adminPrisma.tenant.findMany({
    where: onlyTenant ? { slug: onlyTenant } : {},
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  });

  console.log(`\n${line}`);
  console.log('  REPROCESSAMENTO DO ACERVO PARA WEBP (FASE 56 · dívida E65)');
  console.log(line);
  console.log(`  modo: ${dryRun ? 'SIMULAÇÃO (nada é gravado)' : 'conversão real'}`);
  console.log(`  instituições: ${tenants.length}`);
  console.log(line);

  const summary = await reprocessMediaAssets(
    tenants.map((tenant) => tenant.id),
    {
      dryRun,
      limit: Number.isFinite(limit) ? limit : undefined,
      onProgress: (message) => console.log(`  ${message}`),
    },
  );

  const saved = summary.bytesBefore - summary.bytesAfter;

  console.log(line);
  console.log(`  instituições ......... ${summary.tenants}`);
  console.log(`  imagens examinadas ... ${summary.scanned}`);
  console.log(`  convertidas .......... ${summary.converted}${dryRun ? ' (simulação)' : ''}`);
  console.log(`  em uso (intocadas) ... ${summary.skippedInUse}  ← precisam de reescrita de referência (E78)`);
  console.log(`  alvo não suportado ... ${summary.skippedUnsupported}`);
  console.log(`  falhas ............... ${summary.failures}`);
  if (!dryRun) {
    console.log(
      `  peso ................. ${formatBytes(summary.bytesBefore)} → ${formatBytes(summary.bytesAfter)} (economia de ${formatBytes(Math.max(0, saved))})`,
    );
  }
  console.log(`${line}\n`);
}

main()
  .catch((error: unknown) => {
    console.error('Falha no reprocessamento do acervo:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void adminPrisma.$disconnect();
  });
