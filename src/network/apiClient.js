// src/network/apiClient.js

// Server URL - update this for production
const BASE_URL = 'http://localhost:3001/api';

/**
 * A helper function to make authenticated API requests.
 * @param {string} endpoint - The API endpoint to call (e.g., '/game/create').
 * @param {string} method - The HTTP method (e.g., 'GET', 'POST').
 * @param {object} [body] - The request body for POST/PUT requests.
 * @param {string} [idToken] - The Firebase ID token for authentication.
 * @returns {Promise<object>} The JSON response from the server.
 * @throws {Error} If the network response is not ok.
 */
async function fetchWithAuth(endpoint, method = 'GET', body = null, idToken = null) {
    const headers = {
        'Content-Type': 'application/json',
    };
    if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
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
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`API request failed: ${response.status} ${errorData.message || ''}`);
    }
    return response.json();
}

/**
 * Authenticates the user with the backend by sending the Firebase ID token.
 * This might not be a separate call if your server verifies the token on every authenticated request.
 * However, it could be useful for an initial handshake or to get user-specific data from your backend.
 * @param {string} idToken - The Firebase ID token.
 * @returns {Promise<object>} Server response, e.g., user profile from your backend.
 */
export async function authenticateUserWithServer(idToken) {
    // This endpoint is an example; your server might just verify tokens via middleware.
    return fetchWithAuth('/auth/verify-token', 'POST', { token: idToken }, idToken);
}

/**
 * Creates a new game session on the server.
 * @param {string} idToken - The Firebase ID token of the host.
 * @param {object} gameSettings - Settings for the game (e.g., courseId, maxPlayers).
 * @returns {Promise<object>} Server response, e.g., { sessionId, gameCode }.
 */
export async function createGameSession(idToken, gameSettings) {
    return fetchWithAuth('/game/create', 'POST', gameSettings, idToken);
}

/**
 * Joins an existing game session on the server.
 * @param {string} idToken - The Firebase ID token of the joining player.
 * @param {string} gameCode - The code to join the game session.
 * @param {string} [playerName] - Optional player name.
 * @returns {Promise<object>} Server response, e.g., { sessionId, courseData, players }.
 */
export async function joinGameSession(idToken, gameCode, playerName = null, nanoAddress = null) {
    const body = { roomCode: gameCode };
    if (playerName) {
        body.playerName = playerName;
    }
    if (nanoAddress) {
        body.nanoAddress = nanoAddress;
    }
    return fetchWithAuth('/game/join', 'POST', body, idToken);
}

/**
 * Fetches course/hole data for a given session.
 * This might be redundant if joinGameSession already returns it.
 * @param {string} idToken - The Firebase ID token.
 * @param {string} sessionId - The ID of the game session.
 * @returns {Promise<object>} Server response containing course/hole data.
 */
export async function fetchCourseData(idToken, sessionId) {
    return fetchWithAuth(`/game/${sessionId}/course`, 'GET', null, idToken);
}

/**
 * Submits the final scores of a game to the server.
 * @param {string} idToken - The Firebase ID token.
 * @param {string} sessionId - The ID of the game session.
 * @param {object} scoreDetails - The scores and other relevant game end data.
 * @returns {Promise<object>} Server response confirming score submission.
 */
export async function submitScore(idToken, sessionId, scoreDetails) {
    return fetchWithAuth(`/game/${sessionId}/score`, 'POST', scoreDetails, idToken);
}

/**
 * Retrieves the game history for the authenticated player.
 * @param {string} idToken - The Firebase ID token.
 * @returns {Promise<object>} Server response with player's game history.
 */
export async function getPlayerHistory(idToken) {
    return fetchWithAuth('/player/history', 'GET', null, idToken);
}

// Add other API client functions as needed, e.g., for fetching leaderboards, player profiles, etc.
