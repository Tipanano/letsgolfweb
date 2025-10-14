// Centralized player state management

class PlayerManager {
  constructor() {
    this.currentPlayer = null;
    this.isInitialized = false;
  }

  /**
   * Initialize on page load
   */
  async init() {
    const stored = this.loadFromLocalStorage();

    if (stored) {
      // Existing player
      if (stored.playerType === 'registered') {
        // Validate token expiry first
        if (this.isTokenExpired(stored.tokenExpiry)) {
          // Token expired, downgrade to guest
          console.log('Session expired, creating guest account');
          this.createGuestPlayer();
        } else {
          // Verify with server that user still exists
          const isValid = await this.verifySessionWithServer(stored.sessionToken);
          if (isValid) {
            // Restore registered player
            this.currentPlayer = stored;
            console.log('Restored registered player:', stored.username);
          } else {
            // Server doesn't recognize user (server restart), downgrade to guest
            console.log('User not found on server (server restart), creating guest account');
            this.createGuestPlayer();
          }
        }
      } else {
        // Guest player
        this.currentPlayer = stored;
        console.log('Restored guest player:', stored.guestName);
      }
    } else {
      // First time - create guest
      this.createGuestPlayer();
    }

    this.isInitialized = true;
    this.saveToLocalStorage();
  }

  /**
   * Create new guest player
   */
  createGuestPlayer() {
    const guestId = this.generateUUID();
    const randomDigits = Math.floor(10000 + Math.random() * 90000);

    this.currentPlayer = {
      playerType: 'guest',
      guestId: guestId,
      guestName: `Guest_${randomDigits}`,
      stats: {
        totalShots: 0,
        bestCtfDistance: null,
        holesCompleted: 0,
        averageScore: null
      },
      preferences: {
        soundEnabled: true,
        units: 'yards',
        difficulty: 'medium'
      },
      lastPlayed: Date.now()
    };

    console.log('Created guest player:', this.currentPlayer.guestName);
  }

  /**
   * Upgrade guest to registered player (after Nano auth)
   */
  async upgradeToRegistered(username, nanoAddress, sessionToken, linkedAddresses = null, userId = null) {
    // Migrate guest stats to server
    const guestStats = this.currentPlayer.stats;

    await this.migrateStatsToServer(username, nanoAddress, guestStats, sessionToken);

    // Update player object
    this.currentPlayer = {
      playerType: 'registered',
      userId: userId, // UUID from server
      username: username,
      nanoAddress: nanoAddress, // Primary address (for backwards compatibility)
      linkedAddresses: linkedAddresses || [nanoAddress], // Array of all linked addresses (max 5)
      // TODO: Add profile page UI to link additional addresses (payment verification required)
      sessionToken: sessionToken,
      tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
      stats: guestStats, // Keep local cache
      preferences: this.currentPlayer.preferences,
      lastPlayed: Date.now()
    };

    this.saveToLocalStorage();
    console.log('Upgraded to registered player:', username, 'with userId:', userId);
  }

  /**
   * Check if player can wager
   */
  canWager() {
    return this.currentPlayer?.playerType === 'registered';
  }

  /**
   * Check if player is guest
   */
  isGuest() {
    return this.currentPlayer?.playerType === 'guest';
  }

  /**
   * Get current player data
   */
  getPlayerData() {
    return {
      type: this.currentPlayer?.playerType || 'guest',
      playerType: this.currentPlayer?.playerType || 'guest',
      username: this.currentPlayer?.username || null,
      nanoAddress: this.currentPlayer?.nanoAddress || null,
      linkedAddresses: this.currentPlayer?.linkedAddresses || null, // Array of all linked addresses
      sessionToken: this.currentPlayer?.sessionToken || null,
      guestName: this.currentPlayer?.guestName || null,
      guestId: this.currentPlayer?.guestId || null,
      stats: this.currentPlayer?.stats || null,
      preferences: this.currentPlayer?.preferences || null
    };
  }

