import Link from 'next/link';

import { notFoundContent, type ErrorArea } from '@/domain/platform/error-pages';
import { buttonClasses } from '@/components/ui/button';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PÁGINA DE NÃO ENCONTRADO — o desenho, uma vez (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM COMPONENTE, E NÃO A MESMA TELA EM TRÊS `not-found.tsx`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O recorte é por ÁREA (casca autenticada, área pública da instituição e
 *  raiz/plataforma), e não por página: são as três cascas que existem, e cada uma
 *  muda o CAMINHO DE VOLTA — não o desenho. Um `not-found.tsx` por página repetiria
 *  a marcação em dezenas de arquivos (e a frase que o `notFound()` produz é a mesma
 *  para todas); um só, na raiz, daria o painel a quem estava na vitrine.
 *
 *  O desenho mora aqui; a FRASE mora no domínio (`error-pages.ts`), e o teste de
 *  fonte reprova este arquivo se ele voltar a escrever a frase à mão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM `<main>` — O DA TELA (FASE 52 · dívida I2)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A casca não é landmark: nesta página, o `<main>` é o conteúdo principal. As duas
 *  cascas que hospedam este componente (a barra lateral autenticada e o cabeçalho
 *  público) já não desenham o seu, então aqui ele é exatamente UM — e o portão de
 *  acessibilidade reprova a tela que tiver zero ou dois.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA NÃO DIZ
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ela não revela se o recurso existe: as três hipóteses (não existe, foi removido,
 *  não está disponível para você) estão sempre juntas, na mesma frase do domínio.
 *  Também não é `noindex`: quem escreve isso é o `<meta name="robots">` que o próprio
 *  `notFound()` insere — repetir aqui seria a segunda fonte de uma decisão só.
 */
export function AreaNotFound({
  area,
  tenantSlug = null,
}: {
  area: ErrorArea;
  /** O slug da instituição quando o boundary consegue vê-lo; `null` cai no destino genérico. */
  tenantSlug?: string | null;
}) {
  const content = notFoundContent({ area, tenantSlug });

  return (
    <main
      className="mx-auto w-full max-w-2xl px-6 py-12"
      data-testid={`area-not-found-${area}`}
    >
      <div className="space-y-5 rounded-lg border border-border bg-card p-8 shadow-card">
        <p className="text-label-caps uppercase text-muted-foreground">{content.eyebrow}</p>

        <h1 className="font-display text-title-lg text-foreground">{content.title}</h1>

        <p className="max-w-prose text-sm text-muted-foreground">{content.description}</p>

        <div className="flex flex-wrap gap-3">
          {content.exits.map((exit, index) => (
            <Link
              key={exit.href}
              href={exit.href}
              className={buttonClasses({ variant: index === 0 ? 'primary' : 'outline' })}
            >
              {exit.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
