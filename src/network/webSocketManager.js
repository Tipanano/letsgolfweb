// src/network/webSocketManager.js
// Using Socket.IO client (CDN or npm install socket.io-client)

// Socket.IO server URL - update for production
import { WEBSOCKET_URL } from '../config.js';

let socket = null;
let currentSessionId = null; // Store current session ID
let currentAuthToken = null; // Store current auth token
let onMessageCallback = null; // Callback for general message handling
let onOpenCallback = null;
let onCloseCallback = null;
let onErrorCallback = null;

// Callbacks for specific game events
let onPlayerShotCallback = null;
let onTurnChangeCallback = null;
let onChatMessageCallback = null;
let onPlayerJoinedCallback = null;
let onPlayerLeftCallback = null;
let onGameStartCallback = null;
let onGameStateUpdateCallback = null; // For more general game state sync

// Import Socket.IO client (will be loaded from CDN in HTML)
// If using npm: import { io } from 'socket.io-client';

/**
 * Connects to the Socket.IO server for a given game session.
 * @param {string} sessionId - The ID of the game session to connect to.
 * @param {string} authToken - The auth token for authentication.
 */
export function connect(sessionId, authToken) {
    console.log('🔌 [WS] connect() called with:', {
        sessionId,
        hasAuthToken: !!authToken,
        socketExists: !!socket,
        socketConnected: socket?.connected
    });

    // Store session info for reconnections
    currentSessionId = sessionId;
    currentAuthToken = authToken;

    console.log('💾 [WS] Stored session info:', {
        currentSessionId,
        hasCurrentAuthToken: !!currentAuthToken
    });

    if (socket && socket.connected) {
        console.warn('⚠️ [WS] Socket.IO is already connected. Rejoining with new session.');
        // If already connected, just rejoin with the new session
        if (currentSessionId) {
            console.log('📤 [WS] Emitting join-session (already connected):', { sessionId: currentSessionId });
            socket.emit('join-session', { sessionId: currentSessionId, playerId: currentAuthToken });
        } else {
            console.error('❌ [WS] No currentSessionId available!');
        }
        return;
    }

    console.log('🆕 [WS] Creating new Socket.IO connection to:', WEBSOCKET_URL);

    // Connect to Socket.IO server
    socket = window.io(WEBSOCKET_URL, {
        auth: {
            token: authToken
        }
    });

    socket.on('connect', () => {
        console.log('✅ [WS] Socket.IO connection established:', socket.id);
        console.log('📊 [WS] Current state:', {
            currentSessionId,
            hasCurrentAuthToken: !!currentAuthToken
        });

        // Join the game session room using stored values (handles reconnections)
        if (currentSessionId) {
            console.log('📤 [WS] Emitting join-session:', { sessionId: currentSessionId });
            socket.emit('join-session', { sessionId: currentSessionId, playerId: currentAuthToken });
        } else {
            console.error('❌ [WS] No sessionId available for join-session event');
        }

        if (onOpenCallback) {
            onOpenCallback();
        }
    });

    // Listen for specific Socket.IO events from server
    socket.on('player:joined', (data) => {
        console.log('Player joined:', data);
        if (onPlayerJoinedCallback) onPlayerJoinedCallback(data);
    });

    socket.on('player:left', (data) => {
        console.log('Player left:', data);
        if (onPlayerLeftCallback) onPlayerLeftCallback(data);
    });

    socket.on('shot:received', (data) => {
        console.log('Shot received:', data);
        if (onPlayerShotCallback) onPlayerShotCallback(data);
    });

    socket.on('turn:changed', (data) => {
        console.log('Turn changed:', data);
        if (onTurnChangeCallback) onTurnChangeCallback(data);
    });

    socket.on('game:stateUpdate', (data) => {
        console.log('🔵 WebSocket received game:stateUpdate event:', data);
        if (onGameStateUpdateCallback) {
            console.log('✅ Calling onGameStateUpdateCallback');
            onGameStateUpdateCallback(data);
        } else {
            console.warn('⚠️ No onGameStateUpdateCallback registered!');
        }
    });

    socket.on('game:started', (data) => {
        console.log('Game started:', data);
        if (onGameStartCallback) onGameStartCallback(data);
    });

    socket.on('game:finished', (data) => {
        console.log('🏁 Game finished:', data);
        if (customEventCallbacks['game:finished']) {
            customEventCallbacks['game:finished'](data);
        }
    });

    socket.on('chat:message', (data) => {
        console.log('Chat message:', data);
        if (onChatMessageCallback) onChatMessageCallback(data);
    });

    socket.on('error', (error) => {
        console.error('Socket.IO error:', error);
        if (onErrorCallback) onErrorCallback(error);
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket.IO disconnected:', reason);
        if (onCloseCallback) {
            onCloseCallback(reason);
        }
    });

    // Listen for player:readyStatus event
    socket.on('player:readyStatus', (data) => {
        console.log('Player ready status:', data);
        if (customEventCallbacks['player:readyStatus']) {
            customEventCallbacks['player:readyStatus'](data);
        }
    });

    // Listen for game:canStart event
    socket.on('game:canStart', (data) => {
        console.log('Game can start:', data);
        if (customEventCallbacks['game:canStart']) {
            customEventCallbacks['game:canStart'](data);
        }
    });

    // Listen for escrow:created event (wagering games)
    socket.on('escrow:created', (data) => {
        console.log('💰 Escrow created:', data);
        if (customEventCallbacks['escrow:created']) {
            customEventCallbacks['escrow:created'](data);
        }
    });

    // Listen for payment:status event (wagering games)
    socket.on('payment:status', (data) => {
        console.log('💰 Payment status update:', data);
        if (customEventCallbacks['payment:status']) {
            customEventCallbacks['payment:status'](data);
        }
    });

    // Listen for payment:complete event (all players paid)
    socket.on('payment:complete', (data) => {
        console.log('✅ All payments complete:', data);
        if (customEventCallbacks['payment:complete']) {
            customEventCallbacks['payment:complete'](data);
        }
    });

    // Listen for game:cancelled event (host left)
    socket.on('game:cancelled', (data) => {
        console.log('❌ Game cancelled:', data);
        if (customEventCallbacks['game:cancelled']) {
            customEventCallbacks['game:cancelled'](data);
        }
    });
}

