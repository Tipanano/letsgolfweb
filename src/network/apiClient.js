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

/**
 * Records hole start and gets player's handicap from server
 * Called when first ball is struck (not when hole is selected)
 * @param {string} authToken - The auth token
 * @param {string} holeId - Identifier for the hole being played
 * @param {number} par - Par for the hole
 * @param {boolean} isPracticeMode - Whether this is practice mode
 * @returns {Promise<object>} Server response with handicap, handicapStrokes, etc.
 */
export async function startHole(authToken, holeId, par, isPracticeMode) {
    return fetchWithAuth('/game/hole/start', 'POST', { holeId, par, isPracticeMode }, authToken);
}

/**
 * Records hole completion and updates handicap
 * Called when player holes out (non-practice mode only)
 * @param {string} authToken - The auth token
 * @param {string} sessionId - The game session ID
 * @param {number} grossScore - Actual strokes taken
 * @param {number} par - Par for the hole
 * @param {string} holeId - Identifier for the hole
 * @returns {Promise<object>} Server response with handicap update info
 */
export async function completeHole(authToken, sessionId, grossScore, par, holeId) {
    return fetchWithAuth(`/game/${sessionId}/hole/complete`, 'POST', { grossScore, par, holeId }, authToken);
}

/**
 * Gets player's current handicap
 * @param {string} authToken - The auth token
 * @returns {Promise<object>} Server response with handicap info
 */
export async function getPlayerHandicap(authToken) {
    return fetchWithAuth('/player/handicap', 'GET', null, authToken);
}

/**
 * Gets player's handicap history
 * @param {string} authToken - The auth token
 * @param {number} limit - Number of records to return (default 20)
 * @returns {Promise<object>} Server response with handicap history
 */
export async function getHandicapHistory(authToken, limit = 20) {
    return fetchWithAuth(`/player/handicap/history?limit=${limit}`, 'GET', null, authToken);
}

/**
 * Gets player's handicap statistics
 * @param {string} authToken - The auth token
 * @returns {Promise<object>} Server response with handicap stats (trend, holesPlayed, etc.)
 */
export async function getHandicapStats(authToken) {
    return fetchWithAuth('/player/handicap/stats', 'GET', null, authToken);
}

// Add other API client functions as needed, e.g., for fetching leaderboards, player profiles, etc.
