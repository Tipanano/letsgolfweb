// Multiplayer Manager - Handles lobby and game coordination
import * as apiClient from './network/apiClient.js';
import * as wsManager from './network/webSocketManager.js';
import * as ui from './ui.js';

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

export function init() {
    console.log('Multiplayer Manager initialized');

    // Set up button handlers
    lobbyReadyBtn?.addEventListener('click', handleReadyClick);
    lobbyStartBtn?.addEventListener('click', handleStartClick);
    lobbyLeaveBtn?.addEventListener('click', handleLeaveClick);
    copyRoomCodeBtn?.addEventListener('click', handleCopyRoomCode);

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
        hideLobby();
        startMultiplayerGame();
    });

    wsManager.setOnErrorCallback((error) => {
        console.error('WebSocket error:', error);
        updateStatus('Connection error');
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

function startMultiplayerGame() {
    console.log('Starting multiplayer Closest to Flag game...');

    // Hide main menu, show game view
    ui.showGameView();

    // TODO: Initialize multiplayer closest to flag mode
    // For now, just show the game
    updateStatus('Game starting...');
}

function resetState() {
    currentSessionId = null;
    currentRoomCode = null;
    localPlayerId = null;
    localPlayerToken = null;
    isHost = false;
    players = [];
    isReady = false;
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
