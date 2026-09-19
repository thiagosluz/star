'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Check, Loader2, ShieldCheck } from 'lucide-react';

import { Badge, Button, Checkbox } from '@/components/ui';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  removeMemberAction,
  updateMemberRolesAction,
  type MemberActionState,
} from '@/app/actions/member-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AÇÕES DO MEMBRO — papéis e remoção (FASE 21, item C5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS CAIXAS SÃO CONTROLADAS, PORQUE A ACTION PODE RECUSAR (armadilha 5)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O React 19 reseta o formulário depois de uma Server Action — inclusive quando ela
 *  devolve ERRO. Com caixas não controladas, quem tenta tirar o papel do último
 *  proprietário, envia e lê "promova outra pessoa antes" encontra a seleção anterior
 *  de volta, sem saber o que de fato está marcado. O estado vive aqui.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA NÃO OFERECE, ELA NÃO ESCONDE EM SILÊNCIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem `tenant:role:assign` (o caso do ADMIN, por desenho do RBAC), o editor de
 *  papéis nem aparece: a página diz quem pode mexer nisso. Sem
 *  `tenant:member:remove`, o botão de remover também não. E a própria linha
 *  (`updateMemberRolesAction`) reconfere a permissão — esconder não é autorizar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function SaveRolesButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" disabled={pending} data-testid="save-roles-submit">
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
      Salvar papéis
    </Button>
  );
}

export function MemberRolesForm({
  tenantSlug,
  userId,
  memberName,
  currentRoles,
  options,
}: {
  tenantSlug: string;
  userId: string;
  memberName: string;
  currentRoles: readonly string[];
  options: readonly { value: string; label: string }[];
}) {
  const [selected, setSelected] = useState<readonly string[]>(currentRoles);

  const [state, formAction] = useActionState<MemberActionState, FormData>(
    async (previous, formData) => {
      const result = await updateMemberRolesAction(previous, formData);

      /**
       * Na recusa, a seleção da tela volta a ser a do BANCO: deixar marcado o que a
       * instituição tentou e não pôde aplicar faria a pessoa acreditar que valeu.
       */
      if (!result.ok) setSelected(currentRoles);

      return result;
    },
    { ok: false },
  );

  function toggle(role: string) {
    setSelected((previous) =>
      previous.includes(role) ? previous.filter((entry) => entry !== role) : [...previous, role],
    );
  }

  return (
    <form action={formAction} className="space-y-3" data-testid={`member-roles-${userId}`}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="userId" value={userId} />

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">
          Papéis de {memberName} nesta instituição
        </legend>

        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 rounded-sm border border-border px-3 py-2 text-sm"
            >
              <Checkbox
                name="roles"
                value={option.value}
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                data-testid={`role-${userId}-${option.value}`}
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </label>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Papéis de <strong className="font-medium text-foreground">evento</strong> ou de{' '}
          <strong className="font-medium text-foreground">atividade</strong> não aparecem aqui: quem
          concede <span className="code-data">STAFF</span> para um dia ou{' '}
          <span className="code-data">REVIEWER</span> para uma trilha é a tela daquele alvo.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SaveRolesButton />

        {state.message ? (
          <span
            role={state.ok ? 'status' : 'alert'}
            data-testid={`member-roles-feedback-${userId}`}
            className={
              state.ok
                ? 'flex items-center gap-1.5 text-xs text-success-strong'
                : 'flex items-center gap-1.5 text-xs text-destructive'
            }
          >
            {state.ok ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            )}
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** Ações da linha: o que a pessoa pode fazer com ESTE membro. */
export function MemberRowActions({
  tenantSlug,
  userId,
  memberName,
  memberEmail,
  isSelf,
  canAssignRoles,
  canRemove,
  rolesOptions,
  currentRoles,
  registrationCount,
}: {
  tenantSlug: string;
  userId: string;
  memberName: string;
  memberEmail: string;
  isSelf: boolean;
  canAssignRoles: boolean;
  canRemove: boolean;
  rolesOptions: readonly { value: string; label: string }[];
  currentRoles: readonly string[];
  /** Inscrições da pessoa nesta instituição — entra no aviso da remoção. */
  registrationCount: number;
}) {
  const nothingToDo = !canAssignRoles && !(canRemove && !isSelf);

  if (nothingToDo) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <details className="group" data-testid={`member-actions-${userId}`}>
      <summary className="cursor-pointer text-xs font-medium text-brand">
        Papéis e acesso
      </summary>

      <div className="mt-3 space-y-4 rounded-sm border border-border bg-surface-low p-4">
        {canAssignRoles ? (
          <MemberRolesForm
            tenantSlug={tenantSlug}
            userId={userId}
            memberName={memberName}
            currentRoles={currentRoles}
            options={rolesOptions}
          />
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Trocar papéis exige a permissão de concessão de papel, que o seu perfil não tem. O papel
            vigente aparece ao lado do nome.
          </p>
        )}

        {canRemove && !isSelf ? (
          <div className="border-t border-border pt-3">
            <InlineActionForm
              action={removeMemberAction}
              submitLabel="Remover acesso"
              variant="destructive"
              testId={`remove-member-${userId}`}
              confirm={{
                title: `Remover o acesso de ${memberName}?`,
                description: (
                  <>
                    <span className="block">
                      O vínculo sai da equipe e <strong className="font-medium">todos os papéis</strong>{' '}
                      desta instituição são revogados — inclusive os de evento e de atividade. A vaga
                      volta para a quota do plano, e o histórico de auditoria permanece.
                    </span>
                    {/**
                     * A CONSEQUÊNCIA QUE NÃO APARECE NA TELA, DITA ANTES DO CLIQUE: o
                     * vínculo é uma linha por (instituição, pessoa), então remover a
                     * equipe tira junto o acesso de PARTICIPANTE — quem tem inscrição
                     * deixa de ver as próprias inscrições e certificados.
                     */}
                    {registrationCount > 0 ? (
                      <span className="mt-2 block" data-testid={`remove-member-warning-${userId}`}>
                        Atenção: esta pessoa tem{' '}
                        <strong className="font-medium">
                          {registrationCount} inscrição(ões) em eventos
                        </strong>{' '}
                        desta instituição. Ela perde também o acesso à área de participante (as
                        inscrições e os certificados continuam registrados na instituição).
                      </span>
                    ) : null}
                    <span className="mt-2 block">
                      Readmitir é um convite novo para{' '}
                      <span className="code-data">{memberEmail}</span>.
                    </span>
                  </>
                ),
                confirmLabel: 'Remover acesso',
              }}
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="userId" value={userId} />
            </InlineActionForm>
          </div>
        ) : null}

        {isSelf ? (
          <p className="text-xs text-muted-foreground" data-testid={`member-self-${userId}`}>
            <Badge tone="neutral" size="sm">
              você
            </Badge>{' '}
            O próprio acesso não pode ser removido por aqui — peça a outra pessoa com papel de
            proprietário ou administrador.
          </p>
        ) : null}
      </div>
    </details>
  );
}
