// src/models/player.js

/**
 * Represents a player in the game.
 */
export class Player {
    /**
     * @param {string} playerId - The unique identifier for the player.
     * @param {string} displayName - The display name of the player.
     */
    constructor(playerId, displayName) {
        this.playerId = playerId;
        this.displayName = displayName;
        this.score = 0; // Current score for the active game/hole
        this.totalScore = 0; // Could be used for overall tournament score
        this.handicap = null; // Player's handicap (null for guests, number for registered users)
        this.handicapStrokes = 0; // Strokes per hole based on handicap
        this.isCurrentTurn = false;
        this.ballState = { // Example ball state
            position: { x: 0, y: 0, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            onGround: true,
            club: null, // Last club used
        };
        this.isConnected = true; // To track if the player is currently connected to the session
    }

    /**
     * Updates the player's score for the current hole.
     * @param {number} strokes - The number of strokes taken on the current hole.
     */
    updateHoleScore(strokes) {
        this.score = strokes;
    }

    /**
     * Adds the current hole's score to the total score and resets hole score.
     */
    finalizeHoleScore() {
        this.totalScore += this.score;
        this.score = 0;
    }

    /**
     * Sets whether it's this player's turn.
     * @param {boolean} isTurn - True if it's this player's turn, false otherwise.
     */
    setCurrentTurn(isTurn) {
        this.isCurrentTurn = isTurn;
    }

    /**
     * Updates the player's ball state.
     * @param {object} newState - The new state of the ball.
     * @param {object} newState.position - The new position {x, y, z}.
     * @param {object} newState.velocity - The new velocity {x, y, z}.
     */
    updateBallState(newState) {
        this.ballState = { ...this.ballState, ...newState };
    }

    /**
     * Marks the player as disconnected.
     */
    setDisconnected() {
        this.isConnected = false;
    }

    /**
     * Marks the player as connected.
     */
    setConnected() {
        this.isConnected = true;
    }

    /**
     * Sets the player's handicap.
     * @param {number} handicap - The player's handicap value.
     */
    setHandicap(handicap) {
        this.handicap = handicap;
        // Calculate handicap strokes per hole (handicap ÷ 18, rounded)
        this.handicapStrokes = Math.round(handicap / 18);
    }

    /**
     * Formats handicap for display.
     * Negative values (e.g., -2) are shown as plus handicaps (e.g., "+2.0").
     * @returns {string} Formatted handicap string.
     */
    getHandicapDisplay() {
        if (this.handicap === null) {
            return 'N/A'; // Guest user
        }
        if (this.handicap < 0) {
            return `+${Math.abs(this.handicap).toFixed(1)}`;
        }
        return this.handicap.toFixed(1);
    }
}

/**
 * Creates a player object.
 * @param {string} playerId - The unique identifier for the player.
 * @param {string} displayName - The display name of the player.
 * @returns {Player} A new Player instance.
 */
export function createPlayer(playerId, displayName) {
    return new Player(playerId, displayName);
}
