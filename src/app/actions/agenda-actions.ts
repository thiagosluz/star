'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Favoritar na agenda pessoal (FASE 65 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UMA AÇÃO, DUAS PORTAS, NENHUM JAVASCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pessoa marca e desmarca pelo MESMO formulário (`intencao`), e o formulário é um
 *  `<form>` de verdade com `action` de Server Action: sem bundle, o POST acontece na
 *  submissão NATIVA e o servidor responde com o redirecionamento de volta. É o
 *  caminho que a FASE 50 (E50) mediu — e o que o E2E desta fatia refaz com
 *  `javaScriptEnabled: false`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A POSSE É O `userId` DA SESSÃO — E É A ÚNICA AUTORIZAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não existe — e não deve existir — `activity:favorite` no catálogo de permissões.
 *  Duas razões, e as duas são de produto:
 *
 *    1. **A permissão criaria o poder de marcar EM NOME DE OUTRA PESSOA.** Todo
 *       `can()` desta casa recebe um alvo; um alvo aqui seria "o favorito de quem?".
 *       Favoritar é preferência pessoal e reversível, e o alvo natural é sempre quem
 *       está logado — o que a permissão permitiria é exatamente o que ninguém quer;
 *    2. **O RBAC não é a régua do que é meu.** Quem está em `PARTICIPANT`, quem é
 *       `ADMIN`, quem acabou de criar conta para se inscrever num evento aberto: todos
 *       têm o MESMO direito sobre a própria agenda. Exigir uma permissão aqui faria o
 *       papel — e não a posse — decidir se a pessoa pode guardar um horário.
 *
 *  O que a ação faz, então, é a pergunta certa: **há sessão?** Sem ela, ninguém marca
 *  nada em nome de ninguém, e a pessoa é levada ao login com o destino preservado. Com
 *  ela, o `userId` sai da SESSÃO e vai para o serviço (`favoriteActivity`), que ainda
 *  confere, sob RLS, que a atividade é desta instituição, não é rascunho e o evento é
 *  público — a RLS fecha o resto (invariante nº 3).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CHOQUE NUNCA RECUSA — E O TESTE PRENDE ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nenhuma linha desta ação olha para a agenda da pessoa. Não há `getMyAgenda` aqui,
 *  não há `if (choca) return`: o detector de choque da fatia 1 é AVISO, e quem decide o
 *  que assistir é o participante (decisão registrada no plano da fase). O aviso da tela
 *  é calculado na RENDERIZAÇÃO, com a grade na mão — e o E2E favorita duas atividades
 *  sobrepostas e confere a linha gravada no banco.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMINHO DE VOLTA É DERIVADO, NÃO RECEBIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Voltar para a mesma página" não pode virar "redirecionar para onde o formulário
 *  mandar": `returnTo` de formulário é entrada de dado como qualquer outra, e um POST
 *  autenticado que termina em `https://outro.site` é o defeito clássico (é por isso que
 *  `export-actions.ts` tem o seu `safeReturnTo`). Aqui não há nem o que validar: o
 *  destino sai de um ENUM (`origem`) mais o slug da instituição e o do evento, todos
 *  conferidos pelo schema. Não existe caminho arbitrário para onde ir.
 *
 *  A volta carrega `#atividade-<id>` porque, sem JavaScript, a página inteira chega
 *  nova — e a pessoa precisa cair no CARTÃO que ela acabou de marcar, não no topo de
 *  uma programação de vinte itens.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getAuthenticatedUser } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { favoriteActivity, unfavoriteActivity } from '@/lib/events/agenda-service';
import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * Os campos do formulário.
 *
 * `tenantSlug` e `eventSlug` são os do CONTEXTO (a URL de onde o formulário saiu) e
 * existem para montar a volta; `activityId` e `eventId` são uuid porque um id solto não
 * tem para onde ser redirecionado nem o que ser marcado. Nada de `userId` — esse não
 * existe no formulário de propósito: aceitá-lo seria aceitar que alguém marque na
 * agenda de outra pessoa.
 */
const toggleSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  activityId: z.string().uuid(),
  eventId: z.string().uuid(),
  eventSlug: z.string().trim().min(1).max(120),
  /** De onde a pessoa veio: a programação do evento ou a própria agenda. */
  origem: z.enum(['PROGRAMACAO', 'MINHA_AGENDA']),
  intencao: z.enum(['adicionar', 'remover']),
});

export async function toggleFavoriteAction(formData: FormData): Promise<void> {
  const parsed = toggleSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    activityId: formData.get('activityId'),
    eventId: formData.get('eventId'),
    eventSlug: formData.get('eventSlug'),
    origem: formData.get('origem'),
    intencao: formData.get('intencao'),
  });

  if (!parsed.success) {
    /**
     * Formulário inválido não tem destino confiável — e a única coisa pior que não
     * voltar para a página certa é voltar para um caminho montado com dado não
     * validado. A vitrine de eventos da instituição é o caminho neutro; sem slug
     * nenhum, a raiz da plataforma.
     */
    const slug = String(formData.get('tenantSlug') ?? '').trim();

    redirect(slug ? tenantPath(slug, '/eventos') : '/');
  }

  const { tenantSlug, activityId, eventId, eventSlug, intencao } = parsed.data;

  /** A volta é MONTADA aqui — ver o cabeçalho: nenhum caminho chega do formulário. */
  const caminho =
    parsed.data.origem === 'MINHA_AGENDA'
      ? tenantPath(tenantSlug, '/minha-agenda')
      : tenantPath(tenantSlug, `/eventos/${eventSlug}`);

  const volta =
    parsed.data.origem === 'MINHA_AGENDA' ? `${caminho}?evento=${eventId}` : caminho;

  const user = await getAuthenticatedUser();

  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(volta)}`);
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, status: true },
  });

  if (!tenant || tenant.status !== 'ACTIVE') {
    redirect(`${volta}${volta.includes('?') ? '&' : '?'}agenda-erro=${encodeURIComponent(
      'Instituição não encontrada.',
    )}`);
  }

  /**
   * A ESCRITA. `userId` é o da SESSÃO (nunca um id do formulário), e o serviço é
   * idempotente nos dois sentidos: marcar o que já estava marcado responde `ok` com
   * `created: false`, e desmarcar o que não estava responde `ok` com `removed: false`.
   * Zero linhas afetadas é resposta de negócio (invariante nº 5), não erro.
   */
  const outcome =
    intencao === 'adicionar'
      ? await favoriteActivity({ tenantId: tenant.id, userId: user.id, activityId })
      : await unfavoriteActivity({ tenantId: tenant.id, userId: user.id, activityId });

  const separator = volta.includes('?') ? '&' : '?';

  revalidatePath(caminho);

  /**
   * O desfecho volta pela URL — o mesmo caminho do sucesso (o padrão da exportação,
   * FASE 49): as duas telas são componentes de SERVIDOR, sem `useActionState` para
   * receber o retorno, e assim a falha aparece sem depender de JavaScript.
   */
  if (!outcome.ok) {
    redirect(
      `${volta}${separator}agenda-erro=${encodeURIComponent(outcome.message)}#atividade-${activityId}`,
    );
  }

  redirect(`${volta}${separator}agenda=${activityId}#atividade-${activityId}`);
}
