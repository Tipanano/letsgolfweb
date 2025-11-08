// Multiplayer Manager - Handles lobby and game coordination
import * as apiClient from './network/apiClient.js';
import * as wsManager from './network/webSocketManager.js';
import * as ui from './ui.js';
import * as shotTimer from './shotTimer.js';
import { setGameMode, GAME_MODES } from './main.js';
import * as visuals from './visuals.js';
import { playerManager } from './playerManager.js';
import { wageringManager } from './wageringManager.js';
import { toast } from './ui/toast.js';
import { modal } from './ui/modal.js';
import * as closestToFlag from './modes/closestToFlag.js';
import * as playHole from './modes/playHole.js';
import * as logic from './gameLogic.js';

// State
let currentSessionId = null;
let currentRoomCode = null;
let localPlayerId = null;
let localPlayerToken = null;
let isHost = false;
let players = [];
let isReady = false;
let gameMode = 'closest-to-flag'; // Default mode
let targetDistance = 150; // For CTF mode
let holeConfig = null; // Server-provided hole configuration
let currentPlayerIndex = -1; // Index of the player whose turn it is (-1 = not started)
let isWatchingOtherPlayerShot = false; // Track if we're animating someone else's shot
let isGameFinished = false; // Track if the game has finished
let isFirstTurnOfGame = false; // Track if this is the first turn (skip duplicate modal)
let pendingTurnChange = null; // Queue turn:changed events that arrive during animations

// Wagering state
let isWageringGame = false;
let wagerAmount = null;
let escrowStatus = null;
let paymentStatusPollInterval = null;

// UI Elements
const lobby = document.getElementById('multiplayer-lobby');
const lobbyRoomCode = document.getElementById('lobby-room-code');
const lobbyPlayerList = document.getElementById('lobby-player-list');
const lobbyReadyBtn = document.getElementById('lobby-ready-btn');
const lobbyStartBtn = document.getElementById('lobby-start-btn');
const lobbyLeaveBtn = document.getElementById('lobby-leave-btn');
const lobbyStatus = document.getElementById('lobby-status');
const copyRoomCodeBtn = document.getElementById('copy-room-code');
const lobbyGameMode = document.getElementById('lobby-game-mode');
const lobbyTargetDistance = document.getElementById('lobby-target-distance');

// Scoreboard Elements
const scoreboard = document.getElementById('multiplayer-scoreboard');
const scoreboardPlayerList = document.getElementById('multiplayer-player-list');
const gameLeaveBtn = document.getElementById('game-leave-btn');

// Player scores (distance from hole in CTF)
let playerScores = {}; // { playerId: { distanceMeters, distanceYards, hasShot } }

export function init() {

    // Set up button handlers
    lobbyReadyBtn?.addEventListener('click', handleReadyClick);
    lobbyStartBtn?.addEventListener('click', handleStartClick);
    lobbyLeaveBtn?.addEventListener('click', handleLeaveClick);
    copyRoomCodeBtn?.addEventListener('click', handleCopyRoomCode);
    gameLeaveBtn?.addEventListener('click', handleGameLeaveClick);

    // Set up WebSocket callbacks
    setupWebSocketHandlers();

    // Listen for wager-ready event (all players paid)
    window.addEventListener('wager-ready', (event) => {
        escrowStatus = 'ready';

        // Only host sends the start game command
        if (isHost) {
            wsManager.sendGameStart();
        } else {
        }
    });

    // Listen for leave-game event (from wagering cancel)
    window.addEventListener('leave-game', () => {
        wsManager.disconnect();
        hideLobby();
        resetState();
        ui.showMainMenu();
    });

    // DON'T auto-rejoin on page load - this was causing single-player CTF to trigger multiplayer
    // Instead, we'll check for active games and show a "Resume Game" button in the UI
}

/**
 * Check if player has an active multiplayer game session on the server
 * @returns {Promise<object>} { hasActiveGame: boolean, session: {...} | null }
 */
export async function checkForActiveGame() {
    try {
        const player = playerManager.getPlayerData();
        const token = player.sessionToken || playerManager.getSessionToken();

        const result = await apiClient.checkActiveGame(token);
        return result;
    } catch (error) {
        console.error('Error checking for active game:', error);
        return { hasActiveGame: false, session: null };
    }
}

/**
 * Resume an active multiplayer game
 * @param {object} sessionInfo - Session info from checkForActiveGame()
 */
