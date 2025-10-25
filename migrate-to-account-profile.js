const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTableExists(tableName) {
  const result = await prisma.$queryRaw`
    SELECT COUNT(*) as count 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE() 
    AND table_name = ${tableName}
  `;
  return result[0].count > 0;
}

async function checkColumnExists(tableName, columnName) {
  const result = await prisma.$queryRaw`
    SELECT COUNT(*) as count 
    FROM information_schema.columns 
    WHERE table_schema = DATABASE() 
    AND table_name = ${tableName}
    AND column_name = ${columnName}
  `;
  return result[0].count > 0;
}

async function getColumnName(tableName, possibleNames) {
  for (const name of possibleNames) {
    if (await checkColumnExists(tableName, name)) {
      return name;
    }
  }
  return null;
}

async function dropAllForeignKeys(tableName, columnName) {
  const fkResult = await prisma.$queryRaw`
    SELECT CONSTRAINT_NAME 
    FROM information_schema.KEY_COLUMN_USAGE 
    WHERE TABLE_NAME = ${tableName}
    AND COLUMN_NAME = ${columnName}
    AND CONSTRAINT_SCHEMA = DATABASE()
    AND REFERENCED_TABLE_NAME IS NOT NULL
  `;
  
  for (const fk of fkResult) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tableName} DROP FOREIGN KEY ${fk.CONSTRAINT_NAME}`);
      console.log(`  Dropped FK ${fk.CONSTRAINT_NAME} from ${tableName}`);
    } catch (e) {
      console.log(`  FK ${fk.CONSTRAINT_NAME} already dropped or doesn't exist`);
    }
  }
}

