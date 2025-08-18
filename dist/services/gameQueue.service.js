"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gameQueueService = exports.GameQueueService = void 0;
// backend/src/services/gameQueue.service.ts
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const QUEUE_TIMEOUT_MS = 300000;
const PLAYERS_REQUIRED = 4;
class GameQueueService {
    constructor() {
        this.queue = [];
        this.nextgamequeue = [];
        this.queueTimers = new Map();
        this.socketConnections = new Map();
        this.activeSessions = new Map();
        this.playerColors = new Map();
        this.nextplayersColors = new Map();
        this.winnersWantingNext = new Set();
        this.playersInGame = new Set();
    }
    isUserInQueue(userId) {
        return this.queue.includes(userId);
    }
    async addToQueue(userId, socket) {
        this.socketConnections.set(userId, socket);
        console.log("=================socket=================");
        console.log(exports.gameQueueService.socketConnections.keys());
        console.log("=================socket=================");
        if (this.queue.includes(userId)) {
            console.log(`⚠️ User ${userId} already in queue, socket connection updated`);
            return;
        }
        // Clear any existing timers
        const existingTimer = this.queueTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.queueTimers.delete(userId);
        }
        const isNextGame = this.nextgamequeue.includes(userId);
        if (isNextGame) {
            const storedColor = this.nextplayersColors.get(userId);
            if (storedColor) {
                this.playerColors.set(userId, storedColor);
            }
            // Add to front for priority
            this.queue.unshift(userId);
            this.nextgamequeue = this.nextgamequeue.filter(id => id !== userId);
            this.nextplayersColors.delete(userId);
            console.log(`🔄 Next game player ${userId} added to front of queue`);
        }
        else {
            this.queue.push(userId);
            console.log(`➕ Regular player ${userId} added to back of queue`);
        }
        await prisma.user.updateMany({
            where: { id: userId },
            data: { looking: true }
        });
        console.log(`📊 Queue status: ${this.queue.length} players:`, this.queue);
        console.log(`🎨 Colors assigned:`, Array.from(this.playerColors.entries()));
        socket.emit('QUEUED', {
            remaining: Math.max(0, PLAYERS_REQUIRED - this.queue.length),
        });
        socket.emit('QUEUE_UPDATE', {
            position: this.queue.indexOf(userId) + 1,
            total: this.queue.length,
            takenColors: Array.from(this.playerColors.values())
        });
        const timer = setTimeout(async () => {
            await this.handleQueueTimeout(userId);
        }, QUEUE_TIMEOUT_MS);
        this.queueTimers.set(userId, timer);
        if (this.queue.length >= PLAYERS_REQUIRED) {
            console.log(`🎮 Queue full (${this.queue.length}/${PLAYERS_REQUIRED}), attempting to start game...`);
            await this.tryStartGame();
        }
    }
    async forceRemoveFromQueue(userId) {
        const index = this.queue.indexOf(userId);
        if (index !== -1) {
            this.queue.splice(index, 1);
            console.log(`Force removed user ${userId} from queue`);
        }
        const timer = this.queueTimers.get(userId);
        if (timer) {
            clearTimeout(timer);
            this.queueTimers.delete(userId);
        }
        await prisma.user.updateMany({
            where: { id: userId },
            data: { looking: false }
        });
    }
    async tryStartGame() {
        console.log(`🎮 Trying to start game with queue:`, this.queue);
        console.log(`🎨 Player colors:`, this.playerColors);
        console.log(`🔌 Socket connections:`, Array.from(this.socketConnections.keys()));
        if (this.queue.length < PLAYERS_REQUIRED) {
            console.log(`❌ Not enough players in queue: ${this.queue.length}/${PLAYERS_REQUIRED}`);
            return;
        }
        const uniqueColorPlayers = [];
        const seenColors = new Set();
        for (const uid of this.queue) {
            const color = this.playerColors.get(uid);
            const hasSocket = this.socketConnections.has(uid);
            console.log(`🔍 Checking player ${uid} - color: ${color}, hasSocket: ${hasSocket}`);
            if (!color) {
                console.log(`⚠️ Player ${uid} has no color assigned, skipping`);
                continue;
            }
            if (!hasSocket) {
                console.log(`⚠️ Player ${uid} has no socket connection, skipping`);
                continue;
            }
            if (seenColors.has(color)) {
                console.log(`⚠️ Color ${color} already taken by another player, skipping player ${uid}`);
                continue;
            }
            seenColors.add(color);
            uniqueColorPlayers.push(uid);
            console.log(`✅ Player ${uid} added with unique color ${color}`);
            if (uniqueColorPlayers.length === PLAYERS_REQUIRED)
                break;
        }
        console.log(`🎯 Unique color players with sockets: ${uniqueColorPlayers.length}/${PLAYERS_REQUIRED}`);
        if (uniqueColorPlayers.length === PLAYERS_REQUIRED) {
            console.log(`🚀 Starting game with players:`, uniqueColorPlayers);
            await this.startGameSession(uniqueColorPlayers);
        }
        else {
            console.log(`❌ Not enough valid players: ${uniqueColorPlayers.length}/${PLAYERS_REQUIRED}`);
            // Emit error to all queued players with sockets
            this.queue.forEach((uid) => {
                const socket = this.socketConnections.get(uid);
                if (socket) {
                    socket.emit("ERROR", {
                        message: `Waiting for more players with unique colors and active connections. Currently ${uniqueColorPlayers.length}/${PLAYERS_REQUIRED} valid players.`
                    });
                }
            });
        }
    }
    async removeFromQueue(userId) {
        const index = this.queue.indexOf(userId);
        if (index !== -1) {
            this.queue.splice(index, 1);
            const timer = this.queueTimers.get(userId);
            if (timer)
                clearTimeout(timer);
            this.queueTimers.delete(userId);
            // Only delete socket and color if player is NOT in an active game
            if (!this.playersInGame.has(userId)) {
                this.socketConnections.delete(userId);
                console.log("removing socket and color for user not in game:", userId);
                this.playerColors.delete(userId);
            }
            else {
                console.log("keeping socket and color for player in game:", userId);
            }
            await prisma.user.updateMany({
                where: { id: userId },
                data: { looking: false }
            });
        }
    }
    async handleQueueTimeout(userId) {
        await this.removeFromQueue(userId);
        const socket = this.socketConnections.get(userId);
        if (socket) {
            socket.emit('QUEUE_TIMEOUT', { message: 'Queue time expired' });
        }
    }
    async startGameSession(selectedPlayers) {
        // Clear timers
        selectedPlayers.forEach(pid => {
            const timer = this.queueTimers.get(pid);
            if (timer)
                clearTimeout(timer);
            this.queueTimers.delete(pid);
        });
        // Clear previous game state and mark players as in new game
        selectedPlayers.forEach(pid => {
            this.playersInGame.add(pid);
        });
        const playerRecords = await prisma.user.findMany({
            where: { id: { in: selectedPlayers } },
            select: { id: true, username: true }
        });
        const gameSession = await prisma.gameSession.create({
            data: {
                status: 'IN_PROGRESS',
                startedAt: new Date(),
                players: {
                    create: selectedPlayers.map(id => ({ user: { connect: { id } } }))
                }
            },
            include: { players: { include: { user: true } } }
        });
        const inMemoryGame = {
            board: Array.from({ length: 7 }, () => Array(7).fill(null)),
            players: playerRecords.map(p => ({
                ...p,
                color: this.playerColors.get(p.id)
            })),
            currentTurnIndex: 0,
            status: 'in_progress'
        };
        this.activeSessions.set(gameSession.id, inMemoryGame);
        // Update database
        await prisma.user.updateMany({
            where: { id: { in: selectedPlayers } },
            data: { looking: false, isonrand: true }
        });
        // Emit game started to all players
        selectedPlayers.forEach(pid => {
            const socket = this.socketConnections.get(pid);
            if (socket) {
                socket.emit('GAME_STARTED', {
                    gameSessionId: gameSession.id,
                    players: inMemoryGame.players.map(p => ({
                        id: p.id,
                        username: p.username,
                        color: p.color
                    }))
                });
            }
            else {
                console.warn(`⚠️ No socket connection for player ${pid} when starting game`);
            }
        });
        // Remove selected players from queue
        this.queue = this.queue.filter(uid => !selectedPlayers.includes(uid));
        console.log(`🎮 Game ${gameSession.id} started with players:`, selectedPlayers);
        console.log(`📊 Remaining queue:`, this.queue);
    }
    cleanupStaleConnections() {
        for (const [userId, socket] of this.socketConnections.entries()) {
            if (!socket.connected) {
                console.log(`Cleaning up stale connection for user ${userId}`);
                this.removeFromQueue(userId);
            }
        }
    }
    debugQueueState() {
        console.log('🔍 === QUEUE DEBUG STATE ===');
        console.log('Queue:', this.queue);
        console.log('Player Colors:', Array.from(this.playerColors.entries()));
        console.log('Socket Connections:', Array.from(this.socketConnections.keys()));
        console.log('Players In Game:', Array.from(this.playersInGame));
        console.log('Next Game Queue:', this.nextgamequeue);
        console.log('Next Players Colors:', Array.from(this.nextplayersColors.entries()));
        console.log('Winners Wanting Next:', Array.from(this.winnersWantingNext));
        console.log('=========================');
    }
    async handleClaimSquare(userId, gameId, row, col) {
        const game = this.activeSessions.get(gameId);
        if (!game || game.status !== 'in_progress')
            return;
        const player = game.players[game.currentTurnIndex];
        if (player.id !== userId) {
            const socket = this.socketConnections.get(userId);
            if (socket)
                socket.emit('ERROR', { message: 'Not your turn' });
            return;
        }
        if (game.board[row][col] !== null)
            return;
        game.board[row][col] = userId;
        const flatBoard = game.board.flat();
        if (flatBoard.every(cell => cell !== null)) {
            game.status = 'ended';
            game.winnerId = userId;
            game.players.forEach(p => {
                const socket = this.socketConnections.get(p.id);
                if (socket)
                    socket.emit('gameEnded', { winnerId: userId });
            });
            return;
        }
        game.currentTurnIndex = (game.currentTurnIndex + 1) % game.players.length;
        game.players.forEach(p => {
            const socket = this.socketConnections.get(p.id);
            if (socket) {
                socket.emit('GAME_STATE', {
                    board: game.board,
                    currentTurnIndex: game.currentTurnIndex,
                    players: game.players.map(pl => ({
                        id: pl.id,
                        username: pl.username,
                        color: pl.color
                    }))
                });
            }
        });
    }
    async getQueueStatus(userId) {
        const position = this.queue.indexOf(userId);
        if (position === -1)
            throw new Error('User not in queue');
        return { position: position + 1, total: this.queue.length };
    }
    // ✅ Handle color selection
    handleColorSelection(userId, selectedColor, forceAssign = false) {
        const taken = new Set(this.queue.map(id => this.playerColors.get(id)).filter(Boolean));
        if (taken.has(selectedColor) && !forceAssign) {
            const socket = this.socketConnections.get(userId);
            if (socket) {
                socket.emit('COLOR_TAKEN', { color: selectedColor });
            }
            this.nextplayersColors.set(userId, selectedColor);
            if (!this.nextgamequeue.includes(userId)) {
                this.nextgamequeue.push(userId);
                console.log(`User ${userId} added to nextgamequeue.`);
            }
            return false; // Color not assigned
        }
        this.playerColors.set(userId, selectedColor);
        this.nextplayersColors.delete(userId);
        const socket = this.socketConnections.get(userId);
        if (socket) {
            socket.emit('COLOR_CONFIRMED', { color: selectedColor });
        }
        return true; // Color assigned successfully
    }
    // ✅ Register listener (call this in your socket controller)
    onColorSelect(socket) {
        socket.on('COLOR_SELECT', ({ userId, color }) => {
            this.handleColorSelection(userId, color);
        });
    }
}
exports.GameQueueService = GameQueueService;
exports.gameQueueService = new GameQueueService();