export async function resumeGame(sessionInfo) {
    try {
        console.log('📥 Resuming game session:', sessionInfo);

        // Restore state from session info
        currentSessionId = sessionInfo.sessionId;
        currentRoomCode = sessionInfo.roomCode;
        localPlayerId = playerManager.getPlayerId();

        const player = playerManager.getPlayerData();
        localPlayerToken = player.sessionToken || playerManager.getSessionToken();

        isHost = sessionInfo.isHost;
        isWageringGame = sessionInfo.isWageringGame;
        wagerAmount = sessionInfo.wagerAmount;

        // Fetch full session data from server
        const { API_BASE_URL } = await import('./config.js');
        const response = await fetch(`${API_BASE_URL}/game/session/${currentSessionId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localPlayerToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch session data');
        }

        const sessionData = await response.json();
        players = sessionData.players;

        // Reconnect WebSocket
        wsManager.connect(currentSessionId, localPlayerToken);

        // Show appropriate UI based on game state
        if (sessionInfo.gameState === 'waiting') {
            // Game hasn't started yet - show lobby
            showLobby();
            updateLobbyDisplay();
            toast.success('Rejoined game lobby!');
        } else if (sessionInfo.gameState === 'playing') {
            // Game in progress - rejoin gameplay
            hideLobby();
            startMultiplayerGame();
            toast.success('Rejoined your active game!');
        }

        return true;
    } catch (error) {
        console.error('Error resuming game:', error);
        toast.error('Failed to resume game: ' + error.message);
        return false;
    }
}

export async function hostGame(mode = 'closest-to-flag', settings = {}) {
    try {
        // Check if player is already in a game
        const activeCheck = await checkForActiveGame();
        if (activeCheck.hasActiveGame) {
            const confirmed = await modal.confirm(
                'You are already in an active game. Leave that game to start a new one?',
                'Already in Game',
                'warning'
            );
            if (!confirmed) {
                return null;
            }
            // Leave the existing game
            await handleLeaveCurrentGame();
        }

        // Use playerManager for ID and name
        localPlayerId = playerManager.getPlayerId();
        console.log('🆔 [HOST] Player IDs:', {
            localPlayerId,
            playerData: playerManager.getPlayerData(),
            sessionToken: playerManager.getSessionToken ? playerManager.getSessionToken() : 'N/A'
        });

        // Use real session token for registered users, dev token for guests
        const player = playerManager.getPlayerData();
        localPlayerToken = player.sessionToken || playerManager.getSessionToken();

        gameMode = mode;
        isHost = true;
        isReady = false; // Reset ready state for new game

        // Store wagering state
        isWageringGame = settings.wagerAmount ? true : false;
        wagerAmount = settings.wagerAmount || null;

        const response = await apiClient.createGameSession(localPlayerToken, {
            playerName: playerManager.getDisplayName(),
            settings: {
                maxPlayers: 4,
                courseId: 'default',
                wagerAmount: settings.wagerAmount || null
            }
        });

        currentSessionId = response.sessionId;
        currentRoomCode = response.roomCode;

        // Don't initialize players array locally - wait for server to send it
        // The server will send game:stateUpdate when we connect via WebSocket

        // Connect WebSocket (this will trigger game:stateUpdate with the player list)
        wsManager.connect(currentSessionId, localPlayerToken);

        // Show lobby (player list will update when we receive game:stateUpdate)
        showLobby();
        updateLobbyDisplay();

        return { sessionId: currentSessionId, roomCode: currentRoomCode };
    } catch (error) {
        console.error('Failed to host game:', error);
        await modal.alert(error.message, 'Failed to Create Game', 'error');
        return null;
    }
}

async function handleLeaveCurrentGame() {
    // Disconnect from current game
    wsManager.disconnect();
    resetState();
}

/**
 * Leave active game from main menu (without being in the game UI)
 */
export async function handleLeaveActiveGameFromMenu() {
    try {
        console.log('🚪 [LEAVE] Starting leave game process...');
        const player = playerManager.getPlayerData();
        const token = player.sessionToken || playerManager.getSessionToken();
        console.log('🚪 [LEAVE] Got token:', token ? 'present' : 'missing');

        // Get current session ID from server
        console.log('🚪 [LEAVE] Checking for active game...');
        const activeCheck = await checkForActiveGame();
        console.log('🚪 [LEAVE] Active game check result:', activeCheck);

        if (!activeCheck.hasActiveGame) {
            console.log('🚪 [LEAVE] No active game, returning true');
            return true; // Already not in a game
        }

        // Call server to leave game (triggers refunds if applicable)
        console.log('🚪 [LEAVE] Calling server to leave game:', activeCheck.session.sessionId);
        const leaveResult = await apiClient.leaveGame(token, activeCheck.session.sessionId);
        console.log('🚪 [LEAVE] Server response:', leaveResult);

        // Reset local state
        console.log('🚪 [LEAVE] Resetting local state...');
        resetState();

        // Refresh the main menu UI to show Host/Join buttons
        console.log('🚪 [LEAVE] Refreshing main menu UI...');
        const ui = await import('./ui.js');
        await ui.showMainMenu(); // This calls updateMultiplayerMenuState()
        console.log('🚪 [LEAVE] UI refresh complete');

        return true;
    } catch (error) {
        console.error('🚪 [LEAVE] Error leaving game from menu:', error);
        toast.error('Failed to leave game: ' + error.message);
        return false;
    }
}

export async function joinGame(roomCode) {
    try {
        // Check if player is already in a game
        const activeCheck = await checkForActiveGame();
        if (activeCheck.hasActiveGame) {
            const confirmed = await modal.confirm(
                'You are already in an active game. Leave that game to join a new one?',
                'Already in Game',
                'warning'
            );
            if (!confirmed) {
                return null;
            }
            // Leave the existing game
            await handleLeaveCurrentGame();
        }

        // Use playerManager for ID and name
        localPlayerId = playerManager.getPlayerId();

        // Use real session token for registered users, dev token for guests
        const player = playerManager.getPlayerData();
        localPlayerToken = player.sessionToken || playerManager.getSessionToken();

        isHost = false;
        isReady = false; // Reset ready state when joining new game

        const response = await apiClient.joinGameSession(
            localPlayerToken,
            roomCode,
            playerManager.getDisplayName()
        );

        currentSessionId = response.sessionId;
        currentRoomCode = roomCode;
        players = response.players || [];

        // Connect WebSocket
        wsManager.connect(currentSessionId, localPlayerToken);

        // Show lobby
        showLobby();
        updateLobbyDisplay();

        return { sessionId: currentSessionId, roomCode };
    } catch (error) {
        console.error('Failed to join game:', error);
        await modal.alert(error.message, 'Failed to Join Game', 'error');
        return null;
    }
}

function setupWebSocketHandlers() {
    wsManager.setOnOpenCallback(() => {
        updateStatus('Connected to game');
    });

    wsManager.setOnPlayerJoinedCallback((data) => {
        if (data.player) {
            // Add or update player in list
            const existingIndex = players.findIndex(p => p.id === data.player.id);
            if (existingIndex >= 0) {
                players[existingIndex] = data.player;
            } else {
                players.push(data.player);
            }
            updateLobbyDisplay();
            updateStatus(`${data.player.name} joined`);
        }
    });

    wsManager.setOnPlayerLeftCallback((data) => {
        players = players.filter(p => p.id !== data.playerId);
        updateLobbyDisplay();
        updateStatus('A player left');
    });

    wsManager.setOnGameStateUpdateCallback((data) => {
        if (data.players) {
            players = data.players;
            updateLobbyDisplay();
        } else {
            console.warn('⚠️ Game state update had no players array!');
        }
    });

    // Listen for game preparing (flip the peg phase)
    wsManager.setOnCustomEventCallback('game:preparing', (data) => {
        handleGamePreparing(data);
    });

    wsManager.setOnGameStartCallback((data) => {

        // Store hole configuration from server (server sends meters, keep in meters internally)
        if (data.holeConfig) {
            holeConfig = data.holeConfig;
            // Keep distance in meters internally (conversion to yards happens in UI only)
            targetDistance = data.holeConfig.distanceMeters;
        }

        // Track which player's turn it is
        if (data.currentPlayerIndex !== undefined) {
            currentPlayerIndex = data.currentPlayerIndex;
        }

        // Save active game session to localStorage for rejoin on refresh
        saveActiveGameSession();

        hideLobby();
        hideFlipThePegModal(); // Hide the flip the peg animation

        // Show "First player" announcement before starting game
        if (data.firstPlayerName) {
            const isYou = data.firstPlayerId === localPlayerId;
            const message = isYou
                ? `🎯 You go first!`
                : `🎯 ${data.firstPlayerName} goes first!`;

            // Mark that we showed the first player modal
            isFirstTurnOfGame = true;

            modal.alert(message, 'Starting Game', 'info').then(() => {
                startMultiplayerGame();
            });
        } else {
            // Legacy: no first player announcement
            isFirstTurnOfGame = false;
            startMultiplayerGame();
        }
    });

    wsManager.setOnErrorCallback((error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection error');
    });

    // Listen for turn changes
    wsManager.setOnTurnChangeCallback((data) => {
        handleTurnChange(data);
    });

    // Listen for shots from other players
    wsManager.setOnPlayerShotCallback((data) => {
        handlePlayerShot(data);
    });

    // Listen for player ready status changes
    wsManager.setOnCustomEventCallback('player:readyStatus', (data) => {
        // Update the player's ready status in our local list
        const player = players.find(p => p.id === data.playerId);
        if (player) {
            player.isReady = data.isReady;
            updateLobbyDisplay();
            updateStatus(data.isReady ? `${player.name || 'Player'} is ready!` : `${player.name || 'Player'} is not ready`);
        }
    });

    // Listen for when game can be started
    wsManager.setOnCustomEventCallback('game:canStart', (data) => {
        if (isHost) {
            updateLobbyDisplay(); // This will show the start button
            updateStatus('All players ready! Click Start Game');
        }
    });

    // Listen for game finished event
    wsManager.setOnCustomEventCallback('game:finished', (data) => {
        handleGameFinished(data);
    });

    // Listen for game reset to lobby (after game finishes, for play again)
    wsManager.setOnCustomEventCallback('game:resetToLobby', (data) => {
        console.log('🔄 [RESET TO LOBBY] Received game:resetToLobby event', data);
        // Update players list with new ready statuses
        players = data.players || players;
        console.log('🔄 [RESET TO LOBBY] Updated players, showing lobby...');
        // Show lobby
        showLobby();
        updateLobbyDisplay();
        console.log('🔄 [RESET TO LOBBY] Lobby should now be visible');
    });

    // Listen for escrow created (wagering games)
    wsManager.setOnCustomEventCallback('escrow:created', (data) => {
        handleEscrowCreated(data);
    });

    // Listen for payment status updates (wagering games)
    wsManager.setOnCustomEventCallback('payment:status', (data) => {
        handlePaymentStatus(data);
    });

    // Listen for payment complete (all players paid)
    wsManager.setOnCustomEventCallback('payment:complete', (data) => {
        escrowStatus = 'ready';
        // Game will start automatically via server's game:started event
    });

    // Listen for game cancelled (host left)
    wsManager.setOnCustomEventCallback('game:cancelled', (data) => {
        handleGameCancelled(data);
    });

    // Listen for payout complete (wagering games)
    wsManager.setOnCustomEventCallback('payout:complete', (data) => {
        handlePayoutComplete(data);
    });

    // Listen for payout error (wagering games)
    wsManager.setOnCustomEventCallback('payout:error', (data) => {
        console.error('❌ Payout error:', data);
        handlePayoutError(data);
    });
}

function handleGamePreparing(data) {
    console.log('🎲 [PREPARING] Game preparing - flipping the peg!', data);

    // Store hole configuration if provided
    if (data.holeConfig) {
        holeConfig = data.holeConfig;
        targetDistance = data.holeConfig.distanceMeters;
        console.log('🎲 [PREPARING] Hole config stored, distance:', targetDistance);
    }

    // IMMEDIATELY show flip the peg modal with "Loading..." message
    // This provides instant feedback so users know something is happening
    console.log('🎲 [PREPARING] Showing flip the peg modal...');
    showFlipThePegModal(data.countdown, true); // Pass true for loading state

    // Hide lobby
    console.log('🎲 [PREPARING] Hiding lobby...');
    hideLobby();

    // Initialize the game view so players can see the hole
    // This makes the flip the peg more exciting - they see what they're about to play!
    console.log('🎲 [PREPARING] Starting async imports...');
    import('./modes/closestToFlag.js').then(async (ctfMode) => {
        console.log('🎲 [PREPARING] CTF mode imported');
        const { setGameMode, GAME_MODES } = await import('./main.js');
        console.log('🎲 [PREPARING] main.js imported');

        // Set game mode to CTF (will show the hole)
        gameMode = 'closest-to-flag';
        console.log('🎲 [PREPARING] Calling setGameMode...');
        await setGameMode(GAME_MODES.CLOSEST_TO_FLAG, null, targetDistance);
        console.log('🎲 [PREPARING] setGameMode complete');

        // Show the game view
        const ui = await import('./ui.js');
        console.log('🎲 [PREPARING] Calling showGameView...');
        ui.showGameView();
        console.log('🎲 [PREPARING] showGameView complete');

        // Update flip the peg modal to show the actual animation (remove loading state)
        console.log('🎲 [PREPARING] Updating modal to ready state...');
        updateFlipThePegModalReady();
        console.log('🎲 [PREPARING] Modal updated - hole should be visible now!');
    }).catch(error => {
        console.error('🎲 [PREPARING] ERROR during game preparation:', error);
    });
}

function showFlipThePegModal(countdownSeconds, isLoading = false) {
    // Create modal HTML with animated peg flipping
    const modalHTML = `
        <div class="flip-peg-modal-overlay" id="flip-peg-overlay">
            <div class="flip-peg-modal">
                <h2>🎲 ${isLoading ? 'Starting Game' : 'Flipping the Peg'}</h2>
                <p class="flip-peg-message" id="flip-peg-message">${isLoading ? 'Loading hole...' : 'Determining who goes first...'}</p>
                <div class="flip-peg-animation" id="flip-peg-animation" style="${isLoading ? 'display: none;' : ''}">
                    <div class="peg"></div>
                </div>
                <p class="flip-peg-countdown" id="flip-peg-countdown-container" style="${isLoading ? 'display: none;' : ''}"><span id="flip-countdown">${countdownSeconds}</span> seconds</p>
            </div>
        </div>
    `;

    // Insert modal into document
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add CSS for the animation
    const style = document.createElement('style');
    style.textContent = `
        .flip-peg-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        }
        .flip-peg-modal {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 40px;
            border-radius: 15px;
            text-align: center;
            color: white;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            max-width: 400px;
        }
        .flip-peg-modal h2 {
            margin: 0 0 15px 0;
            font-size: 32px;
        }
        .flip-peg-message {
            margin: 10px 0;
            font-size: 18px;
            opacity: 0.9;
        }
        .flip-peg-animation {
            margin: 30px 0;
            height: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .peg {
            width: 60px;
            height: 60px;
            background: white;
            border-radius: 50%;
            animation: flip 0.6s infinite;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        }
        @keyframes flip {
            0%, 100% { transform: rotateY(0deg) scale(1); }
            50% { transform: rotateY(180deg) scale(1.2); }
        }
        .flip-peg-countdown {
            margin: 20px 0 0 0;
            font-size: 20px;
            font-weight: bold;
        }
        #flip-countdown {
            font-size: 32px;
            color: #ffd700;
        }
    `;
    document.head.appendChild(style);

    // Countdown timer
    let remaining = countdownSeconds;
    const countdownElement = document.getElementById('flip-countdown');
    const countdownInterval = setInterval(() => {
        remaining--;
        if (countdownElement) {
            countdownElement.textContent = remaining;
        }
        if (remaining <= 0) {
            clearInterval(countdownInterval);
        }
    }, 1000);

    // Store interval ID for cleanup if needed
    window.flipPegCountdownInterval = countdownInterval;
}

function updateFlipThePegModalReady() {
    // Update the modal to show the actual animation (game loaded)
    const messageEl = document.getElementById('flip-peg-message');
    const animationEl = document.getElementById('flip-peg-animation');
    const countdownEl = document.getElementById('flip-peg-countdown-container');
    const titleEl = document.querySelector('.flip-peg-modal h2');

    if (messageEl) messageEl.textContent = 'Determining who goes first...';
    if (animationEl) animationEl.style.display = 'flex';
    if (countdownEl) countdownEl.style.display = 'block';
    if (titleEl) titleEl.textContent = '🎲 Flipping the Peg';
}

function hideFlipThePegModal() {
    const overlay = document.getElementById('flip-peg-overlay');
    if (overlay) {
        overlay.remove();
    }
    if (window.flipPegCountdownInterval) {
        clearInterval(window.flipPegCountdownInterval);
        window.flipPegCountdownInterval = null;
    }
}

function handleGameCancelled(data) {
    // Hide payment modal if showing
    wageringManager.hideModal();

    // Hide flip the peg modal if showing
    hideFlipThePegModal();

    // Show alert
    modal.alert(data.message, 'Game Cancelled', 'warning').then(() => {
        // Return to main menu
        wsManager.disconnect();
        hideLobby();
        resetState();
        ui.showMainMenu();
    });
}

function handleEscrowCreated(data) {

    // Show payment UI for all players (host and joiners)
    wageringManager.showPaymentUIFromBroadcast(
        currentSessionId,
        data.escrowAddress,
        data.wagerAmount,
        data.expiresIn,
        players
    );
}

function handlePaymentStatus(data) {

    // Update players with payment status
    if (data.players && Array.isArray(data.players)) {
        data.players.forEach(paymentPlayer => {
            const player = players.find(p => p.nanoAddress === paymentPlayer.address);
            if (player) {
                player.hasPaid = paymentPlayer.hasPaid;
            }
        });
    }

    // Update escrow status
    escrowStatus = data.status;

    // Refresh lobby display to show payment badges
    updateLobbyDisplay();

    // Update status message
    if (data.allPaid) {
        updateStatus('✅ All players paid! Starting game...');
    } else {
        const paidCount = data.players.filter(p => p.hasPaid).length;
        updateStatus(`💰 Waiting for payments: ${paidCount}/${data.players.length} paid`);
    }
}

function handleGameFinished(data) {
    const { winner, gameMode, playerStates, players: allPlayers } = data;

    if (!winner) {
        console.error('No winner in game:finished event');
        return;
    }


    // Mark game as finished to prevent status message updates
    isGameFinished = true;

    // Use the server's winner determination instead of client-side
    const isLocalWinner = winner.id === localPlayerId;
    const winnerDistanceYards = (winner.distanceFromHole * 1.09361).toFixed(1); // Convert meters to yards for display
    const winnerDistance = winnerDistanceYards; // Keep variable name for compatibility

    // Show status message
    const message = isLocalWinner
        ? `🏆 You won! ${winnerDistance} yards from the hole!`
        : `${winner.name} won with ${winnerDistance} yards from the hole`;

    shotTimer.setStatusMessage(message);

    // Sort players by distance (closest first)
    const sortedPlayers = (allPlayers || players).map(p => {
        const state = playerStates[p.id];
        return {
            ...p,
            distanceYards: state?.distanceFromHole ? (state.distanceFromHole * 1.09361) : 999999, // Convert to yards for display
            isWinner: p.id === winner.id
        };
    }).sort((a, b) => a.distanceYards - b.distanceYards); // Sort by yards for leaderboard

    // Check if payout data exists (wagering game)
    const payoutData = window.lastPayoutData;
    if (payoutData) {
        window.lastPayoutData = null; // Clear it
    }

    // Show custom game summary modal
    showGameSummaryModal({
        isLocalWinner,
        winner,
        winnerDistance,
        sortedPlayers,
        payoutData,
        isWageringGame,
        onPlayAgain: () => {
            console.log('🔄 [PLAY AGAIN] onPlayAgain called, showing lobby and sending player:ready');
            // Immediately show lobby for this player
            showLobby();
            updateLobbyDisplay();
            // Mark ourselves as ready and notify server
            wsManager.sendPlayerReady();
            console.log('🔄 [PLAY AGAIN] Lobby shown, player:ready sent to server');
        },
        onReturnToMenu: returnToMenu
    });
}

function returnToMenu() {

    // Terminate game modes
    if (gameMode === 'closest-to-flag') {
        closestToFlag.terminateMode();
    } else if (gameMode === 'play-hole') {
        playHole.terminateMode();
    }

    // Clear player markers
    visuals.clearAllMarkers();

    // Reset core game logic, UI, and visuals
    logic.resetSwing();

    // Disconnect WebSocket and reset multiplayer state
    wsManager.disconnect();
    hideLobby();
    resetState();

    // Show main menu
    ui.showMainMenu();
}

function handlePayoutComplete(data) {

    const isLocalWinner = data.winner.id === localPlayerId;
    const payoutNano = data.payoutAmount;

    // Show toast notification
    if (isLocalWinner) {
        toast.success(`🎉 You won ${payoutNano} NANO! Sent to ${data.payoutAddress.substring(0, 15)}...`);
    } else {
        toast.info(`${data.winner.name} received ${payoutNano} NANO payout`);
    }

    // Store payout data to show in game finished modal
    window.lastPayoutData = data;
}

function handlePayoutError(data) {
    console.error('❌ Payout error:', data);
    toast.error('Payout failed: ' + data.message);
}

function handleReadyClick() {
    isReady = !isReady;
    lobbyReadyBtn.textContent = isReady ? 'Not Ready' : 'Ready';
    lobbyReadyBtn.style.background = isReady ? '#ff9800' : '#4CAF50';

    // Update our own ready status in the players list
    const localPlayer = players.find(p => p.id === localPlayerId);
    if (localPlayer) {
        localPlayer.isReady = isReady;
        updateLobbyDisplay();
    }

    wsManager.sendPlayerReady();
    updateStatus(isReady ? 'You are ready!' : 'Click ready when prepared');
}

async function handleStartClick() {
    if (!isHost) return;


    // If this is a wagering game, create escrow first
    if (isWageringGame) {

        // Validate all players are registered
        const validation = wageringManager.validateAllPlayersRegistered(players);
        if (!validation.valid) {
            await modal.alert(
                `Cannot start wagering game. The following players must register with Nano:\n\n${validation.invalidPlayers.join('\n')}`,
                'Unregistered Players',
                'warning'
            );
            return;
        }

        // Disable start button and show loading state
        lobbyStartBtn.disabled = true;
        lobbyStartBtn.textContent = 'Creating escrow...';
        lobbyStartBtn.style.opacity = '0.6';
        lobbyStartBtn.style.cursor = 'not-allowed';

        try {
            // Create escrow - server will broadcast escrow:created to all players
            // which will show the payment UI for everyone (host + joiners)
            await wageringManager.createEscrow(currentSessionId, wagerAmount);

            // Payment UI will be shown via escrow:created broadcast
            // Game will start after all payments are received
        } catch (error) {
            // Re-enable button on error
            lobbyStartBtn.disabled = false;
            lobbyStartBtn.textContent = 'Start Game';
            lobbyStartBtn.style.opacity = '1';
            lobbyStartBtn.style.cursor = 'pointer';
        }
        return;
    }

    // Regular game - start immediately
    // Disable button to prevent double-clicks
    lobbyStartBtn.disabled = true;
    lobbyStartBtn.textContent = 'Starting...';
    lobbyStartBtn.style.opacity = '0.6';
    lobbyStartBtn.style.cursor = 'not-allowed';

    wsManager.sendGameStart();
}

async function handleLeaveClick() {
    const confirmed = await modal.confirm('Leave the game?', 'Confirm', 'warning');
    if (confirmed) {
        wsManager.disconnect();
        hideLobby();
        resetState();
        ui.showMainMenu();
    }
}

async function handleGameLeaveClick() {
    const confirmed = await modal.confirm(
        'Are you sure you want to leave the game? If you have paid for wagering, you will be refunded.',
        'Leave Game',
        'warning'
    );

    if (confirmed) {
        try {
            // Call API to leave game and trigger refunds if applicable
            const result = await apiClient.leaveGame(localPlayerToken, currentSessionId);

            if (result.refund && result.refund.refunded) {
                toast.success(`Refunded ${result.refund.amount} NANO to your address`);
            }

            // Disconnect and return to menu
            wsManager.disconnect();
            resetState();
            ui.showMainMenu();
        } catch (error) {
            console.error('Error leaving game:', error);
            toast.error('Failed to leave game: ' + error.message);
        }
    }
}

function handleCopyRoomCode() {
    if (currentRoomCode) {
        navigator.clipboard.writeText(currentRoomCode).then(() => {
            toast.success(`Room code copied: ${currentRoomCode}`);
        }).catch(err => {
            console.error('Failed to copy:', err);
            toast.error('Failed to copy room code');
        });
    }
}

function showLobby() {
    if (lobby) {
        lobby.style.display = 'block';
        const mainMenu = document.getElementById('main-menu');
        if (mainMenu) mainMenu.style.display = 'none';
        // Hide game view when returning to lobby
        const gameView = document.getElementById('game-view');
        if (gameView) gameView.style.display = 'none';
        // Remove any lingering game summary modal
        const summaryModal = document.getElementById('game-summary-overlay');
        if (summaryModal) summaryModal.remove();

        // Reset start button state
        if (lobbyStartBtn) {
            lobbyStartBtn.disabled = false;
            lobbyStartBtn.textContent = 'Start Game';
            lobbyStartBtn.style.opacity = '1';
            lobbyStartBtn.style.cursor = 'pointer';
        }

        // Refresh lobby display to show correct button state
        updateLobbyDisplay();
    }
}

function hideLobby() {
    if (lobby) {
        lobby.style.display = 'none';
    }
}

function updateLobbyDisplay() {
    // Update room code
    if (lobbyRoomCode) {
        lobbyRoomCode.textContent = currentRoomCode || '------';
    }

    // Show/hide wagering info
    const wagerInfo = document.getElementById('lobby-wager-info');
    const wagerAmountSpan = document.getElementById('lobby-wager-amount');
    if (isWageringGame && wagerAmount) {
        if (wagerInfo) wagerInfo.style.display = 'block';
        if (wagerAmountSpan) wagerAmountSpan.textContent = `${wagerAmount} NANO`;
    } else {
        if (wagerInfo) wagerInfo.style.display = 'none';
    }

    // Update player list
    if (lobbyPlayerList) {
        lobbyPlayerList.innerHTML = '';
        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.style.cssText = 'padding: 5px; margin: 3px 0; background: #f9f9f9; border-radius: 3px; display: flex; justify-content: space-between; align-items: center;';

            const isYou = player.id === localPlayerId;
            const hostBadge = player.isHost ? ' 👑' : '';
            const readyBadge = player.isReady ? ' ✅' : '';

            // Payment status badge (only shown during payment phase)
            let paymentBadge = '';
            if (escrowStatus === 'awaiting_payments' && player.hasPaid) {
                paymentBadge = ' 💰';
            } else if (escrowStatus === 'awaiting_payments' && !player.hasPaid) {
                paymentBadge = ' ⏳';
            }

            playerDiv.textContent = `${player.name || 'Player'}${hostBadge}${readyBadge}${paymentBadge}${isYou ? ' (You)' : ''}`;

            lobbyPlayerList.appendChild(playerDiv);
        });
    }

    // Update game mode display
    if (lobbyGameMode) lobbyGameMode.textContent = 'Closest to Flag';
    // Target distance is removed - it's randomly set when game starts

    // Update ready button state based on current isReady status
    if (lobbyReadyBtn) {
        const localPlayer = players.find(p => p.id === localPlayerId);
        if (localPlayer) {
            // Sync with server state if player data is available
            isReady = localPlayer.isReady;
        }
        // Always update button to reflect current isReady state
        lobbyReadyBtn.textContent = isReady ? 'Not Ready' : 'Ready';
        lobbyReadyBtn.style.background = isReady ? '#ff9800' : '#4CAF50';
    }

    // Show/hide start button (ONLY for host)
    const allReady = players.every(p => p.isReady);
    const canStart = allReady && players.length >= 2;

    if (lobbyStartBtn) {
        // Only show start button if you're the host
        lobbyStartBtn.style.display = (isHost && canStart) ? 'inline-block' : 'none';
    }

    // Update status message based on ready state
    if (canStart) {
        if (isHost) {
            updateStatus('All players ready! Click Start Game');
        } else {
            updateStatus('All players ready! Waiting for host to start...');
        }
    } else if (players.length < 2) {
        updateStatus('Waiting for more players (minimum 2)...');
    } else {
        const readyCount = players.filter(p => p.isReady).length;
        updateStatus(`${readyCount}/${players.length} players ready`);
    }
}

function updateStatus(message) {
    if (lobbyStatus) {
        lobbyStatus.textContent = message;
    }
}

function showScoreboard() {
    if (scoreboard) {
        scoreboard.style.display = 'block';
        updateScoreboard();
    }

    // Hide the single-player CTF info panel during multiplayer
    const ctfInfoPanel = document.getElementById('closest-to-flag-info');
    if (ctfInfoPanel) {
        ctfInfoPanel.style.display = 'none';
    }

    // Hide the visual overlay top-left info (Hole/Par/Shot) during multiplayer CTF
    const overlayTopLeft = document.querySelector('.overlay-top-left.mode-closest-to-flag');
    if (overlayTopLeft) {
        overlayTopLeft.style.display = 'none';
    }
}

function hideScoreboard() {
    if (scoreboard) {
        scoreboard.style.display = 'none';
    }

    // Show the single-player CTF info panel when not in multiplayer
    const ctfInfoPanel = document.getElementById('closest-to-flag-info');
    if (ctfInfoPanel) {
        ctfInfoPanel.style.display = 'block';
    }

    // Show the visual overlay top-left info again when leaving multiplayer
    const overlayTopLeft = document.querySelector('.overlay-top-left.mode-closest-to-flag');
    if (overlayTopLeft) {
        overlayTopLeft.style.display = 'block';
    }
}

function updateScoreboard() {
    if (!scoreboardPlayerList) return;

    scoreboardPlayerList.innerHTML = '';

    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.style.cssText = 'padding: 8px; margin: 5px 0; background: rgba(255, 255, 255, 0.1); border-radius: 4px; border-left: 3px solid ' + (player.id === localPlayerId ? '#4CAF50' : 'rgba(255, 255, 255, 0.3)');

        const isYou = player.id === localPlayerId;
        const isCurrent = players.indexOf(player) === currentPlayerIndex;
        const playerName = (player.name || 'Player') + (isYou ? ' (You)' : '');

        const score = playerScores[player.id];
        let scoreText = '';

        if (score && score.hasShot) {
            const penaltyIndicator = score.isPenalty ? ' <span style="color: #ff0000; font-weight: bold;">(PENALTY)</span>' : '';
            scoreText = `<strong>${score.distanceYards.toFixed(1)} yd</strong>${penaltyIndicator}`;
        } else if (isCurrent) {
            scoreText = '<em>shooting...</em>';
        } else {
            scoreText = '<em>waiting...</em>';
        }

        // Add player color indicator
        const colorDot = player.color
            ? `<span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${player.color}; margin-right: 6px; vertical-align: middle;"></span>`
            : '';

        playerDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${colorDot}${isCurrent ? '► ' : ''}${playerName}</span>
                <span style="margin-left: 10px;">${scoreText}</span>
            </div>
        `;

        scoreboardPlayerList.appendChild(playerDiv);
    });
}

export function updatePlayerScore(playerId, distanceMeters, distanceYards, isPenalty = false) {
    playerScores[playerId] = {
        distanceMeters,
        distanceYards,
        isPenalty,
        hasShot: true
    };
    updateScoreboard();

    // Server will determine winner and send game:finished event
}

async function startMultiplayerGame() {

    // Safety: Reset game state from any previous game
    logic.resetSwing();
    isGameFinished = false;
    playerScores = {};

    // Clear any existing player markers
    visuals.clearAllMarkers();

    // Show game view FIRST so canvas can get proper dimensions
    ui.showGameView();

    // Small delay to ensure DOM has updated and canvas has proper size
    await new Promise(resolve => setTimeout(resolve, 50));

    // IMPORTANT: Set hole config BEFORE initializing game mode
    // This ensures all players use the same hole layout from the server
    if (holeConfig) {
        const { clearHoleConfig, setHoleConfig } = await import('./visuals/targetView.js');
        // Force clear any existing hole data to ensure a clean slate (defense in depth)
        clearHoleConfig();
        setHoleConfig(holeConfig);
    }

    // Initialize CTF mode with server-provided target distance (or null for single-player)
    await setGameMode(GAME_MODES.CLOSEST_TO_FLAG, null, targetDistance);

    // Show multiplayer scoreboard
    showScoreboard();

    // Find our local player index
    const localPlayerIdx = players.findIndex(p => p.id === localPlayerId);

    console.log('🎯 [TURN CHECK] Starting game - Player turn check:', {
        localPlayerId,
        localPlayerIdx,
        currentPlayerIndex,
        isMyTurn: localPlayerIdx === currentPlayerIndex,
        allPlayers: players.map(p => ({ id: p.id, name: p.name }))
    });

    // Only start timer if it's this player's turn
    if (localPlayerIdx === currentPlayerIndex) {
        // Play sound notification
        playTurnNotificationSound();

        // Only show modal if this is NOT the first turn (we already showed "You go first!")
        if (!isFirstTurnOfGame) {
            modal.alert('It\'s your turn! Take your shot.', 'Your Turn!', 'success');
        } else {
            // Reset flag after first turn
            isFirstTurnOfGame = false;
        }

        startShotTimer('Your shot, {time} seconds left');

        // Switch to static camera (properly resets controls for player's turn)
        visuals.switchToStaticCamera();
    } else {
        // Show waiting message for other players
        const currentPlayer = players[currentPlayerIndex];
        const playerName = currentPlayer?.name || 'Player';
        startWatchingTimer(playerName);

        // Switch to camera 3 (reverse angle) for watching
        // Also need delay for camera to work properly
        setTimeout(async () => {
            const { activateReverseCamera } = await import('./visuals.js');
            activateReverseCamera();
        }, 150);
    }
}

function handleTurnChange(data) {
    // Don't process turn changes if game is finished
    if (isGameFinished) {
        return;
    }

    // If we're watching another player's shot animation, queue this turn change
    if (isWatchingOtherPlayerShot) {
        console.log('🔄 [TURN CHANGE] Animation in progress, queuing turn change');
        pendingTurnChange = data;
        return;
    }

    console.log('🔄 [TURN CHANGE] Processing turn change', data);

    // Update the current turn index
    if (data.currentPlayerIndex !== undefined) {
        currentPlayerIndex = data.currentPlayerIndex;
    }

    // Update scoreboard to show whose turn it is
    updateScoreboard();

    // Find our local player index
    const localPlayerIdx = players.findIndex(p => p.id === localPlayerId);

    // Check if it's now our turn
    if (localPlayerIdx === currentPlayerIndex) {
        console.log('🔄 [TURN CHANGE] It\'s our turn - resetting swing state');
        // Reset swing state to prepare for input (sets gameState to 'ready')
        logic.resetSwing();
        console.log('🔄 [TURN CHANGE] After resetSwing, gameState:', logic.getGameState());

        // Show alert modal with sound notification
        playTurnNotificationSound();
        modal.alert('It\'s your turn! Take your shot.', 'Your Turn!', 'success');
        startShotTimer('Your shot, {time} seconds left');

        // Switch to static camera (properly resets controls for player's turn)
        visuals.switchToStaticCamera();
    } else {
        // Stop timer if it was running
        shotTimer.stopTimer();

        // Show waiting message for other player's turn
        const currentPlayer = players[currentPlayerIndex];
        const playerName = currentPlayer?.name || 'Player';
        startWatchingTimer(playerName);

        // Switch to camera 3 (reverse angle) for watching
        import('./visuals.js').then(({ activateReverseCamera }) => {
            activateReverseCamera();
        });
    }
}

function handlePlayerShot(data) {
    const { playerId, shotData } = data;


    // Update scoreboard with player's distance (for both local and remote players)
    if (shotData && shotData.distanceFromHoleMeters !== undefined && shotData.distanceFromHoleYards !== undefined) {
        const isPenalty = shotData.isPenalty || false;
        updatePlayerScore(playerId, shotData.distanceFromHoleMeters, shotData.distanceFromHoleYards, isPenalty);
    } else {
        console.warn('Shot data missing distance fields:', shotData);
    }

    // Ignore shots from ourselves (we already animated it)
    if (playerId === localPlayerId) {
        return;
    }

    // Find the player who took the shot
    const player = players.find(p => p.id === playerId);
    const playerName = player?.name || 'Player';
    const playerColor = player?.color ? parseInt(player.color.replace('#', '0x')) : 0xffff00;

    shotTimer.setStatusMessage(`Watching ${playerName}'s shot...`);

    // Set flag to prevent onBallStopped from sending duplicate shot data
    isWatchingOtherPlayerShot = true;

    // Animate the other player's shot with their color
    if (shotData && shotData.trajectory) {
        console.log('🎬 [REPLAY] Starting animation for other player:', {
            playerName,
            trajectoryLength: shotData.trajectory.length,
            timeOfFlight: shotData.timeOfFlight,
            hasTrajectory: !!shotData.trajectory
        });
        visuals.animateBallFlightWithLanding(shotData, playerColor);

        // After animation completes (handled by callback), wait a bit then update status
        // The turn:changed event will handle starting the next timer
    } else {
        console.warn('Received shot without trajectory data');
        isWatchingOtherPlayerShot = false;
    }
}

// Play a notification sound to alert the player it's their turn
function playTurnNotificationSound() {
    // Create a simple beep sound using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        // Create a pleasant notification sound (two beeps)
        oscillator.frequency.value = 800; // Hz
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);

        // Second beep
        const oscillator2 = audioContext.createOscillator();
        const gainNode2 = audioContext.createGain();
        oscillator2.connect(gainNode2);
        gainNode2.connect(audioContext.destination);

        oscillator2.frequency.value = 1000;
        oscillator2.type = 'sine';

        gainNode2.gain.setValueAtTime(0.3, audioContext.currentTime + 0.15);
        gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);

        oscillator2.start(audioContext.currentTime + 0.15);
        oscillator2.stop(audioContext.currentTime + 0.25);
    } catch (error) {
        console.error('Could not play notification sound:', error);
    }
}

