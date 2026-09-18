import { Users, UserRoundCheck, UserRoundPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getTeamOverview } from '@/lib/admin/member-service';
import { quotaUsageLabel } from '@/domain/platform/platform-rules';
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
 *  O QUE ESTA TELA NÃO FAZ (E POR QUÊ)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não convida e não remove ninguém. Convite exige provar que o endereço pertence a
 *  quem convida (e não sondar se um e-mail tem conta na plataforma), o que é o
 *  desenho da fase de Comunicação; remover membro mexe em acesso e auditoria e
 *  pede fluxo próprio. Vincular alguém que já tem conta é ação da PLATAFORMA, no
 *  painel de governança — e é onde a quota `maxMembers` é aplicada.
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

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.TENANT_MEMBER_INVITE,
  });

  const team = await getTeamOverview(tenantId);

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
                  </TR>
                </THead>
                <TBody data-testid="team-members">
                  {team.members.map((member) => (
                    <TR key={member.userId} data-user-id={member.userId}>
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
                              <Badge key={`${role.role}-${role.scope}`} tone="neutral" size="sm">
                                {role.role}
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
