/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — FASE 84 · fatia 1
 *  O painel de quem olha: a matriz perfil × blocos e a casa das permissões
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, E SEM O QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até esta fase o painel da instituição mostrava os papéis acumulados (com UUID
 *  de evento e de atividade) e a lista crua das permissões efetivas. Era a prova
 *  do motor de RBAC — e continuava igual para todo mundo, independentemente de
 *  quem olhava. A fase separa as duas coisas:
 *
 *    • o que é da PESSOA (papéis e permissões) vai para `/conta`, que é global;
 *    • o que é do PERFIL vira blocos no painel, com ordem, teto e anúncio do que
 *      ficou de fora.
 *
 *  A matriz inteira roda SEM banco, SEM sessão e SEM Next:
 *
 *    • a REGRA (`dashboardBlocksFor`) é exercitada com os fatos já apurados — e
 *      são onze papéis do catálogo mais as combinações que o produto realmente
 *      vê (participante que também é palestrante, dono que também participa,
 *      patrocinador só, revisor só);
 *    • o RESUMO do vínculo (`summarizeMembershipAccess`) prova a tradução
 *      chave → rótulo e papéis → permissões efetivas, que é o que a seção de
 *      `/conta` desenha;
 *    • as últimas catracas leem a FONTE das duas peças: domínio sem Prisma/Next,
 *      destinos que existem de verdade no App Router e a seção de `/conta` com
 *      `<ul>`/`<li>`, o rótulo do catálogo e a MESMA consulta que o resto da
 *      página já paga.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_ACCESSES_PATH,
  DASHBOARD_BLOCK_LIMIT,
  DASHBOARD_BLOCK_META,
  dashboardBlockHref,
  dashboardBlocksFor,
  dashboardHiddenPhrase,
  type DashboardBlockId,
  type DashboardSubject,
} from '../../src/domain/platform/dashboard-blocks';
import { summarizeMembershipAccess } from '../../src/domain/rbac/access-summary';
import {
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  isRoleKey,
  permissionsForRole,
  roleLabel,
} from '../../src/domain/rbac/permissions';

const SLUG = 'ufba-demo';

/**
 * O sujeito do painel, com TODOS os fatos desligados.
 *
 * Cada caso liga só o que quer provar: um perfil é a combinação de PAPÉIS (o
 * catálogo) com os VÍNCULOS que não se deduzem de papel (palestrante,
 * patrocinador, convite) e com o que tem prazo.
 */
function subject(overrides: Partial<DashboardSubject> = {}): DashboardSubject {
  return {
    roles: [],
    hasDeadlineAction: false,
    hasSpeakerProfile: false,
    hasSponsorLink: false,
    hasPendingInvite: false,
    ...overrides,
  };
}

function blocksOf(overrides: Partial<DashboardSubject> = {}): readonly DashboardBlockId[] {
  return dashboardBlocksFor(subject(overrides)).blocks;
}

// ───────────────────────────────────────────────────────────────────────────────
//  1. A MATRIZ — cada papel do catálogo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A tabela abaixo é o contrato lido do CATÁLOGO de permissões, não inventada:
 *
 *   • `gestao`       ← OWNER/ADMIN/ORGANIZER (ou `event:manage`);
 *   • `participacao` ← `registration:read:own` (quem tem "minhas inscrições");
 *   • `submissoes`   ← `submission:read:own` (quem tem trabalhos próprios);
 *   • `pareceres`    ← `review:submit:own` OU `submission:read:any` (revisor e comitê);
 *   • `equipe`       ← `registration:checkin` (a portaria do dia).
 *
 * Os dois papéis que dependem de VÍNCULO aparecem com o vínculo ligado, porque é
 * assim que eles existem no produto: o papel `SPEAKER` nasce do aceite (há
 * perfil) e o `SPONSOR` nasce do vínculo com a empresa (há `sponsor_users`).
 *
 * `FINANCE` é o único papel de instituição SEM bloco — ele não tem nenhuma das
 * cinco permissões acima e o catálogo não tem bloco de finanças. O painel dele
 * fica com o cabeçalho de contexto e o estado vazio; está declarado no relatório
 * da fatia como ponto aberto, não escondido aqui.
 */
