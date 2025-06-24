/*
  Warnings:

  - You are about to drop the column `mainOwnerId` on the `posts` table. All the data in the column will be lost.
  - You are about to drop the column `videoUrl` on the `posts` table. All the data in the column will be lost.
  - You are about to drop the `_PostSubowners` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `comments` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `authorId` to the `posts` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `_PostSubowners` DROP FOREIGN KEY `_PostSubowners_A_fkey`;

-- DropForeignKey
ALTER TABLE `_PostSubowners` DROP FOREIGN KEY `_PostSubowners_B_fkey`;

-- DropForeignKey
ALTER TABLE `comments` DROP FOREIGN KEY `comments_authorId_fkey`;

-- DropForeignKey
ALTER TABLE `comments` DROP FOREIGN KEY `comments_parentId_fkey`;

-- DropForeignKey
ALTER TABLE `comments` DROP FOREIGN KEY `comments_postId_fkey`;

-- DropForeignKey
ALTER TABLE `posts` DROP FOREIGN KEY `posts_mainOwnerId_fkey`;

-- DropIndex
DROP INDEX `posts_mainOwnerId_fkey` ON `posts`;

-- AlterTable
ALTER TABLE `posts` DROP COLUMN `mainOwnerId`,
    DROP COLUMN `videoUrl`,
    ADD COLUMN `authorId` INTEGER NOT NULL;

-- DropTable
DROP TABLE `_PostSubowners`;

-- DropTable
DROP TABLE `comments`;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
