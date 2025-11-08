// src/network/apiClient.js

// Server URL - update this for production
import { API_BASE_URL } from '../config.js';

const BASE_URL = API_BASE_URL;

/**
 * A helper function to make authenticated API requests.
 * @param {string} endpoint - The API endpoint to call (e.g., '/game/create').
 * @param {string} method - The HTTP method (e.g., 'GET', 'POST').
 * @param {object} [body] - The request body for POST/PUT requests.
 * @param {string} [authToken] - The auth token for authentication.
 * @returns {Promise<object>} The JSON response from the server.
 * @throws {Error} If the network response is not ok.
 */
async function fetchWithAuth(endpoint, method = 'GET', body = null, authToken = null) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }

    const config = {
        method,
        headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
        config.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, config);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
        const errorMessage = errorData.error?.message || errorData.message || response.statusText;
        throw new Error(errorMessage);
    }
    return response.json();
}

/**
 * Authenticates the user with the backend.
 * @param {string} authToken - The auth token.
 * @returns {Promise<object>} Server response, e.g., user profile from your backend.
 */
export async function authenticateUserWithServer(authToken) {
    return fetchWithAuth('/auth/verify-token', 'POST', { token: authToken }, authToken);
}

/**
 * Creates a new game session on the server.
 * @param {string} authToken - The auth token of the host.
 * @param {object} gameSettings - Settings for the game (e.g., courseId, maxPlayers).
 * @returns {Promise<object>} Server response, e.g., { sessionId, gameCode }.
 */
export async function createGameSession(authToken, gameSettings) {
    return fetchWithAuth('/game/create', 'POST', gameSettings, authToken);
}

/**
 * Joins an existing game session on the server.
 * @param {string} authToken - The auth token of the joining player.
 * @param {string} gameCode - The code to join the game session.
 * @param {string} [playerName] - Optional player name.
 * @returns {Promise<object>} Server response, e.g., { sessionId, courseData, players }.
 */
export async function joinGameSession(authToken, gameCode, playerName = null) {
    const body = { roomCode: gameCode };
    if (playerName) {
        body.playerName = playerName;
    }
    return fetchWithAuth('/game/join', 'POST', body, authToken);
}

/**
 * Fetches course/hole data for a given session.
 * @param {string} authToken - The auth token.
 * @param {string} sessionId - The ID of the game session.
 * @returns {Promise<object>} Server response containing course/hole data.
 */
export async function fetchCourseData(authToken, sessionId) {
    return fetchWithAuth(`/game/${sessionId}/course`, 'GET', null, authToken);
}

/**
 * Submits the final scores of a game to the server.
 * @param {string} authToken - The auth token.
 * @param {string} sessionId - The ID of the game session.
 * @param {object} scoreDetails - The scores and other relevant game end data.
 * @returns {Promise<object>} Server response confirming score submission.
 */
export async function submitScore(authToken, sessionId, scoreDetails) {
    return fetchWithAuth(`/game/${sessionId}/score`, 'POST', scoreDetails, authToken);
}

/**
 * Checks if the player has an active multiplayer game session.
 * @param {string} authToken - The auth token.
 * @returns {Promise<object>} { hasActiveGame: boolean, session: {...} | null }
 */
export async function checkActiveGame(authToken) {
    return fetchWithAuth('/game/active', 'GET', null, authToken);
}

/**
 * Retrieves the game history for the authenticated player.
 * @param {string} authToken - The auth token.
 * @returns {Promise<object>} Server response with player's game history.
 */
export async function getPlayerHistory(authToken) {
    return fetchWithAuth('/player/history', 'GET', null, authToken);
}

/**
 * Leaves the current game session
 * @param {string} authToken - The auth token
 * @param {string} sessionId - The ID of the game session to leave
 * @returns {Promise<object>} Server response with refund info if applicable
 */
export async function leaveGame(authToken, sessionId) {
    return fetchWithAuth('/game/leave', 'POST', { sessionId }, authToken);
}

// Add other API client functions as needed, e.g., for fetching leaderboards, player profiles, etc.
