import { CalendarPlus, Download } from 'lucide-react';

import { googleCalendarUrl, type CalendarItem } from '@/lib/calendar/ics';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXPORTAR PARA O CALENDÁRIO — 1 clique, SEM JavaScript (FASE 65 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SÃO DOIS `<a>`, E ISSO É O REQUISITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Adicionar ao Google Calendar" é um link para fora (o Google monta o evento com os
 *  parâmetros da URL) e "Baixar .ics" é um link para a rota do arquivo. Nenhum
 *  `onClick`, nenhum `fetch`, nenhum estado de cliente: com o JavaScript desligado os
 *  dois continuam funcionando — e é assim que o E2E desta fatia os mede.
 *
 *  O botão do Google não SUBSTITUI o arquivo: o Google é o caminho de quem usa aquela
 *  conta; o `.ics` é o caminho de todo o resto (Apple, Outlook, Thunderbird) — e é ele
 *  que leva a descrição com o horário local, que o Google não mostra.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE CADA COMPONENTE RECEBE — E POR QUE NÃO É UMA URL QUALQUER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • `ActivityExportLinks` monta a URL do Google AQUI, com o gerador da fatia 1
 *    (`googleCalendarUrl`) — assim o `dates` sai no MESMO selo UTC do arquivo: um
 *    segundo `Intl` neste componente agendaria no horário errado. O endereço do `.ics`
 *    chega por prop, porque quem o conhece é a APLICAÇÃO (`activityIcsUrl`);
 *
 *  • `AgendaExportLinks` recebe os DOIS endereços prontos: o do arquivo carrega o token
 *    opaco da pessoa (derivado de `BETTER_AUTH_SECRET`, que é segredo de aplicação) e
 *    o do Google carrega o item escolhido pela tela.
 *
 *  Nenhum dos dois aceita uma URL de fora "crua": o endereço do nosso arquivo é sempre
 *  derivado de um id ou de um token, nunca copiado de um parâmetro solto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RÓTULO ACESSÍVEL DIZ A AÇÃO **E** O ALVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Numa programação de vinte atividades, "Baixar .ics" repetido vinte vezes não diz
 *  nada a quem navega por leitor de tela (a mesma lição do botão de favoritar). O
 *  `aria-label` acrescenta o título, e o TEXTO VISÍVEL continua contido nele (WCAG
 *  2.5.3, "rótulo no nome") — o comando de voz segue funcionando.
 */

/** As classes dos dois vocabulários em que os links aparecem (tema do evento × painel). */
function linkClassFor(variant: 'painel' | 'tema'): string {
  return variant === 'tema'
    ? 'inline-flex items-center gap-1.5 rounded-md border border-current px-3 py-1.5 text-xs font-medium transition hover:opacity-80'
    : 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent';
}

export function ActivityExportLinks({
  activityId,
  title,
  startsAt,
  endsAt,
  timezone,
  location,
  description,
  icsHref,
  variant = 'painel',
}: {
  activityId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** Fuso do EVENTO — vai no rótulo legível da descrição do arquivo. */
  timezone: string;
  location: string | null;
  description: string | null;
  /** O endereço do `.ics` desta atividade — montado por `activityIcsUrl`. */
  icsHref: string;
  variant?: 'painel' | 'tema';
}) {
  /**
   * O `UID` do `VEVENT` sai do ID DA ATIVIDADE e de mais nada (ver o gerador): é ele
   * que faz o calendário ATUALIZAR o compromisso em vez de criar um segundo quando a
   * atividade é editada.
   */
  const item: CalendarItem = {
    activityId,
    title,
    startsAt,
    endsAt,
    timezone,
    location,
    description,
  };

  const linkClass = linkClassFor(variant);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`exportacao-${activityId}`}>
      <a
        href={googleCalendarUrl(item)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
        aria-label={`Adicionar ao Google Calendar: ${title}`}
        data-testid="exportar-google"
      >
        <CalendarPlus className="size-3.5 shrink-0" aria-hidden />
        Adicionar ao Google Calendar
      </a>

      <a
        href={icsHref}
        className={linkClass}
        aria-label={`Baixar o arquivo .ics desta atividade: ${title}`}
        data-testid="exportar-ics-atividade"
      >
        <Download className="size-3.5 shrink-0" aria-hidden />
        Baixar .ics
      </a>
    </div>
  );
}

/**
 * Os caminhos de exportação da GRADE INTEIRA (a tela "minha agenda").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O BOTÃO DO GOOGLE AQUI É O DO PRÓXIMO ITEM — E O ARQUIVO NÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O Google Calendar não tem (pela URL) uma forma de importar VÁRIOS eventos: o
 *  formulário do `action=TEMPLATE` cria UM compromisso. Então o botão oferece o
 *  PRÓXIMO item da grade — o que a pessoa tem de fazer em seguida, e o único caso em
 *  que "adicionar ao Google" com um clique é honesto. A grade inteira vai pelo
 *  ARQUIVO, que é o que o Google Calendar importa em massa (e que o Apple e o Outlook
 *  leem sozinhos).
 *
 *  Prometer "a grade no Google" com um botão que cria um evento seria uma mentira
 *  silenciosa — e é o tipo de mentira que só aparece no dia do evento.
 *
 *  Sem `icsHref` (servidor sem segredo utilizável, ou grade vazia) o arquivo NÃO é
 *  oferecido: a tela diz que a exportação está indisponível, em vez de publicar um
 *  endereço que não abre.
 */
export function AgendaExportLinks({
  eventTitle,
  icsHref,
  nextTitle,
  nextGoogleHref,
  variant = 'painel',
}: {
  eventTitle: string;
  icsHref: string | null;
  /** O título do próximo item da grade, quando existe. */
  nextTitle: string | null;
  /** A URL do Google para o próximo item — `null` junto com ele. */
  nextGoogleHref: string | null;
  variant?: 'painel' | 'tema';
}) {
  const linkClass = linkClassFor(variant);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="minha-agenda-exportacao">
      {nextTitle && nextGoogleHref ? (
        <a
          href={nextGoogleHref}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
          aria-label={`Adicionar ao Google Calendar a próxima atividade: ${nextTitle}`}
          data-testid="exportar-google-grade"
        >
          <CalendarPlus className="size-3.5 shrink-0" aria-hidden />
          Adicionar a próxima ao Google Calendar
        </a>
      ) : null}

      {icsHref ? (
        <a
          href={icsHref}
          className={linkClass}
          aria-label={`Baixar o arquivo .ics da minha agenda em ${eventTitle}`}
          data-testid="exportar-ics-grade"
        >
          <Download className="size-3.5 shrink-0" aria-hidden />
          Baixar a minha agenda (.ics)
        </a>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="exportar-indisponivel">
          O download do arquivo de agenda está indisponível nesta instalação.
        </p>
      )}
    </div>
  );
}
