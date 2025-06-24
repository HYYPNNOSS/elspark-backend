-- AlterTable
ALTER TABLE `GameSession` ADD COLUMN `boardState` JSON NULL,
    ADD COLUMN `currentTurn` INTEGER NULL;