  /**
   * Get display name
   */
  getDisplayName() {
    if (this.currentPlayer?.playerType === 'registered') {
      return this.currentPlayer.username;
    }
    return this.currentPlayer?.guestName || 'Guest';
  }

  /**
   * Get player ID for multiplayer
   */
  getPlayerId() {
    if (this.currentPlayer?.playerType === 'registered') {
      // Return UUID if available, fallback to nanoAddress for legacy players
      return this.currentPlayer.userId || this.currentPlayer.nanoAddress;
    }
    return this.currentPlayer?.guestId; // Use guest UUID
  }

  /**
   * Update local stats
   */
  updateStats(statUpdate) {
    this.currentPlayer.stats = {
      ...this.currentPlayer.stats,
      ...statUpdate
    };
    this.currentPlayer.lastPlayed = Date.now();
    this.saveToLocalStorage();

    // If registered, also sync to server
    if (this.currentPlayer.playerType === 'registered') {
      this.syncStatsToServer();
    }
  }

  /**
   * Logout (registered only)
   */
  logout() {
    if (this.currentPlayer?.playerType === 'registered') {
      console.log('Logging out:', this.currentPlayer.username);
      this.createGuestPlayer(); // Downgrade to guest
      this.saveToLocalStorage();
    }
  }

  /**
   * Clear all data (for testing/reset)
   */
  clearAllData() {
    localStorage.removeItem('golfGamePlayer');
    this.currentPlayer = null;
    this.isInitialized = false;
  }

  /**
   * Feature access control
   */
  canAccessFeature(feature) {
    const features = {
      'singleplayer': () => true, // Everyone
      'multiplayer_free': () => true, // Everyone
      'multiplayer_wager': () => this.currentPlayer?.playerType === 'registered',
      'leaderboards': () => this.currentPlayer?.playerType === 'registered',
      'stats_global': () => this.currentPlayer?.playerType === 'registered',
      'username_change': () => false, // Not implemented yet
    };

    return features[feature] ? features[feature]() : false;
  }

  // Private helpers

  async verifySessionWithServer(sessionToken) {
    try {
      const { API_BASE_URL } = await import('./config.js');
      const response = await fetch(`${API_BASE_URL}/auth/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        }
      });

      if (response.ok) {
        return true; // User exists on server
      } else {
        return false; // User not found or token invalid
      }
    } catch (error) {
      console.error('Error verifying session with server:', error);
      return false; // Assume invalid on error
    }
  }

  loadFromLocalStorage() {
    const stored = localStorage.getItem('golfGamePlayer');
    return stored ? JSON.parse(stored) : null;
  }

  saveToLocalStorage() {
    localStorage.setItem('golfGamePlayer', JSON.stringify(this.currentPlayer));
  }

  isTokenExpired(tokenExpiry) {
    return Date.now() > tokenExpiry;
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async migrateStatsToServer(username, nanoAddress, stats, sessionToken) {
    // TODO: Endpoint not implemented yet - users register before setting username anyway
    // POST to server to save guest stats under new account
    // try {
    //   await fetch('/api/user/migrate-stats', {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //       'Authorization': `Bearer ${sessionToken}`
    //     },
    //     body: JSON.stringify({
    //       username,
    //       nanoAddress,
    //       guestStats: stats
    //     })
    //   });
    // } catch (error) {
    //   console.error('Failed to migrate stats:', error);
    // }
  }

  async syncStatsToServer() {
    if (!this.currentPlayer?.sessionToken) return;

    try {
      await fetch('/api/user/sync-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.currentPlayer.sessionToken}`
        },
        body: JSON.stringify({
          stats: this.currentPlayer.stats
        })
      });
    } catch (error) {
      console.error('Failed to sync stats:', error);
    }
  }
}

// Singleton instance
export const playerManager = new PlayerManager();
