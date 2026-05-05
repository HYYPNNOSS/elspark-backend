"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gameQueueService = exports.GameQueueService = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const QUEUE_TIMEOUT_MS = 300000;
const VALID_COLORS = ['red', 'brown', 'blue', 'green'];
class GameQueueService {
    constructor() {
        // Separate queue for each color
        this.colorQueues = new Map([
            ['red', []],
            ['brown', []],
            ['blue', []],
            ['green', []]
        ]);
        this.queueTimers = new Map();
        this.socketConnections = new Map();
        this.playerColors = new Map();
        this.winnersWantingNext = new Set();
        this.playersInGame = new Set();
        this.winnerPriority = new Map();
        this.WINNER_DECISION_TIMEOUT = 10000;
        // NEW: Track if someone can start the game
        this.canStartGame = false;
        this.botCounter = 1;
    }
    isUserInQueue(userId) {
        for (const queue of this.colorQueues.values()) {
            if (queue.includes(userId))
                return true;
        }
        return false;
    }
    setQueueViewNamespace(namespace) {
        this.queueViewNamespace = namespace;
    }
    setWinnerPriority(userId, color) {
        const expiresAt = Date.now() + this.WINNER_DECISION_TIMEOUT;
        this.winnerPriority.set(userId, { color, expiresAt });
        console.log(`🏆 Winner ${userId} has priority for ${color} until ${new Date(expiresAt).toISOString()}`);
    }
    clearWinnerPriority(userId) {
        this.winnerPriority.delete(userId);
        console.log(`🏆 Cleared winner priority for ${userId}`);
    }
    hasWinnerPriority(userId) {
        const priority = this.winnerPriority.get(userId);
        if (!priority)
            return false;
        if (Date.now() > priority.expiresAt) {
            this.clearWinnerPriority(userId);
            return false;
        }
        return true;
    }
    getQueueState() {
        const allPlayers = [];
        let position = 1;
        for (const [color, queue] of this.colorQueues.entries()) {
            for (const userId of queue) {
                allPlayers.push({
                    userId,
                    color,
                    position: position++
                });
            }
        }
        // Check if at least one player is in queue (to enable start button)
        this.canStartGame = allPlayers.length > 0;
        return {
            players: allPlayers,
            total: allPlayers.length,
            canStartGame: this.canStartGame,
            colorQueueCounts: {
                red: this.colorQueues.get('red')?.length || 0,
                brown: this.colorQueues.get('brown')?.length || 0,
                blue: this.colorQueues.get('blue')?.length || 0,
                green: this.colorQueues.get('green')?.length || 0,
            }
        };
    }
    broadcastQueueUpdate() {
        const queueState = this.getQueueState();
        this.socketConnections.forEach((socket) => {
            socket.emit("QUEUE_STATE", queueState);
        });
        if (this.queueViewNamespace) {
            this.queueViewNamespace.emit("QUEUE_STATE", queueState);
        }
    }
    async addToQueue(userId, color, socket) {
        if (!VALID_COLORS.includes(color)) {
            socket.emit('ERROR', { message: `Invalid color. Choose one of: ${VALID_COLORS.join(', ')}` });
            return;
        }
        this.socketConnections.set(userId, socket);
        console.log(`Adding user ${userId} to ${color} queue`);
        // Check if user is already in any queue
        const alreadyInQueue = this.isUserInQueue(userId);
        if (alreadyInQueue) {
            console.log(`⚠️ User ${userId} already in queue, socket connection updated`);
            return;
        }
        const existingTimer = this.queueTimers.get(userId);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.queueTimers.delete(userId);
        }
        // Add to the specific color queue
        const colorQueue = this.colorQueues.get(color);
        if (colorQueue) {
            colorQueue.push(userId);
            this.playerColors.set(userId, color);
        }
        await prisma.profile.updateMany({
            where: { id: userId },
            data: { looking: true }
        });
        const queueState = this.getQueueState();
        console.log(`📊 Queue status:`, queueState);
        socket.emit('QUEUED', {
            message: 'Waiting for game to start',
        });
        socket.emit('QUEUE_UPDATE', {
            position: queueState.players.find(p => p.userId === userId)?.position,
            total: queueState.total,
            colorQueueCounts: queueState.colorQueueCounts,
            canStartGame: queueState.canStartGame
        });
        this.broadcastQueueUpdate();
        const timer = setTimeout(async () => {
            await this.handleQueueTimeout(userId);
        }, QUEUE_TIMEOUT_MS);
        this.queueTimers.set(userId, timer);
    }
    // NEW: Generate a bot name
    generateBotName() {
        const botNumber = Math.floor(Math.random() * 107) + 1;
        return `mooshi-${botNumber}`;
    }
    // NEW: Manual game start with randomized selection
    // In gameQueue.service.ts, replace the startGameManually method with this:
    async startGameManually() {
        console.log(`🎮 Manual game start initiated`);
        const selectedPlayers = [];
        // Collect all real player IDs first
        const realPlayerIds = [];
        for (const color of VALID_COLORS) {
            const colorQueue = this.colorQueues.get(color);
            if (!colorQueue || colorQueue.length === 0) {
                // No players for this color - create a bot
                const botId = -(this.botCounter++);
                const botName = this.generateBotName();
                selectedPlayers.push({
                    userId: botId,
                    username: botName,
                    color: color,
                    isBot: true
                });
                console.log(`🤖 No players for ${color}, added bot: ${botName}`);
            }
            else {
                // Randomly select one player from this color queue
                const randomIndex = Math.floor(Math.random() * colorQueue.length);
                const selectedUserId = colorQueue[randomIndex];
                realPlayerIds.push(selectedUserId);
                // Add placeholder for now, we'll fetch usernames next
                selectedPlayers.push({
                    userId: selectedUserId,
                    username: '', // Will be filled below
                    color: color,
                    isBot: false
                });
                console.log(`✅ Randomly selected player ${selectedUserId} from ${color} queue (${colorQueue.length} players)`);
            }
        }
        // Fetch actual usernames from database for real players
        if (realPlayerIds.length > 0) {
            const profiles = await prisma.profile.findMany({
                where: { id: { in: realPlayerIds } },
                select: { id: true, username: true }
            });
            // Map usernames to the selectedPlayers array
            selectedPlayers.forEach(player => {
                if (!player.isBot) {
                    const profile = profiles.find(p => p.id === player.userId);
                    player.username = profile?.username || `Player${player.userId}`;
                }
            });
        }
        console.log(`🚀 Starting game with players:`, selectedPlayers);
        // Clear timers and remove from queues for real players
        realPlayerIds.forEach(pid => {
            const timer = this.queueTimers.get(pid);
            if (timer)
                clearTimeout(timer);
            this.queueTimers.delete(pid);
            this.playersInGame.add(pid);
        });
        // Remove selected real players from color queues
        for (const [color, queue] of this.colorQueues.entries()) {
            this.colorQueues.set(color, queue.filter(id => !realPlayerIds.includes(id)));
        }
        // Create game session (only store real players in DB)
        const gameSession = await prisma.gameSession.create({
            data: {
                status: 'IN_PROGRESS',
                startedAt: new Date(),
                players: {
                    create: realPlayerIds.map(id => ({ profile: { connect: { id } } }))
                }
            },
            include: { players: { include: { profile: true } } }
        });
        console.log("✅ Game session created:", {
            id: gameSession.id,
            idType: typeof gameSession.id,
            status: gameSession.status
        });
        await prisma.profile.updateMany({
            where: { id: { in: realPlayerIds } },
            data: { looking: false, isonrand: true }
        });
        console.log(`🎮 Game ${gameSession.id} started with players:`, selectedPlayers);
        console.log(`📊 Remaining queues:`, {
            red: this.colorQueues.get('red')?.length || 0,
            brown: this.colorQueues.get('brown')?.length || 0,
            blue: this.colorQueues.get('blue')?.length || 0,
            green: this.colorQueues.get('green')?.length || 0,
        });
        this.broadcastQueueUpdate();
        const numericId = Number(gameSession.id);
        console.log("🎮 Returning game session ID:", numericId, "type:", typeof numericId);
        return {
            gameSessionId: numericId,
            players: selectedPlayers
        };
    }
    async removeFromQueue(userId) {
        // Remove from all color queues
        for (const [color, queue] of this.colorQueues.entries()) {
            const index = queue.indexOf(userId);
            if (index !== -1) {
                queue.splice(index, 1);
                console.log(`Removed user ${userId} from ${color} queue`);
            }
        }
        const timer = this.queueTimers.get(userId);
        if (timer)
            clearTimeout(timer);
        this.queueTimers.delete(userId);
        if (!this.playersInGame.has(userId)) {
            this.socketConnections.delete(userId);
            this.playerColors.delete(userId);
            console.log("Removed socket and color for user not in game:", userId);
        }
        else {
            console.log("Keeping socket and color for player in game:", userId);
        }
        await prisma.profile.updateMany({
            where: { id: userId },
            data: { looking: false }
        });
        this.broadcastQueueUpdate();
    }
    async handleQueueTimeout(userId) {
        await this.removeFromQueue(userId);
        const socket = this.socketConnections.get(userId);
        if (socket) {
            socket.emit('QUEUE_TIMEOUT', { message: 'Queue time expired' });
        }
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
        console.log('Color Queues:');
        for (const [color, queue] of this.colorQueues.entries()) {
            console.log(`  ${color}:`, queue);
        }
        console.log('Player Colors:', Array.from(this.playerColors.entries()));
        console.log('Socket Connections:', Array.from(this.socketConnections.keys()));
        console.log('Players In Game:', Array.from(this.playersInGame));
        console.log('Winners Wanting Next:', Array.from(this.winnersWantingNext));
        console.log('Can Start Game:', this.canStartGame);
        console.log('=========================');
    }
    async getQueueStatus(userId) {
        const queueState = this.getQueueState();
        const playerData = queueState.players.find(p => p.userId === userId);
        if (!playerData) {
            return { position: 0, total: queueState.total };
        }
        return {
            position: playerData.position,
            total: queueState.total
        };
    }
    handleColorSelection(userId, selectedColor) {
        if (!VALID_COLORS.includes(selectedColor)) {
            const socket = this.socketConnections.get(userId);
            if (socket) {
                socket.emit('ERROR', {
                    message: `Invalid color. Choose one of: ${VALID_COLORS.join(', ')}`
                });
            }
            return false;
        }
        const socket = this.socketConnections.get(userId);
        if (socket) {
            socket.emit('COLOR_CONFIRMED', { color: selectedColor });
        }
        return true;
    }
    onColorSelect(socket) {
        socket.on('COLOR_SELECT', ({ userId, color }) => {
            this.handleColorSelection(userId, color);
        });
    }
}
exports.GameQueueService = GameQueueService;
exports.gameQueueService = new GameQueueService();
