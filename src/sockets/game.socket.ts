import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import { gameQueueService } from "../services/gameQueue.service";

const prisma = new PrismaClient();

// const playerColors = ["red", "blue", "green", "yellow"];
// const playerColors: string[] = [];

interface InMemoryGameSession {
  id: string;
  board: string[][];
  players: { userId: number; socketId: string }[];
  currentTurn: number;
  status: string;
  startedAt: Date;
  endedAt?: Date | null;
  firstTurnMoves: Set<number>;
  round: number; 
  roundWinners: number[];
  nextGamePlayers: { userId: number; color: string }[];

}

const boardSessions: Record<string, InMemoryGameSession> = {};

function createEmptyBoard(rows = 7, cols = 7): string[][] {
  const board = Array.from({ length: rows }, () => Array(cols).fill(""));
  // Block x:3 y:3 (center) so no one can claim it
  board[3][3] = "X"; // Use "X" to indicate blocked/unclaimable
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
    // Restrict first move to tiles around (3,3)
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

  // Standard move logic after first turn
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


// setInterval(() => {
  
//       console.log('🔍 === QUEUE DEBUG STATE ===');
//       console.log('Queue:', gameQueueService.queue);
//       console.log('Player Colors:', Array.from(gameQueueService.playerColors.entries()));
//       console.log('Socket Connections:', Array.from(gameQueueService.socketConnections.keys()));
//       console.log('Players In Game:', Array.from(gameQueueService.playersInGame));
//       console.log('Next Game Queue:', gameQueueService.nextgamequeue);
//       console.log('Next Players Colors:', Array.from(gameQueueService.nextplayersColors.entries()));
//       console.log('Winners Wanting Next:', Array.from(gameQueueService.winnersWantingNext));
//       console.log('=========================');
// }, 2000);






export function setupGameWebSocket(io: Server) {
  const gameNamespace = io.of("/ws/game");

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

    socket.on("JOIN_QUEUE", async (data) => {
      console.log("Received JOIN_QUEUE event:", data);
      const { userId, color } = data;
    
      try {
        // Check if color is already taken before queuing
        const takenColors = new Set(
          gameQueueService.queue.map(id => gameQueueService.playerColors.get(id)).filter(Boolean)
        );
    
        if (takenColors.has(color)) {
          gameQueueService.nextgamequeue.push(userId);
          gameQueueService.nextplayersColors.set(userId, color);
          gameQueueService.socketConnections.set(userId, socket);

    
          socket.emit("COLOR_TAKEN", { color });
          console.log(`User ${userId} added to nextgamequeue due to duplicate color.`);
          return;
        }
    
        // CHANGE: Set color BEFORE adding to queue
        gameQueueService.playerColors.set(userId, color);
        
        await gameQueueService.addToQueue(userId, socket);
        
        // Color was already set above, just confirm it
        socket.emit("COLOR_CONFIRMED", { color });
    
        const { position, total } = await gameQueueService.getQueueStatus(userId);
        socket.emit("QUEUE_UPDATE", {
          position,
          total,
          takenColors: Array.from(gameQueueService.playerColors.values())
        });
    
      } catch (err: any) {
        socket.emit("ERROR", { message: err.message });
      }
    });

    socket.on("LEAVE_QUEUE", async () => {
      await gameQueueService.removeFromQueue(userId);
      socket.emit("QUEUE_LEFT");
    });

    socket.on("PLAYER_MOVE", ({ sessionId, row, col, color }) => {
      
      const session = boardSessions[sessionId];
      if (!session) return;
    
      const playerIndex = session.players.findIndex((p) => p.userId === userId);
    
      console.log(`📥 Move: userId=${userId}, turn=${session.currentTurn}, playerIndex=${playerIndex}`);
    
      if (playerIndex !== session.currentTurn) {
        console.log("⛔ Not this player's turn");
        return;
      }
    
      if (session.board[row][col] === "") {
        // Here, store the player's color in the board
        session.board[row][col] = color;
        if (!session.firstTurnMoves.has(userId)) {
          session.firstTurnMoves.add(userId);
        }
        for (let i = 0; i < session.players.length; i++) {
          session.currentTurn = (session.currentTurn + 1) % session.players.length;
        
          const nextUserId = session.players[session.currentTurn].userId;
          const nextColor = gameQueueService.playerColors.get(nextUserId) || "";
        
          const validMoves = getValidMoves(session.board, nextColor, session);
          if (validMoves.length > 0) {
            break; // Found a player with valid moves
          } else {
            console.log(`⏭️ Skipping Player ${nextUserId} — no valid moves`);
          }
        }
        const currentUserId = session.players[session.currentTurn].userId;
        const currentColor = gameQueueService.playerColors.get(currentUserId) || "";
        const remainingMoves = getValidMoves(session.board, currentColor, session);

        if (remainingMoves.length === 0) {
          console.log("❌ No players have valid moves. Game may be stuck or over.");

        }
        console.log(`✅ Move accepted: (${row}, ${col}) by Player ${userId}`);
        
        emitGameState(sessionId);
      } else {
        console.log(`❌ Cell already filled: (${row}, ${col})`);
      }
    });
    

    socket.on("disconnect", async () => {
      console.log(`🚪 Game socket disconnected: userId=${userId}`);
      if (!gameQueueService.playersInGame.has(userId)) {
        await gameQueueService.removeFromQueue(userId);
      }
    });

    socket.on("WINNER_NEXT_MATCH", async ({ userId, color, wantNext }) => {
      if (wantNext) {
        // CHANGE: Use Set instead of boolean
        gameQueueService.winnersWantingNext.add(userId);
        console.log(`Winner ${userId} wants next game`);
      } else {
        gameQueueService.winnersWantingNext.delete(userId);
        console.log(`Winner ${userId} doesn't want next game`);
        return; // Exit early if they don't want next game
      }
      gameNamespace.emit("WINNER_DECIDED");
      
      // Set the color preference
      gameQueueService.playerColors.set(userId, color);
      socket.emit("COLOR_CONFIRMED", { color });
    
      // FIX: Check if user is already in queue before adding
      if (!gameQueueService.queue.includes(userId)) {
        try {
          await gameQueueService.addToQueue(userId, socket);
        } catch (error) {
          console.log(`Error adding winner ${userId} to queue:`, error);
          // If they're already in queue, just update their position info
          const { position, total } = await gameQueueService.getQueueStatus(userId);
          socket.emit("QUEUE_UPDATE", {
            position,
            total,
            takenColors: Array.from(gameQueueService.playerColors.values())
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
        takenColors: Array.from(gameQueueService.playerColors.values())
      });
    });
    

    socket.on("forceEndRound", async ({ sessionId }) => {
      const session = boardSessions[sessionId];
      if (!session) return;
    
      const { board, players } = session;
    
      // Calculate scores and determine winner (existing logic)
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
        // Game is ending - determine final winner
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
        // console.log( gameQueueService.socketConnections.get(players.userId))
        console.log("session.id");

        console.log(session.id);
        console.log("session.id");

    
        gameNamespace.emit("GAME_DONE", { winnerId: gameWinner });
        gameNamespace.emit("NO_ACTIVE_GAME");

        session.status = "ENDED";
        session.endedAt = new Date();
    
        // FIX: Clear all current players from the queue first
        session.players.forEach(player => {
          gameQueueService.playersInGame.delete(player.userId);
          // Remove from queue if they're in it
          const queueIndex = gameQueueService.queue.indexOf(player.userId);
          if (queueIndex !== -1) {
            gameQueueService.queue.splice(queueIndex, 1);
          }
        });
    
        // CHANGE: Prepare next game players BEFORE cleaning up colors
        const eligibleNextGamePlayers = [
          ...gameQueueService.nextgamequeue.map(userId => {
            const color = gameQueueService.nextplayersColors.get(userId);
            return { userId, color };
          }),
          // Include winner if they want next game
          ...(gameQueueService.winnersWantingNext.has(gameWinner) 
              ? [{ userId: gameWinner, color: gameQueueService.playerColors.get(gameWinner)! }] 
              : []
          )
        ];
    
        // CHANGE: Clean up colors AFTER determining next game players
        for (const [userId] of gameQueueService.playerColors) {
          const shouldKeep =
            gameQueueService.nextgamequeue.includes(userId) ||
            gameQueueService.winnersWantingNext.has(userId);
    
          if (!shouldKeep) {
            gameQueueService.playerColors.delete(userId);
          }
        }
    
        // Process next game players
        if (eligibleNextGamePlayers.length > 0) {
          console.log("Processing eligible players for next game");
          
          for (const { userId, color } of eligibleNextGamePlayers) {
            const socket = gameQueueService.socketConnections.get(userId);
            
            if (socket && color) {
              try {
                gameQueueService.playerColors.set(userId, color);
                // FIX: Only add to queue if not already in it
                if (!gameQueueService.queue.includes(userId)) {
                  await gameQueueService.addToQueue(userId, socket);
                }
              } catch (error) {
                console.log(`Error adding user ${userId} to queue:`, error);
              }
            } else {
              console.log(`No socket or color for user ${userId}`);
              // FIX: Only add if not already in queue
              if (!gameQueueService.queue.includes(userId) && color) {
                gameQueueService.queue.push(userId);
                gameQueueService.playerColors.set(userId, color);
              }
            }
          }
          
          // Clean up next game tracking
          gameQueueService.nextgamequeue = [];
          gameQueueService.nextplayersColors.clear();
          gameQueueService.winnersWantingNext.clear();
          
          if (gameQueueService.queue.length >= 4) {
            console.log("🎮 Attempting to start next game...");
            await gameQueueService.tryStartGame();
          }
        }
    
        // Reset session for potential reuse
        session.round = 1;
        session.board = createEmptyBoard();
        session.currentTurn = 0;
        session.firstTurnMoves.clear();
        session.roundWinners = [];
    
      } else {
        // Continue to next round
        session.round += 1;
        session.board = createEmptyBoard();
        session.currentTurn = 0;
        session.firstTurnMoves.clear();
    
        emitGameState(sessionId);
      }
    });

    socket.on("REQUEST_SPECTATOR_VIEW", ({ userId }) => {
      console.log(`User ${userId} requesting spectator view`);
      
      // Find any active game session
      const activeSession = Object.values(boardSessions).find(session => 
        session.status === "IN_PROGRESS"
      );
      
      if (activeSession) {
        const currentUserId = activeSession.players[activeSession.currentTurn].userId;
        const currentPlayer = {
          id: currentUserId,
          username: `Player${currentUserId}`,
          color: gameQueueService.playerColors.get(currentUserId)
        };
        
        socket.emit("SPECTATOR_GAME_STATE", {
          board: activeSession.board,
          currentTurnIndex: activeSession.currentTurn,
          currentPlayer,
          players: activeSession.players.map(p => ({
            id: p.userId,
            username: `Player${p.userId}`,
            color: gameQueueService.playerColors.get(p.userId)
          })),
          round: activeSession.round,
          hasEnded: activeSession.status === "ENDED"
        });
      } else {
        socket.emit("NO_ACTIVE_GAME");
      }
    });
    
  });

  

  
  gameQueueService.startGameSession = async function (selectedPlayers) {
    const players = selectedPlayers || this["queue"].splice(0, 4);
  
    players.forEach((playerId) => {
      const timer = this["queueTimers"].get(playerId);
      if (timer) clearTimeout(timer);
      this["queueTimers"].delete(playerId);
    });
  
    players.forEach(pid => {
      this.playersInGame.add(pid);
    });

    

    const gameSession = await prisma.gameSession.create({
      data: {
        status: "IN_PROGRESS",
        startedAt: new Date(),
        players: {
          create: players.map((userId) => ({
            profile: { connect: { id: userId } },
          })),
        },
      },
      include: {
        players: { include: { profile: true } },
      },
    });
  
    const sockets = players.map((id) => this["socketConnections"].get(id)!);
  
    const boardSession: InMemoryGameSession = {
      id: gameSession.id,
      board: createEmptyBoard(),
      players: players.map((userId, i) => ({
        userId,
        socketId: sockets[i].id,
      })),
      currentTurn: 0,
      status: "IN_PROGRESS",
      startedAt: gameSession.startedAt ?? new Date(),
      endedAt: null,
      firstTurnMoves: new Set(),
      round: 1, 
      roundWinners: [], 
      nextGamePlayers: []
    };
  
    boardSessions[gameSession.id] = boardSession;
  
    await prisma.profile.updateMany({
      where: { id: { in: players } },
      data: { looking: false, isonrand: true },
    });
  
    players.forEach((userId, i) => {
      const socket = this["socketConnections"].get(userId);
      if (socket) {
        socket.emit("GAME_STARTED", {
          gameSessionId: gameSession.id,
          players: players.map((id, idx) => ({
            id,
            username: `Player${id}`,
            color: gameQueueService.playerColors.get(id) || null
          })),
        });
      }
      
      // CHANGE: Don't delete socket connections here, let service handle it
      // this["socketConnections"].delete(userId); // REMOVE THIS LINE
    });
  
    emitGameState(gameSession.id);
  
    // CHANGE: Remove this line - let service handle queue clearing
    // this["queue"] = this["queue"].filter(uid => !players.includes(uid)); // REMOVE THIS LINE
  };


  setInterval(() => {
    gameQueueService.cleanupStaleConnections();
  }, 90000);

  // function emitGameState(sessionId: string) {
  //   const session = boardSessions[sessionId];
  //   if (!session) return;
  
  //   console.log("📤 Emitting new gameState to all players", {
  //     currentTurn: session.currentTurn,
  //     board: session.board,
  //   });
  
  //   const currentUserId = session.players[session.currentTurn].userId;
  //   const currentColor = gameQueueService.playerColors.get(currentUserId);
  
  //   const validMoves = getValidMoves(session.board, currentColor || "", session);
  
  //   console.log(`🔍 Valid moves for Player ${currentUserId}:`, validMoves);
  
  //   session.players.forEach(({ socketId }) => {
  //     gameNamespace.to(socketId).emit("gameState", {
  //       board: session.board,
  //       currentTurnIndex: session.currentTurn,
  //       players: session.players.map((p) => ({
  //         id: p.userId,
  //         username: `Player${p.userId}`,
  //         color: gameQueueService.playerColors.get(p.userId) || null,
  //       })),
  //       validMoves,
  //     });
  //   });
  // }  

  function emitGameState(sessionId: string) {
    const session = boardSessions[sessionId];
    if (!session) return;
  
    console.log("📤 Emitting new gameState to all players", {
      currentTurn: session.currentTurn,
      board: session.board,
    });
  
    const currentUserId = session.players[session.currentTurn].userId;
    const currentColor = gameQueueService.playerColors.get(currentUserId);
    const validMoves = getValidMoves(session.board, currentColor || "", session);
  
    console.log(`🔍 Valid moves for Player ${currentUserId}:`, validMoves);
  
    const gameStateData = {
      board: session.board,
      currentTurnIndex: session.currentTurn,
      players: session.players.map((p) => ({
        id: p.userId,
        username: `Player${p.userId}`,
        color: gameQueueService.playerColors.get(p.userId) || null,
      })),
      validMoves,
    };
  
    // Emit to players
    session.players.forEach(({ socketId }) => {
      gameNamespace.to(socketId).emit("gameState", gameStateData);
    });
  
    // Emit to all spectators (broadcast to all connected sockets)
    const spectatorData = {
      ...gameStateData,
      currentPlayer: {
        id: currentUserId,
        username: `Player${currentUserId}`,
        color: currentColor
      },
      round: session.round,
      hasEnded: session.status === "ENDED"
    };
    
    gameNamespace.emit("SPECTATOR_GAME_STATE", spectatorData);
  }
}
