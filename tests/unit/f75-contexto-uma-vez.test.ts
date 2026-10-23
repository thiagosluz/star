/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CATRACA DE FONTE — O CONTEXTO NÃO VOLTA A SER RESOLVIDO DUAS VEZES (FASE 75)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CATRACA PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A guarda de página (`requirePagePermission`) resolve o contexto inteiro para
 *  decidir a permissão e DEVOLVE o que resolveu. Uma página que chame
 *  `getRequestContext()` por fora da guarda paga de novo a leitura de vínculos
 *  (consulta administrativa que atravessa tenants) e a do principal (transação sob
 *  RLS) no MESMO render — foi o achado medido da fatia 4: 2 × 2 por tela.
 *
 *  O teste de integração (`tests/integration/f75-contexto-uma-vez.test.ts`) conta as
 *  chamadas com banco de verdade e prende o número em 1. Esta catraca é a versão
 *  BARATA: lê o texto das páginas, roda em milissegundos e reprova no CI antes de
 *  alguém precisar subir PostgreSQL — é o que impede a duplicação de voltar por
 *  descuido (um import a mais "para pegar o usuário").
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE COMENTÁRIOS SÃO REMOVIDOS ANTES DA BUSCA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A explicação da própria correção CITA `getRequestContext` ("chamar de novo aqui
 *  repetia…"). Procurar o nome no arquivo cru daria falso positivo no comentário —
 *  e comentário não executa. O que a catraca procura é o identificador no CÓDIGO.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** As três telas do achado — a lista é explícita, como a exceção das guardas. */
const PAGINAS = [
  'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx',
  'src/app/t/[tenantSlug]/(app)/administracao/page.tsx',
  'src/app/t/[tenantSlug]/(app)/participantes/page.tsx',
] as const;

/** O shell: resolvia o principal de novo logo depois de `getRequestContext`. */
const LAYOUT = 'src/app/t/[tenantSlug]/(app)/layout.tsx';

function ler(relativo: string): string {
  return readFileSync(join(process.cwd(), relativo), 'utf8');
}

/** Remove comentários de bloco e de linha — o que sobra é o que executa. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('a duplicação do contexto não volta', () => {
  for (const pagina of PAGINAS) {
    it(`${pagina} não chama getRequestContext (a guarda já devolve o contexto)`, () => {
      const codigo = semComentarios(ler(pagina));

      expect(codigo).toContain('requirePagePermission(');
      expect(codigo).not.toContain('getRequestContext');
    });
  }

  it('o layout do shell não chama loadPrincipal (o contexto já o carregou)', () => {
    const codigo = semComentarios(ler(LAYOUT));

    expect(codigo).toContain('getRequestContext()');
    expect(codigo).not.toContain('loadPrincipal');
  });

  /**
   * A guarda precisa DEVOLVER o que resolveu — é o contrato que dispensa a segunda
   * leitura. Se a devolução sumir, as páginas passam a precisar de outra fonte e a
   * duplicação volta pela porta dos fundos.
   */
  it('a guarda de página devolve o contexto resolvido', () => {
    const guarda = semComentarios(ler('src/lib/auth/guard-page.ts'));

    expect(guarda).toContain('context: RequestContext');
    expect(guarda).toContain('context,');
  });
});