// Storage for custom event callbacks
const customEventCallbacks = {};

/**
 * Sets a callback for custom events not covered by standard callbacks
 * @param {string} eventName - The event name
 * @param {function} callback - The callback function
 */
export function setOnCustomEventCallback(eventName, callback) {
    customEventCallbacks[eventName] = callback;
}

/**
 * Sends player shot data to the server.
 * @param {object} shotData - The shot data (position, club, etc.).
 */
export function sendShotData(shotData) {
    if (socket && socket.connected) {
        socket.emit('player:shot', shotData);
    } else {
        console.error('Socket.IO is not connected. Cannot send shot.');
    }
}

/**
 * Sends a chat message to the server.
 * @param {string} text - The chat message text.
 * @param {string} playerName - The player's name.
 */
export function sendChatMessage(text, playerName) {
    if (socket && socket.connected) {
        socket.emit('chat:message', { message: text, playerName });
    } else {
        console.error('Socket.IO is not connected. Cannot send message.');
    }
}

/**
 * Marks the player as ready.
 */
export function sendPlayerReady() {
    if (socket && socket.connected) {
        socket.emit('player:ready');
    } else {
        console.error('Socket.IO is not connected. Cannot send ready status.');
    }
}

/**
 * Starts the game (host only).
 */
export function sendGameStart() {
    if (socket && socket.connected) {
        socket.emit('game:start');
    } else {
        console.error('Socket.IO is not connected. Cannot start game.');
    }
}

/**
 * Closes the Socket.IO connection.
 */
export function disconnect() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    // Clear stored session info
    currentSessionId = null;
    currentAuthToken = null;
}

/**
 * Registers a callback function to handle incoming messages.
 * @param {function} callback - The function to call when a message is received.
 */
export function setOnMessageCallback(callback) {
    onMessageCallback = callback;
}

export function setOnOpenCallback(callback) {
    onOpenCallback = callback;
}

export function setOnCloseCallback(callback) {
    onCloseCallback = callback;
}

export function setOnErrorCallback(callback) {
    onErrorCallback = callback;
}

// Setters for specific event callbacks
export function setOnPlayerShotCallback(callback) { onPlayerShotCallback = callback; }
export function setOnTurnChangeCallback(callback) { onTurnChangeCallback = callback; }
export function setOnChatMessageCallback(callback) { onChatMessageCallback = callback; }
export function setOnPlayerJoinedCallback(callback) { onPlayerJoinedCallback = callback; }
export function setOnPlayerLeftCallback(callback) { onPlayerLeftCallback = callback; }
export function setOnGameStartCallback(callback) { onGameStartCallback = callback; }
export function setOnGameStateUpdateCallback(callback) { onGameStateUpdateCallback = callback; }

/**
 * Checks if Socket.IO is currently connected.
 * @returns {boolean} True if connected, false otherwise.
 */
export function isConnected() {
    return socket && socket.connected;
}
