/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CATRACAS DE FONTE — o painel da FASE 84 · fatia 2 não pode voltar atrás
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A matriz perfil × blocos tem prova pura (`f84-painel-do-perfil.test.ts`), o
 *  render tem prova com banco (`f75-contexto-uma-vez.test.ts`) e o comportamento
 *  tem prova no navegador (`f84-painel-do-perfil.spec.ts`). Nenhuma das três pega
 *  a REGRESSÃO DE FONTE barata: a página voltar a chamar `loadPrincipal`, a
 *  contagem voltar a ser `tx.event.count()` sem `deletedAt`, a prova de RBAC voltar
 *  para o painel por copiar-e-colar, ou o botão de contexto reusar um testid que
 *  já existe duas vezes na tela.
 *
 *  São propriedades de CÓDIGO, e é isso que estas catracas leem — sem banco, em
 *  milissegundos, antes de qualquer E2E.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PAGINA = 'src/app/t/[tenantSlug]/(app)/dashboard/page.tsx';
const CONTEXTO = 'src/components/shell/dashboard-context.tsx';

function ler(relativo: string): string {
  return readFileSync(join(process.cwd(), relativo), 'utf8');
}

/** Remove comentários: o que a catraca procura é o que EXECUTA. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('a página do painel consome a regra e não a reescreve', () => {
  const codigo = semComentarios(ler(PAGINA));

  it('resolve o contexto UMA vez e usa o principal que veio nele', () => {
    /**
     * O defeito medido (e removido nesta fatia): `getRequestContext()` e, logo
     * abaixo, `loadPrincipal(...)` com os mesmos argumentos — 2 + 2 no mesmo
     * render. A catraca de integração prende o número com banco; esta prende a
     * origem, sem banco.
     */
    expect(codigo.match(/getRequestContext\(/g)).toHaveLength(1);
    expect(codigo).not.toContain('loadPrincipal');
    expect(codigo).toContain('context.principal');
  });

  it('desenha o plano do DOMÍNIO — ordem, teto e anúncio vêm de lá', () => {
    expect(codigo).toContain('dashboardBlocksFor(subject)');
    expect(codigo).toContain('DASHBOARD_BLOCK_META');
    expect(codigo).toContain('dashboardBlockHref(id, tenantSlug)');
    expect(codigo).toContain('dashboardHiddenPhrase(plan.hidden)');
    expect(codigo).toContain('data-testid={`dashboard-block-${id}`}');
    expect(codigo).toContain('data-testid="dashboard-hidden"');
  });

  it('os contadores vêm de getAdminOverview — e NÃO de count sem deletedAt', () => {
    /**
     * `tx.event.count()` e `tx.activity.count()` sem filtro contavam evento
     * excluído: o painel podia dizer "5 eventos" com 4 na administração. A fonte
     * única passou a ser `getAdminOverview`, que já filtra `deletedAt`.
     */
    expect(codigo).toContain('getAdminOverview(tenantId)');
    expect(codigo).not.toContain('tx.event.count');
    expect(codigo).not.toContain('tx.activity.count');
    expect(codigo).not.toContain('withTenant');
  });

  it('a prova de RBAC não voltou para o painel', () => {
    const fonteInteira = ler(PAGINA);

    expect(fonteInteira).not.toContain('role-summary');
    expect(fonteInteira).not.toContain('data-testid="permissions"');
    expect(fonteInteira).not.toContain('effectivePermissions');
    expect(fonteInteira).not.toContain('summarizeRoles');
    expect(fonteInteira).not.toContain('code-data');
  });

  it('o topo é o MESMO de antes: título e eyebrow preservados', () => {
    expect(codigo).toContain('title={`Painel de ${tenantName}`}');
    expect(codigo).toContain('eyebrow={TENANT_NAV_GROUPS.geral}');
    expect(codigo).toContain('<DashboardContextLink tenantName={tenantName} />');
  });

  it('só o perfil de gestão vê `stats`', () => {
    /**
     * A seção nasce do `overview`, que só é lido quando o bloco `gestao` existe no
     * plano. Sem o bloco, não há contador — e o `f62` (que exige `stats` no perfil
     * de gestão) continua valendo.
     */
    expect(codigo).toContain("visible('gestao') ? getAdminOverview(tenantId)");
    expect(codigo).toContain('data-testid="stats"');
  });
});

describe('o botão de contexto é uma peça NOVA — de topo, não de casca', () => {
  const codigo = semComentarios(ler(CONTEXTO));

  it('leva ao seletor e publica o testid próprio', () => {
    expect(codigo).toContain('href="/selecionar-instituicao"');
    expect(codigo).toContain('data-testid="dashboard-context"');
  });

  it('não reusa nenhum dos testids que já existem na mesma tela', () => {
    /**
     * `active-tenant` é o bloco da casca (cinco specs o usam em modo estrito), e
     * `admin-stats` é o indicador da administração (dois specs exigem a AUSÊNCIA
     * dele quando a pessoa cai no painel sem permissão). Reusar qualquer um aqui
     * criaria dois nós com o mesmo testid ou faria a prova de negação mentir.
     */
    expect(codigo).not.toContain('active-tenant');
    expect(codigo).not.toContain('admin-stats');
    expect(codigo).not.toContain('ShellContextBlock');
  });

  it('o nome acessível começa pelo texto visível (sem aria-label separado)', () => {
    expect(codigo).not.toContain('aria-label');
    expect(codigo).toContain('Trocar');
    expect(codigo).toContain('de instituição');
  });
});
