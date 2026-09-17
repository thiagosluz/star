/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Diretório público de instituições
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A VITRINE MOSTRA (E O QUE ELA NUNCA MOSTRA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mostra só o que a instituição publicou: nome (a sigla vive dentro dele),
 *  descrição, logotipo, site e os eventos que ela ABRIU. Nunca dado de participante,
 *  nunca número de inscritos, nunca e-mail.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE É CACHEADO — E O QUE NUNCA É (a decisão mais importante do arquivo)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A vitrine precisa de duas coisas de naturezas diferentes:
 *
 *    1. QUEM aparece — `status = ACTIVE AND isPublic`. Decide ACESSO.
 *    2. QUANTOS eventos abertos cada uma tem. Decide apenas a ORDEM.
 *
 *  Só a segunda é cacheada. Se a primeira viesse do cache, uma suspensão levaria
 *  até cinco minutos para sumir da vitrine — e uma suspensão que demora a valer não
 *  é uma suspensão. A leitura de quem aparece é feita na hora, em uma consulta
 *  indexada; a contagem (que varre eventos de todas as instituições) fica em cache
 *  por tag e é invalidada quando um evento é publicado ou uma instituição muda.
 *
 *  O efeito colateral dessa escolha é bom: busca, ordenação e paginação acontecem
 *  EM MEMÓRIA, sobre as linhas já lidas — sem uma consulta por tecla digitada e sem
 *  uma consulta por página.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { unstable_cache } from 'next/cache';

import {
  buildDirectory,
  type DirectoryEntry,
  type DirectoryOptions,
  type DirectoryRow,
} from '@/domain/platform/platform-rules';
import { selectDirectoryTenants, selectOpenEventCounts } from '@/lib/platform/global-repository';

/**
 * Tag de invalidação da vitrine.
 *
 * Quem altera algo que aparece no diretório publica esta tag: o perfil público da
 * instituição, a suspensão/reativação e a publicação de um evento.
 */
export const PUBLIC_TENANTS_TAG = 'public-tenants';

/** Teto do cache em segundos — a tag é o caminho normal; isto é a rede de segurança. */
const DIRECTORY_REVALIDATE_SECONDS = 300;

/**
 * Contagem de eventos abertos, cacheada.
 *
 * ARMADILHA: o cache serializa o valor, e uma `Date` pode voltar como string (ou
 * sobreviver, dependendo do runtime). A conversão para número aceita os dois
 * formatos — sem ela, `nextEventStartsAt.getTime()` estouraria apenas em produção,
 * no pior momento possível.
 */
const cachedOpenEventCounts = unstable_cache(
  async () => {
    const counts = await selectOpenEventCounts(new Date());

    return Object.fromEntries(
      Object.entries(counts).map(([tenantId, value]) => [
        tenantId,
        {
          openEventCount: value.openEventCount,
          nextEventStartsAt: value.nextEventStartsAt ? value.nextEventStartsAt.getTime() : null,
        },
      ]),
    );
  },
  ['public-tenant-open-events'],
  { tags: [PUBLIC_TENANTS_TAG], revalidate: DIRECTORY_REVALIDATE_SECONDS },
);

export interface PublicDirectory {
  entries: DirectoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Total de instituições visíveis, independente da busca (para o texto de apoio). */
  visibleTenants: number;
}

/**
 * Vitrine pública, já filtrada, ordenada e paginada.
 *
 * Recebe as opções cruas da URL (uma string de busca pode vir de qualquer lugar) e
 * as normaliza: `page` inválida vira 1 e `pageSize` fica no intervalo que o domínio
 * permite.
 */
export async function listPublicDirectory(options: DirectoryOptions = {}): Promise<PublicDirectory> {
  const [tenants, counts] = await Promise.all([selectDirectoryTenants(), cachedOpenEventCounts()]);

  const rows: DirectoryRow[] = tenants.map((tenant) => {
    const counted = counts[tenant.id];

    return {
      ...tenant,
      openEventCount: counted?.openEventCount ?? 0,
      nextEventStartsAt: counted?.nextEventStartsAt ? new Date(counted.nextEventStartsAt) : null,
    };
  });

  const directory = buildDirectory(rows, options);

  return {
    ...directory,
    visibleTenants: rows.filter((row) => row.status === 'ACTIVE' && row.isPublic).length,
  };
}