function startShotTimer(messageTemplate) {

    shotTimer.startTimer(() => {
        modal.alert('Time\'s up! You took too long.', 'Timer Expired', 'warning');
        // TODO: Auto-forfeit turn or take random shot
    }, messageTemplate);
}

function startWatchingTimer(playerName) {

    // Use the timer but with a different message template
    shotTimer.startTimer(() => {
        // Don't need to do anything for other player's timeout
    }, `${playerName}'s turn, {time} seconds left`);
}

// Called when local player starts their shot (w key pressed)
export function onShotStarted() {
    // Only handle multiplayer logic if we're in a multiplayer session
    if (!currentSessionId) {
        return; // Not in multiplayer, nothing to do
    }

    shotTimer.stopTimer();
    shotTimer.setStatusMessage('Shot in progress...');
}

// Called when ball has finished animating/stopped moving
export function onBallStopped(shotData) {
    // Only handle multiplayer logic if we're in a multiplayer session
    if (!currentSessionId) {
        return; // Not in multiplayer, nothing to do
    }

    // If we're watching someone else's shot, don't send data to server
    if (isWatchingOtherPlayerShot) {

        // Place marker for the other player
        const otherPlayer = players.find(p => playerScores[p.id]?.hasShot && p.id !== localPlayerId);
        if (otherPlayer && shotData) {
            const score = playerScores[otherPlayer.id];
            visuals.setPlayerMarker(
                otherPlayer.id,
                otherPlayer.name,
                shotData.finalPosition,
                score.distanceYards,
                otherPlayer.color || '#FFFFFF'
            );
        }

        // Reset ball to tee for next player
        visuals.showBallAtAddress(); // This resets ball to tee position

        isWatchingOtherPlayerShot = false;
        shotTimer.setStatusMessage('Waiting for next turn...');

        // Wait 2 seconds after animation completes to let player see where the ball landed
        setTimeout(() => {
            // Process any pending turn change that arrived during the animation
            if (pendingTurnChange) {
                console.log('🔄 [ANIMATION COMPLETE] Processing queued turn change after pause');
                const queuedData = pendingTurnChange;
                pendingTurnChange = null;
                handleTurnChange(queuedData);
            }
        }, 2000); // 2 second pause to see the final position

        return;
    }

    // This is our own shot - send it to the server

    // Send shot data to server immediately so other players can see the animation
    if (shotData) {
        const shotPayload = {
            finalPosition: shotData.finalPosition,
            totalDistance: shotData.totalDistance,
            carryDistance: shotData.carryDistance,
            rolloutDistance: shotData.rolloutDistance,
            isHoledOut: shotData.isHoledOut || false,
            trajectory: shotData.trajectory, // Include trajectory for other players to animate
            timeOfFlight: shotData.timeOfFlight, // Include timing for proper animation speed
            distanceFromHoleMeters: shotData.distanceFromHoleMeters, // CTF distance
            distanceFromHoleYards: shotData.distanceFromHoleYards // CTF distance
        };
        wsManager.sendShotData(shotPayload);

        // Place marker for own shot
        const localPlayer = players.find(p => p.id === localPlayerId);
        if (localPlayer && shotData.distanceFromHoleYards) {
            visuals.setPlayerMarker(
                localPlayerId,
                localPlayer.name,
                shotData.finalPosition,
                shotData.distanceFromHoleYards,
                localPlayer.color || '#FFFFFF'
            );
        }

        // Reset ball to tee for next player
        visuals.showBallAtAddress();
    } else {
        console.warn('No shot data available to send to server');
    }

    // Now wait 5 seconds locally before expecting next turn (unless game is finished)
    shotTimer.setStatusMessage('Waiting for next turn...');
    setTimeout(() => {
        // Don't update message if game has finished
        if (!isGameFinished) {
            shotTimer.setStatusMessage('Waiting for server...');
        }
    }, 5000);
}

