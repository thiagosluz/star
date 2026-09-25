/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Contatos públicos da pessoa (FASE 45)
 *
 *  E-mail e redes sociais são o ÚNICO campo do perfil que publica contato direto, e
 *  por isso vivem num módulo próprio: nasceram para a vitrine da equipe (FASE 45) e
 *  são decididos pela matriz de visibilidade do perfil público (FASE 44), com o
 *  padrão FECHADO — a página é a internet aberta (ADR-139).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SÓ QUATRO REDES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `website`, `lattes` e o ORCID já têm coluna própria no perfil (`publicSiteUrl`,
 *  `lattesId`, `orcidId`). Aceitá-los aqui também daria DUAS fontes para o mesmo
 *  link — e a pessoa veria na página o endereço antigo depois de corrigir o novo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const PUBLIC_CONTACT_NETWORKS = ['linkedin', 'instagram', 'github', 'youtube'] as const;

export type PublicContactNetwork = (typeof PUBLIC_CONTACT_NETWORKS)[number];

export const PUBLIC_CONTACT_LABELS: Readonly<Record<PublicContactNetwork, string>> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  github: 'GitHub',
  youtube: 'YouTube',
};

export type PublicContacts = Partial<Record<PublicContactNetwork, string>>;

/**
 * O campo da matriz de visibilidade (FASE 44) que governa e-mail e redes.
 *
 * Nomeado em UM lugar só, de propósito: o cartão da equipe (FASE 45) e a página do
 * perfil leem daqui, e o teste unitário confere que este nome EXISTE na matriz — assim
 * renomear o campo quebra o teste em vez de publicar contato sem autorização.
 */
export const PUBLIC_CONTACT_FIELD = 'contacts';

/**
 * Hosts aceitos por rede — a MESMA allowlist do material do palestrante.
 *
 * O campo é rotulado "LinkedIn" na tela e vira link na página: aceitar qualquer host
 * transformaria o rótulo em mentira, e o link de phishing se apoiaria na confiança
 * dele. Aqui só a ESCOLHA das redes é própria; a régua de host é a mesma.
 */
const CONTACT_HOSTS: Readonly<Record<PublicContactNetwork, readonly string[]>> = {
  linkedin: ['linkedin.com', 'www.linkedin.com', 'br.linkedin.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  github: ['github.com', 'www.github.com', 'gist.github.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
};

export type PublicContactsResult =
  | { ok: true; contacts: PublicContacts }
  | { ok: false; errors: readonly string[] };

/**
 * Valida e normaliza os contatos digitados pela pessoa.
 *
 * Sem esquema, `https://` é assumido (é o que a pessoa quis dizer); com esquema, só
 * `http`/`https` passam — `javascript:` e `data:` são recusados com o motivo.
 * Campo vazio é ausente, não `''`: gravar string vazia faria a página renderizar um
 * `<a href="">` que recarrega a própria página ao ser clicado.
 */
export function sanitizePublicContacts(input: unknown): PublicContactsResult {
  const contacts: PublicContacts = {};
  const errors: string[] = [];

  /** Nunca lança: um chamador que não mandou o mapa simplesmente não tem contatos. */
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: true, contacts };

  const record = input as Record<string, unknown>;

  for (const network of PUBLIC_CONTACT_NETWORKS) {
    const raw = record[network];
    if (raw === undefined || raw === null) continue;

    const label = PUBLIC_CONTACT_LABELS[network];

    if (typeof raw !== 'string') {
      errors.push(`${label}: valor inválido.`);
      continue;
    }

    const text = raw.trim();
    if (text.length === 0) continue;

    /**
     * `@usuario` é o que as pessoas DIGITAM, e recusar por isso seria burocracia: o
     * Instagram e o YouTube usam o arroba como endereço. Só essas duas redes aceitam
     * a forma curta — nas outras, `@` não é endereço de nada.
     */
    const expanded = text.startsWith('@')
      ? network === 'instagram'
        ? `https://instagram.com/${text.slice(1)}`
        : network === 'youtube'
          ? `https://youtube.com/${text}`
          : text
      : text;

    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(expanded) ? expanded : `https://${expanded}`;

    let url: URL;

    try {
      url = new URL(withScheme);
    } catch {
      errors.push(`${label}: endereço inválido.`);
      continue;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(`${label}: só endereços http:// ou https://.`);
      continue;
    }

    if (!CONTACT_HOSTS[network].includes(url.hostname.toLowerCase())) {
      errors.push(`${label}: o endereço precisa ser de ${CONTACT_HOSTS[network][0]}.`);
      continue;
    }

    contacts[network] = url.toString();
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, contacts };
}

/**
 * Lê os contatos gravados, descartando **só** o que não é mais válido.
 *
 * ─── POR QUE A LEITURA NÃO PODE SER A ESCRITA ────────────────────────────────
 *
 *  A tentação é chamar `sanitizePublicContacts` e devolver o resultado — foi o que
 *  este arquivo fez na primeira versão, e o teste unitário pegou: como a escrita
 *  recusa o CONJUNTO ao encontrar um valor ruim, um único link estragado (host que
 *  saiu da allowlist, edição manual no banco) apagava as outras três redes da página.
 *  Aqui a validação é rede a rede, e o valor ruim some sozinho — a mesma decisão do
 *  `readSocialLinks` do palestrante.
 */
export function readPublicContacts(value: unknown): PublicContacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const record = value as Record<string, unknown>;
  const contacts: PublicContacts = {};

  for (const network of PUBLIC_CONTACT_NETWORKS) {
    const result = sanitizePublicContacts({ [network]: record[network] });

    if (result.ok && result.contacts[network]) {
      contacts[network] = result.contacts[network];
    }
  }

  return contacts;
}

/** Há algum contato para mostrar? (O cartão só desenha ícones se houver.) */
export function hasPublicContacts(contacts: PublicContacts | null | undefined): boolean {
  if (!contacts) return false;
  return PUBLIC_CONTACT_NETWORKS.some((network) => Boolean(contacts[network]));
}
