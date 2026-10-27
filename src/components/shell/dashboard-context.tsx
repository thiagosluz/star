import Link from 'next/link';
import { Building2 } from 'lucide-react';

import { buttonClasses } from '@/components/ui/button';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BOTÃO DE CONTEXTO DO PAINEL — "onde eu estou, e como sair daqui" (FASE 84)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE EXISTE, SE A CASCA JÁ MOSTRA A INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A barra lateral carrega o bloco de contexto (`active-tenant`) desde a FASE 11A —
 *  e continua sendo o lugar dele. O que faltava era o caminho de SAÍDA ao lado do
 *  título: quem abre o painel de manhã vê "Painel de <instituição>" e, quando a
 *  instituição não é a que queria, precisa procurar o seletor no rodapé da barra
 *  (ou, no celular, abrir a gaveta). O topo da tela é onde essa pergunta aparece,
 *  então é onde a resposta fica.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM COMPONENTE NOVO, E NÃO O `ShellContextBlock`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O motivo é de CONTRATO, não de gosto. O `ShellContextBlock` (em `app-shell.tsx`)
 *  é a peça da CASCA: ele recebe `ShellContext` (nome, detalhe, logo, href e testId),
 *  mora dentro da barra e é desenhado também na versão recolhida — onde o texto vira
 *  `sr-only` e o bloco inteiro depende da largura da barra. Reaproveitá-lo aqui
 *  obrigaria a mexer na casca (que é refactor de outra fatia) para aceitar uma
 *  variante de topo, e a primeira mudança de layout da barra passaria a alterar o
 *  painel sem ninguém pedir. São dois lugares com dois contratos: um botão de topo
 *  com borda, rótulo "Trocar" e nome truncado; um bloco de barra com logo, papéis e
 *  modo recolhido.
 *
 *  O `data-testid` é NOVO (`dashboard-context`) de propósito. Reusar `active-tenant`
 *  criaria DOIS nós com o mesmo testid na mesma tela — e os cinco specs que usam
 *  `getByTestId('active-tenant')` em modo estrito reprovariam com "strict mode
 *  violation", apontando para o lugar errado. Pela mesma razão não se usa
 *  `admin-stats`: ele é o indicador da tela de ADMINISTRAÇÃO, e dois specs provam
 *  que ele NÃO existe quando a pessoa cai no painel sem permissão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NOME ACESSÍVEL COMEÇA PELO TEXTO VISÍVEL (FASE 81)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O link não tem `aria-label`: o nome é o próprio conteúdo — "<instituição>
 *  Trocar de instituição". "de instituição" vai em `sr-only` porque o botão inteiro
 *  já diz "Trocar" ao lado do nome, mas quem chega por leitor de tela ou por
 *  navegação de links precisa saber TROcar o quê. Um `aria-label` separado ("Instituição
 *  atual: X") violaria a regra `label-content-name-mismatch` que a FASE 81 fechou:
 *  o nome acessível tem de conter o texto que está na tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function DashboardContextLink({ tenantName }: { tenantName: string }) {
  return (
    <Link
      href="/selecionar-instituicao"
      data-testid="dashboard-context"
      className={buttonClasses({ variant: 'outline', size: 'sm' })}
    >
      <Building2 className="size-4 shrink-0" aria-hidden />
      <span className="max-w-56 truncate">{tenantName}</span>
      <span className="shrink-0 text-muted-foreground">
        Trocar<span className="sr-only"> de instituição</span>
      </span>
    </Link>
  );
}
