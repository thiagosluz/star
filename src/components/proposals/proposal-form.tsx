'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Send } from 'lucide-react';

import type { CallActionState } from '@/app/actions/call-actions';
import { Button, Input, Label, Textarea } from '@/components/ui';
import { tenantPath } from '@/domain/tenancy/resolution';
import {
  MAX_ABSTRACT_LENGTH,
  MAX_KEYWORDS,
  MIN_ABSTRACT_LENGTH,
  MIN_KEYWORDS,
} from '@/domain/review/submission-rules';
import type { ProposalFieldSpec } from '@/domain/proposals/call-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMULÁRIO PÚBLICO DA CHAMADA (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS CAMPOS POR TIPO VÊM DO DOMÍNIO, NÃO DESTE ARQUIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela RECEBE a lista de campos do tipo (`proposalFieldsFor`) e desenha o que ela
 *  diz — inclusive quando o domínio ganhar um campo novo. A validação acontece no
 *  servidor, com a MESMA função; aqui só se evita o erro previsível (obrigatório,
 *  faixa numérica, tamanho).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RECUSA NÃO É UM BECO (FASE 74 · fatia 2, ajuste posterior)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quando o servidor recusa o ENVIO por prontidão (falta o PDF anonimizado, por
 *  exemplo), a proposta JÁ está gravada como rascunho — e a action REDIRECIONA
 *  para a página desse rascunho, com `?rascunho=1`. Não há link a desenhar aqui:
 *  a navegação acontece no servidor, antes de existir estado de erro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ANEXO NÃO MORA AQUI, E ISSO É DECISÃO (FASE 74 · fatia 4)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A proposta científica se COMPLETA na área do autor: lá estão o upload dos
 *  artefatos, a lista de bloqueios e o botão de envio, no mesmo lugar e na mesma
 *  leitura. Trazer o upload para cá custaria uma segunda superfície de storage numa
 *  página pública, um passo que só funciona com JavaScript (o hash e o PUT direto ao
 *  bucket) — e ainda deixaria o ENVIO de fora, porque enviar é o passo seguinte.
 *  Meio caminho não quita nada e cria um a manter.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O NOME DO CAMPO TEM PREFIXO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `campo.workloadMinutes`, e não `workloadMinutes`: o formulário também tem campos
 *  COMUNS (`title`, `abstract`, `keywords`), e um tipo que pedisse `title` colidiria
 *  com o título da proposta. O prefixo separa o que é comum do que é do tipo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="proposal-submit">
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Send className="size-4" aria-hidden />
      )}
      {pending ? 'Enviando…' : label}
    </Button>
  );
}