const MATRIZ: readonly {
  papel: string;
  sobre: Partial<DashboardSubject>;
  esperado: readonly DashboardBlockId[];
}[] = [
  {
    papel: 'SUPERADMIN (papel de PLATAFORMA: nenhuma permissão de instituição)',
    sobre: { roles: ['SUPERADMIN'] },
    esperado: [],
  },
  {
    papel: 'OWNER',
    sobre: { roles: ['OWNER'] },
    esperado: ['gestao', 'participacao', 'submissoes', 'pareceres', 'equipe'],
  },
  {
    papel: 'ADMIN',
    sobre: { roles: ['ADMIN'] },
    esperado: ['gestao', 'participacao', 'submissoes', 'pareceres', 'equipe'],
  },
  {
    papel: 'ORGANIZER',
    sobre: { roles: ['ORGANIZER'] },
    esperado: ['gestao', 'pareceres', 'equipe'],
  },
  {
    papel: 'FINANCE',
    sobre: { roles: ['FINANCE'] },
    esperado: [],
  },
  {
    papel: 'REVIEWER',
    sobre: { roles: ['REVIEWER'] },
    esperado: ['pareceres'],
  },
  {
    papel: 'CHAIR',
    sobre: { roles: ['CHAIR'] },
    esperado: ['participacao', 'submissoes', 'pareceres'],
  },
  {
    papel: 'SPEAKER (com perfil)',
    sobre: { roles: ['SPEAKER'], hasSpeakerProfile: true },
    esperado: ['participacao', 'submissoes', 'palestrante'],
  },
  {
    papel: 'STAFF',
    sobre: { roles: ['STAFF'] },
    esperado: ['equipe'],
  },
  {
    papel: 'PARTICIPANT',
    sobre: { roles: ['PARTICIPANT'] },
    esperado: ['participacao', 'submissoes'],
  },
  {
    papel: 'SPONSOR (com vínculo)',
    sobre: { roles: ['SPONSOR'], hasSponsorLink: true },
    esperado: ['patrocinador'],
  },
];

