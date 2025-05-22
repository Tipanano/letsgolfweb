// src/multiplayer/chatController.js

import * as RWS from '../network/webSocketManager.js';
// Import UI functions if chat messages are displayed there
// For example:
// import { displayChatMessageInUI } from '../ui.js';

let onNewMessageCallback = null; // Callback for when a new message arrives for UI update

/**
 * Initializes the chat controller.
 * Sets up a listener for incoming chat messages from the WebSocket manager.
 */
export function initialize() {
    RWS.setOnChatMessageCallback(handleIncomingChatMessage);
    console.log('ChatController initializeddd.');
}

/**
 * Handles an incoming chat message from the server.
 * @param {object} chatData - The chat message data (e.g., { playerId, displayName, message, timestamp }).
 *                            The structure depends on what the server sends.
 */
function handleIncomingChatMessage(chatData) {
    console.log('Chat message received:', chatData);

    // Process the chat message (e.g., format it, add sender info)
    const { senderId, senderDisplayName, message, timestamp } = chatData; // Example structure

    // You might want to prevent displaying messages from yourself if the server echoes them,
    // or handle it gracefully. For now, we assume server doesn't echo to sender or client handles it.

    // Call a UI function to display the message
    // displayChatMessageInUI(senderDisplayName || senderId, message, timestamp);

    if (onNewMessageCallback) {
        onNewMessageCallback(chatData); // Pass the raw or processed data to the UI layer
    }
}

/**
 * Sends a chat message from the local player.
 * @param {string} text - The text of the message to send.
 */
export function sendLocalChatMessage(text) {
    if (!text || text.trim() === '') {
        console.warn('Attempted to send an empty chat message.');
        return;
    }

    if (!RWS.isConnected()) {
        console.error('Cannot send chat message: WebSocket is not connected.');
        // Optionally, queue the message or inform the user.
        return;
    }

    RWS.sendChatMessage(text);
    console.log('Chat message sent:', text);

    // Optionally, display the user's own message in their UI immediately
    // This provides instant feedback. The server might also echo it back.
    // if (onNewMessageCallback) {
    //     onNewMessageCallback({
    //         senderId: 'localUser', // Or actual local player ID
    //         senderDisplayName: 'You', // Or actual local display name
    //         message: text,
    //         timestamp: Date.now()
    //     });
    // }
}

/**
 * Sets a callback function to be invoked when a new chat message is received
 * and ready to be displayed.
 * @param {function} callback - The function to call. It will receive the chat message data.
 */
export function setOnNewMessageCallback(callback) {
    onNewMessageCallback = callback;
}

// Note: The actual display of chat messages (`displayChatMessageInUI`)
// will depend on your `src/ui.js` implementation.
