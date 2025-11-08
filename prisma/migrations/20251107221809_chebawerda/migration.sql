-- AlterTable
ALTER TABLE `posts` ADD COLUMN `deletedAt` DATETIME(3) NULL,
    ADD COLUMN `isAnonymous` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `originalAuthorId` INTEGER NULL;
