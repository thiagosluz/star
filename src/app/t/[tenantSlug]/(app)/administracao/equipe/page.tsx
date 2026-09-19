import { Users, UserRoundCheck, UserRoundPlus, MailPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS, roleLabel } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { assignableTenantRoles, getTeamOverview } from '@/lib/admin/member-service';
import { quotaUsageLabel } from '@/domain/platform/platform-rules';
import { listInvitations } from '@/lib/communication/invitation-service';
import {
  invitationConsequence,
  invitableRoles,
} from '@/domain/communication/invitation-rules';
import { invitationRoleLabel } from '@/domain/communication/email-rules';
import { InviteMemberForm } from '@/components/communication/invite-member-form';
import { InvitationActions } from '@/components/communication/invitation-actions';
import { MemberRowActions } from '@/components/admin/member-actions';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrapper,
} from '@/components/ui';

export const metadata = { title: 'Equipe' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INVITED: 'Convite pendente',
  SUSPENDED: 'Suspenso',
  REMOVED: 'Removido',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EQUIPE DA INSTITUIÇÃO — `/t/<slug>/administracao/equipe` (FASE 14)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA QUE FALTAVA: MEMBROS ≠ INSCRITOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Desde a FASE 10, quem se inscreve em evento aberto passa a ter vínculo com a
 *  instituição. Isso é correto para dar acesso — e criou uma confusão real: a lista
 *  de "membros" mostrava o público do evento, e a quota do plano parecia estourada
 *  por causa de inscritos.
 *
 *  Aqui a separação fica visível para quem administra: EQUIPE (quem responde pela
 *  instituição, com papel e situação) e PARTICIPANTES (contagem do público, que
 *  **não** consome a quota). A leitura é feita sob RLS (`getTeamOverview`), e não
 *  pela conexão administrativa — a instituição vê os próprios vínculos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA FAZ DESDE A FASE 15
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Convida por e-mail (a dívida D2, que a FASE 14 declarou aqui em texto: "convite
 *  exige provar que o endereço pertence a quem convida... é o desenho da fase de
 *  Comunicação"). O convite nasce PENDENTE, não ocupa vaga na quota e o vínculo só
 *  existe no aceite — é lá que a quota do plano é aplicada.
 *
 *  Vincular alguém que JÁ tem conta continua sendo ação da PLATAFORMA, no painel de
 *  governança; remover membro ainda é dívida (C5), porque mexe em acesso e auditoria
 *  e pede fluxo próprio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A GUARDA É `tenant:member:invite`, E NÃO `tenant:read`
 * ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão desta tela usava `tenant:read` — que PARECE o certo para
 *  "listar o que é da instituição" e está errado aqui: o papel `PARTICIPANT` TEM
 *  `tenant:read` (ele precisa ler o evento e a própria inscrição). Com essa guarda,
 *  o público de qualquer evento aberto — que ganha acesso automaticamente desde a
 *  FASE 10 — conseguiria abrir a tela e ler nome, e-mail e papéis de toda a equipe.
 *  Foi o teste E2E que reprovou: `participante não entra na tela de equipe`.
 *
 *  A guarda correta é a da seção "Administração", que é de quem administra pessoas.
 *  Lista de equipe é dado de administração, não dado público da instituição.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function TeamPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;

  const { tenantId, tenantName, userId: actorUserId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  const team = await getTeamOverview(tenantId);
  const invitations = await listInvitations({ tenantId });

  /**
   * Papéis oferecidos no convite, com a consequência escrita de cada um.
   *
   * A lista vem do DOMÍNIO (`invitableRoles`): `OWNER` fica de fora porque
   * propriedade se transfere, não se convida; `SUPERADMIN` porque é papel de
   * plataforma; e `PARTICIPANT` porque quem entra na equipe não é público de evento
   * (é a distinção que a FASE 14 criou). A consequência aparece na dica do campo —
   * convidar "Administrador" sem dizer o que isso significa é convite no escuro.
   */
  const invitableRoleOptions = invitableRoles().map((role) => ({
    value: role,
    label: invitationRoleLabel(role),
    consequence: invitationConsequence(role),
  }));

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  QUEM PODE O QUÊ, NA MESMA LEITURA DA GUARDA (FASE 21)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O `Principal` já vem resolvido no contexto da requisição — não é uma segunda ida
   *  ao banco. As duas permissões são DIFERENTES de propósito: trocar papéis exige
   *  `tenant:role:assign` (OWNER), remover gente exige `tenant:member:remove`
   *  (OWNER e ADMIN). A tela mostra o que cada perfil pode, e cada ação reconfere.
   */
  const context = await getRequestContext();
  const principal = context?.principal ?? null;

  const canAssignTenantRoles = can(principal, PERMISSIONS.TENANT_ROLE_ASSIGN, { scope: 'TENANT' });
  const canRemoveMembers = can(principal, PERMISSIONS.TENANT_MEMBER_REMOVE, { scope: 'TENANT' });

  const manageableRoleOptions = assignableTenantRoles().map((role) => ({
    value: role,
    label: roleLabel(role),
  }));

  return (
    <div className="space-y-8" data-testid="team-page">
      <PageHeader
        title="Equipe e participantes"
        description="Quem responde pela instituição e quem é público dos eventos. Só a equipe consome a quota de membros do plano."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Equipe' },
        ]}
        badge={<Badge tone="primary">{tenantName}</Badge>}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="team-stats">
        <StatCard
          label="Membros da equipe"
          value={team.memberCount}
          hint={quotaUsageLabel(team.quota)}
          icon={<Users className="size-4" aria-hidden />}
          tone={team.quota.state === 'AT_LIMIT' || team.quota.state === 'EXCEEDED' ? 'warning' : 'primary'}
          data-testid="team-member-count"
        />
        <StatCard
          label="Acesso liberado"
          value={team.activeMembers}
          hint="Membros ativos"
          icon={<UserRoundCheck className="size-4" aria-hidden />}
        />
        <StatCard
          label="Convites pendentes"
          value={team.invitedMembers}
          hint="Já ocupam vaga no plano"
          icon={<UserRoundPlus className="size-4" aria-hidden />}
        />
        <StatCard
          label="Participantes de eventos"
          value={team.participantCount}
          hint="Não consome quota de membros"
          data-testid="team-participant-count"
        />
      </section>

      {team.quota.state === 'AT_LIMIT' || team.quota.state === 'EXCEEDED' ? (
        <Alert
          tone="warning"
          title="Quota de membros esgotada"
          data-testid="team-quota-alert"
        >
          {team.maxMembers === null
            ? 'Plano sem limite de membros.'
            : `O plano atual permite ${team.maxMembers} membro(s) e a instituição já tem ${team.memberCount}. ` +
              'Novos vínculos de equipe ficam bloqueados até alguém ser removido — ou até a plataforma ajustar o plano.'}
        </Alert>
      ) : null}

      <section className="space-y-4" aria-labelledby="convidar">
        <SectionHeading
          title="Convidar para a equipe"
          description="O convite vale para o endereço informado: a pessoa entra com a conta daquele e-mail (ou cria uma na hora) e o acesso nasce no aceite."
        />

        <Card>
          <div className="p-5">
            <InviteMemberForm tenantSlug={tenantSlug} roles={invitableRoleOptions} />
          </div>
        </Card>
      </section>

      <section className="space-y-4" aria-labelledby="convites">
        <SectionHeading
          title="Convites"
          description="Convites emitidos, com a situação calculada na leitura — convite vencido não precisa de agendador para virar vencido."
        />

        {invitations.length === 0 ? (
          <EmptyState
            icon={MailPlus}
            title="Nenhum convite emitido"
            description="Ao convidar alguém, o convite aparece aqui com o prazo de validade e o que já foi aceito."
          />
        ) : (
          <Card className="overflow-hidden">
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Convidado</TH>
                    <TH>Papel</TH>
                    <TH>Situação</TH>
                    <TH>Validade</TH>
                    <TH>Ações</TH>
                  </TR>
                </THead>
                <TBody data-testid="invitation-list">
                  {invitations.map((invitation) => (
                    <TR key={invitation.id} data-invitation-id={invitation.id} data-state={invitation.state}>
                      <TD>
                        <span className="block font-medium text-foreground">{invitation.email}</span>
                        <span className="block text-xs text-muted-foreground">
                          {invitation.invitedByName
                            ? `convidado por ${invitation.invitedByName}`
                            : 'convite da plataforma'}
                          {invitation.sendCount > 1 ? ` · ${invitation.sendCount} envios` : ''}
                        </span>
                      </TD>
                      <TD className="text-xs text-muted-foreground">{invitation.roleLabel}</TD>
                      <TD>
                        <Badge
                          tone={
                            invitation.state === 'ACCEPTED'
                              ? 'success'
                              : invitation.state === 'PENDING'
                                ? 'primary'
                                : 'neutral'
                          }
                          size="sm"
                        >
                          {invitation.stateLabel}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {invitation.expiresAt.toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </TD>
                      <TD>
                        {invitation.state === 'PENDING' ? (
                          <InvitationActions
                            tenantSlug={tenantSlug}
                            invitationId={invitation.id}
                            email={invitation.email}
                            canRevoke
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          </Card>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="equipe">
        <SectionHeading
          title="Equipe da instituição"
          description="Pessoas vinculadas com acesso administrativo, com os papéis vigentes."
        />

        {team.members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhum membro vinculado"
            description="A instituição ainda não tem equipe registrada. Fale com a plataforma para vincular o primeiro membro."
          />
        ) : (
          <Card className="overflow-hidden">
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Pessoa</TH>
                    <TH>Papéis</TH>
                    <TH>Situação</TH>
                    <TH>Último acesso</TH>
                    <TH>Ações</TH>
                  </TR>
                </THead>
                <TBody data-testid="team-members">
                  {team.members.map((member) => (
                    <TR key={member.userId} data-user-id={member.userId} data-status={member.status}>
                      <TD>
                        <span className="block font-medium text-foreground">{member.name}</span>
                        <span className="block text-xs text-muted-foreground">{member.email}</span>
                      </TD>
                      <TD>
                        <span className="flex flex-wrap gap-1">
                          {member.roles.length === 0 ? (
                            <span className="text-xs text-muted-foreground">sem papel vigente</span>
                          ) : (
                            member.roles.map((role) => (
                              <Badge
                                key={`${role.role}-${role.scope}`}
                                tone="neutral"
                                size="sm"
                              >
                                {roleLabel(role.role)}
                              </Badge>
                            ))
                          )}
                        </span>
                      </TD>
                      <TD>
                        <span data-status={member.status} className="text-xs uppercase text-muted-foreground">
                          {STATUS_LABELS[member.status] ?? member.status}
                        </span>
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {member.lastAccessAt
                          ? member.lastAccessAt.toLocaleString('pt-BR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : 'nunca'}
                      </TD>
                      <TD className="align-top">
                        {/**
                         * As permissões vêm do MESMO `Principal` que a guarda usa, e cada
                         * ação reconfere no servidor: a tela só decide o que MOSTRAR.
                         */}
                        <MemberRowActions
                          tenantSlug={tenantSlug}
                          userId={member.userId}
                          memberName={member.name}
                          memberEmail={member.email}
                          isSelf={member.userId === actorUserId}
                          canAssignRoles={canAssignTenantRoles}
                          canRemove={canRemoveMembers}
                          rolesOptions={manageableRoleOptions}
                          currentRoles={member.tenantRoles}
                          registrationCount={member.registrationCount}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          </Card>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="participantes">
        <SectionHeading
          title="Participantes de eventos"
          description="Quem se inscreveu em evento aberto e passou a ter acesso de participante."
        />

        <Card>
          <div className="space-y-2 p-5" data-testid="team-participants">
            <p className="text-sm text-foreground">
              {team.participantCount === 0
                ? 'Nenhum participante vinculado por inscrição pública.'
                : `${team.participantCount} pessoa(s) com acesso de participante.`}
            </p>
            <p className="text-xs text-muted-foreground">
              Participantes enxergam a programação, as próprias inscrições e os próprios certificados. Eles
              não administram a instituição e <strong className="font-medium text-foreground">não</strong>{' '}
              ocupam vaga na quota de membros do plano.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}
