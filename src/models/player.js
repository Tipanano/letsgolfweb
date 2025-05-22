// src/models/player.js

/**
 * Represents a player in the game.
 */
export class Player {
    /**
     * @param {string} playerId - The unique identifier for the player (e.g., Firebase UID).
     * @param {string} displayName - The display name of the player.
     */
    constructor(playerId, displayName) {
        this.playerId = playerId;
        this.displayName = displayName;
        this.score = 0; // Current score for the active game/hole
        this.totalScore = 0; // Could be used for overall tournament score
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
