// Multiplayer Manager - Handles lobby and game coordination
import * as apiClient from './network/apiClient.js';
import * as wsManager from './network/webSocketManager.js';
import * as ui from './ui.js';
import * as shotTimer from './shotTimer.js';
import { setGameMode, GAME_MODES } from './main.js';
import * as visuals from './visuals.js';

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
let currentPlayerIndex = -1; // Index of the player whose turn it is (-1 = not started)
let isWatchingOtherPlayerShot = false; // Track if we're animating someone else's shot
let isGameFinished = false; // Track if the game has finished

// Mock token for development
const generateDevToken = () => 'dev-token-' + Math.random().toString(36).substring(7);

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
const playAgainBtn = document.getElementById('play-again-btn');

// Player scores (distance from hole in CTF)
let playerScores = {}; // { playerId: { distanceMeters, distanceYards, hasShot } }

export function init() {
    console.log('Multiplayer Manager initialized');

    // Set up button handlers
    lobbyReadyBtn?.addEventListener('click', handleReadyClick);
    lobbyStartBtn?.addEventListener('click', handleStartClick);
    lobbyLeaveBtn?.addEventListener('click', handleLeaveClick);
    copyRoomCodeBtn?.addEventListener('click', handleCopyRoomCode);
    playAgainBtn?.addEventListener('click', handlePlayAgainClick);

    // Set up WebSocket callbacks
    setupWebSocketHandlers();
}

export async function hostGame(mode = 'closest-to-flag') {
    try {
        localPlayerToken = generateDevToken();
        localPlayerId = localPlayerToken;
        gameMode = mode;
        isHost = true;

        const response = await apiClient.createGameSession(localPlayerToken, {
            maxPlayers: 4,
            courseId: 'default'
        });

        currentSessionId = response.sessionId;
        currentRoomCode = response.roomCode;

        console.log('Game created:', currentRoomCode);

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
        alert('Failed to create game: ' + error.message);
        return null;
    }
}

export async function joinGame(roomCode) {
    try {
        localPlayerToken = generateDevToken();
        localPlayerId = localPlayerToken;
        isHost = false;

        const response = await apiClient.joinGameSession(localPlayerToken, roomCode);

        currentSessionId = response.sessionId;
        currentRoomCode = roomCode;
        players = response.players || [];

        console.log('Joined game:', roomCode);

        // Connect WebSocket
        wsManager.connect(currentSessionId, localPlayerToken);

        // Show lobby
        showLobby();
        updateLobbyDisplay();

        return { sessionId: currentSessionId, roomCode };
    } catch (error) {
        console.error('Failed to join game:', error);
        alert('Failed to join game: ' + error.message);
        return null;
    }
}

function setupWebSocketHandlers() {
    wsManager.setOnOpenCallback(() => {
        console.log('WebSocket connected');
        updateStatus('Connected to game');
    });

    wsManager.setOnPlayerJoinedCallback((data) => {
        console.log('Player joined:', data);
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
        console.log('Player left:', data);
        players = players.filter(p => p.id !== data.playerId);
        updateLobbyDisplay();
        updateStatus('A player left');
    });

    wsManager.setOnGameStateUpdateCallback((data) => {
        console.log('🎮 Game state update received:', data);
        console.log('📋 Players from server:', data.players);
        if (data.players) {
            players = data.players;
            console.log('✅ Updated local players array:', players);
            updateLobbyDisplay();
        } else {
            console.warn('⚠️ Game state update had no players array!');
        }
    });

    wsManager.setOnGameStartCallback((data) => {
        console.log('Game started!', data);
        // Track which player's turn it is
        if (data.currentPlayerIndex !== undefined) {
            currentPlayerIndex = data.currentPlayerIndex;
            console.log('Starting turn index:', currentPlayerIndex);
        }
        hideLobby();
        startMultiplayerGame();
    });

    wsManager.setOnErrorCallback((error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection error');
    });

    // Listen for turn changes
    wsManager.setOnTurnChangeCallback((data) => {
        console.log('Turn changed:', data);
        handleTurnChange(data);
    });

    // Listen for shots from other players
    wsManager.setOnPlayerShotCallback((data) => {
        console.log('Shot received:', data);
        handlePlayerShot(data);
    });

    // Listen for player ready status changes
    wsManager.setOnCustomEventCallback('player:readyStatus', (data) => {
        console.log('Player ready status:', data);
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
        console.log('Game can start:', data);
        if (isHost) {
            updateLobbyDisplay(); // This will show the start button
            updateStatus('All players ready! Click Start Game');
        }
    });

    // Listen for game finished event
    wsManager.setOnCustomEventCallback('game:finished', (data) => {
        console.log('🏁 Game finished event received:', data);
        handleGameFinished(data);
    });
}

