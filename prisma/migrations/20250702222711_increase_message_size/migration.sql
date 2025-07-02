-- AlterTable
ALTER TABLE `ai_messages` ADD COLUMN `sessionId` VARCHAR(191) NULL,
    MODIFY `message` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `bio` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ai_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `botId` INTEGER NOT NULL,
    `duration` INTEGER NOT NULL,
    `startTime` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endTime` DATETIME(3) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_sessions` ADD CONSTRAINT `ai_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
