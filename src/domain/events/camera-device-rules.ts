/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A LENTE DO BALCÃO (FASE 51 · dívida E42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU DOMÍNIO, SE O RESTO DO LEITOR É NAVEGADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `enumerateDevices`, `getUserMedia` e o comportamento do navegador quando um
 *  `deviceId` desaparece NÃO são testáveis sem um navegador de verdade — e o
 *  projeto não tem `jsdom` na suíte. O que É regra de negócio, e por isso vive
 *  aqui, é:
 *
 *    • **a chave da escolha guardada** — trocá-la em silêncio faria o operador
 *      reescolher a lente no meio do evento, porque o valor antigo ficaria órfão
 *      num nome que ninguém mais lê;
 *    • **o rótulo do dispositivo** — o navegador só entrega `label` DEPOIS da
 *      permissão (é proteção contra fingerprint), e uma lista de opções em branco
 *      é pior que uma lista numerada;
 *    • **quando o seletor aparece** — com uma câmera, escolher não é escolha.
 *
 *  Puro: sem React, sem `navigator`, sem `window`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * A chave do `localStorage` da lente escolhida, POR EVENTO.
 *
 * O `eventId` faz parte da chave pelo mesmo motivo do sentido da leitura
 * (`eventflow_monitor_mode_<eventId>`): a mesma pessoa opera eventos diferentes no
 * mesmo notebook, e a câmera certa num estande não é a certa na portaria.
 */
export function cameraDeviceStorageKey(eventId: string): string {
  return `eventflow_camera_device_${eventId}`;
}

/**
 * O rótulo de um dispositivo de vídeo.
 *
 * `label` vazio é o estado NORMAL antes da permissão — não é um dispositivo
 * quebrado. Numerar é o que impede uma lista de opções em branco, em que o
 * operador não tem como saber qual é a lente da bancada.
 */
export function cameraDeviceLabel(label: string | null | undefined, index: number): string {
  const text = typeof label === 'string' ? label.trim() : '';

  return text.length > 0 ? text : `Câmera ${index + 1}`;
}

/** A escolha só é oferecida quando há o que escolher. */
export function shouldOfferCameraChoice(deviceCount: number): boolean {
  return deviceCount > 1;
}

/**
 * A escolha guardada ainda existe entre os dispositivos disponíveis?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É UMA FUNÇÃO, E NÃO UM `some` NO COMPONENTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  A resposta decide o que o monitor VÊ: quando `false`, a leitura volta à câmera
 *  padrão e a tela avisa. Uma comparação escrita no meio do JSX é fácil de
 *  inverter sem ninguém notar — e o defeito (câmera escolhida que não abre mais)
 *  só aparece no dia do evento, com fila na porta.
 */
export function cameraChoiceStillAvailable(
  savedDeviceId: string | null | undefined,
  availableDeviceIds: readonly string[],
): boolean {
  const wanted = typeof savedDeviceId === 'string' ? savedDeviceId.trim() : '';

  if (wanted.length === 0) return true;

  return availableDeviceIds.includes(wanted);
}

/** O que a tela diz quando a lente escolhida não respondeu. */
export const CAMERA_FALLBACK_NOTICE =
  'A câmera escolhida não respondeu (desconectada ou em uso). Abrimos a câmera padrão — escolha outra na lista.';
