import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BellRing, CalendarCheck, MailX, ShieldCheck } from 'lucide-react';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getTenantContext } from '@/lib/events/event-repository';
import { tenantPath } from '@/domain/tenancy/resolution';
import { readUnsubscribePage } from '@/lib/communication/unsubscribe-service';
import { ResubscribeForm, UnsubscribeForm } from '@/components/communication/unsubscribe-forms';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DESCADASTRO SEM LOGIN — `/t/<slug>/descadastro/<token>` (FASE 67 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA EXISTE, E POR QUE ELA NÃO PEDE LOGIN
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O rodapé de todo e-mail de campanha oferece o caminho de saída, e quem clica nele
 *  muitas vezes NUNCA entrou na plataforma: pedir login para parar de receber e-mail
 *  é a forma mais rápida de fazer a pessoa marcar a mensagem como spam — que é o
 *  resultado que este caminho existe para evitar. A autorização é o TOKEN, e ele é
 *  conferido por HMAC antes de qualquer leitura (ver `unsubscribe-service.ts`).
 *
 *  A forma segue a das outras páginas públicas por token da casa (`/convite?codigo=`,
 *  `/carta/<token>`, `/patrocinio/<code>`): o slug vem do CAMINHO, a instituição é
 *  resolvida pelo layout público, e o token identifica a pessoa. O endereço do
 *  descadastro leva o token no CAMINHO e não na query — ele é lido por gente e colado
 *  em conversa, e `?token=` de 43 caracteres chega cortado com frequência.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOKEN NÃO PODE VAZAR POR `Referer` — E O DESENHO É QUE GARANTE ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada nesta página carrega recurso EXTERNO: nem imagem remota, nem fonte, nem
 *  script de terceiro. Sem subrecurso externo não há requisição com `Referer` para
 *  fora, e o token — que está no caminho da URL — fica onde está. O único caminho
 *  de saída daqui é um link INTERNO (a programação da instituição), e o `<a>` leva
 *  `rel="noreferrer"` por precaução: quem copia esta tela para outra não herda o
 *  direito de vazar o endereço.
 *
 *  E o token também NÃO vai para log: nada aqui registra a URL, e o serviço registra
 *  só a MENSAGEM da falha, nunca o valor recebido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A PÁGINA DIZ — E POR QUE ELA DIZ O QUE CONTINUA CHEGANDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem chegou aqui quer parar de receber "e-mail da instituição", e é legítimo. O
 *  que não é legítimo é a pessoa perder a vaga por não ter sido avisada de que
 *  precisava confirmar, ou o certificado existir sem que ela saiba. Então a página
 *  separa as duas coisas em dois blocos, na ordem em que a dúvida aparece:
 *
 *    1. **o que PARA** — os recados em massa (campanha, divulgação, aviso geral);
 *    2. **o que CONTINUA** — o transacional, que é obrigação da instituição com a
 *       pessoa: vaga retida e prazo, confirmação/liberação de vaga, promoção da lista
 *       de espera, material de apoio e certificado.
 *
 *  A lista do que continua vem do SERVIÇO (`TRANSACTIONAL_EMAILS`), e não é escrita
 *  aqui: a mesma frase aparece no rodapé do e-mail que trouxe a pessoa, e duas
 *  cópias divergiriam no dia em que o produto mudasse.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  IDEMPOTENTE NOS DOIS SENTIDOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sair duas vezes não muda nada, e voltar duas vezes também não — o serviço usa
 *  `updateMany` condicional e devolve "já estava fora" / "já estava recebendo". A
 *  página mostra o estado VIGENTE lido do banco a cada renderização, então quem
 *  recarrega o endereço vê a verdade do momento, e não o que a última ação disse.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEM `opacity` NO TEXTO — E O MOTIVO FOI MEDIDO PELO PRÓPRIO PORTÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão desta tela usava o par `opacity-60` / `opacity-75` que as
 *  páginas públicas da casa herdaram — e o portão WCAG AA reprovou com **três nós de
 *  `color-contrast`** nesta página: `opacity` não escolhe cor, ela COMPÕE o texto com
 *  o fundo, e o resultado fica abaixo dos 4,5:1 do AA.
 *
 *  A correção usa o token de TEXTO SECUNDÁRIO da plataforma
 *  (`text-muted-foreground` → `--ef-on-surface-variant`, `#464555`): **8,82:1** sobre
 *  a `--ef-surface` da página e **8,25:1** sobre o cartão (que é a `--ef-surface-low`
 *  misturada). É o MESMO papel que o rótulo do grupo de aparência passou a usar na
 *  FASE 63, e pelo mesmo motivo — ele é token de TINTA, e não de superfície.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO OS PAPÉIS `.ef-muted` / `.ef-muted-on-card` DA PÁGINA DO EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Eles foram a primeira tentativa, e o erro é instrutivo: os dois resolvem em
 *  `color-mix(… var(--ef-text) … var(--ef-background))`, e essas duas variáveis SÓ
 *  existem dentro de `.ef-theme` (a página do EVENTO, onde o organizador publica a
 *  paleta dele). Aqui elas não estão definidas, então a declaração de cor é
 *  INVÁLIDA e o navegador a descarta — o texto cai na cor herdada e o contraste
 *  passa por ACIDENTE, não por desenho. Um par que depende de variável inexistente é
 *  um par que ninguém está medindo.
 *
 *  Trocar o tom é mudar MECANISMO, não desenho: a hierarquia é a mesma, e o papel é
 *  o mesmo que o resto do painel usa para texto secundário.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ tenantSlug: string; token: string }>;
}