export function onPlayerTookShot() {
    // Legacy function - keeping for compatibility
    // Stop timer when player takes their shot
    shotTimer.stopTimer();
}

// Check for active game session on page load and attempt to rejoin
async function checkAndRejoinActiveGame() {
    const savedSession = loadActiveGameSession();
    if (!savedSession) {
        return;
    }


    try {
        // Verify session still exists on server
        const { API_BASE_URL } = await import('./config.js');
        const response = await fetch(`${API_BASE_URL}/game/session/${savedSession.sessionId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${savedSession.playerToken}`
            }
        });

        if (!response.ok) {
            clearActiveGameSession();
            return;
        }

        const sessionData = await response.json();

        // Restore state
        currentSessionId = savedSession.sessionId;
        currentRoomCode = savedSession.roomCode;
        localPlayerId = savedSession.playerId;
        localPlayerToken = savedSession.playerToken;
        isHost = savedSession.isHost;
        gameMode = savedSession.gameMode;
        isWageringGame = savedSession.isWageringGame;
        wagerAmount = savedSession.wagerAmount;
        players = sessionData.players;

        // Reconnect WebSocket
        wsManager.connect(currentSessionId, localPlayerToken);

        // Show game UI (game is in progress)
        hideLobby();
        startMultiplayerGame();

        updateStatus('Rejoined game!');
        toast.success('Rejoined your active game!');

    } catch (error) {
        console.error('Error rejoining game:', error);
        clearActiveGameSession();
    }
}

