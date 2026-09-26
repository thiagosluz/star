/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Ciclo de vida do membro e quota de armazenamento (FASE 21)
 *
 *  Sem banco: aqui vive o que é PURO e decide antes de qualquer escrita.
 *
 *    • a quota de armazenamento olha o TAMANHO DO ARQUIVO, não a quantidade — e
 *      "cabe exatamente" é permitido, "não cabe" é recusado com números na mensagem;
 *    • o plano da troca de papéis é um CONJUNTO (conceder o que falta, revogar o que
 *      sobra), e papel de plataforma ou de público não entra no editor de equipe;
 *    • as duas travas de segurança do ciclo de vida: ninguém remove a si mesmo e
 *      ninguém deixa a instituição sem proprietário.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { evaluateStorageQuota, evaluateQuotaUsage } from '../../src/domain/platform/platform-rules';
import { formatBytes } from '../../src/domain/events/image-rules';
import {
  TENANT_MEMBER_ROLES,
  evaluateMemberRemoval,
  evaluateRoleChange,
  isTenantMemberRole,
  planRoleChange,
  validateRoleSelection,
} from '../../src/domain/tenancy/membership-rules';

const MB = 1024 * 1024;
const GB = 1024 ** 3;

describe('quota de armazenamento — o tamanho do arquivo decide', () => {
  it('plano sem teto nunca recusa', () => {
    const decision = evaluateStorageQuota({
      currentBytes: 999 * GB,
      incomingBytes: 5 * GB,
      maxBytes: null,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBeNull();
  });

  it('cabe exatamente = permitido; um byte a mais = recusado', () => {
    const exactly = evaluateStorageQuota({
      currentBytes: 4 * GB,
      incomingBytes: 1 * GB,
      maxBytes: 5 * GB,
    });
    expect(exactly.allowed).toBe(true);
    expect(exactly.remaining).toBe(0);

    const oneMoreByte = evaluateStorageQuota({
      currentBytes: 4 * GB,
      incomingBytes: 1 * GB + 1,
      maxBytes: 5 * GB,
    });
    expect(oneMoreByte.allowed).toBe(false);
    expect(oneMoreByte.remaining).toBe(0);
  });

  it('a recusa diz o teto, o uso e o tamanho do arquivo', () => {
    const decision = evaluateStorageQuota({
      currentBytes: 900 * MB,
      incomingBytes: 200 * MB,
      maxBytes: 1 * GB,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain('1 GB');
    expect(decision.message).toContain('900 MB');
    expect(decision.message).toContain('200 MB');
    expect(decision.message).toMatch(/acervo de mídia|aumento da quota/i);
  });

  it('instituição JÁ acima do teto não recebe nada (nem arquivo de 1 KB)', () => {
    const decision = evaluateStorageQuota({
      currentBytes: 6 * GB,
      incomingBytes: 1024,
      maxBytes: 5 * GB,
    });

    expect(decision.allowed).toBe(false);
    // `remaining` negativo na mensagem seria confuso; o que sai é "restam 0".
    // Desde a F47 a formatação desce até bytes ("0 B"): dizer "0 KB" para um
    // arquivo de 1 KB soaria como se ainda coubesse algo.
    expect(decision.message).toContain('restam 0 B');
  });

  it('plano com zero byte recusa qualquer envio (e a mensagem não mente)', () => {
    const decision = evaluateStorageQuota({ currentBytes: 0, incomingBytes: 1, maxBytes: 0 });

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it('a situação exibida usa a mesma aritmética da decisão', () => {
    expect(evaluateQuotaUsage(5 * GB, 5 * GB).state).toBe('AT_LIMIT');
    expect(evaluateQuotaUsage(5 * GB + 1, 5 * GB).state).toBe('EXCEEDED');
    expect(evaluateQuotaUsage(1 * GB, null).state).toBe('UNLIMITED');
  });

  it('formatBytes fala a língua da quota (GB antes de MB)', () => {
    expect(formatBytes(5 * GB)).toBe('5 GB');
    expect(formatBytes(1.5 * GB)).toBe('1.5 GB');
    expect(formatBytes(2 * MB)).toBe('2 MB');
    expect(formatBytes(900 * 1024)).toBe('900 KB');
    // Abaixo de 1 KB a mensagem desce até bytes (F47): "0 KB" mentiria sobre o que resta.
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('troca de papéis — o conjunto é substituído', () => {
  const tenant = (role: string) => ({ role, scope: 'TENANT' });
  const atEvent = (role: string) => ({ role, scope: 'EVENT' });

  it('calcula o que conceder e o que revogar', () => {
    const plan = planRoleChange([tenant('ADMIN')], ['ADMIN', 'STAFF']);

    expect(plan.grant).toEqual(['STAFF']);
    expect(plan.revoke).toEqual([]);
    expect(plan.finalRoles.sort()).toEqual(['ADMIN', 'STAFF']);
  });

  it('revogar é retirar do conjunto (e o plano diz exatamente o que sai)', () => {
    const plan = planRoleChange([tenant('ADMIN'), tenant('FINANCE')], ['ADMIN']);

    expect(plan.grant).toEqual([]);
    expect(plan.revoke).toEqual(['FINANCE']);
  });

  it('trocar um papel por outro gera as duas pontas', () => {
    const plan = planRoleChange([tenant('FINANCE')], ['ORGANIZER']);

    expect(plan.grant).toEqual(['ORGANIZER']);
    expect(plan.revoke).toEqual(['FINANCE']);
  });

  it('conjunto igual = plano vazio (nada é escrito)', () => {
    const plan = planRoleChange([tenant('ADMIN'), tenant('STAFF')], ['STAFF', 'ADMIN']);

    expect(plan.grant).toEqual([]);
    expect(plan.revoke).toEqual([]);
  });

  it('papel repetido na entrada não vira duas concessões', () => {
    const plan = planRoleChange([], ['STAFF', 'STAFF']);

    expect(plan.grant).toEqual(['STAFF']);
    expect(plan.finalRoles).toEqual(['STAFF']);
  });

  it('o editor de equipe NÃO mexe em papel de plataforma nem no de participante', () => {
    // `SUPERADMIN` é da plataforma; `PARTICIPANT` é o público do evento — nenhum dos
    // dois é papel de equipe, e ambos ficam fora do conjunto gerenciado.
    expect(TENANT_MEMBER_ROLES).not.toContain('SUPERADMIN');
    expect(TENANT_MEMBER_ROLES).not.toContain('PARTICIPANT');

    expect(isTenantMemberRole('ADMIN')).toBe(true);
    expect(isTenantMemberRole('OWNER')).toBe(true);
    expect(isTenantMemberRole('SUPERADMIN')).toBe(false);
    expect(isTenantMemberRole('PARTICIPANT')).toBe(false);
  });

  it('papel inexistente e papel fora do escopo de equipe são recusados com motivos distintos', () => {
    const invented = validateRoleSelection(['ADMIN', 'IMPERADOR']);
    expect(invented.ok).toBe(false);
    if (!invented.ok) expect(invented.code).toBe('INVALID_ROLE');

    const platform = validateRoleSelection(['SUPERADMIN']);
    expect(platform.ok).toBe(false);
    if (!platform.ok) expect(platform.code).toBe('ROLE_SCOPE');

    const audience = validateRoleSelection(['PARTICIPANT']);
    expect(audience.ok).toBe(false);
    if (!audience.ok) expect(audience.code).toBe('ROLE_SCOPE');
  });

  it('papel de evento ou atividade NÃO é tocado quando o conjunto é reescrito', () => {
    /**
     * Este caso nasceu de um defeito real: o plano recebia só NOMES de papel, e
     * `REVIEWER` de uma TRILHA tem o mesmo nome do papel de instituição. Sem o escopo
     * na entrada, reescrever a equipe revogaria a avaliação de uma trilha — em
     * silêncio, porque para o domínio eram dois nomes iguais.
     */
    const plan = planRoleChange([tenant('ADMIN'), atEvent('REVIEWER'), atEvent('STAFF')], ['ADMIN']);

    expect(plan.revoke).toEqual([]);
    expect(plan.grant).toEqual([]);
  });

  it('retirar o papel do ÚLTIMO proprietário é recusado', () => {
    const verdict = evaluateRoleChange({
      current: [tenant('OWNER')],
      desired: ['ADMIN'],
      activeOwnerCount: 1,
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.code).toBe('LAST_OWNER');
      expect(verdict.message).toMatch(/proprietário/i);
    }
  });

  it('com outro proprietário ativo, o rebaixamento é permitido (inclusive o próprio)', () => {
    const verdict = evaluateRoleChange({
      current: [tenant('OWNER')],
      desired: ['ADMIN'],
      activeOwnerCount: 2,
    });

    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.plan.revoke).toEqual(['OWNER']);
      expect(verdict.plan.grant).toEqual(['ADMIN']);
    }
  });

  it('promover alguém a proprietário é permitido e não mexe na contagem', () => {
    const verdict = evaluateRoleChange({
      current: [tenant('ADMIN')],
      desired: ['ADMIN', 'OWNER'],
      activeOwnerCount: 1,
    });

    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.plan.grant).toEqual(['OWNER']);
  });
});

describe('remoção de membro — as duas travas de segurança', () => {
  const base = {
    actorUserId: 'ator',
    targetUserId: 'alvo',
    targetStatus: 'ACTIVE',
    targetRoles: ['ADMIN'] as string[],
    activeOwnerCount: 1,
  };

  it('remove um membro comum', () => {
    const verdict = evaluateMemberRemoval(base);
    expect(verdict.allowed).toBe(true);
  });

  it('recusa remover a si mesmo', () => {
    const verdict = evaluateMemberRemoval({ ...base, actorUserId: 'alvo' });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.code).toBe('SELF');
      expect(verdict.message).toMatch(/próprio acesso/i);
    }
  });

  it('recusa remover o único proprietário — mesmo sendo outra pessoa', () => {
    const verdict = evaluateMemberRemoval({
      ...base,
      targetRoles: ['OWNER'],
      activeOwnerCount: 1,
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.code).toBe('LAST_OWNER');
  });

  it('proprietário entre vários pode ser removido', () => {
    const verdict = evaluateMemberRemoval({
      ...base,
      targetRoles: ['OWNER'],
      activeOwnerCount: 2,
    });

    expect(verdict.allowed).toBe(true);
  });

  it('vínculo que já saiu não é "removido de novo"', () => {
    const verdict = evaluateMemberRemoval({ ...base, targetStatus: 'REMOVED' });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.code).toBe('NOT_A_MEMBER');
  });

  it('convite pendente pode ser removido (ele já ocupa vaga na quota)', () => {
    const verdict = evaluateMemberRemoval({ ...base, targetStatus: 'INVITED' });
    expect(verdict.allowed).toBe(true);
  });

  it('a trava de "é você mesmo" vem ANTES da de último proprietário', () => {
    /**
     * Quem é o único proprietário e tenta sair precisa ouvir "peça a outra pessoa",
     * e não "promova outra pessoa antes" — a segunda mensagem não faz sentido para
     * quem não tem ninguém para promover.
     */
    const verdict = evaluateMemberRemoval({
      ...base,
      actorUserId: 'alvo',
      targetRoles: ['OWNER'],
      activeOwnerCount: 1,
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.code).toBe('SELF');
  });
});