describe('a matriz perfil × blocos', () => {
  for (const caso of MATRIZ) {
    it(`${caso.papel} → ${caso.esperado.length > 0 ? caso.esperado.join(' · ') : '(nenhum bloco)'}`, () => {
      expect(blocksOf(caso.sobre)).toEqual(caso.esperado);
    });
  }

  it('cobre os ONZE papéis do catálogo — papel novo sem caso reprova aqui', () => {
    const cobertos = new Set(
      MATRIZ.flatMap((caso) => caso.sobre.roles ?? []).filter(isRoleKey),
    );

    expect([...cobertos].sort()).toEqual([...ROLE_KEYS].sort());
  });

  it('PARTICIPANT + SPEAKER: um perfil, os blocos dos dois papéis', () => {
    expect(
      blocksOf({
        roles: ['PARTICIPANT', 'SPEAKER'],
        hasSpeakerProfile: true,
      }),
    ).toEqual(['participacao', 'submissoes', 'palestrante']);
  });

  it('PARTICIPANT + OWNER: quem participa e gere vê a gestão primeiro', () => {
    expect(blocksOf({ roles: ['PARTICIPANT', 'OWNER'] })).toEqual([
      'gestao',
      'participacao',
      'submissoes',
      'pareceres',
      'equipe',
    ]);
  });

  it('PARTICIPANT + REVIEWER: o parecer entra depois da vida de participante', () => {
    expect(blocksOf({ roles: ['PARTICIPANT', 'REVIEWER'] })).toEqual([
      'participacao',
      'submissoes',
      'pareceres',
    ]);
  });

  it('REVIEWER + STAFF: o revisor da portaria', () => {
    expect(blocksOf({ roles: ['REVIEWER', 'STAFF'] })).toEqual(['pareceres', 'equipe']);
  });

  it('STAR: o bloco não nasce de papel — só de perfil/vínculo', () => {
    /**
     * `SPONSOR` sem vínculo não mostra a área: é a lição da FASE 59 (a permissão
     * `sponsor:read` está no pacote mínimo de todo mundo; o que abre a área é o
     * vínculo). O mesmo vale para `SPEAKER` sem perfil assumido.
     */
    expect(blocksOf({ roles: ['SPONSOR'] })).toEqual([]);
    expect(blocksOf({ roles: ['SPEAKER'] })).toEqual(['participacao', 'submissoes']);
  });

  it('o convite pendente não é consequência de papel nenhum', () => {
    expect(blocksOf({ roles: ['PARTICIPANT'], hasPendingInvite: true })).toEqual([
      'participacao',
      'submissoes',
      'convite',
    ]);
  });

  it('a precedência sobrevive ao teto: prazo e gestão ficam na frente', () => {
    /**
     * A precedência é o contrato: com oito blocos distintos, os cinco primeiros
     * são os de cima da lista — e a gestão vem antes de tudo, menos do prazo.
     */
    expect(
      blocksOf({
        roles: ['OWNER'],
        hasDeadlineAction: true,
        hasSpeakerProfile: true,
        hasSponsorLink: true,
        hasPendingInvite: true,
      }),
    ).toEqual(['acuacao-prazo', 'gestao', 'submissoes', 'pareceres', 'palestrante']);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  2. O TETO E O ANÚNCIO DO QUE FICOU DE FORA
// ───────────────────────────────────────────────────────────────────────────────
describe('o teto de cinco e a frase do "e mais N"', () => {
  it('nunca devolve mais que o teto, com TODOS os gatilhos ligados', () => {
    const plano = dashboardBlocksFor(
      subject({
        roles: [...ROLE_KEYS],
        hasDeadlineAction: true,
        hasSpeakerProfile: true,
        hasSponsorLink: true,
        hasPendingInvite: true,
      }),
    );

    expect(DASHBOARD_BLOCK_LIMIT).toBe(5);
    expect(plano.blocks).toHaveLength(5);
    expect(plano.blocks).toEqual([
      'acuacao-prazo',
      'gestao',
      'submissoes',
      'pareceres',
      'palestrante',
    ]);
  });

  it('conta quantos ficaram de fora — e os nove gatilhos passam pelo colapso', () => {
    /**
     * Nove gatilhos, mas `acuacao-prazo` e `participacao` levam à MESMA tela
     * (`/minhas-inscricoes`). O colapso deixa oito destinos distintos; cinco
     * cabem e três são anunciados.
     */
    const plano = dashboardBlocksFor(
      subject({
        roles: ['OWNER'],
        hasDeadlineAction: true,
        hasSpeakerProfile: true,
        hasSponsorLink: true,
        hasPendingInvite: true,
      }),
    );

    expect(plano.blocks).toHaveLength(5);
    expect(plano.hidden).toBe(3);
    expect(dashboardHiddenPhrase(plano.hidden)).toBe('e mais 3 atalhos');
  });

  it('nada escondido não tem frase (null, não string vazia)', () => {
    const plano = dashboardBlocksFor(subject({ roles: ['PARTICIPANT'] }));

    expect(plano.hidden).toBe(0);
    expect(dashboardHiddenPhrase(plano.hidden)).toBeNull();
    expect(dashboardHiddenPhrase(-1)).toBeNull();
  });

  it('singular e plural da frase saem do mesmo lugar que o número', () => {
    expect(dashboardHiddenPhrase(1)).toBe('e mais 1 atalho');
    expect(dashboardHiddenPhrase(2)).toBe('e mais 2 atalhos');
    expect(dashboardHiddenPhrase(9)).toBe('e mais 9 atalhos');
  });

  it('dois blocos para a mesma tela são UM atalho (não gastam o teto)', () => {
    /**
     * Quem tem vaga retida e participa receberia "Prazos e confirmações" e
     * "Minhas inscrições" — o mesmo destino, duas vezes. A precedência fica com o
     * rótulo urgente, e o colapsado não entra em `hidden` porque não é um atalho
     * escondido: é o mesmo atalho.
     */
    const plano = dashboardBlocksFor(
      subject({ roles: ['PARTICIPANT'], hasDeadlineAction: true }),
    );

    expect(plano.blocks).toEqual(['acuacao-prazo', 'submissoes']);
    expect(plano.hidden).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  3. O CATÁLOGO DOS BLOCOS — destino declarado, nenhum link morto
// ───────────────────────────────────────────────────────────────────────────────
describe('o catálogo de blocos', () => {
  const IDS = Object.keys(DASHBOARD_BLOCK_META) as DashboardBlockId[];

  it('todo bloco tem título e descrição (a página não inventa texto)', () => {
    expect(IDS).toHaveLength(9);

    for (const id of IDS) {
      const meta = DASHBOARD_BLOCK_META[id];
      expect(meta.title.length, `${id}: título vazio`).toBeGreaterThan(0);
      expect(meta.description.length, `${id}: descrição vazia`).toBeGreaterThan(0);
      expect(meta.description, `${id}: descrição repete o título`).not.toBe(meta.title);
    }
  });

  it('o href é montado com tenantPath — nunca um caminho cru', () => {
    expect(dashboardBlockHref('gestao', SLUG)).toBe('/t/ufba-demo/administracao/eventos');
    expect(dashboardBlockHref('participacao', SLUG)).toBe('/t/ufba-demo/minhas-inscricoes');
    expect(dashboardBlockHref('submissoes', SLUG)).toBe('/t/ufba-demo/submissoes');
    expect(dashboardBlockHref('pareceres', SLUG)).toBe('/t/ufba-demo/revisoes');
    expect(dashboardBlockHref('palestrante', SLUG)).toBe('/t/ufba-demo/palestrante');
    expect(dashboardBlockHref('patrocinador', SLUG)).toBe('/t/ufba-demo/patrocinador');
    expect(dashboardBlockHref('equipe', SLUG)).toBe('/t/ufba-demo/credenciamento');
  });

  it('oito dos nove destinos são DENTRO da instituição', () => {
    for (const id of IDS) {
      if (id === 'convite') continue;
      expect(dashboardBlockHref(id, SLUG), id).toMatch(/^\/t\/ufba-demo\//);
    }
  });

  it('o convite é a exceção declarada: a casa dos acessos em /conta', () => {
    /**
     * O aceite do convite de equipe exige o código do e-mail; `/t/<slug>/convite`
     * sem código responde "convite não encontrado". O destino honesto é a seção de
     * `/conta` que lista os acessos — e o âncora precisa existir na página.
     */
    expect(dashboardBlockHref('convite', SLUG)).toBe(ACCOUNT_ACCESSES_PATH);
    expect(ACCOUNT_ACCESSES_PATH).toBe('/conta#seus-acessos');
  });

  it('cada destino é uma TELA REAL do App Router (link morto reprova)', () => {
    const appRoot = join(process.cwd(), 'src', 'app', 't', '[tenantSlug]', '(app)');

    for (const id of IDS) {
      if (id === 'convite') continue;

      const page = join(appRoot, DASHBOARD_BLOCK_META[id].path, 'page.tsx');
      expect(existsSync(page), `${id}: ${page} não existe`).toBe(true);
    }

    const conta = readFileSync(join(process.cwd(), 'src', 'app', 'conta', 'page.tsx'), 'utf8');
    expect(conta.includes('id="seus-acessos"'), 'o âncora do convite não existe em /conta').toBe(
      true,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  4. A CASA DAS PERMISSÕES — o resumo de cada vínculo
// ───────────────────────────────────────────────────────────────────────────────
describe('o resumo do vínculo para "Seus acessos"', () => {
  it('traduz o papel e conta as permissões EFETIVAS (14 do participante)', () => {
    const resumo = summarizeMembershipAccess(['PARTICIPANT']);

    expect(resumo.roles).toEqual([{ key: 'PARTICIPANT', label: 'Participante' }]);
    expect(resumo.permissionCount).toBe(14);
    expect(resumo.permissionCount).toBe(permissionsForRole('PARTICIPANT').length);
  });

  it('os números medidos dos papéis de gestão continuam os mesmos', () => {
    expect(summarizeMembershipAccess(['OWNER']).permissionCount).toBe(65);
    expect(summarizeMembershipAccess(['ADMIN']).permissionCount).toBe(62);
    expect(summarizeMembershipAccess(['ORGANIZER']).permissionCount).toBe(43);
    expect(summarizeMembershipAccess(['REVIEWER']).permissionCount).toBe(8);
    expect(summarizeMembershipAccess(['FINANCE']).permissionCount).toBe(8);
    expect(summarizeMembershipAccess(['SPONSOR']).permissionCount).toBe(4);
  });

  it('CHAIR soma 23, e não 27: permissão repetida é UMA', () => {
    /**
     * O pacote do CHAIR lista `sponsor:read` e depois espalha o pacote mínimo, que
     * também a tem. O painel sempre contou a UNIÃO (era `new Set(...)`); a seção
     * nova tem de contar igual, senão os dois lugares divergiriam.
     */
    expect(ROLE_PERMISSIONS.CHAIR.length).toBe(27);
    expect(summarizeMembershipAccess(['CHAIR']).permissionCount).toBe(23);
  });

  it('papéis acumulados somam por UNIÃO, não por adição', () => {
    expect(summarizeMembershipAccess(['PARTICIPANT', 'REVIEWER']).permissionCount).toBe(17);
    expect(summarizeMembershipAccess(['PARTICIPANT', 'SPEAKER']).permissionCount).toBe(16);
  });

  it('nunca devolve a chave crua: o rótulo vem do catálogo', () => {
    const resumo = summarizeMembershipAccess(['CHAIR', 'REVIEWER']);

    expect(resumo.roles.map((role) => role.label)).toEqual([
      'Coordenação científica',
      'Revisor(a)',
    ]);

    for (const role of resumo.roles) {
      expect(role.label).toBe(ROLE_LABELS[role.key]);
      expect(role.label).toBe(roleLabel(role.key));
    }
  });

  it('ordena pelo RÓTULO em português, não pela ordem de chegada', () => {
    const um = summarizeMembershipAccess(['REVIEWER', 'CHAIR', 'PARTICIPANT']);
    const outro = summarizeMembershipAccess(['PARTICIPANT', 'REVIEWER', 'CHAIR']);

    expect(um.roles.map((role) => role.label)).toEqual([
      'Coordenação científica',
      'Participante',
      'Revisor(a)',
    ]);
    expect(outro.roles.map((role) => role.label)).toEqual(
      um.roles.map((role) => role.label),
    );
  });

  it('duplicata não conta duas vezes', () => {
    const resumo = summarizeMembershipAccess(['PARTICIPANT', 'PARTICIPANT']);

    expect(resumo.roles).toHaveLength(1);
    expect(resumo.permissionCount).toBe(14);
  });

  it('chave fora do catálogo é descartada (não vira texto cru na tela)', () => {
    const resumo = summarizeMembershipAccess(['PARTICIPANT', 'PAPEL_QUE_NAO_EXISTE']);

    expect(resumo.roles).toEqual([{ key: 'PARTICIPANT', label: 'Participante' }]);
    expect(resumo.permissionCount).toBe(14);
  });

  it('vínculo sem papel é um resumo vazio, e não um erro', () => {
    expect(summarizeMembershipAccess([])).toEqual({ roles: [], permissionCount: 0 });
  });

  it('toda permissão somada existe no catálogo do papel (nada inventado)', () => {
    for (const role of ROLE_KEYS) {
      const resumo = summarizeMembershipAccess([role]);
      expect(resumo.permissionCount, role).toBe(new Set(permissionsForRole(role)).size);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  5. CATRACAS DE FONTE — o que não pode voltar
// ───────────────────────────────────────────────────────────────────────────────
describe('catracas de fonte', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('a regra do painel é domínio PURO (sem Prisma, sem Next, sem React)', () => {
    const fonte = read('src/domain/platform/dashboard-blocks.ts');

    for (const proibido of ["from 'next", 'from "next', '@/lib/', 'generated/prisma', 'React']) {
      expect(fonte.includes(proibido), `dashboard-blocks importa ${proibido}`).toBe(false);
    }
  });

  it('o resumo do vínculo é domínio PURO', () => {
    const fonte = read('src/domain/rbac/access-summary.ts');

    for (const proibido of ["from 'next", 'from "next', '@/lib/', 'generated/prisma', 'React']) {
      expect(fonte.includes(proibido), `access-summary importa ${proibido}`).toBe(false);
    }
  });

  it('/conta paga UMA consulta de vínculos e a usa para a seção nova', () => {
    const fonte = read('src/app/conta/page.tsx');

    expect(fonte.match(/loadMemberships\(/g)).toHaveLength(1);
    expect(fonte).toContain('loadMemberships(session.user.id)');
    expect(fonte).toContain('summarizeMembershipAccess(membership.roles)');
    expect(fonte).toContain('data-testid="account-accesses"');
    expect(fonte).toContain('data-testid="account-accesses-list"');
    expect(fonte).toContain('data-testid="account-accesses-empty"');
  });

  it('/conta lista acessos com <ul>/<li> — não é grade de <div> clicável', () => {
    const fonte = read('src/app/conta/page.tsx');

    expect(fonte).toContain('<ul className="divide-y divide-border"');
    expect(fonte).toContain('key={membership.tenantId}');
  });

  it('/conta não desenha a chave crua do papel nem o UUID do vínculo', () => {
    const fonte = read('src/app/conta/page.tsx');

    /**
     * O caminho proibido é o do painel antigo: `membership.roles.join(...)` (chaves
     * cruas) e `membership.tenantId` no TEXTO (o `<li key>` usa o id, e isso é
     * permitido — o que não pode é virar conteúdo).
     */
    expect(fonte.includes('membership.roles.join')).toBe(false);
    expect(fonte.includes('summary.eventId')).toBe(false);
  });

  it('/conta usa as rotas canônicas do domínio para entrar e para quem não tem vínculo', () => {
    const fonte = read('src/app/conta/page.tsx');

    expect(fonte).toContain('tenantDashboardPath(membership.tenantSlug)');
    expect(fonte).toContain('ENTRY_DISCOVERY_PATH');
  });

  it('/conta usa os componentes da casa (Card, Badge, PageHeader) — sem <div> de cartão', () => {
    const fonte = read('src/app/conta/page.tsx');

    expect(fonte).toContain('Badge');
    expect(fonte).toContain('Card');
    expect(fonte).toContain('PageHeader');
  });
});