/**
 * Os metadados NÃO leem o token.
 *
 * `generateMetadata` roda antes do corpo, e uma leitura a mais aqui seria uma
 * segunda resolução de HMAC por acesso — sem ganho nenhum: o título de uma página
 * que existe para desfazer um recebimento não precisa (nem deve) ser indexável nem
 * personalizado. O que os robôs de prévia veriam é um título genérico, e é o certo.
 */
export const metadata: Metadata = {
  title: 'Descadastro de mensagens',
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({ params }: PageProps) {
  const { tenantSlug, token } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const state = await readUnsubscribePage({
    tenantId: tenant.tenantId,
    token,
    tenantName: tenant.name,
  });

  /**
   * Token torto, de outra pessoa, de outra instituição ou de quem perdeu o vínculo:
   * tudo responde 404, e a resposta é a MESMA. Distinguir os casos contaria a quem
   * sonda que ele acertou o formato — a mesma régua do link selado da carta (FASE 48).
   */
  if (!state.ok) notFound();

  const firstName = state.userName.trim().split(/\s+/)[0] ?? '';

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-12">
      <header className="space-y-1.5">
        {/* Texto secundário: TOKEN de tinta sobre o FUNDO da página — e não `opacity`, que compõe. */}
        <p className="text-muted-foreground text-xs uppercase tracking-wide">{state.tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MailX className="size-6" aria-hidden />
          {state.isOut ? 'Você está fora da lista' : 'Parar de receber os recados'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {firstName ? `${firstName}, ` : ''}
          {state.isOut
            ? 'você pediu para não receber mais os recados em massa desta instituição. Nada mais precisa ser feito — e você pode voltar quando quiser.'
            : 'confira abaixo o que deixa de chegar e o que continua chegando. A decisão é sua, e é reversível.'}
        </p>
      </header>

      {/**
       * O ESTADO VIGENTE — lido do banco, não do que a última ação disse.
       *
       * `unsubscribedAt` só aparece quando existe: imprimir "saiu em —" para quem
       * nunca saiu seria uma data inventada.
       */}
      <div className="ef-card space-y-4 p-5" data-testid="unsubscribe-state">
        <p
          className="flex items-center gap-2 text-sm font-medium"
          data-testid="unsubscribe-state-value"
          data-out={state.isOut ? 'true' : 'false'}
        >
          {state.isOut ? (
            <>
              <ShieldCheck className="size-4" aria-hidden />
              Situação agora: fora da lista de recados em massa.
            </>
          ) : (
            <>
              <BellRing className="size-4" aria-hidden />
              Situação agora: você recebe os recados em massa desta instituição.
            </>
          )}
        </p>

        {state.isOut && state.unsubscribedAt ? (
          <p className="text-muted-foreground text-xs" data-testid="unsubscribe-since">
            Registrado em{' '}
            {state.unsubscribedAt.toLocaleString('pt-BR', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
            .
          </p>
        ) : null}
      </div>

      {/**
       * OS DOIS BLOCOS DA PROMESSA. O que PARA primeiro (é a decisão que a pessoa
       * veio tomar), e o que CONTINUA logo abaixo (é o que ela precisa saber para
       * tomá-la sem medo).
       */}
      <div className="ef-card space-y-3 p-5" data-testid="unsubscribe-what-stops">
        <h2 className="text-sm font-semibold">O que deixa de chegar</h2>
        <p className="text-muted-foreground text-sm">
          Os <strong className="font-medium">recados em massa</strong> de{' '}
          {state.tenantName}: campanhas, divulgação de atividades, avisos gerais e
          convites que a instituição mande para um grupo de pessoas.
        </p>
      </div>

      <div className="ef-card space-y-3 p-5" data-testid="unsubscribe-what-keeps">
        <h2 className="text-sm font-semibold">O que continua chegando</h2>
        <p className="text-muted-foreground text-sm">
          Os avisos que são <strong className="font-medium">obrigação da instituição
          com você</strong> — eles não são divulgação, e por isso não dependem desta
          escolha:
        </p>
        <ul
          className="text-muted-foreground ml-5 list-disc space-y-1 text-sm"
          data-testid="unsubscribe-keeps-list"
        >
          {state.keepsReceiving.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <CalendarCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Se você quer parar de receber também esses avisos, fale com a instituição:
          eles envolvem vaga, prazo e documento, e a conversa é com uma pessoa.
        </p>
      </div>

      {state.isOut ? (
        <div className="ef-card space-y-3 p-5" data-testid="unsubscribe-actions">
          <h2 className="text-sm font-semibold">Voltar a receber</h2>
          <p className="text-muted-foreground text-sm">
            Quer voltar a receber os recados em massa? É um clique, e você pode sair de
            novo depois.
          </p>
          <ResubscribeForm tenantSlug={tenantSlug} token={token} />
        </div>
      ) : (
        <div className="ef-card space-y-3 p-5" data-testid="unsubscribe-actions">
          <h2 className="text-sm font-semibold">Confirmar</h2>
          <p className="text-muted-foreground text-sm">
            Ao confirmar, {state.tenantName} para de mandar os recados em massa para o
            seu endereço. Os avisos da lista acima continuam.
          </p>
          <UnsubscribeForm tenantSlug={tenantSlug} token={token} />
        </div>
      )}

      {/**
       * O CAMINHO DE VOLTA TAMBÉM FICA PARA QUEM ESTÁ DENTRO.
       *
       * A dúvida "eu saí sem querer?" chega por telefone, e a resposta honesta é dar
       * o botão — em vez de explicar que a pessoa precisa sair primeiro para poder
       * voltar.
       */}
      {!state.isOut ? (
        <div className="space-y-3" data-testid="unsubscribe-resubscribe-always">
          <p className="text-muted-foreground text-xs">Já saiu antes e quer voltar a receber?</p>
          <ResubscribeForm tenantSlug={tenantSlug} token={token} />
        </div>
      ) : null}

      {/**
       * O único caminho de saída da tela, e ele é INTERNO.
       *
       * `rel="noreferrer"` é precaução declarada: o token está no caminho desta URL, e
       * uma página que herdasse o endereço como referenciador o levaria junto. O
       * produto não tem subrecurso externo nenhum aqui — o que fecha o caminho por
       * desenho, e não por política de cabeçalho.
       */}
      <p className="text-muted-foreground text-xs">
        <Link
          href={tenantPath(tenantSlug, '/eventos')}
          rel="noreferrer"
          className="underline"
          data-testid="unsubscribe-back-to-events"
        >
          Ver a programação de {state.tenantName}
        </Link>
      </p>
    </main>
  );
}
