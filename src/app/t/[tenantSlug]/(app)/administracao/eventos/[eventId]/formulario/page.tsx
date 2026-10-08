import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ClipboardList, Info } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import {
  FORM_FIELD_TYPE_LABELS,
  FORM_FIELDS_MAX,
  THIRD_PARTY_FORBIDDEN_FORM_KEYS,
  formFieldRequiresPurpose,
  type RegistrationFormField,
} from '@/domain/events/registration-form-spec-rules';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  FreeTextFieldNotice,
  RegistrationFieldForm,
} from '@/components/admin/registration-form-editor';
import {
  moveRegistrationFormFieldAction,
  removeRegistrationFormFieldAction,
} from '@/app/actions/registration-form-actions';
import { SectionHeading } from '@/components/ui';

export const metadata = { title: 'Formulário de inscrição' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMULÁRIO DE INSCRIÇÃO DO EVENTO (FASE 70 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA PÁGINA PRÓPRIA, NO GRUPO "CONFIGURAR"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As seções que se editam no evento viraram PÁGINAS com cartão na FASE 55 (dados,
 *  salas, programação, reconhecimento), e esta é a mesma espécie de coisa: uma
 *  configuração do evento, com endereço próprio, na grade de áreas da raiz. Ela fica
 *  logo depois de "Dados do evento" porque as duas respondem à mesma pergunta de
 *  quem organiza — "o que o evento é" — e porque os PRAZOS de inscrição moram lá.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE VEM DO DOMÍNIO, E O QUE NÃO VEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os campos chegam PRONTOS de `getAdminEvent`, que usa o leitor tolerante
 *  (`readRegistrationForm`) — esta página nunca toca no JSON cru de `Event.settings`
 *  (o mesmo caminho que a política de inscrição da FASE 12 usa). O que o organizador
 *  declarou pode estar INVÁLIDO (só um caminho de fora do sistema grava assim), e aí
 *  a leitura devolve a lista vazia COM os problemas: a página mostra as mensagens do
 *  domínio e diz o que acontece com o que for salvo dali em diante.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA INTEIRA É SERVIDOR, E O ENVIO NÃO PRECISA DE JAVASCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada gesto é um `<form>` de verdade (acrescentar/editar, remover, subir/descer) —
 *  como a ordem das equipes da FASE 51 —, e nenhum botão depende de estado de
 *  cliente. Com o script desligado o POST acontece do mesmo jeito, e é o que o E2E
 *  desta fatia mede.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventRegistrationFormPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const { fields, problems } = event.registrationForm;

  const atCeiling = fields.length >= FORM_FIELDS_MAX;

  return (
    <main className="max-w-3xl space-y-8" data-testid="registration-form-page">
      <div className="space-y-2">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Voltar ao evento
          </Link>
        </nav>

        <SectionHeading
          title="Formulário de inscrição"
          description={`${event.title} · o que o participante responde ao se inscrever neste evento. Sem nenhum campo declarado, vale o formulário de sempre.`}
        />
      </div>

      {/**
        * O AVISO (requisito da fase), logo acima do editor: a decisão de liberar
        * texto livre veio com ele, e é aqui que a decisão de pedir acontece.
        */}
      <FreeTextFieldNotice />

      {/**
        * ─────────────────────────────────────────────────────────────────────────
        *  A CONFIGURAÇÃO GRAVADA ESTÁ TORTA
        * ─────────────────────────────────────────────────────────────────────────
        *  A leitura tolerante devolve a lista VAZIA e os problemas. As mensagens são
        *  as do domínio, uma por problema, com o índice do campo — esta tela não
        *  inventa texto para elas. E o aviso diz o que o gesto vai fazer com o que
        *  está lá: SUBSTITUIR. Guardar isso em silêncio seria apagar sem avisar.
        */}
      {problems.length > 0 ? (
        <section
          aria-label="Problemas na configuração gravada"
          data-testid="registration-form-problems"
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive-soft p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            A configuração gravada deste formulário está inválida
          </p>

          <p className="text-sm text-foreground">
            Enquanto ela estiver assim, quem se inscreve responde <strong>o formulário de sempre</strong>{' '}
            — CPF, necessidades de acessibilidade e consentimentos —, e nenhum campo entra em vigor. O
            que você salvar aqui <strong>substitui</strong> a configuração inválida.
          </p>

          <ul className="ml-5 list-disc space-y-1 text-sm text-foreground">
            {problems.map((problem) => (
              <li key={`${problem.code}-${problem.index ?? 'lista'}-${problem.key ?? ''}`}>
                {/**
                  * O número do campo é a COORDENADA que o domínio devolveu
                  * (`problem.index`, 1-based na lista de campos declarados) e aparece
                  * como tal — separado da mensagem. A frase é do domínio, inteira:
                  * esta tela não reescreve nem resume nenhuma delas.
                  */}
                {problem.index !== null ? (
                  <span className="text-muted-foreground">Campo {problem.index}: </span>
                ) : null}
                {problem.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4" aria-labelledby="campos-declarados">
        <SectionHeading
          title="Campos declarados"
          description={`Até ${FORM_FIELDS_MAX} campos, na ordem em que o participante os vê. As setas ↑ e ↓ mudam essa ordem.`}
        />

        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="registration-form-empty">
            Nenhum campo declarado. Quem se inscreve responde o formulário de sempre: CPF, necessidades
            de acessibilidade e os consentimentos.
          </p>
        ) : (
          <ul
            className="divide-y divide-border rounded-lg border border-border"
            data-testid="registration-form-fields"
          >
            {fields.map((field) => (
              <li
                key={field.key}
                className="space-y-3 p-3"
                data-testid={`registration-field-${field.key}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground">{field.label}</p>
                    <p className="text-xs text-muted-foreground">
                      <code className="code-data">{field.key}</code> ·{' '}
                      {FORM_FIELD_TYPE_LABELS[field.type]} ·{' '}
                      {field.required ? 'obrigatório' : 'opcional'}
                      {declaredLimits(field).map((limit) => (
                        <span key={limit}> · {limit}</span>
                      ))}
                    </p>
                    {field.help ? (
                      <p className="text-xs text-muted-foreground">{field.help}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Finalidade: {field.purpose ?? 'não declarada'}
                      {formFieldRequiresPurpose(field.type) ? '' : ' (opcional neste tipo)'}
                    </p>
                  </div>

                  {/**
                    * As duas setas são DOIS formulários, e não um com dois botões: o
                    * `InlineActionForm` envia UM formulário, e a direção viaja como
                    * campo oculto — o mesmo desenho da ordem das equipes (FASE 51).
                    *
                    * Remover NÃO tem diálogo de confirmação de propósito: a
                    * confirmação é um portão de JavaScript, e aqui a régua é a tela
                    * funcionar sem ele (a lição da E50). Tirar um campo do formulário
                    * é reversível — recriá-lo é digitar os mesmos campos de novo.
                    */}
                  <div className="flex items-center gap-1">
                    <InlineActionForm
                      action={moveRegistrationFormFieldAction}
                      submitLabel="↑"
                      testId={`field-up-${field.key}`}
                      className="inline-flex"
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="key" value={field.key} />
                      <input type="hidden" name="direction" value="up" />
                    </InlineActionForm>

                    <InlineActionForm
                      action={moveRegistrationFormFieldAction}
                      submitLabel="↓"
                      testId={`field-down-${field.key}`}
                      className="inline-flex"
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="key" value={field.key} />
                      <input type="hidden" name="direction" value="down" />
                    </InlineActionForm>

                    <InlineActionForm
                      action={removeRegistrationFormFieldAction}
                      submitLabel="Remover campo"
                      variant="destructive"
                      testId={`field-remove-${field.key}`}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="key" value={field.key} />
                    </InlineActionForm>
                  </div>
                </div>

                <details className="rounded-lg border border-border p-2">
                  <summary
                    className="cursor-pointer text-xs font-medium"
                    data-testid={`edit-field-${field.key}`}
                  >
                    Editar este campo
                  </summary>

                  <div className="pt-3">
                    <RegistrationFieldForm
                      tenantSlug={tenantSlug}
                      eventId={eventId}
                      field={field}
                      idPrefix={`field-${field.key}`}
                      testId={`field-form-${field.key}`}
                      submitLabel="Salvar campo"
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}

        {/**
          * Tirar um campo do formulário não apaga o que já foi respondido: as
          * respostas vivem na INSCRIÇÃO de quem respondeu, e a configuração do evento
          * não as alcança. Dizer isso evita que alguém deixe de remover uma pergunta
          * por medo de perder dado — e evita que alguém remova achando que limpou.
          */}
        {fields.length > 0 ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Tirar um campo do formulário não apaga as respostas já recebidas: elas continuam guardadas
            na inscrição de quem respondeu.
          </p>
        ) : null}
      </section>

      <section className="space-y-4" aria-labelledby="novo-campo">
        <SectionHeading
          title="Acrescentar campo"
          description="O campo entra no fim da lista; depois as setas ↑ e ↓ colocam-no onde você quiser."
        />

        {atCeiling ? (
          <p className="text-sm text-muted-foreground" data-testid="registration-form-ceiling">
            Este formulário já está no teto de {FORM_FIELDS_MAX} campos. Remova algum para acrescentar
            outro.
          </p>
        ) : (
          <details
            className="rounded-lg border border-border p-3"
            open={fields.length === 0}
            data-testid="new-field"
          >
            <summary className="cursor-pointer text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <ClipboardList className="size-4" aria-hidden />
                Novo campo
              </span>
            </summary>

            <div className="pt-4">
              <RegistrationFieldForm
                tenantSlug={tenantSlug}
                eventId={eventId}
                field={null}
                idPrefix="new-field"
                testId="new-field-form"
                submitLabel="Acrescentar campo"
              />
            </div>
          </details>
        )}
      </section>

      {/**
        * O fecho diz o que NÃO sai — a mesma decisão que o aviso anuncia. A lista vem
        * do domínio (`THIRD_PARTY_FORBIDDEN_FORM_KEYS`), e não de uma cópia na tela:
        * acrescentar uma chave proibida nova é decisão de uma linha só, lá.
        */}
      <p className="text-xs text-muted-foreground" data-testid="third-party-keys">
        Respostas deste formulário não saem em CSV de participantes nem no perfil público. As chaves
        mantidas fora dessas superfícies hoje: {THIRD_PARTY_FORBIDDEN_FORM_KEYS.join(', ')}.
      </p>
    </main>
  );
}

/**
 * Os limites DECLARADOS no campo, em uma linha — o que a tela mostra sem obrigar o
 * organizador a abrir o editor. Sem limite declarado, o teto é o do TIPO, e quem
 * responde isso é o domínio: aqui só aparece o que foi escrito.
 */
function declaredLimits(field: RegistrationFormField): string[] {
  const limits: string[] = [];

  if (field.maxLength !== undefined) limits.push(`até ${field.maxLength} caracteres`);

  if (field.min !== undefined && field.max !== undefined) {
    limits.push(`de ${field.min} a ${field.max}`);
  } else if (field.min !== undefined) {
    limits.push(`a partir de ${field.min}`);
  } else if (field.max !== undefined) {
    limits.push(`até ${field.max}`);
  }

  if (field.options && field.options.length > 0) {
    limits.push(
      field.options.length === 1 ? '1 opção' : `${field.options.length} opções`,
    );
  }

  return limits;
}
