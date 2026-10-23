/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SISTEMA DE UI — ponto de entrada único (FASE 11A)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO UM MÓDULO NOVO DEVE IMPORTAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *      import { Button, Card, CardHeader, PageHeader, Table } from '@/components/ui';
 *
 *  Um caminho só, para que "usar o sistema" seja mais fácil do que inventar. Se um
 *  módulo novo precisa de algo que não está aqui, a resposta é **acrescentar um
 *  primitivo a este diretório** — não escrever a classe solta na tela. É assim que
 *  o padrão sobrevive à próxima fase (ver `docs/design-system.md`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export { Badge, RarityBadge, type BadgeTone, type CardRarityTone } from './badge';
export { Button, buttonClasses, buttonVariants, type ButtonVariants } from './button';
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  SectionHeading,
} from './card';
export { MetaItem, MetaList, StatCard, TBody, TD, TH, THead, TR, Table, TableWrapper } from './data';
export { Alert, Avatar, EmptyState, Progress, Skeleton, type AlertTone } from './feedback';
export {
  ConfirmDialog,
  ConfirmSubmitButton,
  Modal,
  type ConfirmDialogProps,
  type ModalProps,
} from './dialog';
export {
  Checkbox,
  Field,
  Input,
  Label,
  Select,
  Textarea,
  fieldAria,
  fieldControlClasses,
} from './form';
/**
 * O topo (`PageHeader`/`Breadcrumbs`) vem de um módulo SERVER desde a FASE 78; o
 * menu (`NavLink`/`TabNav`) continua no módulo `'use client'`. Reexportar os
 * dois daqui mantém o caminho único de import (`@/components/ui`) sem arrastar o
 * cliente para quem só quer o cabeçalho — o barrel não tem diretiva, e cada
 * símbolo carrega a fronteira do arquivo onde foi definido.
 */
export { Breadcrumbs, PageHeader, type Crumb } from './page-header';
export { NavLink, TabNav } from './navigation';