async function cleanup() {
  console.log('🧹 Cleaning up partial migration...\n');
  
  try {
    // Drop all foreign keys that reference profiles
    const tablesWithProfileFK = [
      { table: 'Notification', column: 'profileId' },
      { table: 'GameStats', column: 'profileId' },
      { table: 'PlayerInGame', column: 'profileId' },
      { table: 'ai_messages', column: 'profileId' },
      { table: 'ai_sessions', column: 'profileId' },
      { table: 'posts', column: 'authorId' },
      { table: 'post_coowners', column: 'userId' },
      { table: 'post_collections', column: 'userId' },
      { table: 'comments', column: 'authorId' },
      { table: 'messages', column: 'senderId' },
      { table: 'messages', column: 'receiverId' },
      { table: 'friend_requests', column: 'senderId' },
      { table: 'friend_requests', column: 'receiverId' },
      { table: 'friendships', column: 'userId' },
      { table: 'friendships', column: 'friendId' },
      { table: 'follows', column: 'followerId' },
      { table: 'follows', column: 'followingId' },
      { table: 'chat_connections', column: 'user1Id' },
      { table: 'chat_connections', column: 'user2Id' },
    ];
    
    for (const { table, column } of tablesWithProfileFK) {
      if (await checkTableExists(table)) {
        await dropAllForeignKeys(table, column);
      }
    }
    
    // Drop foreign keys that reference accounts
    if (await checkTableExists('password_reset_tokens')) {
      await dropAllForeignKeys('password_reset_tokens', 'accountId');
      await dropAllForeignKeys('password_reset_tokens', 'userId');
    }
    
    if (await checkTableExists('coin_transactions')) {
      await dropAllForeignKeys('coin_transactions', 'accountId');
      await dropAllForeignKeys('coin_transactions', 'userId');
    }
    
    if (await checkTableExists('account_refresh_tokens')) {
      await dropAllForeignKeys('account_refresh_tokens', 'accountId');
    }
    
    if (await checkTableExists('profiles')) {
      await dropAllForeignKeys('profiles', 'accountId');
    }
    
    // Drop new tables
    if (await checkTableExists('account_refresh_tokens')) {
      await prisma.$executeRaw`DROP TABLE account_refresh_tokens`;
      console.log('  Dropped account_refresh_tokens');
    }
    
    if (await checkTableExists('profiles')) {
      await prisma.$executeRaw`DROP TABLE profiles`;
      console.log('  Dropped profiles');
    }
    
    if (await checkTableExists('accounts')) {
      await prisma.$executeRaw`DROP TABLE accounts`;
      console.log('  Dropped accounts');
    }
    
    // Remove profileId columns if they exist
    const tablesWithProfileId = [
      'Notification', 'GameStats', 'PlayerInGame', 
      'ai_messages', 'ai_sessions'
    ];
    
    for (const table of tablesWithProfileId) {
      if (await checkTableExists(table)) {
        if (await checkColumnExists(table, 'profileId')) {
          await prisma.$executeRawUnsafe(`ALTER TABLE ${table} DROP COLUMN profileId`);
          console.log(`  Removed profileId from ${table}`);
        }
      }
    }
    
    // Handle accountId columns - restore original state
    if (await checkTableExists('password_reset_tokens')) {
      if (await checkColumnExists('password_reset_tokens', 'accountId')) {
        await prisma.$executeRaw`ALTER TABLE password_reset_tokens DROP COLUMN accountId`;
        console.log('  Removed accountId from password_reset_tokens');
      }
      if (!(await checkColumnExists('password_reset_tokens', 'userId'))) {
        await prisma.$executeRaw`ALTER TABLE password_reset_tokens ADD COLUMN userId INTEGER NOT NULL`;
        console.log('  Restored userId to password_reset_tokens');
      }
    }
    
    if (await checkTableExists('coin_transactions')) {
      if (await checkColumnExists('coin_transactions', 'accountId')) {
        await prisma.$executeRaw`ALTER TABLE coin_transactions DROP COLUMN accountId`;
        console.log('  Removed accountId from coin_transactions');
      }
      if (!(await checkColumnExists('coin_transactions', 'userId'))) {
        await prisma.$executeRaw`ALTER TABLE coin_transactions ADD COLUMN userId INTEGER NOT NULL`;
        console.log('  Restored userId to coin_transactions');
      }
    }
    
    // Restore original foreign keys to users table
    console.log('  Restoring foreign keys to users table...');
    
    const restoreFKs = [
      { table: 'posts', column: 'authorId', fk: 'posts_authorId_fkey' },
      { table: 'post_coowners', column: 'userId', fk: 'post_coowners_userId_fkey' },
      { table: 'post_collections', column: 'userId', fk: 'post_collections_userId_fkey' },
      { table: 'comments', column: 'authorId', fk: 'comments_authorId_fkey' },
      { table: 'messages', column: 'senderId', fk: 'messages_senderId_fkey' },
      { table: 'messages', column: 'receiverId', fk: 'messages_receiverId_fkey' },
      { table: 'friend_requests', column: 'senderId', fk: 'friend_requests_senderId_fkey' },
      { table: 'friend_requests', column: 'receiverId', fk: 'friend_requests_receiverId_fkey' },
      { table: 'friendships', column: 'userId', fk: 'friendships_userId_fkey' },
      { table: 'friendships', column: 'friendId', fk: 'friendships_friendId_fkey' },
      { table: 'follows', column: 'followerId', fk: 'follows_followerId_fkey' },
      { table: 'follows', column: 'followingId', fk: 'follows_followingId_fkey' },
      { table: 'chat_connections', column: 'user1Id', fk: 'chat_connections_user1Id_fkey' },
      { table: 'chat_connections', column: 'user2Id', fk: 'chat_connections_user2Id_fkey' },
      { table: 'password_reset_tokens', column: 'userId', fk: 'password_reset_tokens_userId_fkey' },
      { table: 'coin_transactions', column: 'userId', fk: 'coin_transactions_userId_fkey' },
    ];
    
    for (const { table, column, fk } of restoreFKs) {
      if (await checkTableExists(table) && await checkColumnExists(table, column)) {
        try {
          await prisma.$executeRawUnsafe(
            `ALTER TABLE ${table} ADD CONSTRAINT ${fk} FOREIGN KEY (${column}) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`
          );
        } catch (e) {
          // FK might already exist
        }
      }
    }
    
    console.log('✅ Cleanup complete\n');
  } catch (error) {
    console.error('Error during cleanup:', error.message);
    throw error;
  }
}

