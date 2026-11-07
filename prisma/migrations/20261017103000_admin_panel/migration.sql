-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MODERATOR';
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- AlterEnum
ALTER TYPE "Status" ADD VALUE 'HIDDEN';
ALTER TYPE "Status" ADD VALUE 'INFO_REQUESTED';

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "assigneeId" TEXT;

-- AlterTable
ALTER TABLE "PlatformConfig" ADD COLUMN     "announcement" TEXT,
ADD COLUMN     "maxAttachmentBytes" INTEGER NOT NULL DEFAULT 5242880,
ADD COLUMN     "maxAttachments" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "readOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "siteDescription" TEXT NOT NULL DEFAULT 'Discover businesses through customer experiences, transparent grades, and optional supporting evidence. Every review matters.',
ADD COLUMN     "siteTitle" TEXT NOT NULL DEFAULT 'Review Matters — Real Reviews. Clear Grades.';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "appealNote" TEXT,
ADD COLUMN     "appealedAt" TIMESTAMP(3),
ADD COLUMN     "assigneeId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdminNote" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "recipient" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNote_targetType_targetId_createdAt_idx" ON "AdminNote"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailLog_createdAt_idx" ON "EmailLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Claim_assigneeId_idx" ON "Claim"("assigneeId");

-- CreateIndex
CREATE INDEX "Report_assigneeId_idx" ON "Report"("assigneeId");

-- CreateIndex
CREATE INDEX "Review_appealedAt_idx" ON "Review"("appealedAt");

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