function handleGameFinished(data) {
    const { winner, gameMode, playerStates } = data;

    if (!winner) {
        console.error('No winner in game:finished event');
        return;
    }

    console.log('Game finished! Winner:', winner.name, 'Distance:', winner.distanceFromHole, 'meters');

    // Mark game as finished to prevent status message updates
    isGameFinished = true;

    // Use the server's winner determination instead of client-side
    const isLocalWinner = winner.id === localPlayerId;
    const winnerDistance = (winner.distanceFromHole * 1.09361).toFixed(1); // Convert meters to yards

    const message = isLocalWinner
        ? `🏆 You won! ${winnerDistance} yards from the hole!`
        : `${winner.name} won with ${winnerDistance} yards from the hole`;

    shotTimer.setStatusMessage(message);

    // Show Play Again button
    if (playAgainBtn) {
        playAgainBtn.style.display = 'block';
    }
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

function handleStartClick() {
    if (!isHost) return;

    console.log('Host starting game...');
    wsManager.sendGameStart();
}

function handleLeaveClick() {
    if (confirm('Leave the game?')) {
        wsManager.disconnect();
        hideLobby();
        resetState();
        ui.showMainMenu();
    }
}

function handleCopyRoomCode() {
    if (currentRoomCode) {
        navigator.clipboard.writeText(currentRoomCode).then(() => {
            alert('Room code copied: ' + currentRoomCode);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }
}

function showLobby() {
    if (lobby) {
        lobby.style.display = 'block';
        const mainMenu = document.getElementById('main-menu');
        if (mainMenu) mainMenu.style.display = 'none';
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

    // Update player list
    if (lobbyPlayerList) {
        lobbyPlayerList.innerHTML = '';
        players.forEach(player => {
            const playerDiv = document.createElement('div');
            playerDiv.style.cssText = 'padding: 5px; margin: 3px 0; background: #f9f9f9; border-radius: 3px;';

            const isYou = player.id === localPlayerId;
            const hostBadge = player.isHost ? ' 👑' : '';
            const readyBadge = player.isReady ? ' ✅' : '';

            playerDiv.textContent = `${player.name || 'Player'}${hostBadge}${readyBadge}${isYou ? ' (You)' : ''}`;

            lobbyPlayerList.appendChild(playerDiv);
        });
    }

    // Update game mode display
    if (lobbyGameMode) lobbyGameMode.textContent = 'Closest to Flag';
    if (lobbyTargetDistance) lobbyTargetDistance.textContent = targetDistance;

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
}

function updateScoreboard() {
    if (!scoreboardPlayerList) return;

    scoreboardPlayerList.innerHTML = '';

    players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.style.cssText = 'padding: 8px; margin: 5px 0; background: #f9f9f9; border-radius: 4px; border-left: 3px solid ' + (player.id === localPlayerId ? '#4CAF50' : '#ddd');

        const isYou = player.id === localPlayerId;
        const isCurrent = players.indexOf(player) === currentPlayerIndex;
        const playerName = (player.name || 'Player') + (isYou ? ' (You)' : '');

        const score = playerScores[player.id];
        let scoreText = '';

        if (score && score.hasShot) {
            scoreText = `<strong>${score.distanceYards.toFixed(1)} yd</strong>`;
        } else if (isCurrent) {
            scoreText = '<em>shooting...</em>';
        } else {
            scoreText = '<em>waiting...</em>';
        }

        playerDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>${isCurrent ? '► ' : ''}${playerName}</span>
                <span style="margin-left: 10px;">${scoreText}</span>
            </div>
        `;

        scoreboardPlayerList.appendChild(playerDiv);
    });
}

export function updatePlayerScore(playerId, distanceMeters, distanceYards) {
    playerScores[playerId] = {
        distanceMeters,
        distanceYards,
        hasShot: true
    };
    updateScoreboard();

    // Check if all players have finished
    checkForGameCompletion();
}

function checkForGameCompletion() {
    // Only check in CTF mode
    if (gameMode !== 'closest-to-flag') return;

    // Check if all players have shot
    const allPlayersFinished = players.every(player => playerScores[player.id]?.hasShot);

    if (allPlayersFinished) {
        console.log('All players have finished! Determining winner...');
        showWinner();
    }
}

function showWinner() {
    // Find the player with the shortest distance
    let winner = null;
    let bestDistance = Infinity;

    players.forEach(player => {
        const score = playerScores[player.id];
        if (score && score.distanceMeters < bestDistance) {
            bestDistance = score.distanceMeters;
            winner = player;
        }
    });

    if (!winner) {
        console.error('Could not determine winner');
        return;
    }

    const isLocalWinner = winner.id === localPlayerId;
    const winnerName = winner.name || 'Player';
    const winnerDistance = playerScores[winner.id].distanceYards.toFixed(1);

    // Show winner message in top center status
    const message = isLocalWinner
        ? `🏆 You won! ${winnerDistance} yards from the hole!`
        : `${winnerName} won with ${winnerDistance} yards from the hole`;

    shotTimer.setStatusMessage(message);

    // Show Play Again button
    if (playAgainBtn) {
        playAgainBtn.style.display = 'block';
    }

    console.log('Winner:', winnerName, 'Distance:', winnerDistance, 'yards');
}

function handlePlayAgainClick() {
    console.log('Play again clicked');

    // Reset player scores and game finished flag
    playerScores = {};
    isGameFinished = false;

    // Hide Play Again button
    if (playAgainBtn) {
        playAgainBtn.style.display = 'none';
    }

    // Update scoreboard to reset
    updateScoreboard();

    // Reset the game state (but keep multiplayer session)
    // This will allow players to take new shots
    shotTimer.setStatusMessage('Starting new round...');

    // TODO: Need to coordinate with server to reset game state for all players
    // For now, just reset locally
    console.log('New round started');
}

async function startMultiplayerGame() {
    console.log('Starting multiplayer Closest to Flag game...');

    // Show game view FIRST so canvas can get proper dimensions
    ui.showGameView();

    // Small delay to ensure DOM has updated and canvas has proper size
    await new Promise(resolve => setTimeout(resolve, 50));

    // Initialize CTF mode (sets up visuals and game state)
    await setGameMode(GAME_MODES.CLOSEST_TO_FLAG);

    // Show multiplayer scoreboard
    showScoreboard();

    // Find our local player index
    const localPlayerIdx = players.findIndex(p => p.id === localPlayerId);
    console.log('Local player index:', localPlayerIdx, 'Current turn:', currentPlayerIndex);

    // Only start timer if it's this player's turn
    if (localPlayerIdx === currentPlayerIndex) {
        console.log('It\'s your turn! Starting timer...');
        startShotTimer('Your shot, {time} seconds left');
    } else {
        // Show waiting message for other players
        const currentPlayer = players[currentPlayerIndex];
        const playerName = currentPlayer?.name || 'Player';
        console.log('Waiting for', playerName, '\'s turn');
        startWatchingTimer(playerName);
    }
}

function handleTurnChange(data) {
    // Update the current turn index
    if (data.currentPlayerIndex !== undefined) {
        currentPlayerIndex = data.currentPlayerIndex;
        console.log('Turn changed to player index:', currentPlayerIndex);
    }

    // Update scoreboard to show whose turn it is
    updateScoreboard();

    // Find our local player index
    const localPlayerIdx = players.findIndex(p => p.id === localPlayerId);

    // Check if it's now our turn
    if (localPlayerIdx === currentPlayerIndex) {
        console.log('It\'s now your turn!');
        startShotTimer('Your shot, {time} seconds left');
    } else {
        // Stop timer if it was running
        shotTimer.stopTimer();

        // Show waiting message for other player's turn
        const currentPlayer = players[currentPlayerIndex];
        const playerName = currentPlayer?.name || 'Player';
        console.log('Waiting for', playerName, '\'s turn');
        startWatchingTimer(playerName);
    }
}

function handlePlayerShot(data) {
    const { playerId, shotData } = data;

    console.log('handlePlayerShot received:', { playerId, shotData });

    // Update scoreboard with player's distance (for both local and remote players)
    if (shotData && shotData.distanceFromHoleMeters !== undefined && shotData.distanceFromHoleYards !== undefined) {
        console.log('Updating player score with distance:', shotData.distanceFromHoleYards, 'yards');
        updatePlayerScore(playerId, shotData.distanceFromHoleMeters, shotData.distanceFromHoleYards);
    } else {
        console.warn('Shot data missing distance fields:', shotData);
    }

    // Ignore shots from ourselves (we already animated it)
    if (playerId === localPlayerId) {
        console.log('Received our own shot, ignoring animation');
        return;
    }

    // Find the player who took the shot
    const player = players.find(p => p.id === playerId);
    const playerName = player?.name || 'Player';

    console.log(`Received shot from ${playerName}, animating...`);
    shotTimer.setStatusMessage(`Watching ${playerName}'s shot...`);

    // Set flag to prevent onBallStopped from sending duplicate shot data
    isWatchingOtherPlayerShot = true;

    // Animate the other player's shot
    if (shotData && shotData.trajectory) {
        visuals.animateBallFlightWithLanding(shotData);

        // After animation completes (handled by callback), wait a bit then update status
        // The turn:changed event will handle starting the next timer
    } else {
        console.warn('Received shot without trajectory data');
        isWatchingOtherPlayerShot = false;
    }
}

function startShotTimer(messageTemplate) {
    console.log('Starting shot timer for player turn');

    shotTimer.startTimer(() => {
        console.log('Shot timer expired!');
        alert('Time\'s up! You took too long.');
        // TODO: Auto-forfeit turn or take random shot
    }, messageTemplate);
}

function startWatchingTimer(playerName) {
    console.log('Starting watching timer for', playerName);

    // Use the timer but with a different message template
    shotTimer.startTimer(() => {
        console.log('Other player\'s timer expired');
        // Don't need to do anything for other player's timeout
    }, `${playerName}'s turn, {time} seconds left`);
}

// Called when local player starts their shot (w key pressed)
export function onShotStarted() {
    // Only handle multiplayer logic if we're in a multiplayer session
    if (!currentSessionId) {
        return; // Not in multiplayer, nothing to do
    }

    console.log('Shot started, stopping timer');
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
        console.log('Finished watching other player\'s shot');
        isWatchingOtherPlayerShot = false;
        shotTimer.setStatusMessage('Waiting for next turn...');
        return;
    }

    // This is our own shot - send it to the server
    console.log('Ball stopped, sending shot to server immediately');

    // Send shot data to server immediately so other players can see the animation
    if (shotData) {
        const shotPayload = {
            finalPosition: shotData.finalPosition,
            totalDistance: shotData.totalDistance,
            carryDistance: shotData.carryDistance,
            rolloutDistance: shotData.rolloutDistance,
            isHoledOut: shotData.isHoledOut || false,
            trajectory: shotData.trajectory, // Include trajectory for other players to animate
            distanceFromHoleMeters: shotData.distanceFromHoleMeters, // CTF distance
            distanceFromHoleYards: shotData.distanceFromHoleYards // CTF distance
        };
        console.log('Sending shot data with distance:', shotPayload.distanceFromHoleYards, 'yards');
        wsManager.sendShotData(shotPayload);
    } else {
        console.warn('No shot data available to send to server');
    }

    // Now wait 5 seconds locally before expecting next turn (unless game is finished)
    shotTimer.setStatusMessage('Waiting for next turn...');
    setTimeout(() => {
        // Don't update message if game has finished
        if (!isGameFinished) {
            console.log('5 second delay complete, ready for next turn');
            shotTimer.setStatusMessage('Waiting for server...');
        }
    }, 5000);
}

export function onPlayerTookShot() {
    // Legacy function - keeping for compatibility
    // Stop timer when player takes their shot
    shotTimer.stopTimer();
    console.log('Shot taken, timer stopped');
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
    hideScoreboard();
}

// Exports for other modules
export function getCurrentSessionId() {
    return currentSessionId;
}

export function getPlayers() {
    return [...players];
}

export function isLocalPlayerTurn() {
    // For turn-based: check if it's our turn
    // For now, always allow (simultaneous mode)
    return true;
}

export function hasLocalPlayerShot() {
    // Check if local player has already taken their shot in CTF mode
    if (!currentSessionId) return false; // Not in multiplayer
    if (gameMode !== 'closest-to-flag') return false; // Not in CTF mode

    return playerScores[localPlayerId]?.hasShot || false;
}
