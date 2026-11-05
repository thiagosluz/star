/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 86 · FATIA 4 — A SEÇÃO "MODELO DESTE EVENTO"
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE (sem banco e sem navegador)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a seção diz QUAL modelo vale para cada tipo e DE ONDE ele veio (evento ×
 *    instituição), em vez de deixar o organizador descobrir no PDF;
 *  • o tipo sem modelo aparece como "Desenho padrão do sistema" — e não como um
 *    espaço vazio;
 *  • o modelo ILEGÍVEL tem estado próprio, com o aviso "usando o desenho padrão" e
 *    o caminho para corrigir (o `resolveTemplateWithTx` da emissão cai no padrão em
 *    silêncio; a tela não pode esconder a diferença);
 *  • o LINK para os modelos só existe para quem `can('event:manage')` — o CHAIR
 *    emite e não desenha, e um link que termina em redirecionamento é o defeito da
 *    F72 dentro da própria seção.
 *
 *  A renderização usa `renderToStaticMarkup` do componente de SERVIDOR: o que se
 *  prova é o HTML entregue, não uma árvore de teste. A tela inteira (com banco) é
 *  coberta pelo E2E `f85-emissao-do-evento.spec.ts` (caso 4) e a classificação dos
 *  estados, pela integração `f86-modelos-do-evento.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  /** O mock PRESERVA os props: o `data-testid` do link é o que a tela e o E2E leem. */
  default: (props: { href: string; children?: unknown } & Record<string, unknown>) => {
    const { href, children, ...rest } = props;
    return createElement('a', { href, ...rest }, children as never);
  },
}));

import { EventTemplateSummary } from '../../src/components/certificates/event-template-summary';
import type { EventTemplateKindInfo } from '../../src/lib/certificates/certificate-template-service';

const RESOLUTIONS: readonly EventTemplateKindInfo[] = [
  {
    kind: 'ATTENDANCE',
    state: 'TEMPLATE',
    templateId: 'template-do-evento',
    templateName: 'Modelo do evento',
    target: 'EVENT',
  },
  {
    kind: 'MINI_COURSE',
    state: 'TEMPLATE',
    templateId: 'template-da-instituicao',
    templateName: 'Padrão da casa',
    target: 'INSTITUTION',
  },
  {
    kind: 'SPEAKER',
    state: 'DEFAULT',
    templateId: null,
    templateName: null,
    target: null,
  },
  {
    kind: 'ORGANIZER',
    state: 'INVALID',
    templateId: 'template-quebrado',
    templateName: 'Quebrado',
    target: 'EVENT',
  },
];

function render(canManage: boolean): string {
  return renderToStaticMarkup(
    createElement(EventTemplateSummary, {
      resolutions: RESOLUTIONS,
      modelsHref: '/t/casa/administracao/eventos/1/certificados/modelos',
      canManage,
    }),
  );
}

describe('a seção "Modelo deste evento"', () => {
  it('diz o modelo de cada tipo e a ORIGEM dele', () => {
    const html = render(true);

    expect(html).toContain('Modelo do evento — modelo do evento');
    expect(html).toContain('Padrão da casa — modelo padrão da instituição');
    expect(html).toContain('Desenho padrão do sistema');
  });

  it('modelo ILEGÍVEL tem estado próprio, aviso e caminho de correção', () => {
    const html = render(true);
    const invalido = html.slice(html.indexOf('event-template-invalid-ORGANIZER'));

    expect(html).toContain('data-state="INVALID"');
    expect(invalido).toContain('Modelo inválido');
    expect(invalido).toContain('usando o desenho padrão');
    expect(invalido).toContain('Quebrado');
    expect(invalido).toContain('Corrija o modelo');
  });

  it('o link dos modelos só aparece para quem tem `event:manage`', () => {
    const comPermissao = render(true);
    const semPermissao = render(false);

    expect(comPermissao).toContain('data-testid="event-models-link"');
    expect(semPermissao).not.toContain('data-testid="event-models-link"');
    expect(semPermissao).toContain('Peça a quem administra a instituição');
  });
});
