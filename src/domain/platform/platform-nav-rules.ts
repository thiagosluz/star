/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — o endereço da governança da plataforma (FASE 82 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA CONSTANTE SAIU DO COMPONENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 1 precisou do caminho de `/superadmin` para decidir o destino de quem
 *  entra, e o pegou de onde ele morava: `PLATFORM_CRUMB`, em
 *  `src/components/shell/tenant-nav.tsx`. Isso criou um grafo INVERTIDO — o
 *  domínio (`src/domain/**`, que por contrato não conhece Prisma, Next nem
 *  interface) importando a camada de componentes. A regra continuava pura em
 *  execução, mas a dependência estava errada: bastava o `tenant-nav` importar algo
 *  de cliente para o domínio passar a depender de React.
 *
 *  O caminho é um FATO do produto, não uma decoração de trilha: o destino de
 *  entrada, a trilha do `PageHeader` e qualquer catraca futura têm de concordar
 *  sobre ele. Por isso ele mora aqui, na camada que não depende de ninguém, e o
 *  componente passa a IMPORTAR daqui.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `/superadmin/metricas`, E NÃO `/superadmin`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O índice de `/superadmin` é um `redirect` para as métricas. Apontar para a tela
 *  final evita um salto a mais no destino de quem acabou de entrar e na "volta" da
 *  trilha — a mesma escolha que o guia de estilo já fazia. Um literal repetido em
 *  cada lugar viraria uma segunda verdade no dia em que o índice mudasse de tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** A casa do operador de plataforma — a tela final, sem passar pelo índice. */
export const PLATFORM_HOME_PATH = '/superadmin/metricas';
