/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LIBERAR AS VAGAS VENCIDAS, PELA LINHA DE COMANDO (FASE 34)
 *
 *      npm run registrations:expire
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA CLI, SE O WORKER JÁ FAZ ISSO DE HORA EM HORA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três razões, e as três são de operação:
 *
 *    1. **O cron do host é o caminho de produção declarado** (mesma decisão das
 *       partições da auditoria, `npm run db:partitions`): quem opera o evento não
 *       depende de o worker estar de pé para a vaga voltar para a fila;
 *    2. **o E2E precisa do caminho REAL** — um cenário que esperasse a passada do
 *       relógio levaria uma hora, e um que chamasse o serviço direto mediria uma
 *       função, não o caminho que roda em produção (armadilha 66);
 *    3. **a operação precisa poder forçar a passada** quando um prazo mal
 *       configurado está segurando gente (o organizador escolheu 30 dias por engano).
 *
 *  Ele roda a MESMA função do worker (`runConfirmationExpirySweep`) e, com
 *  `--lembretes`, também a varredura de lembretes. Não há segunda implementação da
 *  regra para divergir da que roda no worker.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  USO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `--lembretes`   roda também o aviso de prazo próximo (o worker faz os dois juntos)
 *  `--agora=<ISO>` usa um instante fixo como "agora" (útil para conferir um cenário)
 *
 *  Sai com código 1 quando alguma liberação falha — o cron precisa saber.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { disconnectDb } from '../../src/lib/db/tenant-client.ts';
import { adminPrisma } from '../../src/lib/db/admin-client.ts';
import {
  runConfirmationExpirySweep,
  runConfirmationReminderScan,
} from '../../src/lib/events/confirmation-service.ts';

const line = '─'.repeat(78);

const args = process.argv.slice(2);
const withReminders = args.includes('--lembretes');
const nowArg = args.find((arg) => arg.startsWith('--agora='))?.split('=')[1];
const now = nowArg ? new Date(nowArg) : undefined;

if (nowArg && Number.isNaN(now?.getTime())) {
  console.error(`  ✗ --agora inválido: "${nowArg}" não é uma data ISO.`);
  process.exit(1);
}

console.log(`\n${line}`);
console.log('  LIBERAÇÃO AUTOMÁTICA DAS VAGAS NÃO CONFIRMADAS (FASE 34)');
console.log(line);
console.log(`  agora: ${(now ?? new Date()).toISOString()}`);

try {
  if (withReminders) {
    const reminders = await runConfirmationReminderScan({ now });

    console.log(
      `\n  Lembretes: ${reminders.reminded} enviado(s) · ${reminders.alreadyReminded} já avisado(s) · ` +
        `${reminders.failures} falha(s) · ${reminders.tenants} instituição(ões)`,
    );
  }

  const sweep = await runConfirmationExpirySweep({ now });

  console.log(
    `\n  Liberadas: ${sweep.released} vaga(s) em ${sweep.tenants} instituição(ões) · ` +
      `${sweep.promoted} promoção(ões) da lista de espera · ${sweep.noticeFailures} aviso(s) não entregue(s)`,
  );

  console.log(
    '\n  As vagas liberadas voltaram para a fila e quem estava na lista de espera foi promovido.',
  );
  console.log(
    '  Os avisos saem pelo outbox: falha de e-mail NÃO desfaz a liberação (o fato já está no banco).',
  );

  console.log(`${line}\n`);

  /**
   * Falha de AVISO não muda o código de saída: o fato de negócio (a vaga liberada)
   * aconteceu. Só a varredura que não conseguiu trabalhar merece alarme no cron.
   */
  process.exit(0);
} catch (error) {
  console.error(`\n  ✗ falha na liberação automática: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
} finally {
  await adminPrisma.$disconnect().catch(() => undefined);
  await disconnectDb().catch(() => undefined);
}
