/*
  Warnings:

  - Made the column `profilePicture` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `users` MODIFY `profilePicture` VARCHAR(191) NOT NULL DEFAULT '/uploads/profiles/profile-default.png';
