-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "RoleKey" AS ENUM ('OWNER', 'ADMIN', 'ORGANIZER', 'FINANCE', 'REVIEWER', 'CHAIR', 'SPEAKER', 'STAFF', 'PARTICIPANT', 'SPONSOR');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('TENANT', 'EVENT', 'ACTIVITY');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS', 'FINISHED', 'CANCELED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EventModality" AS ENUM ('IN_PERSON', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('LECTURE', 'MINI_COURSE', 'WORKSHOP', 'ROUND_TABLE', 'HACKATHON', 'POSTER_SESSION', 'ORAL_PRESENTATION', 'CULTURAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'WAITLISTED', 'CANCELED', 'ATTENDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('QR_CODE_CHECKIN', 'QR_CODE_CHECKOUT', 'MANUAL_STAFF', 'SELF_DECLARED', 'IMPORTS');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'PARTIAL', 'EXCUSED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CANCELED');

-- CreateEnum
CREATE TYPE "SubmissionFileKind" AS ENUM ('BLIND_PDF', 'IDENTIFIED_PDF', 'SUPPLEMENTARY', 'PRESENTATION', 'CAMERA_READY');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('ACCEPT', 'MINOR_REVISION', 'MAJOR_REVISION', 'REJECT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'IN_PROGRESS', 'SUBMITTED', 'RECUSED');

-- CreateEnum
CREATE TYPE "ConflictType" AS ENUM ('SAME_INSTITUTION', 'COAUTHOR', 'ADVISOR_ADVISEE', 'FINANCIAL_TIE', 'PERSONAL_RELATIONSHIP', 'SELF_DECLARED');

-- CreateEnum
CREATE TYPE "CardRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');

-- CreateEnum
CREATE TYPE "CardTrigger" AS ENUM ('CHECKIN', 'ACTIVITY_COMPLETION', 'MINI_COURSE_COMPLETION', 'SUBMISSION_ACCEPTED', 'SUBMISSION_SUBMITTED', 'REVIEW_COMPLETED', 'REVIEWER_TOP', 'XP_THRESHOLD', 'LEVEL_UP', 'MANUAL_GRANT', 'STREAK', 'EVENT_ATTENDANCE_FULL');

-- CreateEnum
CREATE TYPE "XpSourceKind" AS ENUM ('CHECKIN', 'ACTIVITY_ATTENDANCE', 'MINI_COURSE_COMPLETION', 'SUBMISSION_SUBMITTED', 'SUBMISSION_ACCEPTED', 'REVIEW_COMPLETED', 'TASK_COMPLETED', 'BONUS', 'ADMIN_ADJUSTMENT', 'REFERRAL');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('DAILY', 'WEEKLY', 'EVENT_LONG', 'ONE_OFF', 'ACHIEVEMENT');

-- CreateEnum
CREATE TYPE "TaskProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CLAIMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CertificateKind" AS ENUM ('ATTENDANCE', 'SPEAKER', 'ORGANIZER', 'REVIEWER', 'AUTHOR', 'MINI_COURSE', 'PARTICIPATION', 'MERIT');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('QUEUED', 'GENERATING', 'ISSUED', 'REVOKED', 'FAILED');

-- CreateEnum
CREATE TYPE "SponsorTierKey" AS ENUM ('DIAMOND', 'GOLD', 'SILVER', 'BRONZE', 'SUPPORTER', 'MEDIA_PARTNER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PageBlockType" AS ENUM ('HERO', 'RICH_TEXT', 'SCHEDULE', 'SPEAKERS', 'SPONSORS', 'FAQ', 'GALLERY', 'COUNTDOWN', 'VENUE_MAP', 'REGISTRATION_CTA', 'TRACKS', 'CUSTOM_HTML');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'PERMISSION_CHANGE', 'IMPERSONATE');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "customDomain" VARCHAR(253),
    "status" "TenantStatus" NOT NULL DEFAULT 'PENDING',
    "plan" "TenantPlan" NOT NULL DEFAULT 'FREE',
    "maxEvents" INTEGER NOT NULL DEFAULT 3,
    "maxStorageBytes" BIGINT NOT NULL DEFAULT 5368709120,
    "maxMembers" INTEGER NOT NULL DEFAULT 100,
    "logoUrl" VARCHAR(1024),
    "primaryColor" VARCHAR(9),
    "locale" VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Bahia',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" VARCHAR(1024),
    "passwordHash" VARCHAR(255),
    "publicHandle" VARCHAR(63),
    "bio" VARCHAR(1000),
    "headline" VARCHAR(160),
    "country" VARCHAR(2),
    "orcidId" VARCHAR(19),
    "lattesId" VARCHAR(32),
    "isPublicProfile" BOOLEAN NOT NULL DEFAULT true,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" VARCHAR(500),
    "banExpires" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "accountId" VARCHAR(255) NOT NULL,
    "providerId" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(6),
    "refreshTokenExpiresAt" TIMESTAMPTZ(6),
    "scope" VARCHAR(500),
    "password" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "activeTenantId" UUID,
    "impersonatedBy" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" UUID NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "value" VARCHAR(512) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tenant_profiles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "jobTitle" VARCHAR(120),
    "department" VARCHAR(120),
    "institution" VARCHAR(200),
    "externalRef" VARCHAR(120),
    "invitedById" UUID,
    "invitedAt" TIMESTAMPTZ(6),
    "joinedAt" TIMESTAMPTZ(6),
    "lastAccessAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "user_tenant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "RoleKey" NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "eventId" UUID,
    "activityId" UUID,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6),
    "grantedById" UUID,
    "reason" VARCHAR(300),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "subtitle" VARCHAR(300),
    "summary" VARCHAR(600),
    "description" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "modality" "EventModality" NOT NULL DEFAULT 'IN_PERSON',
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Bahia',
    "registrationOpensAt" TIMESTAMPTZ(6),
    "registrationClosesAt" TIMESTAMPTZ(6),
    "cfpOpensAt" TIMESTAMPTZ(6),
    "cfpClosesAt" TIMESTAMPTZ(6),
    "venueName" VARCHAR(200),
    "venueAddress" VARCHAR(300),
    "city" VARCHAR(120),
    "state" VARCHAR(120),
    "country" VARCHAR(2),
    "onlineUrl" VARCHAR(1024),
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "capacity" INTEGER DEFAULT 0,
    "coverImageUrl" VARCHAR(1024),
    "logoUrl" VARCHAR(1024),
    "primaryColor" VARCHAR(9),
    "secondaryColor" VARCHAR(9),
    "accentColor" VARCHAR(9),
    "theme" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "publishedAt" TIMESTAMPTZ(6),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "building" VARCHAR(120),
    "floor" VARCHAR(40),
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "resources" JSONB NOT NULL DEFAULT '[]',
    "mapUrl" VARCHAR(1024),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" "ActivityType" NOT NULL DEFAULT 'LECTURE',
    "status" "ActivityStatus" NOT NULL DEFAULT 'DRAFT',
    "modality" "EventModality" NOT NULL DEFAULT 'IN_PERSON',
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "roomId" UUID,
    "capacity" INTEGER DEFAULT 0,
    "waitlistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "workloadMinutes" INTEGER NOT NULL DEFAULT 60,
    "requiresAttendance" BOOLEAN NOT NULL DEFAULT true,
    "minAttendancePercent" INTEGER NOT NULL DEFAULT 75,
    "checkInEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInOpensAt" TIMESTAMPTZ(6),
    "checkInClosesAt" TIMESTAMPTZ(6),
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "rewardCardTemplateId" UUID,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "coverImageUrl" VARCHAR(1024),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_speakers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "userId" UUID,
    "guestName" VARCHAR(160),
    "guestEmail" VARCHAR(255),
    "guestInstitution" VARCHAR(200),
    "guestBio" TEXT,
    "isKeynote" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "workloadMinutes" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activity_speakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_pages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "isHome" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "metaTitle" VARCHAR(200),
    "metaDescription" VARCHAR(320),
    "ogImageUrl" VARCHAR(1024),
    "theme" JSONB NOT NULL DEFAULT '{}',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "event_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_blocks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "type" "PageBlockType" NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "style" JSONB NOT NULL DEFAULT '{}',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_tiers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" "SponsorTierKey" NOT NULL DEFAULT 'CUSTOM',
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(400),
    "color" VARCHAR(9),
    "rank" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
    "maxSponsors" INTEGER NOT NULL DEFAULT 0,
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sponsor_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID,
    "tierId" UUID,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "logoUrl" VARCHAR(1024),
    "websiteUrl" VARCHAR(1024),
    "contactName" VARCHAR(160),
    "contactEmail" VARCHAR(255),
    "contactPhone" VARCHAR(40),
    "taxId" VARCHAR(32),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "contractUrl" VARCHAR(1024),
    "contractValueCents" INTEGER DEFAULT 0,
    "contractStart" TIMESTAMPTZ(6),
    "contractEnd" TIMESTAMPTZ(6),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "activityId" UUID,
    "userId" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "waitlistPosition" INTEGER DEFAULT 0,
    "consentImage" BOOLEAN NOT NULL DEFAULT false,
    "consentData" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMPTZ(6),
    "accessibilityNotes" VARCHAR(600),
    "dietaryNotes" VARCHAR(300),
    "formResponses" JSONB NOT NULL DEFAULT '{}',
    "badgeToken" VARCHAR(64),
    "checkedInAt" TIMESTAMPTZ(6),
    "checkedInById" UUID,
    "canceledAt" TIMESTAMPTZ(6),
    "cancelReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "activityId" UUID,
    "registrationId" UUID,
    "userId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "source" "AttendanceSource" NOT NULL,
    "checkedInAt" TIMESTAMPTZ(6) NOT NULL,
    "checkedOutAt" TIMESTAMPTZ(6),
    "minutesAttended" INTEGER DEFAULT 0,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "validatedById" UUID,
    "qrNonce" VARCHAR(64),
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "color" VARCHAR(9),
    "chairId" UUID,
    "maxSubmissionsPerAuthor" INTEGER NOT NULL DEFAULT 0,
    "requiresBlindReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewRubric" JSONB NOT NULL DEFAULT '[]',
    "acceptanceThreshold" DECIMAL(5,2) NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "trackId" UUID,
    "activityId" UUID,
    "protocol" VARCHAR(20) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "abstract" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" VARCHAR(10) NOT NULL DEFAULT 'pt-BR',
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(6),
    "finalScore" DECIMAL(6,2),
    "decisionAt" TIMESTAMPTZ(6),
    "decisionById" UUID,
    "decisionNotes" TEXT,
    "presentationScheduledAt" TIMESTAMPTZ(6),
    "presentationRoomId" UUID,
    "presentationFormat" VARCHAR(40),
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_authors" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "userId" UUID,
    "guestName" VARCHAR(160),
    "guestEmail" VARCHAR(255),
    "guestInstitution" VARCHAR(200),
    "guestOrcidId" VARCHAR(19),
    "institution" VARCHAR(200),
    "authorOrder" INTEGER NOT NULL DEFAULT 1,
    "isCorresponding" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "submission_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_files" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "kind" "SubmissionFileKind" NOT NULL DEFAULT 'BLIND_PDF',
    "storageKey" VARCHAR(1024) NOT NULL,
    "bucket" VARCHAR(120) NOT NULL,
    "fileName" VARCHAR(300) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "scanStatus" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'INVITED',
    "affinityScore" DECIMAL(5,2),
    "matchReason" VARCHAR(400),
    "isBlind" BOOLEAN NOT NULL DEFAULT true,
    "invitedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(6),
    "dueAt" TIMESTAMPTZ(6),
    "assignedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "assignmentId" UUID,
    "status" "ReviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "recommendation" "ReviewRecommendation",
    "scores" JSONB NOT NULL DEFAULT '{}',
    "weightedScore" DECIMAL(6,2),
    "confidentialComments" TEXT,
    "feedbackToAuthor" TEXT,
    "isBlind" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_conflicts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ConflictType" NOT NULL,
    "isDetected" BOOLEAN NOT NULL DEFAULT true,
    "reason" VARCHAR(500),
    "declaredById" UUID,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_templates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "lore" TEXT,
    "rarity" "CardRarity" NOT NULL,
    "levelRequired" INTEGER NOT NULL DEFAULT 1,
    "palette" JSONB NOT NULL DEFAULT '{}',
    "art" JSONB NOT NULL DEFAULT '{}',
    "trigger" "CardTrigger" NOT NULL,
    "triggerCondition" JSONB NOT NULL DEFAULT '{}',
    "dropWeight" INTEGER NOT NULL DEFAULT 100,
    "availableUntil" TIMESTAMPTZ(6),
    "maxSupply" INTEGER NOT NULL DEFAULT 0,
    "mintedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cards" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cardTemplateId" UUID NOT NULL,
    "eventId" UUID,
    "level" INTEGER NOT NULL DEFAULT 1,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isFoil" BOOLEAN NOT NULL DEFAULT false,
    "source" "CardTrigger" NOT NULL,
    "sourceRef" VARCHAR(120),
    "grantedById" UUID,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_xp_profiles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "spentXp" INTEGER NOT NULL DEFAULT 0,
    "seasonXp" INTEGER NOT NULL DEFAULT 0,
    "seasonKey" VARCHAR(20),
    "level" INTEGER NOT NULL DEFAULT 1,
    "prestigeLevel" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMPTZ(6),
    "equippedFrame" VARCHAR(80),
    "equippedTitle" VARCHAR(80),
    "equippedBadge" VARCHAR(80),
    "cardsCollected" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_xp_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_transactions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventId" UUID,
    "amount" INTEGER NOT NULL,
    "source" "XpSourceKind" NOT NULL,
    "reason" VARCHAR(300),
    "activityId" UUID,
    "submissionId" UUID,
    "reviewId" UUID,
    "registrationId" UUID,
    "balanceAfter" INTEGER DEFAULT 0,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_definitions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "kind" "TaskKind" NOT NULL DEFAULT 'ONE_OFF',
    "trigger" "XpSourceKind" NOT NULL,
    "target" JSONB NOT NULL DEFAULT '{}',
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "rewardCardTemplateId" UUID,
    "startsAt" TIMESTAMPTZ(6),
    "endsAt" TIMESTAMPTZ(6),
    "repeatEveryHours" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "task_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_task_progress" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskDefinitionId" UUID NOT NULL,
    "status" "TaskProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER NOT NULL DEFAULT 1,
    "periodKey" VARCHAR(20),
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "claimedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_task_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "activityId" UUID,
    "kind" "CertificateKind" NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'QUEUED',
    "validationCode" VARCHAR(32) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "recipientName" VARCHAR(200) NOT NULL,
    "bodyText" TEXT NOT NULL,
    "workloadMinutes" INTEGER NOT NULL DEFAULT 0,
    "workloadBreakdown" JSONB NOT NULL DEFAULT '[]',
    "issuedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "storageKey" VARCHAR(1024),
    "bucket" VARCHAR(120),
    "mimeType" VARCHAR(120) NOT NULL DEFAULT 'application/pdf',
    "sizeBytes" BIGINT,
    "contentHash" CHAR(64),
    "signature" TEXT,
    "signatureKeyId" VARCHAR(80),
    "signatureAlg" VARCHAR(40),
    "validationCount" INTEGER NOT NULL DEFAULT 0,
    "lastValidatedAt" TIMESTAMPTZ(6),
    "failureReason" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "jobId" VARCHAR(120),
    "attendanceId" UUID,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedReason" VARCHAR(400),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" UUID,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "requestId" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_customDomain_key" ON "tenants"("customDomain");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenants_deletedAt_idx" ON "tenants"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_publicHandle_key" ON "user"("publicHandle");

-- CreateIndex
CREATE INDEX "user_email_idx" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_deletedAt_idx" ON "user"("deletedAt");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE INDEX "session_activeTenantId_idx" ON "session"("activeTenantId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "user_tenant_profiles_userId_status_idx" ON "user_tenant_profiles"("userId", "status");

-- CreateIndex
CREATE INDEX "user_tenant_profiles_tenantId_status_idx" ON "user_tenant_profiles"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenant_profiles_tenantId_userId_key" ON "user_tenant_profiles"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "role_assignments_tenantId_userId_role_idx" ON "role_assignments"("tenantId", "userId", "role");

-- CreateIndex
CREATE INDEX "role_assignments_tenantId_role_scope_idx" ON "role_assignments"("tenantId", "role", "scope");

-- CreateIndex
CREATE INDEX "role_assignments_eventId_role_idx" ON "role_assignments"("eventId", "role");

-- CreateIndex
CREATE INDEX "role_assignments_activityId_role_idx" ON "role_assignments"("activityId", "role");

-- CreateIndex
CREATE INDEX "role_assignments_userId_revokedAt_idx" ON "role_assignments"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "events_tenantId_status_idx" ON "events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "events_tenantId_startsAt_idx" ON "events"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "events_status_startsAt_idx" ON "events"("status", "startsAt");

-- CreateIndex
CREATE INDEX "events_deletedAt_idx" ON "events"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "events_tenantId_slug_key" ON "events"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "rooms_tenantId_eventId_idx" ON "rooms"("tenantId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_eventId_name_key" ON "rooms"("eventId", "name");

-- CreateIndex
CREATE INDEX "activities_tenantId_eventId_status_idx" ON "activities"("tenantId", "eventId", "status");

-- CreateIndex
CREATE INDEX "activities_eventId_startsAt_idx" ON "activities"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "activities_roomId_startsAt_idx" ON "activities"("roomId", "startsAt");

-- CreateIndex
CREATE INDEX "activities_tenantId_type_idx" ON "activities"("tenantId", "type");

-- CreateIndex
CREATE INDEX "activities_deletedAt_idx" ON "activities"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "activities_eventId_slug_key" ON "activities"("eventId", "slug");

-- CreateIndex
CREATE INDEX "activity_speakers_tenantId_activityId_idx" ON "activity_speakers"("tenantId", "activityId");

-- CreateIndex
CREATE INDEX "activity_speakers_userId_idx" ON "activity_speakers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "activity_speakers_activityId_userId_key" ON "activity_speakers"("activityId", "userId");

-- CreateIndex
CREATE INDEX "event_pages_tenantId_eventId_isPublished_idx" ON "event_pages"("tenantId", "eventId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "event_pages_eventId_slug_key" ON "event_pages"("eventId", "slug");

-- CreateIndex
CREATE INDEX "page_blocks_tenantId_pageId_displayOrder_idx" ON "page_blocks"("tenantId", "pageId", "displayOrder");

-- CreateIndex
CREATE INDEX "sponsor_tiers_tenantId_eventId_rank_idx" ON "sponsor_tiers"("tenantId", "eventId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "sponsor_tiers_eventId_name_key" ON "sponsor_tiers"("eventId", "name");

-- CreateIndex
CREATE INDEX "sponsors_tenantId_eventId_isActive_idx" ON "sponsors"("tenantId", "eventId", "isActive");

-- CreateIndex
CREATE INDEX "sponsors_tierId_idx" ON "sponsors"("tierId");

-- CreateIndex
CREATE UNIQUE INDEX "sponsors_tenantId_slug_key" ON "sponsors"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_badgeToken_key" ON "registrations"("badgeToken");

-- CreateIndex
CREATE INDEX "registrations_tenantId_eventId_status_idx" ON "registrations"("tenantId", "eventId", "status");

-- CreateIndex
CREATE INDEX "registrations_tenantId_userId_status_idx" ON "registrations"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "registrations_eventId_status_idx" ON "registrations"("eventId", "status");

-- CreateIndex
CREATE INDEX "registrations_badgeToken_idx" ON "registrations"("badgeToken");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_activityId_userId_key" ON "registrations"("activityId", "userId");

-- CreateIndex
CREATE INDEX "attendances_tenantId_activityId_userId_idx" ON "attendances"("tenantId", "activityId", "userId");

-- CreateIndex
CREATE INDEX "attendances_tenantId_eventId_checkedInAt_idx" ON "attendances"("tenantId", "eventId", "checkedInAt");

-- CreateIndex
CREATE INDEX "attendances_registrationId_idx" ON "attendances"("registrationId");

-- CreateIndex
CREATE INDEX "attendances_qrNonce_idx" ON "attendances"("qrNonce");

-- CreateIndex
CREATE INDEX "tracks_tenantId_eventId_isActive_idx" ON "tracks"("tenantId", "eventId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_eventId_slug_key" ON "tracks"("eventId", "slug");

-- CreateIndex
CREATE INDEX "submissions_tenantId_eventId_status_idx" ON "submissions"("tenantId", "eventId", "status");

-- CreateIndex
CREATE INDEX "submissions_eventId_trackId_status_idx" ON "submissions"("eventId", "trackId", "status");

-- CreateIndex
CREATE INDEX "submissions_submittedById_idx" ON "submissions"("submittedById");

-- CreateIndex
CREATE INDEX "submissions_tenantId_status_submittedAt_idx" ON "submissions"("tenantId", "status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_tenantId_protocol_key" ON "submissions"("tenantId", "protocol");

-- CreateIndex
CREATE INDEX "submission_authors_tenantId_submissionId_idx" ON "submission_authors"("tenantId", "submissionId");

-- CreateIndex
CREATE INDEX "submission_authors_userId_idx" ON "submission_authors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_authors_submissionId_authorOrder_key" ON "submission_authors"("submissionId", "authorOrder");

-- CreateIndex
CREATE INDEX "submission_files_tenantId_submissionId_isCurrent_idx" ON "submission_files"("tenantId", "submissionId", "isCurrent");

-- CreateIndex
CREATE INDEX "submission_files_checksum_idx" ON "submission_files"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "submission_files_submissionId_kind_version_key" ON "submission_files"("submissionId", "kind", "version");

-- CreateIndex
CREATE INDEX "review_assignments_tenantId_reviewerId_status_idx" ON "review_assignments"("tenantId", "reviewerId", "status");

-- CreateIndex
CREATE INDEX "review_assignments_submissionId_status_idx" ON "review_assignments"("submissionId", "status");

-- CreateIndex
CREATE INDEX "review_assignments_dueAt_idx" ON "review_assignments"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "review_assignments_submissionId_reviewerId_key" ON "review_assignments"("submissionId", "reviewerId");

-- CreateIndex
CREATE INDEX "reviews_tenantId_reviewerId_status_idx" ON "reviews"("tenantId", "reviewerId", "status");

-- CreateIndex
CREATE INDEX "reviews_submissionId_status_idx" ON "reviews"("submissionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_submissionId_reviewerId_key" ON "reviews"("submissionId", "reviewerId");

-- CreateIndex
CREATE INDEX "review_conflicts_tenantId_submissionId_idx" ON "review_conflicts"("tenantId", "submissionId");

-- CreateIndex
CREATE INDEX "review_conflicts_userId_idx" ON "review_conflicts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "review_conflicts_submissionId_userId_type_key" ON "review_conflicts"("submissionId", "userId", "type");

-- CreateIndex
CREATE INDEX "card_templates_tenantId_eventId_rarity_idx" ON "card_templates"("tenantId", "eventId", "rarity");

-- CreateIndex
CREATE INDEX "card_templates_tenantId_trigger_isActive_idx" ON "card_templates"("tenantId", "trigger", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "card_templates_tenantId_slug_key" ON "card_templates"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "user_cards_tenantId_userId_grantedAt_idx" ON "user_cards"("tenantId", "userId", "grantedAt");

-- CreateIndex
CREATE INDEX "user_cards_cardTemplateId_idx" ON "user_cards"("cardTemplateId");

-- CreateIndex
CREATE INDEX "user_cards_userId_isPinned_idx" ON "user_cards"("userId", "isPinned");

-- CreateIndex
CREATE UNIQUE INDEX "user_cards_tenantId_userId_cardTemplateId_isFoil_key" ON "user_cards"("tenantId", "userId", "cardTemplateId", "isFoil");

-- CreateIndex
CREATE INDEX "user_xp_profiles_tenantId_totalXp_idx" ON "user_xp_profiles"("tenantId", "totalXp");

-- CreateIndex
CREATE INDEX "user_xp_profiles_tenantId_level_idx" ON "user_xp_profiles"("tenantId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "user_xp_profiles_tenantId_userId_key" ON "user_xp_profiles"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "xp_transactions_idempotencyKey_key" ON "xp_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "xp_transactions_tenantId_userId_createdAt_idx" ON "xp_transactions"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "xp_transactions_tenantId_eventId_source_idx" ON "xp_transactions"("tenantId", "eventId", "source");

-- CreateIndex
CREATE INDEX "xp_transactions_userId_source_idx" ON "xp_transactions"("userId", "source");

-- CreateIndex
CREATE INDEX "task_definitions_tenantId_eventId_isActive_idx" ON "task_definitions"("tenantId", "eventId", "isActive");

-- CreateIndex
CREATE INDEX "task_definitions_tenantId_trigger_idx" ON "task_definitions"("tenantId", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "task_definitions_tenantId_slug_key" ON "task_definitions"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "user_task_progress_tenantId_userId_status_idx" ON "user_task_progress"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "user_task_progress_taskDefinitionId_status_idx" ON "user_task_progress"("taskDefinitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_task_progress_tenantId_userId_taskDefinitionId_periodK_key" ON "user_task_progress"("tenantId", "userId", "taskDefinitionId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_validationCode_key" ON "certificates"("validationCode");

-- CreateIndex
CREATE INDEX "certificates_tenantId_eventId_status_idx" ON "certificates"("tenantId", "eventId", "status");

-- CreateIndex
CREATE INDEX "certificates_tenantId_userId_status_idx" ON "certificates"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "certificates_validationCode_idx" ON "certificates"("validationCode");

-- CreateIndex
CREATE INDEX "certificates_status_createdAt_idx" ON "certificates"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_tenantId_userId_eventId_activityId_kind_key" ON "certificates"("tenantId", "userId", "eventId", "activityId", "kind");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenant_profiles" ADD CONSTRAINT "user_tenant_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenant_profiles" ADD CONSTRAINT "user_tenant_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_speakers" ADD CONSTRAINT "activity_speakers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_speakers" ADD CONSTRAINT "activity_speakers_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_pages" ADD CONSTRAINT "event_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_pages" ADD CONSTRAINT "event_pages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_blocks" ADD CONSTRAINT "page_blocks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_blocks" ADD CONSTRAINT "page_blocks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "event_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_tiers" ADD CONSTRAINT "sponsor_tiers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsor_tiers" ADD CONSTRAINT "sponsor_tiers_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "sponsor_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "tracks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_authors" ADD CONSTRAINT "submission_authors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_authors" ADD CONSTRAINT "submission_authors_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_authors" ADD CONSTRAINT "submission_authors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "review_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_conflicts" ADD CONSTRAINT "review_conflicts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_conflicts" ADD CONSTRAINT "review_conflicts_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_cardTemplateId_fkey" FOREIGN KEY ("cardTemplateId") REFERENCES "card_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cards" ADD CONSTRAINT "user_cards_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_xp_profiles" ADD CONSTRAINT "user_xp_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_xp_profiles" ADD CONSTRAINT "user_xp_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_definitions" ADD CONSTRAINT "task_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_definitions" ADD CONSTRAINT "task_definitions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_definitions" ADD CONSTRAINT "task_definitions_rewardCardTemplateId_fkey" FOREIGN KEY ("rewardCardTemplateId") REFERENCES "card_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_task_progress" ADD CONSTRAINT "user_task_progress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_task_progress" ADD CONSTRAINT "user_task_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_task_progress" ADD CONSTRAINT "user_task_progress_taskDefinitionId_fkey" FOREIGN KEY ("taskDefinitionId") REFERENCES "task_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
