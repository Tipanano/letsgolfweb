// src/gameLogic/persistentGameState.js

const PLAY_HOLE_STORAGE_KEY = 'letsgolf_playHoleState';

// Default structure for the persistent game state
const getDefaultState = () => ({
    currentHoleIndex: 0, // Index of the current hole being played
    ballPosition: null, // { x, y, z }
    strokesThisHole: 0,
    totalStrokesRound: 0,
    currentLie: 'tee', // e.g., 'tee', 'fairway', 'rough', 'green', 'bunker', 'water'
    holeLayoutData: null, // Will store the fully processed hole layout
    // Add any other relevant data to persist for playHole mode
});

/**
 * Saves the current playHole game state to localStorage.
 * @param {object} state - The game state to save.
 *                         Expected to include: currentHoleIndex, ballPosition, strokesThisHole, totalStrokesRound, currentLie, holeLayoutData.
 */
export function savePlayHoleState(state) {
    if (!state || state.ballPosition === undefined || state.holeLayoutData === undefined) { // Basic check, ensure holeLayoutData is considered
        console.error('PersistentGameState: Attempted to save invalid or incomplete state:', state);
        return;
    }
    try {
        localStorage.setItem(PLAY_HOLE_STORAGE_KEY, JSON.stringify(state));
        console.log('PersistentGameState: PlayHole state saved.', state);
    } catch (error) {
        console.error('PersistentGameState: Error saving PlayHole state to localStorage:', error);
    }
}

/**
 * Loads the playHole game state from localStorage.
 * @returns {object | null} The loaded game state, or null if no state is found or an error occurs.
 */
export function loadPlayHoleState() {
    try {
        const savedState = localStorage.getItem(PLAY_HOLE_STORAGE_KEY);
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            console.log('PersistentGameState: PlayHole state loaded.', parsedState);
            return parsedState;
        }
        console.log('PersistentGameState: No saved PlayHole state found.');
        return null;
    } catch (error) {
        console.error('PersistentGameState: Error loading PlayHole state from localStorage:', error);
        return null;
    }
}

/**
 * Clears the saved playHole game state from localStorage.
 */
export function clearPlayHoleState() {
    try {
        localStorage.removeItem(PLAY_HOLE_STORAGE_KEY);
        console.log('PersistentGameState: PlayHole state cleared from localStorage.');
    } catch (error) {
        console.error('PersistentGameState: Error clearing PlayHole state from localStorage:', error);
    }
}

/**
 * Gets the current persistent state or a default if none exists.
 * Useful for initializing the game or checking current status.
 * @returns {object} The current or default persistent state.
 */
export function getCurrentPlayHoleState() {
    const loadedState = loadPlayHoleState();
    return loadedState || getDefaultState();
}

// Example of how you might update parts of the state:
/**
 * Updates specific properties of the saved playHole game state.
 * @param {object} updates - An object containing the properties to update.
 */
export function updatePlayHoleState(updates) {
    let currentState = loadPlayHoleState();
    if (!currentState) {
        // If no state exists, initialize with default and then apply updates
        // This might happen if update is called before any save,
        // though typically you'd load first in the game flow.
        currentState = getDefaultState(); 
    }
    
    const newState = { ...currentState, ...updates };
    savePlayHoleState(newState);
}
