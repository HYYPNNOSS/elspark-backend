import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { gameQueueService } from "../services/gameQueue.service";

const prisma = new PrismaClient();

interface InMemoryGameSession {
  id: string;
  board: string[][];
  players: { 
    userId: number; 
    socketId: string;
    isBot?: boolean;
    username?: string;
  }[];
  currentTurn: number;
  status: string;
  startedAt: Date;
  endedAt?: Date | null;
  firstTurnMoves: Set<number>;
  round: number; 
  roundWinners: number[];
}

const boardSessions: Record<string, InMemoryGameSession> = {};

function createEmptyBoard(rows = 7, cols = 7): string[][] {
  const board = Array.from({ length: rows }, () => Array(cols).fill(""));
  board[3][3] = "X";
  return board;
}

function getValidMoves(
  board: string[][],
  currentColor: string,
  session: InMemoryGameSession
): { x: number; y: number }[] {
  const validMoves: { x: number; y: number }[] = [];

  const allPlayersMoved = session.players.every(player =>
    session.firstTurnMoves.has(player.userId)
  );

  if (!allPlayersMoved && !session.firstTurnMoves.has(session.players[session.currentTurn].userId)) {
    const startingTiles = [
      { x: 2, y: 3 },
      { x: 4, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 4 },
    ];

    for (const { x, y } of startingTiles) {
      if (board[y][x] === "") {
        validMoves.push({ x, y });
      }
    }

    console.log("🟢 First move allowed around (3,3):", validMoves);
    return validMoves;
  }

  const seen = new Set<string>();
  const directions = [
    [-1, 0], [0, -1], [0, 1], [1, 0],
  ];

  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] === currentColor) {
        for (const [dy, dx] of directions) {
          const ny = y + dy;
          const nx = x + dx;

          if (
            ny >= 0 && ny < board.length &&
            nx >= 0 && nx < board[0].length &&
            board[ny][nx] === ""
          ) {
            const key = `${nx},${ny}`;
            if (!seen.has(key)) {
              seen.add(key);
              validMoves.push({ x: nx, y: ny });
            }
          }
        }
      }
    }
  }

  return validMoves;
}

