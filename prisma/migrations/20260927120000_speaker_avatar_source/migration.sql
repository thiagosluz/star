-- ═══════════════════════════════════════════════════════════════════════════════
--  FASE 46 — Origem da foto do palestrante
--
--  A organização passou a poder enviar a foto de quem nunca vai assumir o perfil
--  (o palestrante que não faz cadastro na plataforma). Como é dado pessoal enviado
--  por TERCEIRO, o portal precisa poder dizer de onde a foto veio — é o que permite
--  a pessoa substituí-la ou removê-la sabendo o que está olhando.
--
--  O BACKFILL É HONESTO: até esta migração o ÚNICO caminho de upload era o portal,
--  então toda foto já gravada veio do próprio palestrante.
-- ═══════════════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "SpeakerAvatarSource" AS ENUM ('ORGANIZATION', 'SPEAKER');

-- AlterTable
ALTER TABLE "speaker_profiles" ADD COLUMN "avatarSource" "SpeakerAvatarSource";

-- Backfill: toda foto existente foi enviada pelo próprio palestrante
UPDATE "speaker_profiles" SET "avatarSource" = 'SPEAKER' WHERE "avatarUrl" IS NOT NULL;