async function migrate() {
  console.log('🚀 Starting migration from User to Account-Profile...\n');

  try {
    // Check if migration already completed
    if (await checkTableExists('accounts') && await checkTableExists('profiles')) {
      console.log('⚠️  Migration tables already exist!');
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question('Do you want to cleanup and restart? (yes/no): ', resolve);
      });
      readline.close();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('Migration cancelled.');
        return;
      }
      
      await cleanup();
    }

    // Step 1: Create accounts from users
    console.log('Step 1: Creating accounts...');
    await prisma.$executeRaw`
      CREATE TABLE accounts (
        id INTEGER NOT NULL AUTO_INCREMENT,
        email VARCHAR(191) NOT NULL,
        password VARCHAR(191) NOT NULL,
        cyberCoins DECIMAL(10, 2) NOT NULL DEFAULT 5,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL,
        UNIQUE INDEX accounts_email_key(email),
        PRIMARY KEY (id)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `;

    await prisma.$executeRaw`
      INSERT INTO accounts (id, email, password, cyberCoins, createdAt, updatedAt)
      SELECT id, email, password, cyberCoins, createdAt, updatedAt
      FROM users
    `;
    console.log('✅ Accounts created\n');

    // Step 2: Create profiles table
    console.log('Step 2: Creating profiles table...');
    await prisma.$executeRaw`
      CREATE TABLE profiles (
        id INTEGER NOT NULL AUTO_INCREMENT,
        accountId INTEGER NOT NULL,
        username VARCHAR(191) NOT NULL,
        profilePicture VARCHAR(191) NOT NULL DEFAULT '/uploads/profiles/profile-default.jpg',
        bio TEXT NULL,
        color VARCHAR(191) NULL,
        isActive BOOLEAN NOT NULL DEFAULT true,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt DATETIME(3) NOT NULL,
        online BOOLEAN NOT NULL DEFAULT false,
        isonrand BOOLEAN NOT NULL DEFAULT false,
        looking BOOLEAN NOT NULL DEFAULT false,
        isMooshi BOOLEAN NOT NULL DEFAULT false,
        isApproved BOOLEAN NOT NULL DEFAULT false,
        mooshiNumber INTEGER NULL,
        journal JSON NULL,
        mooshiConv JSON NULL,
        UNIQUE INDEX profiles_username_key(username),
        UNIQUE INDEX profiles_mooshiNumber_key(mooshiNumber),
        PRIMARY KEY (id)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `;

    await prisma.$executeRaw`
      INSERT INTO profiles (
        id, accountId, username, profilePicture, bio, color, 
        isActive, createdAt, updatedAt, online, isonrand, looking,
        isMooshi, isApproved, mooshiNumber, journal, mooshiConv
      )
      SELECT 
        id, id as accountId, username, profilePicture, bio, color,
        true as isActive, createdAt, updatedAt, online, isonrand, looking,
        isMooshi, isApproved, mooshiNumber, journal, mooshiConv
      FROM users
    `;

    await prisma.$executeRaw`
      ALTER TABLE profiles ADD CONSTRAINT profiles_accountId_fkey 
      FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    console.log('✅ Profiles created\n');

    // Step 3: Create account_refresh_tokens
    console.log('Step 3: Migrating refresh tokens...');
    await prisma.$executeRaw`
      CREATE TABLE account_refresh_tokens (
        id INTEGER NOT NULL AUTO_INCREMENT,
        token VARCHAR(191) NOT NULL,
        accountId INTEGER NOT NULL,
        profileId INTEGER NULL,
        expiresAt DATETIME(3) NOT NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE INDEX account_refresh_tokens_token_key(token),
        INDEX account_refresh_tokens_token_idx(token),
        PRIMARY KEY (id)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `;

    await prisma.$executeRaw`
      INSERT INTO account_refresh_tokens (id, token, accountId, profileId, expiresAt, createdAt)
      SELECT id, token, userId as accountId, userId as profileId, expiresAt, createdAt
      FROM refresh_tokens
    `;

    await prisma.$executeRaw`
      ALTER TABLE account_refresh_tokens ADD CONSTRAINT account_refresh_tokens_accountId_fkey 
      FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    console.log('✅ Refresh tokens migrated\n');

    // Step 4: Update password_reset_tokens
    console.log('Step 4: Updating password reset tokens...');
    
    // Drop existing FK first
    await dropAllForeignKeys('password_reset_tokens', 'userId');
    
    await prisma.$executeRaw`ALTER TABLE password_reset_tokens ADD COLUMN accountId INTEGER NULL`;
    await prisma.$executeRaw`UPDATE password_reset_tokens SET accountId = userId`;
    
    const orphanedPwdTokens = await prisma.$executeRaw`
      DELETE FROM password_reset_tokens 
      WHERE accountId NOT IN (SELECT id FROM accounts)
    `;
    if (orphanedPwdTokens > 0) {
      console.log(`  Removed ${orphanedPwdTokens} orphaned password reset tokens`);
    }
    
    await prisma.$executeRaw`ALTER TABLE password_reset_tokens MODIFY accountId INTEGER NOT NULL`;
    await prisma.$executeRaw`ALTER TABLE password_reset_tokens DROP COLUMN userId`;
    await prisma.$executeRaw`
      ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_accountId_fkey 
      FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    console.log('✅ Password reset tokens updated\n');

    // Step 5: Update coin_transactions
    console.log('Step 5: Updating coin transactions...');
    
    // Drop existing FK first
    await dropAllForeignKeys('coin_transactions', 'userId');
    
    await prisma.$executeRaw`ALTER TABLE coin_transactions ADD COLUMN accountId INTEGER NULL`;
    await prisma.$executeRaw`UPDATE coin_transactions SET accountId = userId`;
    
    const orphanedCoinTx = await prisma.$executeRaw`
      DELETE FROM coin_transactions 
      WHERE accountId NOT IN (SELECT id FROM accounts)
    `;
    if (orphanedCoinTx > 0) {
      console.log(`  Removed ${orphanedCoinTx} orphaned coin transactions`);
    }
    
    await prisma.$executeRaw`ALTER TABLE coin_transactions MODIFY accountId INTEGER NOT NULL`;
    await prisma.$executeRaw`ALTER TABLE coin_transactions DROP COLUMN userId`;
    await prisma.$executeRaw`
      ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_accountId_fkey 
      FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    console.log('✅ Coin transactions updated\n');

    // Step 6: Update Notification
    console.log('Step 6: Updating notifications...');
    const notifUserCol = await getColumnName('Notification', ['userId', 'profileId']);
    
    if (notifUserCol === 'userId') {
      // Drop FK first
      await dropAllForeignKeys('Notification', 'userId');
      
      // Add new column
      await prisma.$executeRaw`ALTER TABLE Notification ADD COLUMN profileId INTEGER NULL`;
      await prisma.$executeRaw`UPDATE Notification SET profileId = userId`;
      
      const orphanedNotifs = await prisma.$executeRaw`
        DELETE FROM Notification 
        WHERE profileId NOT IN (SELECT id FROM profiles)
      `;
      if (orphanedNotifs > 0) {
        console.log(`  Removed ${orphanedNotifs} orphaned notifications`);
      }
      
      await prisma.$executeRaw`ALTER TABLE Notification MODIFY profileId INTEGER NOT NULL`;
      await prisma.$executeRaw`ALTER TABLE Notification DROP COLUMN userId`;
      
      // Add FK constraint after column is created
      await prisma.$executeRaw`
        ALTER TABLE Notification ADD CONSTRAINT Notification_profileId_fkey 
        FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
      `;
    } else if (notifUserCol === 'profileId') {
      // Column already exists, just ensure FK exists
      const hasFk = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_NAME = 'Notification' 
        AND COLUMN_NAME = 'profileId' 
        AND CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `;
      
      if (hasFk[0].count === 0) {
        await prisma.$executeRaw`
          ALTER TABLE Notification ADD CONSTRAINT Notification_profileId_fkey 
          FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
        `;
      }
    }
    console.log('✅ Notifications updated\n');

    // Step 7: Update GameStats
    console.log('Step 7: Updating game stats...');
    const gameStatsUserCol = await getColumnName('GameStats', ['userId', 'profileId']);
    
    if (gameStatsUserCol === 'userId') {
      await dropAllForeignKeys('GameStats', 'userId');
      
      await prisma.$executeRaw`ALTER TABLE GameStats ADD COLUMN profileId INTEGER NULL`;
      await prisma.$executeRaw`UPDATE GameStats SET profileId = userId`;
      
      const orphanedStats = await prisma.$executeRaw`
        DELETE FROM GameStats 
        WHERE profileId NOT IN (SELECT id FROM profiles)
      `;
      if (orphanedStats > 0) {
        console.log(`  Removed ${orphanedStats} orphaned game stats`);
      }
      
      await prisma.$executeRaw`ALTER TABLE GameStats MODIFY profileId INTEGER NOT NULL`;
      await prisma.$executeRaw`ALTER TABLE GameStats DROP COLUMN userId`;
      
      await prisma.$executeRaw`
        ALTER TABLE GameStats ADD CONSTRAINT GameStats_profileId_fkey 
        FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
      `;
    } else if (gameStatsUserCol === 'profileId') {
      const hasFk = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_NAME = 'GameStats' 
        AND COLUMN_NAME = 'profileId' 
        AND CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `;
      
      if (hasFk[0].count === 0) {
        await prisma.$executeRaw`
          ALTER TABLE GameStats ADD CONSTRAINT GameStats_profileId_fkey 
          FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
        `;
      }
    }
    console.log('✅ Game stats updated\n');

    // Step 8: Update PlayerInGame
    console.log('Step 8: Updating player in game...');
    const playerUserCol = await getColumnName('PlayerInGame', ['userId', 'profileId']);
    
    if (playerUserCol === 'userId') {
      await dropAllForeignKeys('PlayerInGame', 'userId');
      
      // Drop unique index before column modification
      try {
        await prisma.$executeRaw`ALTER TABLE PlayerInGame DROP INDEX PlayerInGame_gameSessionId_userId_key`;
      } catch (e) {
        console.log('  Unique index already dropped or does not exist');
      }
      
      await prisma.$executeRaw`ALTER TABLE PlayerInGame ADD COLUMN profileId INTEGER NULL`;
      await prisma.$executeRaw`UPDATE PlayerInGame SET profileId = userId`;
      
      const orphanedPlayers = await prisma.$executeRaw`
        DELETE FROM PlayerInGame 
        WHERE profileId NOT IN (SELECT id FROM profiles)
      `;
      if (orphanedPlayers > 0) {
        console.log(`  Removed ${orphanedPlayers} orphaned player records`);
      }
      
      await prisma.$executeRaw`ALTER TABLE PlayerInGame MODIFY profileId INTEGER NOT NULL`;
      await prisma.$executeRaw`ALTER TABLE PlayerInGame DROP COLUMN userId`;
      
      await prisma.$executeRaw`
        ALTER TABLE PlayerInGame ADD CONSTRAINT PlayerInGame_profileId_fkey 
        FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
      `;
      
      // Add new unique index
      try {
        await prisma.$executeRaw`
          ALTER TABLE PlayerInGame ADD UNIQUE INDEX PlayerInGame_gameSessionId_profileId_key(gameSessionId, profileId)
        `;
      } catch (e) {
        console.log('  Unique index already exists');
      }
    } else if (playerUserCol === 'profileId') {
      const hasFk = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_NAME = 'PlayerInGame' 
        AND COLUMN_NAME = 'profileId' 
        AND CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `;
      
      if (hasFk[0].count === 0) {
        await prisma.$executeRaw`
          ALTER TABLE PlayerInGame ADD CONSTRAINT PlayerInGame_profileId_fkey 
          FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
        `;
      }
      
      // Ensure unique index exists
      try {
        await prisma.$executeRaw`
          ALTER TABLE PlayerInGame ADD UNIQUE INDEX PlayerInGame_gameSessionId_profileId_key(gameSessionId, profileId)
        `;
      } catch (e) {
        console.log('  Unique index already exists');
      }
    }
    console.log('✅ Player in game updated\n');

    // Step 9: Update ai_messages
    console.log('Step 9: Updating AI messages...');
    const aiMsgUserCol = await getColumnName('ai_messages', ['userId', 'profileId']);
    
    if (aiMsgUserCol === 'userId') {
      await dropAllForeignKeys('ai_messages', 'userId');
      
      await prisma.$executeRaw`ALTER TABLE ai_messages ADD COLUMN profileId INTEGER NULL`;
      await prisma.$executeRaw`UPDATE ai_messages SET profileId = userId`;
      
      const orphanedMsgs = await prisma.$executeRaw`
        DELETE FROM ai_messages 
        WHERE profileId NOT IN (SELECT id FROM profiles)
      `;
      if (orphanedMsgs > 0) {
        console.log(`  Removed ${orphanedMsgs} orphaned AI messages`);
      }
      
      await prisma.$executeRaw`ALTER TABLE ai_messages MODIFY profileId INTEGER NOT NULL`;
      await prisma.$executeRaw`ALTER TABLE ai_messages DROP COLUMN userId`;
      
      await prisma.$executeRaw`
        ALTER TABLE ai_messages ADD CONSTRAINT ai_messages_profileId_fkey 
        FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
      `;
    } else if (aiMsgUserCol === 'profileId') {
      const hasFk = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_NAME = 'ai_messages' 
        AND COLUMN_NAME = 'profileId' 
        AND CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `;
      
      if (hasFk[0].count === 0) {
        await prisma.$executeRaw`
          ALTER TABLE ai_messages ADD CONSTRAINT ai_messages_profileId_fkey 
          FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
        `;
      }
    }
    console.log('✅ AI messages updated\n');

    // Step 10: Update ai_sessions
    console.log('Step 10: Updating AI sessions...');
    const aiSessionUserCol = await getColumnName('ai_sessions', ['userId', 'profileId']);
    
    if (aiSessionUserCol === 'userId') {
      await dropAllForeignKeys('ai_sessions', 'userId');
      
      await prisma.$executeRaw`ALTER TABLE ai_sessions ADD COLUMN profileId INTEGER NULL`;
      await prisma.$executeRaw`UPDATE ai_sessions SET profileId = userId`;
      
      const orphanedSessions = await prisma.$executeRaw`
        DELETE FROM ai_sessions 
        WHERE profileId NOT IN (SELECT id FROM profiles)
      `;
      if (orphanedSessions > 0) {
        console.log(`  Removed ${orphanedSessions} orphaned AI sessions`);
      }
      
      await prisma.$executeRaw`ALTER TABLE ai_sessions MODIFY profileId INTEGER NOT NULL`;
      await prisma.$executeRaw`ALTER TABLE ai_sessions DROP COLUMN userId`;
      
      await prisma.$executeRaw`
        ALTER TABLE ai_sessions ADD CONSTRAINT ai_sessions_profileId_fkey 
        FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
      `;
    } else if (aiSessionUserCol === 'profileId') {
      const hasFk = await prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM information_schema.KEY_COLUMN_USAGE 
        WHERE TABLE_NAME = 'ai_sessions' 
        AND COLUMN_NAME = 'profileId' 
        AND CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      `;
      
      if (hasFk[0].count === 0) {
        await prisma.$executeRaw`
          ALTER TABLE ai_sessions ADD CONSTRAINT ai_sessions_profileId_fkey 
          FOREIGN KEY (profileId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
        `;
      }
    }
    console.log('✅ AI sessions updated\n');

    // Step 11: Update all relation foreign keys
    console.log('Step 11: Updating relation foreign keys...');
    
    // Posts
    await dropAllForeignKeys('posts', 'authorId');
    await prisma.$executeRaw`
      ALTER TABLE posts ADD CONSTRAINT posts_authorId_fkey 
      FOREIGN KEY (authorId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    
    // Post coowners
    await dropAllForeignKeys('post_coowners', 'userId');
    await prisma.$executeRaw`
      ALTER TABLE post_coowners ADD CONSTRAINT post_coowners_userId_fkey 
      FOREIGN KEY (userId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    
    // Post collections
    await dropAllForeignKeys('post_collections', 'userId');
    await prisma.$executeRaw`
      ALTER TABLE post_collections ADD CONSTRAINT post_collections_userId_fkey 
      FOREIGN KEY (userId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    
    // Comments
    await dropAllForeignKeys('comments', 'authorId');
    await prisma.$executeRaw`
      ALTER TABLE comments ADD CONSTRAINT comments_authorId_fkey 
      FOREIGN KEY (authorId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;

    // Messages
    await dropAllForeignKeys('messages', 'senderId');
    await dropAllForeignKeys('messages', 'receiverId');
    await prisma.$executeRaw`
      ALTER TABLE messages ADD CONSTRAINT messages_senderId_fkey 
      FOREIGN KEY (senderId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE messages ADD CONSTRAINT messages_receiverId_fkey 
      FOREIGN KEY (receiverId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;

    // Friend requests
    await dropAllForeignKeys('friend_requests', 'senderId');
    await dropAllForeignKeys('friend_requests', 'receiverId');
    await prisma.$executeRaw`
      ALTER TABLE friend_requests ADD CONSTRAINT friend_requests_senderId_fkey 
      FOREIGN KEY (senderId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE friend_requests ADD CONSTRAINT friend_requests_receiverId_fkey 
      FOREIGN KEY (receiverId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;

    // Friendships
    await dropAllForeignKeys('friendships', 'userId');
    await dropAllForeignKeys('friendships', 'friendId');
    await prisma.$executeRaw`
      ALTER TABLE friendships ADD CONSTRAINT friendships_userId_fkey 
      FOREIGN KEY (userId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE friendships ADD CONSTRAINT friendships_friendId_fkey 
      FOREIGN KEY (friendId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;

    // Follows
    await dropAllForeignKeys('follows', 'followerId');
    await dropAllForeignKeys('follows', 'followingId');
    await prisma.$executeRaw`
      ALTER TABLE follows ADD CONSTRAINT follows_followerId_fkey 
      FOREIGN KEY (followerId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE follows ADD CONSTRAINT follows_followingId_fkey 
      FOREIGN KEY (followingId) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;

    // Chat connections
    await dropAllForeignKeys('chat_connections', 'user1Id');
    await dropAllForeignKeys('chat_connections', 'user2Id');
    await prisma.$executeRaw`
      ALTER TABLE chat_connections ADD CONSTRAINT chat_connections_user1Id_fkey 
      FOREIGN KEY (user1Id) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;
    await prisma.$executeRaw`
      ALTER TABLE chat_connections ADD CONSTRAINT chat_connections_user2Id_fkey 
      FOREIGN KEY (user2Id) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE
    `;

    console.log('✅ All relations updated\n');

    // Step 12: Drop old tables
    console.log('Step 12: Dropping old tables...');
    await prisma.$executeRaw`DROP TABLE refresh_tokens`;
    await prisma.$executeRaw`DROP TABLE users`;
    console.log('✅ Old tables dropped\n');

    console.log('🎉 Migration completed successfully!\n');
    console.log('Next steps:');
    console.log('1. Update your schema.prisma to the new Account-Profile model');
    console.log('2. Run: npx prisma generate');
    console.log('3. Restart your application');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n⚠️  The database may be in an inconsistent state.');
    console.log('Run the script again - it will offer to cleanup and restart.');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrate();