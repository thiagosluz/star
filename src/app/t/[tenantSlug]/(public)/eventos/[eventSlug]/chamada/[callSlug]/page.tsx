import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle, CalendarClock, Clock, FileText, LogIn } from 'lucide-react';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getCallBySlug } from '@/lib/proposals/call-service';
import { getPublicCallResult } from '@/lib/proposals/call-result-public-service';
import {
  PROPOSAL_KIND_LABELS,
  canSubmitToCall,
  proposalFieldsFor,
} from '@/domain/proposals/call-rules';
import { buildPublicCallResultSection } from '@/domain/proposals/call-result-public-rules';
import { submissionArtifactRequirements, proposalAttachmentStepNotice } from '@/domain/review/submission-rules';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { submitProposalAction } from '@/app/actions/call-actions';
import { ProposalForm } from '@/components/proposals/proposal-form';
import { CallResultPublicView } from '@/components/proposals/call-result-public-view';
import { Section, ThemeScope } from '@/components/events/theme-scope';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; callSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, callSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Chamada não encontrada' };

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return { title: 'Chamada não encontrada' };

  const result = await getCallBySlug({
    tenantId: tenant.tenantId,
    eventId: event.id,
    slug: callSlug,
    now: new Date(),
  });

  if (!result.ok || result.call.state === 'DRAFT') {
    return { title: 'Chamada não encontrada' };
  }

  return {
    title: `${result.call.title} · ${event.title}`,
    description: result.call.summary ?? undefined,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMULÁRIO PÚBLICO DE UMA CHAMADA (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PÁGINA EXISTE (E NÃO UM FORMULÁRIO NA ÁREA AUTENTICADA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Convidar palestrante e receber proposta de minicurso não é um ato de quem já está
 *  dentro do sistema: é uma CHAMADA ABERTA, divulgada em lista de e-mail e em rede
 *  social, em que a pessoa quase nunca tem conta. Até a FASE 32 a submissão só
 *  existia dentro do painel — quem recebia o convite precisava criar conta, achar o
 *  evento e só então descobrir que a trilha da chamada não servia para o que ele
 *  queria propor.
 *
 *  A página é pública para LER a chamada. Para ENVIAR, o servidor exige sessão (o
 *  autor precisa ser uma pessoa), e quem não tem conta entra por `/signup` com o
 *  caminho de volta — a mesma porta da inscrição pública (FASE 10).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ESTADO DA CHAMADA É DECIDIDO NO SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A janela (agendada, aberta, encerrada) vem calculada da leitura, com o MESMO
 *  domínio que a action usa para recusar. A tela espelha a decisão; ela não decide.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RESULTADO PUBLICADO É UMA SEÇÃO QUE SÓ EXISTE QUANDO HÁ RESULTADO (FASE 73)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A seção "Resultado" (estado, data, texto, lista e próximos passos) vem de uma
 *  leitura PRÓPRIA do resultado publicado — não do painel do organizador, que carrega
 *  o seletor e a decisão interna de cada submissão. Em SEM_RESULTADO e RASCUNHO não
 *  há seção: nenhum nó, nenhum título, nenhum espaço. A decisão é do domínio
 *  (`buildPublicCallResultSection`), para as duas superfícies públicas que citam o
 *  resultado dizerem a mesma coisa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PublicCallPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; callSlug: string }>;
}) {
  const { tenantSlug, eventSlug, callSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  /** UM instante para toda a página: janela, contagem e decisão de exibição. */
  const now = new Date();

  const result = await getCallBySlug({
    tenantId: tenant.tenantId,
    eventId: event.id,
    slug: callSlug,
    now,
  });

  if (!result.ok) notFound();

  const call = result.call;

  /**
   * Chamada NÃO publicada não existe para o visitante: 404, e não "ainda não
   * publicada". Rascunho é informação de quem organiza, e dizer que ele existe
   * revelaria o calendário de divulgação da instituição.
   */
  if (call.state === 'DRAFT') notFound();

  /**
   * ── O RESULTADO PUBLICADO (FASE 73 · fatia 4) ──────────────────────────────────
   *
   *  A leitura é PRÓPRIA (`getPublicCallResult`) e não o painel do organizador: o
   *  painel carrega o seletor com todas as submissões e o status da decisão de cada
   *  uma, que são material interno. Aqui o visitante recebe só o que foi publicado —
   *  texto, próximos passos e a lista escolhida.
   *
   *  A chamada já foi resolvida acima pelo caminho de sempre (`getCallBySlug`, com o
   *  evento e a instituição); a leitura do resultado relê a MESMA linha pelo id. Não
   *  há um segundo caminho para achar a chamada, e despublicar continua dando 404
   *  pelo `state === 'DRAFT'` acima.
   *
   *  A data é formatada AQUI, no fuso do evento, e chega pronta ao componente: duas
   *  formatações (servidor e navegador) dariam strings diferentes no HTML.
   */
  const resultadoPublico = await getPublicCallResult({
    tenantId: tenant.tenantId,
    callId: call.id,
  });

  /**
   * A decisão de mostrar a seção é do DOMÍNIO (`buildPublicCallResultSection`):
   * `null` — SEM_RESULTADO, RASCUNHO ou publicação sem data — não desenha seção,
   * título, espaço nem rótulo. A página não esconde: ela não cria.
   */
  const secaoResultado =
    resultadoPublico === null
      ? null
      : buildPublicCallResultSection({
          view: resultadoPublico,
          publicadoEmLabel: formatZonedDateTime(
            new Date(resultadoPublico.publicadoEm),
            result.event.timeZone,
          ),
        });

  const user = await getAuthenticatedUser();

  /**
   * A tela espelha a decisão do servidor por dois caminhos, iguais aos da inscrição:
   * quem tem vínculo ativo precisa de `submission:create`; quem não tem vínculo passa
   * e o serviço aplica os bloqueios (vínculo suspenso ou removido).
   */
  let canSubmit = call.state === 'OPEN';

  if (user) {
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId: tenant.tenantId, userId: user.id },
      select: { status: true, deletedAt: true },
    });

    if (membership?.status === 'ACTIVE' && membership.deletedAt === null) {
      const principal = await loadPrincipal(user.id, tenant.tenantId, 'ACTIVE');
      canSubmit = canSubmit && can(principal, PERMISSIONS.SUBMISSION_CREATE, { scope: 'TENANT' });
    } else if (membership?.status === 'SUSPENDED' || membership?.deletedAt) {
      canSubmit = false;
    }
  }

  const gate = canSubmitToCall({
    call: {
      isPublished: call.isPublished,
      opensAt: call.opensAt,
      closesAt: call.closesAt,
      now,
      maxSubmissionsPerAuthor: call.maxSubmissionsPerAuthor,
      title: call.title,
    },
    // O limite por autor é conferido de verdade na action; aqui a lista só decide se
    // o formulário aparece.
    authorSubmissions: 0,
  });

  const callPath = tenantPath(tenantSlug, `/eventos/${eventSlug}/chamada/${callSlug}`);
  const fields = proposalFieldsFor(call.kind);

  /**
   * ── O QUE O ENVIO VAI EXIGIR (FASE 74 · fatia 2) ─────────────────────────────
   *
   *  A frase vem do DOMÍNIO (`submissionArtifactRequirements`), a mesma função de
   *  onde a régua de prontidão tira as recusas. Antes desta fatia a página dizia o
   *  que o FORMULÁRIO pede e não dizia o que o SERVIDOR exige — a pessoa preenchia
   *  tudo, recebia "anexe a versão sem identificação dos autores" e não tinha onde
   *  anexar. Escrever a frase aqui à mão funcionaria hoje e divergiria amanhã.
   *
   *  A CEGUEIRA ANUNCIADA É A EFETIVA (FASE 74 · fatia 5): uma chamada que HERDA de
   *  uma trilha cega não declara nada na própria coluna, e ler a declaração crua
   *  faria a página anunciar "revisão aberta" (sem PDF anonimizado) para um envio
   *  que exige exatamente esse arquivo. A herança tem de chegar ao anúncio.
   */
  const requirements = submissionArtifactRequirements({
    requiresBlindReview: call.effectiveRequiresBlindReview,
    proposalKind: call.kind,
  });

  /**
   * ── O CAMINHO DO ARQUIVO, DITO ANTES DO ENVIO (FASE 74 · fatia 4) ────────────
   *
   *  Quando a chamada exige um arquivo, a proposta NÃO se completa nesta página: os
   *  dados são gravados, o rascunho fica salvo, e o anexo e o envio acontecem na área
   *  do autor — onde a esteira já existe inteira e não há uma segunda superfície de
   *  storage para manter. A frase vem do domínio (a mesma função que decide a
   *  exigência), então a promessa e a recusa nunca divergem.
   *
   *  `null` — chamada de programação sem exigência de arquivo — não acrescenta nada:
   *  ali o envio acontece aqui mesmo, num ato só.
   */
  const attachmentNotice = proposalAttachmentStepNotice({
    requiresBlindReview: call.effectiveRequiresBlindReview,
    proposalKind: call.kind,
  });

  return (
    <ThemeScope theme={event.theme}>
      <main>
        <Section>
          <nav className="mb-6">
            <Link
              href={tenantPath(tenantSlug, `/eventos/${eventSlug}`)}
              className="ef-muted text-xs underline underline-offset-4"
            >
              ← {event.title}
            </Link>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <header className="space-y-2">
                <p className="ef-muted text-xs uppercase tracking-wide">
                  {PROPOSAL_KIND_LABELS[call.kind]}
                </p>
                <h1
                  className="text-balance text-3xl font-semibold tracking-tight"
                  data-testid="call-title"
                >
                  {call.title}
                </h1>
                {call.summary ? (
                  <p className="text-pretty text-sm opacity-80">{call.summary}</p>
                ) : null}

                <p className="flex flex-wrap items-center gap-3 text-xs opacity-70">
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="size-3.5" aria-hidden />
                    {call.windowLabel}
                  </span>
                  {call.countdown ? (
                    <span className="flex items-center gap-1.5 font-medium" data-testid="call-countdown">
                      <Clock className="size-3.5" aria-hidden />
                      {call.countdown}
                    </span>
                  ) : null}
                  <span className="ef-badge">{call.state === 'OPEN' ? 'Aberta' : call.state === 'CLOSED' ? 'Encerrada' : 'Em breve'}</span>
                </p>
              </header>

              {call.instructions ? (
                <div className="ef-card space-y-2 p-4">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <FileText className="size-3.5" aria-hidden />
                    Orientações
                  </p>
                  <p className="whitespace-pre-line text-pretty text-sm opacity-80">
                    {call.instructions}
                  </p>
                </div>
              ) : null}

              {canSubmit ? (
                <div className="ef-card p-5" data-testid="call-form-section">
                  <h2 className="mb-4 text-lg font-semibold tracking-tight">Enviar proposta</h2>

                  {attachmentNotice ? (
                    <p
                      className="mb-4 text-pretty text-sm opacity-80"
                      data-testid="proposal-attachment-notice"
                    >
                      {attachmentNotice}
                    </p>
                  ) : null}

                  {user ? (
                    <ProposalForm
                      tenantSlug={tenantSlug}
                      eventSlug={eventSlug}
                      callSlug={callSlug}
                      fields={fields}
                      action={submitProposalAction}
                    />
                  ) : (
                    /**
                     * Sem sessão, o caminho é entrar ou criar a conta — e VOLTAR para esta
                     * chamada. O formulário não pede senha: quem propõe precisa ser uma
                     * pessoa identificável, e é a conta que responde pelo protocolo.
                     */
                    <div className="space-y-3" data-testid="call-login-required">
                      <p className="flex items-start gap-2 text-sm opacity-80">
                        <LogIn className="mt-0.5 size-4 shrink-0" aria-hidden />
                        Entre na plataforma para enviar sua proposta. Se ainda não tem conta, criar
                        uma leva um minuto — e você volta direto para esta chamada.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Link
                          className="ef-button"
                          href={`/login?redirectTo=${encodeURIComponent(callPath)}`}
                        >
                          Entrar
                        </Link>
                        <Link
                          className="ef-button"
                          href={`/signup?redirectTo=${encodeURIComponent(callPath)}`}
                          data-testid="call-signup-link"
                        >
                          Criar conta
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="ef-card flex items-start gap-2 p-5 text-sm"
                  data-testid="call-not-open"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {gate.ok === false
                      ? gate.message
                      : 'Seu perfil não tem permissão para propor nesta instituição. Fale com a organização do evento.'}
                  </span>
                </div>
              )}
            </div>

            {/* ── Lateral: o que esta chamada pede ─────────────────────────── */}
            <aside className="space-y-4">
              <div className="ef-card space-y-3 p-4">
                <p className="text-sm font-medium">O que esta chamada pede</p>

                <ul className="space-y-2 text-sm opacity-80" data-testid="call-requirements">
                  <li>Título e resumo da proposta</li>
                  {fields.map((field) => (
                    <li key={field.key}>
                      {field.label}
                      {field.required ? '' : ' (opcional)'}
                    </li>
                  ))}
                  {requirements.map((requirement) => (
                    <li
                      key={requirement.key}
                      data-testid={`call-requirement-${requirement.key}`}
                      data-requirement={requirement.required ? 'REQUIRED' : 'RECOMMENDED'}
                    >
                      {requirement.label}
                    </li>
                  ))}
                </ul>

                {/* Sobre o CARTÃO: `.ef-muted-on-card` — é o papel do tema para texto
                    de apoio sobre a superfície do cartão (a régua da FASE 66; a
                    opacidade media 4,44:1 no claro e reprovava o AA). */}
                <p className="ef-muted-on-card text-xs">
                  {/**
                    * A frase lê a cegueira EFETIVA: numa chamada que herda da trilha,
                    * `requiresBlindReview` é nulo e a frase ficaria "aberta" enquanto o
                    * envio exige o PDF anonimizado (FASE 74 · fatia 5). O que a tela
                    * afirma é o que o servidor vai cobrar.
                    */}
                  {call.effectiveRequiresBlindReview
                    ? 'A avaliação é cega: quem julga não vê a autoria.'
                    : 'A avaliação é aberta: quem julga vê a autoria.'}
                  {call.maxSubmissionsPerAuthor > 0
                    ? ` Limite de ${call.maxSubmissionsPerAuthor} proposta(s) por pessoa nesta chamada.`
                    : ' Sem limite de propostas por pessoa.'}
                </p>
              </div>

              <div className="ef-card space-y-2 p-4 text-xs opacity-70">
                <p className="font-medium opacity-100">Depois de enviar</p>
                <p>
                  Você recebe um protocolo e um e-mail de confirmação. É o protocolo que a
                  organização usa para localizar sua proposta — guarde-o.
                </p>
              </div>
            </aside>
          </div>

          {/*
            ── O RESULTADO PUBLICADO (FASE 73 · fatia 4) ───────────────────────
            A seção só é CRIADA quando o domínio decidiu que há resultado — e é por
            isso que SEM_RESULTADO e RASCUNHO não deixam nem o título no HTML: não há
            seção escondida por CSS, há ausência de nó.
          */}
          {secaoResultado ? (
            <section
              aria-labelledby="call-result-title"
              className="mt-10 border-t border-border pt-8"
              data-testid="call-result-section"
            >
              <h2
                id="call-result-title"
                className="mb-4 text-2xl font-semibold tracking-tight"
              >
                {secaoResultado.title}
              </h2>

              <CallResultPublicView
                view={secaoResultado.view}
                publicadoEmLabel={secaoResultado.publicadoEmLabel}
              />
            </section>
          ) : null}
        </Section>
      </main>
    </ThemeScope>
  );
}
