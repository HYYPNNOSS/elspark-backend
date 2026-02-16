const { PrismaClient } = require('@prisma/client');
const readline = require('readline');

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function deleteVideosNotUploadedBy5() {
  try {
    // First, find all videos where uploaderId is NOT 5
    const videosToDelete = await prisma.elsparkVideo.findMany({
      where: {
        uploaderId: {
          not: 5
        }
      },
      select: {
        id: true,
        title: true,
        uploaderId: true,
        filename: true
      }
    });

    if (videosToDelete.length === 0) {
      console.log('✅ No videos found with uploaderId != 5. Nothing to delete!');
      await prisma.$disconnect();
      rl.close();
      return;
    }

    // Show what will be deleted
    console.log(`\n⚠️  Found ${videosToDelete.length} videos to delete:\n`);
    videosToDelete.forEach((video, index) => {
      console.log(`${index + 1}. ID: ${video.id}`);
      console.log(`   Title: ${video.title}`);
      console.log(`   Uploader ID: ${video.uploaderId}`);
      console.log(`   Filename: ${video.filename}\n`);
    });

    // Ask for confirmation
    rl.question('⚠️  Are you sure you want to DELETE all these videos? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes') {
        console.log('\n🗑️  Deleting videos...');
        
        // Delete all videos where uploaderId is NOT 5
        const result = await prisma.elsparkVideo.deleteMany({
          where: {
            uploaderId: {
              not: 5
            }
          }
        });

        console.log(`\n✅ Successfully deleted ${result.count} videos!`);
        console.log('✅ Related VideoOwnership and LiveTVQueue records were also deleted (cascade).');
      } else {
        console.log('\n❌ Deletion cancelled. No videos were deleted.');
      }

      await prisma.$disconnect();
      rl.close();
    });

  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    rl.close();
  }
}

// Run the function
deleteVideosNotUploadedBy5();
