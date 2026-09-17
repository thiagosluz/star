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
  Checkbox,
  Field,
  Input,
  Label,
  Select,
  Textarea,
  fieldAria,
  fieldControlClasses,
} from './form';
export {
  Breadcrumbs,
  NavLink,
  PageHeader,
  TabNav,
  type Crumb,
} from './navigation';
