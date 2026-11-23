'use client';

import type { BlockContentValues } from '@/components/admin/block-content-values';
import { BlockFieldShell } from '@/components/admin/block-fields/block-field-shell';
import { FaqBlockFields } from '@/components/admin/block-fields/faq-block-fields';
import {
  GalleryBlockFields,
  type BlockUploadContext,
} from '@/components/admin/block-fields/gallery-block-fields';
import {
  CallForProposalsBlockFields,
  CountdownBlockFields,
  CustomHtmlBlockFields,
  RegistrationCtaBlockFields,
  RichTextBlockFields,
  SponsorsBlockFields,
  TeamBlockFields,
} from '@/components/admin/block-fields/simple-block-fields';
import { Input } from '@/components/ui';
import { BLOCK_DESCRIPTIONS, type PageBlockType } from '@/domain/events/landing-page';

/** Despachante de campos específicos de cada bloco do editor da landing page. */
export function BlockContentFields({
  type,
  values,
  tierOptions,
  teamOptions = [],
  libraryOptions = [],
  uploadContext,
}: {
  type: PageBlockType;
  values: BlockContentValues;
  tierOptions: { value: string; label: string }[];
  teamOptions?: { value: string; label: string }[];
  libraryOptions?: { value: string; label: string }[];
  uploadContext?: BlockUploadContext;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{BLOCK_DESCRIPTIONS[type]}</p>

      {type !== 'RICH_TEXT' && type !== 'CUSTOM_HTML' ? (
        <BlockFieldShell label="Título da seção" hint="Vazio usa o título padrão do bloco.">
          <Input name="title" defaultValue={values.title} aria-label="Título da seção" />
        </BlockFieldShell>
      ) : null}

      {type === 'RICH_TEXT' ? <RichTextBlockFields values={values} /> : null}
      {type === 'FAQ' ? <FaqBlockFields initialFaq={values.faq} /> : null}
      {type === 'GALLERY' ? (
        <GalleryBlockFields
          initialGallery={values.gallery}
          libraryOptions={libraryOptions}
          uploadContext={uploadContext}
        />
      ) : null}
      {type === 'SPONSORS' ? <SponsorsBlockFields values={values} tierOptions={tierOptions} /> : null}
      {type === 'TEAM' ? <TeamBlockFields values={values} teamOptions={teamOptions} /> : null}
      {type === 'COUNTDOWN' ? <CountdownBlockFields values={values} /> : null}
      {type === 'REGISTRATION_CTA' ? <RegistrationCtaBlockFields values={values} /> : null}
      {type === 'CALL_FOR_PROPOSALS' ? <CallForProposalsBlockFields values={values} /> : null}
      {type === 'CUSTOM_HTML' ? <CustomHtmlBlockFields values={values} /> : null}
    </div>
  );
}