export function ProposalForm({
  tenantSlug,
  eventSlug,
  callSlug,
  fields,
  action,
}: {
  tenantSlug: string;
  eventSlug: string;
  callSlug: string;
  fields: readonly ProposalFieldSpec[];
  action: (prev: CallActionState | null, formData: FormData) => Promise<CallActionState>;
}) {
  const [state, formAction] = useActionState<CallActionState | null, FormData>(action, null);

  /**
   * O protocolo é a única prova que o proponente leva. Ele fica em destaque, e não
   * numa linha de mensagem: é com ele que a organização localiza a proposta.
   */
  if (state?.ok) {
    return (
      <div
        className="space-y-3 rounded-lg border border-success/40 bg-card p-6"
        data-testid="proposal-received"
      >
        <p className="flex items-center gap-2 font-medium text-success-strong">
          <CheckCircle2 className="size-5" aria-hidden />
          Proposta recebida!
        </p>

        {state.protocol ? (
          <p className="text-sm">
            Seu protocolo é{' '}
            <span className="code-data text-base font-semibold" data-testid="proposal-protocol">
              {state.protocol}
            </span>
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">{state.message}</p>

        {/*
          O DESTINO DA TELA DE SUCESSO É O QUE A ACTION DEVOLVEU (`redirectTo`, a
          rota REAL da submissão). Antes o campo apontava para `/minhas-submissoes`,
          que nunca existiu — um link quebrado escondido atrás de um valor morto.
        */}
        {state.redirectTo ? (
          <p>
            <Link
              href={state.redirectTo}
              className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
              data-testid="proposal-received-link"
            >
              Ver a proposta
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" data-testid="proposal-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="callSlug" value={callSlug} />

      <div className="space-y-1.5">
        <Label htmlFor="proposal-title">Título</Label>
        <Input
          id="proposal-title"
          name="title"
          required
          minLength={3}
          maxLength={300}
          aria-label="Título"
          placeholder="Como a organização deve identificar sua proposta"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="proposal-abstract">Resumo</Label>
        <Textarea
          id="proposal-abstract"
          name="abstract"
          required
          minLength={MIN_ABSTRACT_LENGTH}
          maxLength={MAX_ABSTRACT_LENGTH}
          rows={6}
          aria-label="Resumo"
          placeholder="O que você propõe, para quem e por quê. É o texto que os avaliadores leem."
        />
        {/*
          A regra vem do DOMÍNIO, e não de um número escrito aqui: o resumo curto é
          recusado no servidor ("ao menos 150 caracteres para permitir avaliação"), e um
          campo que aceita 30 enquanto o servidor exige 150 faz a pessoa perder o texto
          digitado no fim do formulário.
        */}
        <p className="text-xs text-muted-foreground">
          De {MIN_ABSTRACT_LENGTH} a {MAX_ABSTRACT_LENGTH} caracteres.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="proposal-keywords">Palavras-chave</Label>
          <Input
            id="proposal-keywords"
            name="keywords"
            required
            maxLength={400}
            aria-label="Palavras-chave"
            placeholder="extensão, saúde digital, telemedicina"
          />
          {/*
            A regra é a MESMA da submissão científica (o motor é o mesmo): de 3 a 8
            palavras distintas. O campo diz isso antes de a pessoa enviar, em vez de
            revelar no erro — e é por elas que a afinidade dos revisores é calculada.
          */}
          <p className="text-xs text-muted-foreground">
            De {MIN_KEYWORDS} a {MAX_KEYWORDS}, separadas por vírgula — são elas que ligam sua
            proposta a quem tem afinidade com o tema.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="proposal-language">Idioma</Label>
          <Input
            id="proposal-language"
            name="language"
            maxLength={16}
            aria-label="Idioma"
            placeholder="pt-BR"
          />
        </div>
      </div>

      {/* ── Campos do TIPO (vêm do domínio) ──────────────────────────────── */}
      {fields.length > 0 ? (
        <div className="space-y-4 rounded-md border border-border p-4">
          <p className="text-sm font-medium">Sobre esta modalidade</p>

          {fields.map((field) => {
            const id = `proposal-field-${field.key}`;

            return (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={id}>
                  {field.label}
                  {field.required ? null : (
                    <span className="ml-1 font-normal text-muted-foreground">(opcional)</span>
                  )}
                </Label>

                {field.input === 'LONG_TEXT' ? (
                  <Textarea
                    id={id}
                    name={`campo.${field.key}`}
                    required={field.required}
                    maxLength={field.maxLength}
                    rows={4}
                    aria-label={field.label}
                    data-testid={`proposal-${field.key}`}
                  />
                ) : (
                  <Input
                    id={id}
                    name={`campo.${field.key}`}
                    type={field.input === 'NUMBER' ? 'number' : 'text'}
                    required={field.required}
                    min={field.input === 'NUMBER' ? field.min : undefined}
                    max={field.input === 'NUMBER' ? field.max : undefined}
                    maxLength={field.maxLength}
                    aria-label={field.label}
                    data-testid={`proposal-${field.key}`}
                  />
                )}

                {field.help ? (
                  <p className="text-xs text-muted-foreground">{field.help}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {state && !state.ok ? (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="proposal-error"
        >
          <p>
            <AlertCircle className="mr-1.5 inline size-3.5" aria-hidden />
            {state.message}
          </p>
          {state.details?.length ? (
            <ul className="ml-5 list-disc text-xs">
              {state.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}

          {/*
            ── O TETO DE RASCUNHOS TAMBÉM DIZ O CAMINHO (FASE 74 · fatia 4) ───────
            A recusa do teto não devolve um rascunho específico (são vários), mas a
            mensagem manda enviar ou excluir um — e sem link a pessoa teria de
            adivinhar onde. O destino é a lista, onde os rascunhos aparecem com o
            estado e o botão de abrir. "Erro sem saída é o defeito" vale aqui também.

            A recusa que TEM rascunho não aparece nesta caixa: a action redireciona
            para ele (FASE 74 · ajuste da fatia 2), e este formulário nunca a vê.
          */}
          {state.code === 'DRAFT_FILE_LIMIT_REACHED' ? (
            <p className="pt-1 text-xs">
              <Link
                href={tenantPath(tenantSlug, '/submissoes')}
                className="font-medium underline underline-offset-4"
                data-testid="proposal-draft-ceiling-link"
              >
                Ver meus rascunhos
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      <SubmitButton label="Enviar proposta" />
    </form>
  );
}