// LocalStorage helpers for active game session
function saveActiveGameSession() {
    const sessionData = {
        sessionId: currentSessionId,
        roomCode: currentRoomCode,
        playerId: localPlayerId,
        playerToken: localPlayerToken,
        isHost,
        gameMode,
        isWageringGame,
        wagerAmount,
        savedAt: Date.now()
    };
    localStorage.setItem('golfishard_activeGame', JSON.stringify(sessionData));
}

function loadActiveGameSession() {
    const stored = localStorage.getItem('golfishard_activeGame');
    if (!stored) return null;

    try {
        const sessionData = JSON.parse(stored);
        // Expire after 24 hours
        if (Date.now() - sessionData.savedAt > 24 * 60 * 60 * 1000) {
            clearActiveGameSession();
            return null;
        }
        return sessionData;
    } catch (error) {
        console.error('Error loading active game session:', error);
        return null;
    }
}

function clearActiveGameSession() {
    localStorage.removeItem('golfishard_activeGame');
}

function resetState() {
    currentSessionId = null;
    currentRoomCode = null;
    localPlayerId = null;
    localPlayerToken = null;
    isHost = false;
    players = [];
    isReady = false;
    playerScores = {};
    currentPlayerIndex = -1;
    isGameFinished = false;
    isFirstTurnOfGame = false;
    hideScoreboard();
    clearActiveGameSession();
}