export function setupGameWebSocket(io: Server) {
  const gameNamespace = io.of("/ws/game");

  // Queue view namespace - can be accessed from any route
  const queueViewNamespace = io.of("/ws/queue-view");

  queueViewNamespace.on("connection", (socket: Socket) => {
    console.log("👀 Queue viewer connected");
    
    socket.emit("QUEUE_STATE", gameQueueService.getQueueState());
    
    socket.on("REQUEST_QUEUE_STATE", () => {
      socket.emit("QUEUE_STATE", gameQueueService.getQueueState());
    });
  });

  gameQueueService.setQueueViewNamespace(queueViewNamespace);

  // NEW: Bot move handler
  function handleBotMove(sessionId: string, session: InMemoryGameSession) {
    const currentPlayer = session.players[session.currentTurn];
    
    if (!currentPlayer.isBot) {
      return; // Not a bot, skip
    }
    
    console.log(`🤖 Bot ${currentPlayer.username} (${currentPlayer.userId}) is making a move`);
    
    const botColor = gameQueueService.playerColors.get(currentPlayer.userId);
    if (!botColor) {
      console.error(`❌ No color found for bot ${currentPlayer.userId}`);
      return;
    }
    
    const validMoves = getValidMoves(session.board, botColor, session);
    
    if (validMoves.length === 0) {
      console.log(`🤖 Bot has no valid moves, skipping turn`);
      // Move to next player
      session.currentTurn = (session.currentTurn + 1) % session.players.length;
      emitGameState(sessionId);
      return;
    }
    
    // Bot picks a random valid move
    const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
    
    console.log(`🤖 Bot ${currentPlayer.username} placing at (${randomMove.x}, ${randomMove.y})`);
    
    // Make the move
    session.board[randomMove.y][randomMove.x] = botColor;
    
    if (!session.firstTurnMoves.has(currentPlayer.userId)) {
      session.firstTurnMoves.add(currentPlayer.userId);
    }
    
    const allPlayersMoved = session.players.every(player =>
      session.firstTurnMoves.has(player.userId)
    );
    
    // Find next valid player
    let foundValidPlayer = false;
    let attempts = 0;
    const maxAttempts = session.players.length;
    
    while (!foundValidPlayer && attempts < maxAttempts) {
      session.currentTurn = (session.currentTurn + 1) % session.players.length;
      attempts++;
      
      const nextPlayer = session.players[session.currentTurn];
      const nextColor = gameQueueService.playerColors.get(nextPlayer.userId) || "";
      
      const nextValidMoves = getValidMoves(session.board, nextColor, session);
      
      if (nextValidMoves.length > 0) {
        foundValidPlayer = true;
        console.log(`✅ Found valid next player: ${nextPlayer.userId} with ${nextValidMoves.length} moves`);
      } else {
        console.log(`⏭️ Skipping Player ${nextPlayer.userId} — no valid moves`);
      }
    }
    
    if (!foundValidPlayer && allPlayersMoved) {
      console.log("🏁 No players have valid moves - forcing round end");
      handleForceEndRound(sessionId, session);
      return;
    }
    
    emitGameState(sessionId);
    
    // If next player is also a bot, trigger their move after a delay
    setTimeout(() => {
      const nextPlayer = session.players[session.currentTurn];
      if (nextPlayer.isBot) {
        handleBotMove(sessionId, session);
      }
    }, 1000); // 1 second delay for bot moves
  }

  async function handleForceEndRound(sessionId: string, session: InMemoryGameSession) {
    const { board, players } = session;
  
    const playerTileCounts: Record<number, number> = {};
    for (const row of board) {
      for (const cell of row) {
        const player = players.find(p => gameQueueService.playerColors.get(p.userId) === cell);
        if (player) {
          playerTileCounts[player.userId] = (playerTileCounts[player.userId] || 0) + 1;
        }
      }
    }
  
    const entries = Object.entries(playerTileCounts);
    if (entries.length === 0) return;
  
    const maxScore = Math.max(...entries.map(([_, count]) => count as number));
    const topPlayers = entries
      .filter(([_, count]) => count === maxScore)
      .map(([id]) => parseInt(id));
  
    let roundWinner: number;
    const tied = topPlayers.length > 1;
    if (tied) {
      roundWinner = topPlayers[Math.floor(Math.random() * topPlayers.length)];
    } else {
      roundWinner = topPlayers[0];
    }
  
    console.log(`🏁 Round ${session.round} winner: Player ${roundWinner}`);
    session.roundWinners.push(roundWinner);
  
    gameNamespace.to(session.id).emit("ROUND_OVER", {
      round: session.round,
      winnerId: roundWinner,
      tied,
    });
  
    if (session.round >= 3) {
      const winCounts: Record<number, number> = {};
      for (const id of session.roundWinners) {
        winCounts[id] = (winCounts[id] || 0) + 1;
      }
  
      const maxWins = Math.max(...Object.values(winCounts));
      const potentialWinners = Object.entries(winCounts)
        .filter(([_, wins]) => wins === maxWins)
        .map(([id]) => parseInt(id));
  
      const gameWinner = potentialWinners.length === 1
        ? potentialWinners[0]
        : potentialWinners[Math.floor(Math.random() * potentialWinners.length)];
  
      console.log(`🏆 Game over — Final winner: Player ${gameWinner}`);
  
      // Calculate final rankings
      const finalRankings = session.players.map(player => {
        const score = playerTileCounts[player.userId] || 0;
        const roundWins = session.roundWinners.filter(id => id === player.userId).length;
        return {
          userId: player.userId,
          username: player.username || `Player${player.userId}`,
          color: gameQueueService.playerColors.get(player.userId),
          score,
          roundWins,
          isBot: player.isBot || false
        };
      }).sort((a, b) => b.score - a.score);
  
      // Emit match results to all players AND spectators
      gameNamespace.emit("MATCH_RESULTS", {
        winnerId: gameWinner,
        rankings: finalRankings,
        gameDuration: Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
      });
  
      // Only emit winner decision prompt if winner is NOT a bot
      const winnerPlayer = session.players.find(p => p.userId === gameWinner);
      if (winnerPlayer && !winnerPlayer.isBot) {
        const winnerSocket = gameQueueService.socketConnections.get(gameWinner);
        if (winnerSocket) {
          winnerSocket.emit("WINNER_DECISION_REQUIRED", {
            timeoutSeconds: 10
          });
        }
  
        const winnerColor = gameQueueService.playerColors.get(gameWinner);
        if (winnerColor) {
          gameQueueService.setWinnerPriority(gameWinner, winnerColor);
        }
      }
  
      session.status = "ENDED";
      session.endedAt = new Date();
  
      // Clean up players from game
      session.players.forEach(player => {
        if (!player.isBot) {
          gameQueueService.playersInGame.delete(player.userId);
        }
      });
  
      // Wait for winner decision (10 seconds) - only if winner is not a bot
      setTimeout(async () => {
        if (winnerPlayer && !winnerPlayer.isBot) {
          if (gameQueueService.hasWinnerPriority(gameWinner)) {
            console.log(`⏰ Winner ${gameWinner} timed out - removing priority`);
            gameQueueService.clearWinnerPriority(gameWinner);
          }
        }
  
        // Reset session
        session.round = 1;
        session.board = createEmptyBoard();
        session.currentTurn = 0;
        session.firstTurnMoves.clear();
        session.roundWinners = [];
      }, 10000);
  
    } else {
      session.round += 1;
      session.board = createEmptyBoard();
      session.currentTurn = 0;
      session.firstTurnMoves.clear();
      emitGameState(sessionId);
    }
  }

  gameNamespace.on("connection", (socket: Socket) => {
    gameQueueService.onColorSelect(socket);
    const userIdStr = socket.handshake.auth.userId || socket.handshake.query.userId;
    const userId = parseInt(userIdStr as string, 10);

    if (!userId || isNaN(userId)) {
      console.log("❌ Invalid userId, disconnecting socket");
      socket.disconnect();
      return;
    }

    console.log(`🎮 Game socket connected: userId=${userId}`);
    socket.emit("CONNECTED", { userId });

    (async () => {
      if (gameQueueService.isUserInQueue(userId)) {
        gameQueueService.socketConnections.set(userId, socket);
        
        const userColor = gameQueueService.playerColors.get(userId);
        const { position, total } = await gameQueueService.getQueueStatus(userId);
        
        socket.emit("AUTO_RECONNECTED_TO_QUEUE", {
          color: userColor,
          position,
          total,
          message: "You were reconnected to the queue"
        });
        
        socket.emit("QUEUE_STATE", gameQueueService.getQueueState());
      }
    })();

    socket.emit("QUEUE_STATE", gameQueueService.getQueueState());

    socket.on("JOIN_QUEUE", async (data) => {
      const { userId, color } = data;
    
      try {
        if (!['red', 'brown', 'blue', 'green'].includes(color)) {
          socket.emit("ERROR", { message: 'Invalid color' });
          return;
        }
    
        await gameQueueService.addToQueue(userId, color, socket);
        
        socket.emit("COLOR_CONFIRMED", { color });
    
        if (gameQueueService.isUserInQueue(userId)) {
          const { position, total } = await gameQueueService.getQueueStatus(userId);
          const queueState = gameQueueService.getQueueState();
          
          socket.emit("QUEUE_UPDATE", {
            position,
            total,
            colorQueueCounts: queueState.colorQueueCounts,
            canStartGame: queueState.canStartGame
          });
        }
    
      } catch (err: any) {
        socket.emit("ERROR", { message: err.message });
      }
    });

    // NEW: Manual game start handler
    socket.on("START_GAME_MANUALLY", async () => {
      console.log(`🎮 Manual game start requested by user ${userId}`);
      
      // Check if user is in queue
      if (!gameQueueService.isUserInQueue(userId)) {
        socket.emit("ERROR", { message: "You must be in queue to start a game" });
        return;
      }
      
      // Check if there's at least one player in queue
      const queueState = gameQueueService.getQueueState();
      if (!queueState.canStartGame) {
        socket.emit("ERROR", { message: "No players in queue" });
        return;
      }
      
      try {
        const result = await gameQueueService.startGameManually();
        console.log(`✅ Game started manually:`, result);
        
        const { gameSessionId, players } = result;
        
        const boardSession: InMemoryGameSession = {
          id: gameSessionId,
          board: createEmptyBoard(),
          players: players.map((p: any) => ({
            userId: p.userId,
            socketId: p.isBot ? `bot-${p.userId}` : gameQueueService.socketConnections.get(p.userId)?.id || '',
            isBot: p.isBot,
            username: p.username
          })),
          currentTurn: 0,
          status: "IN_PROGRESS",
          startedAt: new Date(),
          endedAt: null,
          firstTurnMoves: new Set(),
          round: 1,
          roundWinners: []
        };
        
        boardSessions[gameSessionId] = boardSession;
        
        // Set player colors for all players (including bots)
        players.forEach((p: any) => {
          gameQueueService.playerColors.set(p.userId, p.color);
        });
        
        // Emit initial game state
        emitGameState(gameSessionId);
        
      } catch (error) {
        console.error("Error starting game manually:", error);
        socket.emit("ERROR", { message: "Failed to start game" });
      }
    });

    socket.on("WINNER_DECISION", async ({ userId, wantNext }) => {
      console.log(`🏆 Winner ${userId} decided: ${wantNext ? 'YES' : 'NO'}`);
    
      if (wantNext) {
        const priority = gameQueueService.winnerPriority.get(userId);
        if (priority) {
          const { color } = priority;
          const socket = gameQueueService.socketConnections.get(userId);
          
          if (socket) {
            await gameQueueService.addToQueue(userId, color, socket);
            socket.emit("WINNER_JOINED_QUEUE", { color, hasPriority: true });
          }
        }
      } else {
        gameQueueService.clearWinnerPriority(userId);
      }
    
      gameNamespace.emit("WINNER_DECIDED", { userId, wantNext });
    });

    socket.on("LEAVE_QUEUE", async () => {
      await gameQueueService.removeFromQueue(userId);
      socket.emit("QUEUE_LEFT");
    });

    socket.on("REQUEST_QUEUE_STATE", () => {
      socket.emit("QUEUE_STATE", gameQueueService.getQueueState());
    });

    socket.on("RECONNECT_TO_QUEUE", async ({ userId }) => {
      console.log(`🔄 User ${userId} reconnecting to queue`);
      
      if (gameQueueService.isUserInQueue(userId)) {
        gameQueueService.socketConnections.set(userId, socket);
        
        const { position, total } = await gameQueueService.getQueueStatus(userId);
        socket.emit("QUEUE_UPDATE", {
          position,
          total,
          colorQueueCounts: gameQueueService.getQueueState().colorQueueCounts,
          canStartGame: gameQueueService.getQueueState().canStartGame
        });
        
        socket.emit("RECONNECTED_TO_QUEUE", {
          color: gameQueueService.playerColors.get(userId),
          position
        });
      }
    });

    socket.on("PLAYER_MOVE", async ({ sessionId, row, col, color }) => {
      const session = boardSessions[sessionId];
      if (!session) return;
    
      const playerIndex = session.players.findIndex((p) => p.userId === userId);
    
      if (playerIndex !== session.currentTurn) {
        console.log("⛔ Not this player's turn");
        return;
      }
    
      if (session.board[row][col] === "") {
        session.board[row][col] = color;
        if (!session.firstTurnMoves.has(userId)) {
          session.firstTurnMoves.add(userId);
        }
        
        const allPlayersMoved = session.players.every(player =>
          session.firstTurnMoves.has(player.userId)
        );
    
        let foundValidPlayer = false;
        let attempts = 0;
        const maxAttempts = session.players.length;
    
        while (!foundValidPlayer && attempts < maxAttempts) {
          session.currentTurn = (session.currentTurn + 1) % session.players.length;
          attempts++;
    
          const nextUserId = session.players[session.currentTurn].userId;
          const nextColor = gameQueueService.playerColors.get(nextUserId) || "";
    
          const validMoves = getValidMoves(session.board, nextColor, session);
          
          if (validMoves.length > 0) {
            foundValidPlayer = true;
            console.log(`✅ Found valid player: ${nextUserId} with ${validMoves.length} moves`);
          } else {
            console.log(`⏭️ Skipping Player ${nextUserId} — no valid moves`);
          }
        }
    
        if (!foundValidPlayer && allPlayersMoved) {
          console.log("🏁 No players have valid moves - forcing round end");
          await handleForceEndRound(sessionId, session);
          return;
        } else if (!foundValidPlayer && !allPlayersMoved) {
          console.error("⚠️ ERROR: No valid player found during first moves phase!");
          return;
        }
    
        emitGameState(sessionId);
      }
    });

    socket.on("disconnect", async () => {
      console.log(`🚪 Game socket disconnected: userId=${userId}`);
    });

    socket.on("WINNER_NEXT_MATCH", async ({ userId, color, wantNext }) => {
      if (wantNext) {
        gameQueueService.winnersWantingNext.add(userId);
        console.log(`Winner ${userId} wants next game with color ${color}`);
      } else {
        gameQueueService.winnersWantingNext.delete(userId);
        console.log(`Winner ${userId} doesn't want next game`);
        return;
      }
      
      gameNamespace.emit("WINNER_DECIDED");
      
      gameQueueService.playerColors.set(userId, color);
      socket.emit("COLOR_CONFIRMED", { color });
    
      if (!gameQueueService.isUserInQueue(userId)) {
        try {
          await gameQueueService.addToQueue(userId, color, socket);
        } catch (error) {
          console.log(`Error adding winner ${userId} to queue:`, error);
          const { position, total } = await gameQueueService.getQueueStatus(userId);
          socket.emit("QUEUE_UPDATE", {
            position,
            total,
            colorQueueCounts: gameQueueService.getQueueState().colorQueueCounts,
            canStartGame: gameQueueService.getQueueState().canStartGame
          });
          return;
        }
      } else {
        console.log(`Winner ${userId} already in queue, updating status only`);
      }
    
      const { position, total } = await gameQueueService.getQueueStatus(userId);
      socket.emit("QUEUE_UPDATE", {
        position,
        total,
        colorQueueCounts: gameQueueService.getQueueState().colorQueueCounts,
        canStartGame: gameQueueService.getQueueState().canStartGame
      });
    });

    socket.on("forceEndRound", async ({ sessionId }) => {
      const session = boardSessions[sessionId];
      if (!session) return;
      
      await handleForceEndRound(sessionId, session);
    });

    socket.on("REQUEST_SPECTATOR_VIEW", ({ userId }) => {
      console.log(`User ${userId} requesting spectator view`);
      
      const activeSession = Object.values(boardSessions).find(session => 
        session.status === "IN_PROGRESS"
      );
      
      if (activeSession) {
        const currentUserId = activeSession.players[activeSession.currentTurn].userId;
        const currentPlayer = activeSession.players[activeSession.currentTurn];
        
        socket.emit("SPECTATOR_GAME_STATE", {
          board: activeSession.board,
          currentTurnIndex: activeSession.currentTurn,
          currentPlayer: {
            id: currentUserId,
            username: currentPlayer.username || `Player${currentUserId}`,
            color: gameQueueService.playerColors.get(currentUserId),
            isBot: currentPlayer.isBot || false
          },
          players: activeSession.players.map(p => ({
            id: p.userId,
            username: p.username || `Player${p.userId}`,
            color: gameQueueService.playerColors.get(p.userId),
            isBot: p.isBot || false
          })),
          round: activeSession.round,
          hasEnded: activeSession.status === "ENDED"
        });
      } else {
        socket.emit("NO_ACTIVE_GAME");
      }
    });
  });

  setInterval(() => {
    gameQueueService.cleanupStaleConnections();
  }, 90000);

  function emitGameState(sessionId: string) {
    const session = boardSessions[sessionId];
    if (!session) return;
  
    console.log("📤 Emitting new gameState to all players", {
      currentTurn: session.currentTurn,
      board: session.board,
    });
  
    const currentPlayer = session.players[session.currentTurn];
    const currentUserId = currentPlayer.userId;
    const currentColor = gameQueueService.playerColors.get(currentUserId);
    const validMoves = getValidMoves(session.board, currentColor || "", session);
  
    console.log(`🔍 Valid moves for Player ${currentUserId}:`, validMoves);
  
    const gameStateData = {
      board: session.board,
      currentTurnIndex: session.currentTurn,
      players: session.players.map((p) => ({
        id: p.userId,
        username: p.username || `Player${p.userId}`,
        color: gameQueueService.playerColors.get(p.userId) || null,
        isBot: p.isBot || false
      })),
      validMoves,
    };
  
    // Send regular gameState to active human players only
    session.players.forEach((player) => {
      if (!player.isBot) {
        gameNamespace.to(player.socketId).emit("gameState", gameStateData);
      }
    });
  
    // Get active player socket IDs to exclude them from spectator broadcast
    const activePlayerSocketIds = new Set(
      session.players.filter(p => !p.isBot).map(p => p.socketId)
    );
  
    const spectatorData = {
      ...gameStateData,
      currentPlayer: {
        id: currentUserId,
        username: currentPlayer.username || `Player${currentUserId}`,
        color: currentColor,
        isBot: currentPlayer.isBot || false
      },
      round: session.round,
      hasEnded: session.status === "ENDED"
    };
    
    // Broadcast to spectators ONLY (exclude active players)
    gameNamespace.sockets.forEach((socket) => {
      if (!activePlayerSocketIds.has(socket.id)) {
        socket.emit("SPECTATOR_GAME_STATE", spectatorData);
      }
    });
    
    // If current player is a bot, trigger bot move after a short delay
    if (currentPlayer.isBot) {
      setTimeout(() => {
        handleBotMove(sessionId, session);
      }, 1500); // 1.5 second delay before bot moves
    }
  }
}