// src/network/webSocketManager.js

// Placeholder for the WebSocket server URL. This will be configured later.
const WEBSOCKET_URL = 'ws://your-server-address.com/ws'; // Replace with your actual WebSocket server URL

let socket = null;
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

/**
 * Connects to the WebSocket server for a given game session.
 * @param {string} sessionId - The ID of the game session to connect to.
 * @param {string} idToken - The Firebase ID token for authentication.
 */
export function connect(sessionId, idToken) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.warn('WebSocket is already connected.');
        return;
    }

    const url = `${WEBSOCKET_URL}?sessionId=${sessionId}&token=${idToken}`;
    socket = new WebSocket(url);

    socket.onopen = (event) => {
        console.log('WebSocket connection established.');
        if (onOpenCallback) {
            onOpenCallback(event);
        }
    };

    socket.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        try {
            const message = JSON.parse(event.data);
            if (onMessageCallback) {
                onMessageCallback(message);
            }
            // Route message to specific handlers based on type
            switch (message.type) {
                case 'playerShot':
                    if (onPlayerShotCallback) onPlayerShotCallback(message.payload);
                    break;
                case 'turnChange':
                    if (onTurnChangeCallback) onTurnChangeCallback(message.payload);
                    break;
                case 'chatMessage':
                    if (onChatMessageCallback) onChatMessageCallback(message.payload);
                    break;
                case 'playerJoined':
                    if (onPlayerJoinedCallback) onPlayerJoinedCallback(message.payload);
                    break;
                case 'playerLeft':
                    if (onPlayerLeftCallback) onPlayerLeftCallback(message.payload);
                    break;
                case 'gameStart':
                    if (onGameStartCallback) onGameStartCallback(message.payload);
                    break;
                case 'gameStateUpdate':
                     if (onGameStateUpdateCallback) onGameStateUpdateCallback(message.payload);
                     break;
                default:
                    console.warn('Received unknown WebSocket message type:', message.type);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message or in callback:', error);
        }
    };

    socket.onclose = (event) => {
        console.log('WebSocket connection closed.', event.code, event.reason);
        if (onCloseCallback) {
            onCloseCallback(event);
        }
        socket = null; // Clear the socket reference
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (onErrorCallback) {
            onErrorCallback(error);
        }
    };
}

/**
 * Sends a message over the WebSocket connection.
 * @param {object} message - The message object to send. Must be serializable to JSON.
 */
function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        console.error('WebSocket is not connected or not open. Cannot send message.');
    }
}

/**
 * Sends player shot input parameters to the server.
 * @param {object} inputs - The shot input parameters (e.g., club, power, aim).
 */
export function sendShotInputs(inputs) {
    sendMessage({ type: 'shotInputs', payload: inputs });
}

/**
 * Sends a chat message to the server.
 * @param {string} text - The chat message text.
 */
export function sendChatMessage(text) {
    sendMessage({ type: 'chat', payload: { message: text } });
}

/**
 * Closes the WebSocket connection.
 */
export function disconnect() {
    if (socket) {
        socket.close();
    }
}

/**
 * Registers a callback function to handle incoming messages.
 * @param {function} callback - The function to call when a message is received.
 *                              It will be passed the parsed message object.
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
 * Checks if the WebSocket is currently connected.
 * @returns {boolean} True if connected, false otherwise.
 */
export function isConnected() {
    return socket && socket.readyState === WebSocket.OPEN;
}
