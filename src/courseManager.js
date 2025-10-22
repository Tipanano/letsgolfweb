// Course Manager - Handles saving/loading custom holes to/from the server
// Can be used from hole maker, play view, multiplayer setup, etc.

import { API_BASE_URL } from './config.js';

class CourseManager {
    constructor() {
        this.currentHoleId = null;
    }

    /**
     * Get authentication token from localStorage
     */
    getAuthToken() {
        const playerData = localStorage.getItem('golfGamePlayer');
        if (!playerData) {
            throw new Error('Not authenticated. Please sign in first.');
        }

        const player = JSON.parse(playerData);
        if (player.playerType !== 'registered' || !player.sessionToken) {
            throw new Error('Not authenticated. Please sign in first.');
        }

        return player.sessionToken;
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        try {
            const playerData = localStorage.getItem('golfGamePlayer');
            if (!playerData) return false;

            const player = JSON.parse(playerData);
            return player.playerType === 'registered' && !!player.sessionToken;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get current username
     */
    getUsername() {
        try {
            const playerData = localStorage.getItem('golfGamePlayer');
            if (!playerData) return 'Unknown';

            const player = JSON.parse(playerData);
            return player.username || 'Unknown';
        } catch (e) {
            return 'Unknown';
        }
    }

    /**
     * Save a custom hole to the server
     * @param {Object} holeData - The hole layout data (JSON format)
     * @returns {Promise<Object>} Result with holeId
     */
    async saveHole(holeData) {
        const token = this.getAuthToken();

        if (!holeData || !holeData.name) {
            throw new Error('Hole data must include a name');
        }

        const response = await fetch(`${API_BASE_URL}/holes/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ holeData })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to save hole');
        }

        this.currentHoleId = result.holeId;
        return result;
    }

    /**
     * Update an existing hole
     * @param {string} holeId - The hole ID to update
     * @param {Object} holeData - The updated hole layout data
     * @returns {Promise<Object>} Result
     */
    async updateHole(holeId, holeData) {
        const token = this.getAuthToken();

        const response = await fetch(`${API_BASE_URL}/holes/${holeId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ holeData })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to update hole');
        }

        return result;
    }

    /**
     * List all holes owned by the current user
     * @returns {Promise<Array>} Array of hole metadata
     */
    async listHoles() {
        const token = this.getAuthToken();

        const response = await fetch(`${API_BASE_URL}/holes/list`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to load holes');
        }

        return result.holes;
    }

    /**
     * Load a specific hole
     * @param {string} holeId - The hole ID to load
     * @returns {Promise<Object>} Hole data
     */
    async loadHole(holeId) {
        const token = this.getAuthToken();

        const response = await fetch(`${API_BASE_URL}/holes/${holeId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to load hole');
        }

        this.currentHoleId = holeId;
        return result.hole;
    }

    /**
     * Delete a hole
     * @param {string} holeId - The hole ID to delete
     * @returns {Promise<Object>} Result
     */
    async deleteHole(holeId) {
        const token = this.getAuthToken();

        const response = await fetch(`${API_BASE_URL}/holes/${holeId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to delete hole');
        }

        if (this.currentHoleId === holeId) {
            this.currentHoleId = null;
        }

        return result;
    }
}

// Export singleton instance
export const courseManager = new CourseManager();