// Exports for other modules
export function getCurrentSessionId() {
    return currentSessionId;
}

export function getPlayers() {
    return [...players];
}

export function isLocalPlayerTurn() {
    // Not in multiplayer - always allow
    if (!currentSessionId) return true;

    // Check if it's our turn based on currentPlayerIndex
    const localPlayerIdx = players.findIndex(p => p.id === localPlayerId);
    const isMyTurn = localPlayerIdx === currentPlayerIndex;

    console.log('🎯 [TURN CHECK] isLocalPlayerTurn called:', {
        localPlayerId,
        localPlayerIdx,
        currentPlayerIndex,
        isMyTurn,
        players: players.map(p => p.id)
    });

    return isMyTurn;
}

function showGameSummaryModal({ isLocalWinner, winner, winnerDistance, sortedPlayers, payoutData, isWageringGame, onPlayAgain, onReturnToMenu }) {
    // Create modal HTML
    const modalHTML = `
        <div class="game-summary-modal-overlay" id="game-summary-overlay">
            <div class="game-summary-modal">
                <div class="game-summary-header ${isLocalWinner ? 'winner' : ''}">
                    <h2>${isLocalWinner ? '🎉 Victory!' : '🏁 Game Over'}</h2>
                    <p class="winner-text">${winner.name} won with ${winnerDistance} yards!</p>
                </div>

                <div class="game-summary-results">
                    <h3>Final Results</h3>
                    <div class="players-list">
                        ${sortedPlayers.map((p, index) => `
                            <div class="player-result ${p.isWinner ? 'winner' : ''} ${p.id === localPlayerId ? 'local-player' : ''}">
                                <span class="rank">${index + 1}</span>
                                <span class="player-name">${p.isWinner ? '🏆 ' : ''}${p.name}${p.id === localPlayerId ? ' (You)' : ''}</span>
                                <span class="distance">${p.distanceYards.toFixed(1)} yards</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                ${payoutData && isWageringGame ? `
                    <div class="game-summary-payout">
                        <h3>💰 Payout</h3>
                        <p><strong>${payoutData.payoutAmount} NANO</strong> sent to winner</p>
                        ${isLocalWinner ? `<p class="payout-address">Address: ${payoutData.payoutAddress.substring(0, 30)}...</p>` : ''}
                    </div>
                ` : ''}

                <div class="game-summary-actions">
                    <button class="btn-play-again" id="btn-play-again">Play Again</button>
                    <button class="btn-return-menu" id="btn-return-menu">Return to Menu</button>
                </div>
            </div>
        </div>
    `;

    // Insert modal into document
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Add event listeners
    document.getElementById('btn-play-again').addEventListener('click', () => {
        console.log('🔄 [PLAY AGAIN] Button clicked, removing modal and calling onPlayAgain');
        document.getElementById('game-summary-overlay').remove();
        console.log('🔄 [PLAY AGAIN] Modal removed, calling onPlayAgain callback');
        onPlayAgain();
    });

    document.getElementById('btn-return-menu').addEventListener('click', () => {
        document.getElementById('game-summary-overlay').remove();
        onReturnToMenu();
    });
}

export function hasLocalPlayerShot() {
    // Check if local player has already taken their shot in CTF mode
    if (!currentSessionId) return false; // Not in multiplayer
    if (gameMode !== 'closest-to-flag') return false; // Not in CTF mode

    return playerScores[localPlayerId]?.hasShot || false;
}
