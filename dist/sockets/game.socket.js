"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupGameWebSocket = setupGameWebSocket;
const client_1 = require("@prisma/client");
const gameQueue_service_1 = require("../services/gameQueue.service");
const prisma = new client_1.PrismaClient();
const boardSessions = {};
function createEmptyBoard(rows = 7, cols = 7) {
    const board = Array.from({ length: rows }, () => Array(cols).fill(""));
    board[3][3] = "X";
    return board;
}
function getValidMoves(board, currentColor, session) {
    const validMoves = [];
    const allPlayersMoved = session.players.every(player => session.firstTurnMoves.has(player.userId));
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
    const seen = new Set();
    const directions = [
        [-1, 0], [0, -1], [0, 1], [1, 0],
    ];
    for (let y = 0; y < board.length; y++) {
        for (let x = 0; x < board[y].length; x++) {
            if (board[y][x] === currentColor) {
                for (const [dy, dx] of directions) {
                    const ny = y + dy;
                    const nx = x + dx;
                    if (ny >= 0 && ny < board.length &&
                        nx >= 0 && nx < board[0].length &&
                        board[ny][nx] === "") {
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
function setupGameWebSocket(io) {
    const gameNamespace = io.of("/ws/game");
    // Queue view namespace - can be accessed from any route
    const queueViewNamespace = io.of("/ws/queue-view");
    queueViewNamespace.on("connection", (socket) => {
        console.log("👀 Queue viewer connected");
        socket.emit("QUEUE_STATE", gameQueue_service_1.gameQueueService.getQueueState());
        socket.on("REQUEST_QUEUE_STATE", () => {
            socket.emit("QUEUE_STATE", gameQueue_service_1.gameQueueService.getQueueState());
        });
    });
    gameQueue_service_1.gameQueueService.setQueueViewNamespace(queueViewNamespace);
    // NEW: Bot move handler
    function handleBotMove(sessionId, session) {
        const currentPlayer = session.players[session.currentTurn];
        if (!currentPlayer.isBot) {
            return; // Not a bot, skip
        }
        console.log(`🤖 Bot ${currentPlayer.username} (${currentPlayer.userId}) is making a move`);
        const botColor = gameQueue_service_1.gameQueueService.playerColors.get(currentPlayer.userId);
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
        const allPlayersMoved = session.players.every(player => session.firstTurnMoves.has(player.userId));
        // Find next valid player
        let foundValidPlayer = false;
        let attempts = 0;
        const maxAttempts = session.players.length;
        while (!foundValidPlayer && attempts < maxAttempts) {
            session.currentTurn = (session.currentTurn + 1) % session.players.length;
            attempts++;
            const nextPlayer = session.players[session.currentTurn];
            const nextColor = gameQueue_service_1.gameQueueService.playerColors.get(nextPlayer.userId) || "";
            const nextValidMoves = getValidMoves(session.board, nextColor, session);
            if (nextValidMoves.length > 0) {
                foundValidPlayer = true;
                console.log(`✅ Found valid next player: ${nextPlayer.userId} with ${nextValidMoves.length} moves`);
            }
            else {
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
    async function handleForceEndRound(sessionId, session) {
        const { board, players } = session;
        // Calculate current round scores
        const playerTileCounts = {};
        for (const row of board) {
            for (const cell of row) {
                const player = players.find(p => gameQueue_service_1.gameQueueService.playerColors.get(p.userId) === cell);
                if (player) {
                    playerTileCounts[player.userId] = (playerTileCounts[player.userId] || 0) + 1;
                }
            }
        }
        // UPDATE CUMULATIVE SCORES FOR EACH PLAYER
        session.players.forEach(player => {
            const roundScore = playerTileCounts[player.userId] || 0;
            player.cumulativeScore = (player.cumulativeScore || 0) + roundScore;
            console.log(`📊 Player ${player.userId} - Round ${session.round} score: ${roundScore}, Cumulative: ${player.cumulativeScore}`);
        });
        const entries = Object.entries(playerTileCounts);
        if (entries.length === 0)
            return;
        const maxScore = Math.max(...entries.map(([_, count]) => count));
        const topPlayers = entries
            .filter(([_, count]) => count === maxScore)
            .map(([id]) => parseInt(id));
        let roundWinner;
        const tied = topPlayers.length > 1;
        if (tied) {
            roundWinner = topPlayers[Math.floor(Math.random() * topPlayers.length)];
        }
        else {
            roundWinner = topPlayers[0];
        }
        console.log(`🏁 Round ${session.round} winner: Player ${roundWinner}`);
        session.roundWinners.push(roundWinner);
        gameNamespace.to(sessionId.toString()).emit("ROUND_OVER", {
            round: session.round,
            winnerId: roundWinner,
            tied,
            sessionId: sessionId
        });
        if (session.round >= 3) {
            const winCounts = {};
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
            // Calculate final rankings using CUMULATIVE SCORES
            const finalRankings = session.players.map(player => {
                const cumulativeScore = player.cumulativeScore || 0; // USE CUMULATIVE
                const roundWins = session.roundWinners.filter(id => id === player.userId).length;
                return {
                    userId: player.userId,
                    username: player.username || `Player${player.userId}`,
                    color: gameQueue_service_1.gameQueueService.playerColors.get(player.userId),
                    score: cumulativeScore, // THIS IS NOW CUMULATIVE
                    roundWins,
                    isBot: player.isBot || false
                };
            }).sort((a, b) => b.score - a.score);
            console.log(`📊 Final Rankings with Cumulative Scores:`, finalRankings);
            // Emit match results to all players AND spectators
            gameNamespace.emit("MATCH_RESULTS", {
                winnerId: gameWinner,
                rankings: finalRankings,
                gameDuration: Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
            });
            // Only emit winner decision prompt if winner is NOT a bot
            const winnerPlayer = session.players.find(p => p.userId === gameWinner);
            if (winnerPlayer && !winnerPlayer.isBot) {
                const winnerSocket = gameQueue_service_1.gameQueueService.socketConnections.get(gameWinner);
                if (winnerSocket) {
                    winnerSocket.emit("WINNER_DECISION_REQUIRED", {
                        timeoutSeconds: 10
                    });
                }
                const winnerColor = gameQueue_service_1.gameQueueService.playerColors.get(gameWinner);
                if (winnerColor) {
                    gameQueue_service_1.gameQueueService.setWinnerPriority(gameWinner, winnerColor);
                }
            }
            session.status = "ENDED";
            session.endedAt = new Date();
            // Clean up players from game
            session.players.forEach(player => {
                if (!player.isBot) {
                    gameQueue_service_1.gameQueueService.playersInGame.delete(player.userId);
                }
            });
            // Wait for winner decision (10 seconds) - only if winner is not a bot
            setTimeout(async () => {
                if (winnerPlayer && !winnerPlayer.isBot) {
                    if (gameQueue_service_1.gameQueueService.hasWinnerPriority(gameWinner)) {
                        console.log(`⏰ Winner ${gameWinner} timed out - removing priority`);
                        gameQueue_service_1.gameQueueService.clearWinnerPriority(gameWinner);
                    }
                }
                // Reset session - RESET CUMULATIVE SCORES TOO
                session.round = 1;
                session.board = createEmptyBoard();
                session.currentTurn = 0;
                session.firstTurnMoves.clear();
                session.roundWinners = [];
                session.players.forEach(p => p.cumulativeScore = 0); // RESET SCORES
            }, 10000);
        }
        else {
            // Move to next round
            session.round += 1;
            session.board = createEmptyBoard();
            session.currentTurn = Math.floor(Math.random() * session.players.length);
            session.firstTurnMoves.clear();
            emitGameState(sessionId);
        }
    }
    gameNamespace.on("connection", (socket) => {
        gameQueue_service_1.gameQueueService.onColorSelect(socket);
        const userIdStr = socket.handshake.auth.userId || socket.handshake.query.userId;
        const userId = parseInt(userIdStr, 10);
        if (!userId || isNaN(userId)) {
            console.log("❌ Invalid userId, disconnecting socket");
            socket.disconnect();
            return;
        }
        console.log(`🎮 Game socket connected: userId=${userId}`);
        socket.emit("CONNECTED", { userId });
        (async () => {
            if (gameQueue_service_1.gameQueueService.isUserInQueue(userId)) {
                gameQueue_service_1.gameQueueService.socketConnections.set(userId, socket);
                const userColor = gameQueue_service_1.gameQueueService.playerColors.get(userId);
                const { position, total } = await gameQueue_service_1.gameQueueService.getQueueStatus(userId);
                socket.emit("AUTO_RECONNECTED_TO_QUEUE", {
                    color: userColor,
                    position,
                    total,
                    message: "You were reconnected to the queue"
                });
                socket.emit("QUEUE_STATE", gameQueue_service_1.gameQueueService.getQueueState());
            }
        })();
        socket.emit("QUEUE_STATE", gameQueue_service_1.gameQueueService.getQueueState());
        socket.on("JOIN_QUEUE", async (data) => {
            const { userId, color } = data;
            try {
                if (!['red', 'brown', 'blue', 'green'].includes(color)) {
                    socket.emit("ERROR", { message: 'Invalid color' });
                    return;
                }
                await gameQueue_service_1.gameQueueService.addToQueue(userId, color, socket);
                socket.emit("COLOR_CONFIRMED", { color });
                if (gameQueue_service_1.gameQueueService.isUserInQueue(userId)) {
                    const { position, total } = await gameQueue_service_1.gameQueueService.getQueueStatus(userId);
                    const queueState = gameQueue_service_1.gameQueueService.getQueueState();
                    socket.emit("QUEUE_UPDATE", {
                        position,
                        total,
                        colorQueueCounts: queueState.colorQueueCounts,
                        canStartGame: queueState.canStartGame
                    });
                }
            }
            catch (err) {
                socket.emit("ERROR", { message: err.message });
            }
        });
        // Manual game start handler
        socket.on("START_GAME_MANUALLY", async () => {
            console.log(`🎮 Manual game start requested by user ${userId}`);
            // Check if user is in queue
            if (!gameQueue_service_1.gameQueueService.isUserInQueue(userId)) {
                socket.emit("ERROR", { message: "You must be in queue to start a game" });
                return;
            }
            // Check if there's at least one player in queue
            const queueState = gameQueue_service_1.gameQueueService.getQueueState();
            if (!queueState.canStartGame) {
                socket.emit("ERROR", { message: "No players in queue" });
                return;
            }
            try {
                const result = await gameQueue_service_1.gameQueueService.startGameManually();
                console.log(`✅ Game started manually:`, result);
                const { gameSessionId, players } = result;
                const numericSessionId = Number(gameSessionId);
                if (isNaN(numericSessionId)) {
                    console.error("❌ Invalid gameSessionId received:", gameSessionId);
                    socket.emit("ERROR", { message: "Failed to create game session" });
                    return;
                }
                console.log("✅ Starting game with session ID:", numericSessionId, "type:", typeof numericSessionId);
                const boardSession = {
                    id: numericSessionId,
                    board: createEmptyBoard(),
                    players: players.map((p) => ({
                        userId: p.userId,
                        socketId: p.isBot ? `bot-${p.userId}` : gameQueue_service_1.gameQueueService.socketConnections.get(p.userId)?.id || '',
                        isBot: p.isBot,
                        username: p.username,
                        cumulativeScore: 0
                    })),
                    currentTurn: Math.floor(Math.random() * players.length),
                    status: "IN_PROGRESS",
                    startedAt: new Date(),
                    endedAt: null,
                    firstTurnMoves: new Set(),
                    round: 1,
                    roundWinners: []
                };
                boardSessions[numericSessionId] = boardSession;
                console.log("✅ boardSessions after insert:", Object.keys(boardSessions));
                // Set player colors for all players (including bots)
                players.forEach((p) => {
                    gameQueue_service_1.gameQueueService.playerColors.set(p.userId, p.color);
                    // Join human players to the Socket.IO room
                    if (!p.isBot) {
                        const playerSocket = gameQueue_service_1.gameQueueService.socketConnections.get(p.userId);
                        if (playerSocket) {
                            playerSocket.join(numericSessionId.toString());
                            // Emit with explicit numeric ID
                            playerSocket.emit('GAME_STARTED', {
                                gameSessionId: numericSessionId,
                                players: players.map((pl) => ({
                                    id: pl.userId,
                                    username: pl.username,
                                    color: pl.color,
                                    isBot: pl.isBot
                                }))
                            });
                            console.log(`✅ Emitted GAME_STARTED to player ${p.userId} with sessionId:`, numericSessionId);
                        }
                    }
                });
                // Emit initial game state
                emitGameState(numericSessionId);
            }
            catch (error) {
                console.error("Error starting game manually:", error);
                socket.emit("ERROR", { message: "Failed to start game" });
            }
        });
        socket.on("WINNER_DECISION", async ({ userId, wantNext }) => {
            console.log(`🏆 Winner ${userId} decided: ${wantNext ? 'YES' : 'NO'}`);
            if (wantNext) {
                const priority = gameQueue_service_1.gameQueueService.winnerPriority.get(userId);
                if (priority) {
                    const { color } = priority;
                    const socket = gameQueue_service_1.gameQueueService.socketConnections.get(userId);
                    if (socket) {
                        await gameQueue_service_1.gameQueueService.addToQueue(userId, color, socket);
                        socket.emit("WINNER_JOINED_QUEUE", { color, hasPriority: true });
                    }
                }
            }
            else {
                gameQueue_service_1.gameQueueService.clearWinnerPriority(userId);
            }
            gameNamespace.emit("WINNER_DECIDED", { userId, wantNext });
        });
        socket.on("LEAVE_QUEUE", async () => {
            await gameQueue_service_1.gameQueueService.removeFromQueue(userId);
            socket.emit("QUEUE_LEFT");
        });
        socket.on("REQUEST_QUEUE_STATE", () => {
            socket.emit("QUEUE_STATE", gameQueue_service_1.gameQueueService.getQueueState());
        });
        socket.on("RECONNECT_TO_QUEUE", async ({ userId }) => {
            console.log(`🔄 User ${userId} reconnecting to queue`);
            if (gameQueue_service_1.gameQueueService.isUserInQueue(userId)) {
                gameQueue_service_1.gameQueueService.socketConnections.set(userId, socket);
                const { position, total } = await gameQueue_service_1.gameQueueService.getQueueStatus(userId);
                socket.emit("QUEUE_UPDATE", {
                    position,
                    total,
                    colorQueueCounts: gameQueue_service_1.gameQueueService.getQueueState().colorQueueCounts,
                    canStartGame: gameQueue_service_1.gameQueueService.getQueueState().canStartGame
                });
                socket.emit("RECONNECTED_TO_QUEUE", {
                    color: gameQueue_service_1.gameQueueService.playerColors.get(userId),
                    position
                });
            }
        });
        socket.on("PLAYER_MOVE", async ({ sessionId, row, col, color }) => {
            const numericSessionId = Number(sessionId);
            const session = boardSessions[numericSessionId];
            if (!session) {
                console.log(`⚠️ Session ${sessionId} not found in boardSessions. Available:`, Object.keys(boardSessions));
                return;
            }
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
                const allPlayersMoved = session.players.every(player => session.firstTurnMoves.has(player.userId));
                let foundValidPlayer = false;
                let attempts = 0;
                const maxAttempts = session.players.length;
                while (!foundValidPlayer && attempts < maxAttempts) {
                    session.currentTurn = (session.currentTurn + 1) % session.players.length;
                    attempts++;
                    const nextUserId = session.players[session.currentTurn].userId;
                    const nextColor = gameQueue_service_1.gameQueueService.playerColors.get(nextUserId) || "";
                    const validMoves = getValidMoves(session.board, nextColor, session);
                    if (validMoves.length > 0) {
                        foundValidPlayer = true;
                        console.log(`✅ Found valid player: ${nextUserId} with ${validMoves.length} moves`);
                    }
                    else {
                        console.log(`⏭️ Skipping Player ${nextUserId} — no valid moves`);
                    }
                }
                if (!foundValidPlayer && allPlayersMoved) {
                    console.log("🏁 No players have valid moves - forcing round end");
                    await handleForceEndRound(numericSessionId, session);
                    return;
                }
                else if (!foundValidPlayer && !allPlayersMoved) {
                    console.error("⚠️ ERROR: No valid player found during first moves phase!");
                    return;
                }
                emitGameState(numericSessionId);
            }
        });
        socket.on("disconnect", async () => {
            console.log(`🚪 Game socket disconnected: userId=${userId}`);
        });
        socket.on("WINNER_NEXT_MATCH", async ({ userId, color, wantNext }) => {
            if (wantNext) {
                gameQueue_service_1.gameQueueService.winnersWantingNext.add(userId);
                console.log(`Winner ${userId} wants next game with color ${color}`);
            }
            else {
                gameQueue_service_1.gameQueueService.winnersWantingNext.delete(userId);
                console.log(`Winner ${userId} doesn't want next game`);
                return;
            }
            gameNamespace.emit("WINNER_DECIDED");
            gameQueue_service_1.gameQueueService.playerColors.set(userId, color);
            socket.emit("COLOR_CONFIRMED", { color });
            if (!gameQueue_service_1.gameQueueService.isUserInQueue(userId)) {
                try {
                    await gameQueue_service_1.gameQueueService.addToQueue(userId, color, socket);
                }
                catch (error) {
                    console.log(`Error adding winner ${userId} to queue:`, error);
                    const { position, total } = await gameQueue_service_1.gameQueueService.getQueueStatus(userId);
                    socket.emit("QUEUE_UPDATE", {
                        position,
                        total,
                        colorQueueCounts: gameQueue_service_1.gameQueueService.getQueueState().colorQueueCounts,
                        canStartGame: gameQueue_service_1.gameQueueService.getQueueState().canStartGame
                    });
                    return;
                }
            }
            else {
                console.log(`Winner ${userId} already in queue, updating status only`);
            }
            const { position, total } = await gameQueue_service_1.gameQueueService.getQueueStatus(userId);
            socket.emit("QUEUE_UPDATE", {
                position,
                total,
                colorQueueCounts: gameQueue_service_1.gameQueueService.getQueueState().colorQueueCounts,
                canStartGame: gameQueue_service_1.gameQueueService.getQueueState().canStartGame
            });
        });
        socket.on("forceEndRound", async ({ sessionId }) => {
            const numericSessionId = Number(sessionId);
            const session = boardSessions[numericSessionId];
            if (!session)
                return;
            await handleForceEndRound(numericSessionId, session);
        });
        socket.on("REQUEST_SPECTATOR_VIEW", ({ userId }) => {
            console.log(`User ${userId} requesting spectator view`);
            const activeSession = Object.values(boardSessions).find(session => session.status === "IN_PROGRESS");
            if (activeSession) {
                const currentUserId = activeSession.players[activeSession.currentTurn].userId;
                const currentPlayer = activeSession.players[activeSession.currentTurn];
                socket.emit("SPECTATOR_GAME_STATE", {
                    board: activeSession.board,
                    currentTurnIndex: activeSession.currentTurn,
                    currentPlayer: {
                        id: currentUserId,
                        username: currentPlayer.username || `Player${currentUserId}`,
                        color: gameQueue_service_1.gameQueueService.playerColors.get(currentUserId),
                        isBot: currentPlayer.isBot || false
                    },
                    players: activeSession.players.map(p => ({
                        id: p.userId,
                        username: p.username || `Player${p.userId}`,
                        color: gameQueue_service_1.gameQueueService.playerColors.get(p.userId),
                        isBot: p.isBot || false
                    })),
                    round: activeSession.round,
                    hasEnded: activeSession.status === "ENDED"
                });
            }
            else {
                socket.emit("NO_ACTIVE_GAME");
            }
        });
    });
    setInterval(() => {
        gameQueue_service_1.gameQueueService.cleanupStaleConnections();
    }, 90000);
    function emitGameState(sessionId) {
        const session = boardSessions[sessionId];
        if (!session)
            return;
        console.log("📤 Emitting new gameState to all players", {
            currentTurn: session.currentTurn,
            board: session.board,
        });
        const currentPlayer = session.players[session.currentTurn];
        const currentUserId = currentPlayer.userId;
        const currentColor = gameQueue_service_1.gameQueueService.playerColors.get(currentUserId);
        const validMoves = getValidMoves(session.board, currentColor || "", session);
        console.log(`🔍 Valid moves for Player ${currentUserId}:`, validMoves);
        const gameStateData = {
            board: session.board,
            currentTurnIndex: session.currentTurn,
            players: session.players.map((p) => ({
                id: p.userId,
                username: p.username || `Player${p.userId}`,
                color: gameQueue_service_1.gameQueueService.playerColors.get(p.userId) || null,
                isBot: p.isBot || false,
                cumulativeScore: p.cumulativeScore || 0
            })),
            validMoves,
            round: session.round,
        };
        // Send regular gameState to active human players only
        session.players.forEach((player) => {
            if (!player.isBot) {
                gameNamespace.to(player.socketId).emit("gameState", gameStateData);
            }
        });
        // Get active player socket IDs to exclude them from spectator broadcast
        const activePlayerSocketIds = new Set(session.players.filter(p => !p.isBot).map(p => p.socketId));
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
