-- Step 1: Drop foreign key constraints first
ALTER TABLE `PlayerInGame` DROP FOREIGN KEY `PlayerInGame_gameSessionId_fkey`;
ALTER TABLE `BotInGame` DROP FOREIGN KEY `BotInGame_gameSessionId_fkey`;

-- Step 2: Drop the dependent tables
DROP TABLE IF EXISTS `PlayerInGame`;
DROP TABLE IF EXISTS `BotInGame`;

-- Step 3: Drop GameSession table
DROP TABLE IF EXISTS `GameSession`;

-- Step 4: Recreate GameSession with Int ID
CREATE TABLE `GameSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('WAITING', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED') NOT NULL DEFAULT 'WAITING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `winnerId` INTEGER NULL,
    `boardState` JSON NULL,
    `currentTurn` INTEGER NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 5: Recreate PlayerInGame
CREATE TABLE `PlayerInGame` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gameSessionId` INTEGER NOT NULL,
    `profileId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PlayerInGame_gameSessionId_profileId_key`(`gameSessionId`, `profileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 6: Recreate BotInGame
CREATE TABLE `BotInGame` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gameSessionId` INTEGER NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `BotInGame_gameSessionId_botId_key`(`gameSessionId`, `botId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Step 7: Add foreign keys back
ALTER TABLE `PlayerInGame` ADD CONSTRAINT `PlayerInGame_gameSessionId_fkey` 
    FOREIGN KEY (`gameSessionId`) REFERENCES `GameSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PlayerInGame` ADD CONSTRAINT `PlayerInGame_profileId_fkey` 
    FOREIGN KEY (`profileId`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `BotInGame` ADD CONSTRAINT `BotInGame_gameSessionId_fkey` 
    FOREIGN KEY (`gameSessionId`) REFERENCES `GameSession`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;