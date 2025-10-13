// src/multiplayer/sessionManager.js

import * as apiClient from '../network/apiClient.js';
import * as RWS from '../network/webSocketManager.js'; // RWS for Realtime WebSocket
import { Player, createPlayer } from '../models/player.js';

let currentSessionId = null;
let currentGameCode = null;
let localPlayerId = null;
let authToken = null;
let players = []; // Array of Player objects in the current session
let onPlayerListUpdateCallback = null; // Callback when the player list changes
let onSessionJoinErrorCallback = null;
let onSessionCreateErrorCallback = null;

/**
 * Initializes the session manager with the local player's ID and auth token.
 * @param {string} playerId - The local player's ID.
 * @param {string} token - The auth token.
 */
export function initialize(playerId, token) {
    localPlayerId = playerId;
    authToken = token;
}

/**
 * Hosts a new game session.
 * @param {object} gameSettings - Settings for the game (e.g., courseId, maxPlayers).
 * @returns {Promise<boolean>} True if session creation and WebSocket connection were successful.
 */
export async function hostNewGame(gameSettings) {
    if (!authToken) {
        console.error('SessionManager: Auth token not set. Call initialize first.');
        if (onSessionCreateErrorCallback) onSessionCreateErrorCallback('Authentication token not available.');
        return false;
    }
    try {
        const response = await apiClient.createGameSession(authToken, gameSettings);
        currentSessionId = response.sessionId;
        currentGameCode = response.gameCode; // Server should return a game code
        console.log(`Game session created: ${currentSessionId}, Code: ${currentGameCode}`);

        // Add self to player list (server might also send this)
        // Assuming the server confirms the host as the first player or sends player list
        // For now, let's assume we need to create the local player instance
        // The server's response from createGameSession or joinGameSession should ideally provide initial player data.
        // This part might need adjustment based on actual server responses.

        RWS.connect(currentSessionId, authToken);
        // Setup WebSocket event handlers specific to session management if needed
        // e.g., RWS.setOnPlayerJoinedCallback, RWS.setOnPlayerLeftCallback

        // Placeholder: Fetch initial player list or expect it from WebSocket connection
        // For now, assume the host is the first player.
        // This should ideally come from the server response or a subsequent WebSocket message.
        // const localPlayer = createPlayer(localPlayerId, "HostPlayer"); // Display name needs to be fetched/set
        // players = [localPlayer];
        // if(onPlayerListUpdateCallback) onPlayerListUpdateCallback([...players]);


        return true;
    } catch (error) {
        console.error('Error hosting new game:', error);
        if (onSessionCreateErrorCallback) onSessionCreateErrorCallback(error.message || 'Failed to create game.');
        currentSessionId = null;
        currentGameCode = null;
        return false;
    }
}

/**
 * Joins an existing game session using a game code.
 * @param {string} gameCodeToJoin - The code for the game session to join.
 * @returns {Promise<boolean>} True if joining and WebSocket connection were successful.
 */
export async function joinExistingGame(gameCodeToJoin) {
    if (!authToken) {
        console.error('SessionManager: Auth token not set. Call initialize first.');
        if (onSessionJoinErrorCallback) onSessionJoinErrorCallback('Authentication token not available.');
        return false;
    }
    try {
        const response = await apiClient.joinGameSession(authToken, gameCodeToJoin);
        currentSessionId = response.sessionId;
        currentGameCode = gameCodeToJoin; // We already have this
        // The response should ideally include the list of current players and course data
        console.log(`Joined game session: ${currentSessionId}`);
        
        // Update player list from response
        if (response.players && Array.isArray(response.players)) {
            players = response.players.map(p => new Player(p.playerId, p.displayName)); // Assuming server sends player data
            if (onPlayerListUpdateCallback) onPlayerListUpdateCallback([...players]);
        }


        RWS.connect(currentSessionId, authToken);
        // Setup WebSocket event handlers
        // RWS.setOnPlayerJoinedCallback, RWS.setOnPlayerLeftCallback

        return true;
    } catch (error) {
        console.error('Error joining game:', error);
        if (onSessionJoinErrorCallback) onSessionJoinErrorCallback(error.message || 'Failed to join game.');
        currentSessionId = null;
        currentGameCode = null;
        return false;
    }
}

/**
 * Leaves the current game session.
 */
export function leaveGame() {
    if (currentSessionId) {
        RWS.disconnect();
        console.log(`Left game session: ${currentSessionId}`);
    }
    currentSessionId = null;
    currentGameCode = null;
    players = [];
    if (onPlayerListUpdateCallback) onPlayerListUpdateCallback([...players]);
}

/**
 * Gets the current session ID.
 * @returns {string|null}
 */
export function getCurrentSessionId() {
    return currentSessionId;
}

/**
 * Gets the current game code.
 * @returns {string|null}
 */
export function getCurrentGameCode() {
    return currentGameCode;
}

/**
 * Gets the list of players in the current session.
 * @returns {Player[]}
 */
export function getPlayers() {
    return [...players]; // Return a copy
}

/**
 * Adds a player to the session (typically called by WebSocket event).
 * @param {object} playerData - Data for the player to add (e.g., { playerId, displayName }).
 */
export function addPlayer(playerData) {
    if (!players.find(p => p.playerId === playerData.playerId)) {
        const newPlayer = createPlayer(playerData.playerId, playerData.displayName);
        players.push(newPlayer);
        if (onPlayerListUpdateCallback) onPlayerListUpdateCallback([...players]);
        console.log('Player added:', newPlayer);
    }
}

/**
 * Removes a player from the session (typically called by WebSocket event).
 * @param {string} playerIdToRemove - The ID of the player to remove.
 */
export function removePlayer(playerIdToRemove) {
    const initialLength = players.length;
    players = players.filter(p => p.playerId !== playerIdToRemove);
    if (players.length < initialLength) {
        if (onPlayerListUpdateCallback) onPlayerListUpdateCallback([...players]);
        console.log('Player removed:', playerIdToRemove);
    }
}

/**
 * Updates a player's data in the session.
 * @param {string} playerIdToUpdate - The ID of the player to update.
 * @param {object} updatedData - The data to update (e.g., { score, isCurrentTurn }).
 */
export function updatePlayerData(playerIdToUpdate, updatedData) {
    const player = players.find(p => p.playerId === playerIdToUpdate);
    if (player) {
        Object.assign(player, updatedData); // Simple merge, can be more sophisticated
        if (onPlayerListUpdateCallback) onPlayerListUpdateCallback([...players]);
        console.log('Player data updated:', playerIdToUpdate, updatedData);
    }
}


/**
 * Sets a callback function to be invoked when the player list changes.
 * @param {function} callback - The function to call. It will receive the updated player list.
 */
export function setOnPlayerListUpdateCallback(callback) {
    onPlayerListUpdateCallback = callback;
}

export function setOnSessionJoinErrorCallback(callback) {
    onSessionJoinErrorCallback = callback;
}

export function setOnSessionCreateErrorCallback(callback) {
    onSessionCreateErrorCallback = callback;
}

// Example of how webSocketManager might interact with sessionManager
// This would typically be set up in main.js or a similar initialization file.
/*
RWS.setOnPlayerJoinedCallback((playerData) => {
    addPlayer(playerData);
});

RWS.setOnPlayerLeftCallback((playerLeftData) => {
    removePlayer(playerLeftData.playerId);
});
*/

// Ensure RWS (webSocketManager) is initialized and its callbacks are set up
// in your main application logic to call addPlayer, removePlayer, etc.
