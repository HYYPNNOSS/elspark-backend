-- AlterTable
ALTER TABLE `users` ADD COLUMN `isonrand` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `online` BOOLEAN NOT NULL DEFAULT false;
