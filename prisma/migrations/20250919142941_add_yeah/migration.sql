/*
  Warnings:

  - You are about to drop the column `tittle` on the `posts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `posts` DROP COLUMN `tittle`,
    ADD COLUMN `title` VARCHAR(191) NULL;
