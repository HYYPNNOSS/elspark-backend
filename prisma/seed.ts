import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Update all existing users with no profile picture
  await prisma.user.updateMany({
    where: { profilePicture: "/uploads/profiles/profile-default.png" },
    data: { profilePicture: "/uploads/profiles/profile-default.jpg" },
  });

  console.log("✅ Default profile pictures applied!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
