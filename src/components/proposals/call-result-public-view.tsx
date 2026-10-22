/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A PROJEÇÃO PÚBLICA DO RESULTADO, DESENHADA (FASE 73 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE COMPONENTE EXISTE NA FATIA DA TELA DO ORGANIZADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A prévia da tela do organizador precisa mostrar EXATAMENTE o documento que o
 *  público vai ler. A tentação é montar um "resumo" na tela do painel — e aí a
 *  prévia e a página pública divergem no primeiro ajuste da projeção, que é o
 *  defeito que a prévia existia para evitar.
 *
 *  A entrada aqui é `PublicCallResultView`: o OBJETO que
 *  `projectPublicCallResult` devolveu, com a lista já montada, a ordem já decidida
 *  e a lista fechada já conferida. Este componente não lê `resultado`, não cruza ids
 *  com submissões e não recalcula nada: ele só desenha. Por isso a página pública
 *  (fatia 4) pode usar o MESMO componente — uma só marcação, uma só verdade.
 *
 *  Sem `date-fns`, sem relógio e sem `Intl`: a data chega FORMATADA do SERVIDOR. Duas
 *  formatações (servidor e navegador) dariam strings diferentes no HTML e na
 *  hidratação, e o organizador veria a data "piscar" ao publicar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  CALL_RESULT_STATE_LABELS,
  type PublicCallResultView,
} from '@/domain/proposals/call-result-rules';
/**
 * As frases vêm do DOMÍNIO da página pública (FASE 73 · fatia 4). Elas nasceram
 * escritas aqui na fatia 3 e passaram a ser compartilhadas quando a página pública
 * passou a desenhar o mesmo documento: duas cópias do mesmo rótulo divergem no
 * primeiro ajuste de texto, e o organizador veria na prévia uma frase que o público
 * não lê.
 */
import {
  PUBLIC_CALL_RESULT_LIST_TITLE,
  PUBLIC_CALL_RESULT_NEXT_STEPS_TITLE,
  PUBLIC_CALL_RESULT_PUBLISHED_PREFIX,
} from '@/domain/proposals/call-result-public-rules';

export function CallResultPublicView({
  view,
  publicadoEmLabel,
}: {
  /** A projeção REAL do domínio — nunca uma remontagem a partir do `resultado`. */
  view: PublicCallResultView;
  /** Data da publicação vigente, já no fuso do evento. */
  publicadoEmLabel: string;
}) {
  return (
    <article
      className="space-y-3"
      data-testid="call-result-public-view"
      data-public-state={view.estado}
    >
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span className="ef-badge">{CALL_RESULT_STATE_LABELS[view.estado]}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {PUBLIC_CALL_RESULT_PUBLISHED_PREFIX} {publicadoEmLabel}
        </span>
      </p>

      {view.texto.length > 0 ? (
        <p className="whitespace-pre-line text-sm text-foreground">{view.texto}</p>
      ) : null}

      {view.lista.length > 0 ? (
        <section className="space-y-1.5" aria-label="Lista publicada">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {PUBLIC_CALL_RESULT_LIST_TITLE} ({view.lista.length})
          </h5>

          <ul className="divide-y divide-border rounded-sm border border-border" data-testid="call-result-public-list">
            {view.lista.map((item, index) => (
              <li
                key={`${item.protocoloOuIdEstavel}-${index}`}
                className="space-y-0.5 px-3 py-2"
                data-testid="call-result-public-item"
              >
                <p className="text-sm">
                  <span className="code-data text-xs text-muted-foreground">
                    {item.protocoloOuIdEstavel}
                  </span>{' '}
                  {item.titulo}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.tipo}
                  {' · '}
                  {item.autores.length > 0 ? item.autores.join(', ') : 'Autoria não informada'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.proximosPassos.length > 0 ? (
        <section className="space-y-1" aria-label="Próximos passos">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {PUBLIC_CALL_RESULT_NEXT_STEPS_TITLE}
          </h5>
          <p className="whitespace-pre-line text-sm text-foreground">{view.proximosPassos}</p>
        </section>
      ) : null}
    </article>
  );
}
