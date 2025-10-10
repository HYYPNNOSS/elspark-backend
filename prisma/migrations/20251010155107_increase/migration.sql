-- DropForeignKey
ALTER TABLE `GameStats` DROP FOREIGN KEY `GameStats_userId_fkey`;

-- DropForeignKey
ALTER TABLE `Notification` DROP FOREIGN KEY `Notification_userId_fkey`;

-- DropForeignKey
ALTER TABLE `PlayerInGame` DROP FOREIGN KEY `PlayerInGame_userId_fkey`;

-- DropIndex
DROP INDEX `GameStats_userId_fkey` ON `GameStats`;

-- DropIndex
DROP INDEX `Notification_userId_fkey` ON `Notification`;

-- DropIndex
DROP INDEX `PlayerInGame_userId_fkey` ON `PlayerInGame`;

-- AddForeignKey
ALTER TABLE `GameStats` ADD CONSTRAINT `GameStats_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlayerInGame` ADD CONSTRAINT `PlayerInGame_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
