import Link from 'next/link';
import { AlertTriangle, BadgeCheck, Ban, ClipboardCheck, Info, XCircle } from 'lucide-react';

import { ThemeChoice } from '@/components/theme/theme-choice';
import { verifyCertificateBatch } from '@/lib/certificates/certificate-batch-service';
import { CERTIFICATE_BATCH_LIMIT } from '@/domain/certificates/certificate-batch-rules';
import { CERTIFICATE_KIND_LABELS } from '@/domain/certificates/certificate-rules';

export const metadata = { title: 'Conferência de certificados em lote' };
export const dynamic = 'force-dynamic';

/**
 * Rótulo curto de cada veredito — o MESMO conjunto que a tela de um código usa
 * (`ValidationStatus`), porque as duas telas compartilham o veredito.
 */
const STATUS_LABELS: Record<string, string> = {
  VALID: 'Emitido e não revogado',
  REVOKED: 'Revogado',
  EXPIRED: 'Expirado',
  NOT_ISSUED: 'Não emitido',
  NOT_FOUND: 'Não encontrado',
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONFERÊNCIA DE CERTIFICADOS EM LOTE (dívida E7, FASE 51)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELA É PÚBLICA, AO LADO DE `/validar/<code>`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem confere certificado em LOTE é quem contrata: um departamento de pessoal, uma
 *  banca de concurso, um órgão de fomento com uma pilha de documentos na mão. Essa
 *  pessoa não tem conta na plataforma, não pertence a instituição nenhuma e não vai
 *  criar cadastro para conferir um título — exigir login aqui reproduziria o erro que a
 *  validação pública já resolveu na FASE 6: validação que só funciona logado não é
 *  validação. A tela vive no mesmo endereço público, com as mesmas garantias:
 *
 *    • lê pela policy `certificate_public_validation`, em que o CÓDIGO é a capacidade
 *      de acesso — sem código, nenhuma linha é visível (a RLS é fail-closed);
 *    • não exibe nada além do que já está IMPRESSO no certificado (nome, evento,
 *      emissão, situação) — nem e-mail, nem documento, nem id interno;
 *    • não tem escrita: conferir não muda o documento, fora o contador de validações
 *      que a tela de um código também incrementa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TETO DE 50, E POR QUE ELE É DECISÃO DE SEGURANÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Em lote, cada requisição testa N códigos em vez de um: sem teto, uma tela pública
 *  viraria um oráculo barato para enumerar códigos. Com 50, uma requisição custa o
 *  mesmo que cinquenta consultas individuais — que já são possíveis hoje, uma a uma — e
 *  o custo por requisição fica previsível. O espaço de códigos (29⁸ ≈ 5 × 10¹¹) é o que
 *  torna a adivinhação inviável; o teto existe para que ela continue assim. Acima do
 *  limite a resposta é RECUSA, não resultado parcial: quem confere contrato precisa
 *  saber que a lista inteira foi olhada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA **NÃO** PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A frase está na tela, e não só no comentário: a conferência é dos códigos digitados.
 *  Ela não varre o evento, não lista quem recebeu certificado e não prova que a lista
 *  está completa — um documento emitido que não foi colado aqui simplesmente não
 *  aparece. Dizer isso é parte do produto: uma tela que só mostra carimbos verdes
 *  convida a conclusões que ela não sustenta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CertificateBatchPage({
  searchParams,
}: {
  searchParams: Promise<{ codigos?: string }>;
}) {
  const { codigos } = await searchParams;

  /**
   * `codigos === undefined` é "ninguém enviou nada ainda" — a tela abre só com o
   * formulário. String vazia é um envio de verdade (a pessoa clicou em conferir sem
   * colar nada) e merece a mensagem de validação, não o silêncio.
   */
  const submitted = codigos !== undefined;
  const outcome = submitted ? await verifyCertificateBatch(codigos) : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-12">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">EventFlow</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardCheck className="size-6" aria-hidden />
          Conferência de certificados em lote
        </h1>
        <p className="text-sm text-muted-foreground">
          Cole a lista de códigos para conferir vários certificados de uma vez. Não é
          preciso ter conta: o código impresso no documento é a credencial.
        </p>
      </header>

      {/* ── Formulário (GET: funciona sem JavaScript) ─────────────────────── */}
      <form method="get" action="/validar/lote" className="space-y-3" data-testid="batch-form">
        <label className="block space-y-1 text-sm" htmlFor="codigos">
          <span className="font-medium">Códigos dos certificados</span>
          <span className="block text-xs text-muted-foreground">
            Um por linha, ou separados por vírgula, ponto e vírgula ou espaço. Até{' '}
            {CERTIFICATE_BATCH_LIMIT} códigos distintos por consulta — o código tem o
            formato <span className="code-data">CERT-XXXXXXXX</span> e aparece no rodapé do
            documento, ao lado do QR Code.
          </span>
        </label>

        <textarea
          id="codigos"
          name="codigos"
          rows={8}
          defaultValue={codigos ?? ''}
          placeholder={'CERT-ABCD2345\nCERT-EFGH6789'}
          className="code-data w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          data-testid="batch-codes"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            data-testid="batch-submit"
          >
            Conferir lista
          </button>

          <Link
            href="/validar/lote"
            className="text-sm text-muted-foreground underline underline-offset-4"
            data-testid="batch-clear"
          >
            limpar
          </Link>
        </div>
      </form>

      {/* ── Recusa: acima do teto, lista longa ou lista vazia ─────────────── */}
      {outcome && !outcome.ok ? (
        <p
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive"
          data-testid="batch-refused"
          data-code={outcome.code}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {outcome.message}
            {outcome.code === 'TOO_MANY' ? (
              <>
                {' '}
                Nada foi conferido nesta consulta — a lista acima do limite é recusada por
                inteiro, para o resultado nunca parecer completo quando não é.
              </>
            ) : null}
          </span>
        </p>
      ) : null}

      {/* ── Resultado ─────────────────────────────────────────────────────── */}
      {outcome?.ok ? (
        <>
          <section
            className="space-y-2 rounded-lg border border-border bg-card p-4"
            data-testid="batch-summary"
            data-valid={outcome.batch.validCount}
            data-invalid={outcome.batch.invalidCount}
          >
            <p className="text-sm font-medium">
              {outcome.batch.rows.length} código(s) conferido(s) · {outcome.batch.validCount}{' '}
              válido(s) · {outcome.batch.invalidCount} com problema
            </p>

            {outcome.batch.duplicates.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="batch-duplicates">
                {outcome.batch.duplicates.length} código(s) apareceram mais de uma vez e foram
                conferidos uma vez só:{' '}
                <span className="code-data">{outcome.batch.duplicates.join(', ')}</span>
              </p>
            ) : null}

            {outcome.batch.ignored > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="batch-ignored">
                {outcome.batch.ignored} item(ns) sem nenhum caractere de código foram ignorados
                (pontuação solta, prefixo sem o código). Linha em branco não conta: ela nem
                chega a virar item.
              </p>
            ) : null}
          </section>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" data-testid="batch-table">
              <caption className="sr-only">
                Resultado da conferência, na ordem em que os códigos foram digitados
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3">
                    Código
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Situação
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Recebeu
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Evento
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Emissão
                  </th>
                  <th scope="col" className="py-2">
                    Motivo
                  </th>
                </tr>
              </thead>

              <tbody>
                {outcome.batch.rows.map((row, index) => (
                  <tr
                    key={row.code}
                    className="border-b border-border align-top"
                    data-testid={`batch-row-${index}`}
                    data-code={row.code}
                    data-status={row.status}
                    data-valid={row.valid ? 'true' : 'false'}
                  >
                    <td className="code-data py-2 pr-3">{row.code}</td>

                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          row.valid ? 'text-success-strong' : 'text-destructive'
                        }`}
                        data-testid={`batch-verdict-${index}`}
                      >
                        {row.valid ? (
                          <BadgeCheck className="size-4" aria-hidden />
                        ) : row.status === 'REVOKED' ? (
                          <Ban className="size-4" aria-hidden />
                        ) : (
                          <XCircle className="size-4" aria-hidden />
                        )}
                        {row.valid ? 'válido' : 'inválido'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {STATUS_LABELS[row.status] ?? row.status}
                      </span>
                    </td>

                    <td className="py-2 pr-3">{row.recipientName ?? '—'}</td>
                    <td className="py-2 pr-3">{row.eventTitle ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {row.issuedAt ? row.issuedAt.toLocaleDateString('pt-BR') : '—'}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* O que a conferência NÃO prova — dito na tela, não só no código. */}
          <section
            className="flex items-start gap-2 rounded-lg border border-border bg-surface-low p-4 text-xs text-muted-foreground"
            data-testid="batch-scope-notice"
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                O que esta conferência prova — e o que ela não prova
              </p>
              <p>
                Ela confere <strong>uma a uma</strong> as {outcome.batch.rows.length} entradas
                que você colou, usando exatamente a mesma validação da página de um código.
              </p>
              <p>
                Ela <strong>não</strong> varre o evento: não lista quem recebeu certificado e
                não prova que a lista está completa. Um documento emitido que não esteja na
                sua lista não aparece aqui. Ela também não prova que o PDF em mãos é o
                arquivo emitido — para isso, abra o código individualmente e confira o
                documento.
              </p>
              <p>
                Códigos conferidos repetidamente são contados no certificado: cada consulta
                fica registrada na instituição que emitiu o documento.
              </p>
            </div>
          </section>
        </>
      ) : null}

      {/*
        A legenda de tipos existe porque o nome da coluna "Evento" pode trazer um
        certificado de participação, de palestrante ou de autoria — e a diferença
        importa para quem confere. O caminho de um código só é citado por ENDEREÇO, e
        não como link: `/validar` sem código não existe (o código é a capacidade de
        acesso), então um link para lá levaria a um 404.
      */}
      <p className="text-xs text-muted-foreground">
        Tipos de certificado reconhecidos: {Object.values(CERTIFICATE_KIND_LABELS).join(' · ')}.
        Para conferir um documento só (e baixar o PDF), abra o endereço{' '}
        <span className="code-data">/validar/&lt;código&gt;</span>.
      </p>

      <nav className="text-sm">
        <Link href="/" className="font-medium underline underline-offset-4">
          Ir para a página inicial
        </Link>
      </nav>

      {/*
        A linha de conferência em lote é usada por quem NÃO tem conta na plataforma
        (departamento de pessoal, banca, órgão de fomento) e é onde o visitante
        anônimo mais precisa poder discordar do tema do sistema operacional.
      */}
      <footer className="border-t border-border pt-6">
        <ThemeChoice variant="public" />
      </footer>
    </main>
  );
}
