/*
  Warnings:

  - You are about to alter the column `cyberCoins` on the `users` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Decimal(10,2)`.

*/
-- AlterTable
ALTER TABLE `users` MODIFY `cyberCoins` DECIMAL(10, 2) NOT NULL DEFAULT 5;
