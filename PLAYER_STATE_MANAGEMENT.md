# Player State Management Design

## Overview
The game supports both **guest players** (temporary, local) and **registered players** (authenticated via Nano). Player state is managed centrally and determines what features are accessible.

---

## Player Types

### Guest Player
- **Identity**: Auto-generated UUID stored in localStorage
- **Display Name**: "Guest_12345" (random 5 digits)
- **Persistence**: localStorage only (lost on cache clear)
- **Features**:
  - ✅ Single-player modes (Range, CTF, Play Hole)
  - ✅ Free multiplayer (no wagering)
  - ✅ Local stats and progress
  - ❌ Wagering
  - ❌ Leaderboards
  - ❌ Cross-device sync
  - ❌ Username reservation

### Registered Player
- **Identity**: Nano address (nano_xxx...)
- **Display Name**: User-chosen username
- **Persistence**: Server database + localStorage cache
- **Features**:
  - ✅ All guest features
  - ✅ Wagering with Nano
  - ✅ Leaderboards
  - ✅ Stats history
  - ✅ Cross-device login
  - ✅ Secured username
  - ✅ Account recovery (via Nano wallet)

---

## Player State Structure

### LocalStorage Schema
```javascript
// Key: 'golfGamePlayer'
{
  playerType: 'guest' | 'registered',

  // Guest fields
  guestId: 'uuid-v4',                    // For guests only
  guestName: 'Guest_12345',              // For guests only

  // Registered fields
  username: 'ProGolfer99',               // For registered only
  nanoAddress: 'nano_abc...',            // For registered only
  sessionToken: 'eyJhbGc...',            // JWT session token
  tokenExpiry: 1234567890,               // Unix timestamp

  // Common stats (cached locally)
  stats: {
    totalShots: 0,
    bestCtfDistance: null,
    holesCompleted: 0,
    averageScore: null
  },

  // Preferences
  preferences: {
    soundEnabled: true,
    units: 'yards' | 'meters',
    difficulty: 'medium'
  },

  lastPlayed: 1234567890                 // Unix timestamp
}
```

---

## Player Manager Module

### File: `src/playerManager.js`

```javascript
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
        // Validate token
        if (this.isTokenExpired(stored.tokenExpiry)) {
          // Token expired, downgrade to guest
          console.log('Session expired, creating guest account');
          this.createGuestPlayer();
        } else {
          // Restore registered player
          this.currentPlayer = stored;
          console.log('Restored registered player:', stored.username);
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
  async upgradeToRegistered(username, nanoAddress, sessionToken) {
    // Migrate guest stats to server
    const guestStats = this.currentPlayer.stats;

    await this.migrateStatsToServer(username, nanoAddress, guestStats);

    // Update player object
    this.currentPlayer = {
      playerType: 'registered',
      username: username,
      nanoAddress: nanoAddress,
      sessionToken: sessionToken,
      tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
      stats: guestStats, // Keep local cache
      preferences: this.currentPlayer.preferences,
      lastPlayed: Date.now()
    };

    this.saveToLocalStorage();
    console.log('Upgraded to registered player:', username);
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
      return this.currentPlayer.nanoAddress; // Use Nano address as ID
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

  // Private helpers

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

  async migrateStatsToServer(username, nanoAddress, stats) {
    // POST to server to save guest stats under new account
    try {
      await fetch('/api/user/migrate-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.currentPlayer.sessionToken}`
        },
        body: JSON.stringify({
          username,
          nanoAddress,
          guestStats: stats
        })
      });
    } catch (error) {
      console.error('Failed to migrate stats:', error);
    }
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
```

---

## Integration with Existing Code

### 1. main.js Initialization
```javascript
import { playerManager } from './playerManager.js';

// At startup (before showing main menu)
await playerManager.init();

// Display player name in UI
ui.updatePlayerDisplay(playerManager.getDisplayName());
```

### 2. Multiplayer Integration
```javascript
// In multiplayerManager.js
import { playerManager } from './playerManager.js';

export async function hostGame(mode = 'closest-to-flag') {
  // Check if can create wager game
  if (isWagerGame && !playerManager.canWager()) {
    alert('Please register with Nano to create wager games');
    return;
  }

  const playerId = playerManager.getPlayerId();
  const playerName = playerManager.getDisplayName();

  const response = await apiClient.createGameSession(playerId, {
    maxPlayers: 4,
    courseId: 'default',
    playerName: playerName
  });

  // ... rest of logic
}
```

### 3. UI Updates
```javascript
// Show registration prompt for guests trying to wager
function showWagerPrompt() {
  if (playerManager.isGuest()) {
    ui.showModal({
      title: 'Registration Required',
      message: 'Register with Nano to wager and compete on leaderboards',
      buttons: [
        { text: 'Register', action: () => showRegistrationFlow() },
        { text: 'Cancel', action: () => {} }
      ]
    });
  } else {
    // Proceed with wager game creation
  }
}
```

### 4. Stats Tracking
```javascript
// After each shot/game
playerManager.updateStats({
  totalShots: playerManager.currentPlayer.stats.totalShots + 1,
  bestCtfDistance: Math.min(distance, playerManager.currentPlayer.stats.bestCtfDistance || Infinity)
});
```

---

## UI Indicators

### Main Menu Display
```
┌─────────────────────────────┐
│  Let's Golf!                │
│                             │
│  👤 Guest_12345             │  ← Guest indicator
│  📊 Stats (Local Only)      │
│                             │
│  [Play CTF]                 │
│  [Play Hole]                │
│  [Multiplayer (Free)]       │
│  [Register with Nano] ⭐    │  ← Prominent registration CTA
└─────────────────────────────┘
```

```
┌─────────────────────────────┐
│  Let's Golf!                │
│                             │
│  👤 ProGolfer99 ✓           │  ← Registered indicator
│  📊 Global Leaderboard      │
│  💰 Balance: 1.5 NANO       │  ← Show balance if registered
│                             │
│  [Play CTF]                 │
│  [Play Hole]                │
│  [Multiplayer (Free)]       │
│  [Wager Match] 💎           │  ← Only show if registered
│  [Logout]                   │
└─────────────────────────────┘
```

---

## Registration Flow (UI)

### Step 1: Registration Button Click
```javascript
async function showRegistrationFlow() {
  // 1. Prompt for username
  const username = await ui.prompt('Choose a username:');

  if (!username || username.length < 3) {
    alert('Username must be at least 3 characters');
    return;
  }

  // 2. Start registration with server
  const response = await fetch('/api/auth/register/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });

  const { login_secret, ephemeral_address, qr_code_data, expires_in } = await response.json();

  // 3. Show QR code modal
  ui.showQRCodeModal({
    title: 'Register with Nano',
    message: 'Send 0.000001 NANO from your Nano wallet',
    qr_data: qr_code_data,
    address: ephemeral_address,
    expires_in: expires_in
  });

  // 4. Poll for confirmation
  const checkInterval = setInterval(async () => {
    const statusResponse = await fetch(`/api/auth/register/status/${login_secret}`);
    const status = await statusResponse.json();

    if (status.status === 'confirmed') {
      clearInterval(checkInterval);

      // 5. Upgrade player
      await playerManager.upgradeToRegistered(
        username,
        status.nano_address,
        status.session_token
      );

      ui.hideQRCodeModal();
      ui.showSuccess('Registration successful!');
      ui.refreshMainMenu(); // Update UI with new player state
    } else if (status.status === 'expired') {
      clearInterval(checkInterval);
      ui.hideQRCodeModal();
      ui.showError('Registration timed out. Please try again.');
    }
  }, 2000); // Poll every 2 seconds
}
```

---

## Feature Access Control

### Centralized Permission Checks
```javascript
// In playerManager.js
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
```

### Usage in UI
```javascript
// Enable/disable wager button based on player type
const wagerButton = document.getElementById('wager-match-btn');
wagerButton.disabled = !playerManager.canAccessFeature('multiplayer_wager');

if (!playerManager.canAccessFeature('multiplayer_wager')) {
  wagerButton.title = 'Register with Nano to wager';
}
```

---

## Migration from Guest to Registered

### What Happens to Guest Data?
1. Guest stats migrated to server under new username
2. Guest UUID discarded
3. Nano address becomes primary identity
4. JWT session token stored for authentication
5. All future stats sync to server

### Example Flow
```
Guest_12345 (UUID: abc-123)
├── Total shots: 150
├── Best CTF: 2.3 yards
└── Holes completed: 5

↓ Register as "ProGolfer99" ↓

ProGolfer99 (Nano: nano_xyz)
├── Total shots: 150        ← Migrated
├── Best CTF: 2.3 yards     ← Migrated
├── Holes completed: 5      ← Migrated
└── Now on leaderboards! ✅
```

---

## Server-Side Player Management

### Database Updates (from NANO_WAGERING_DESIGN.md)

Add `player_type` to distinguish accounts:

```sql
ALTER TABLE users ADD COLUMN player_type ENUM('guest', 'registered') DEFAULT 'registered';

-- For registered players, nano_address is required
-- For guest players (if we ever store them), nano_address can be NULL
```

### API Endpoint for Migration
```
POST /api/user/migrate-stats
  Headers: Authorization: Bearer <session_token>
  Body: {
    username: "ProGolfer99",
    nanoAddress: "nano_abc...",
    guestStats: {
      totalShots: 150,
      bestCtfDistance: 2.3,
      holesCompleted: 5
    }
  }
  Response: {
    success: true,
    userId: "nano_abc..."
  }
```

---

## Testing Scenarios

### Test 1: New User (Guest Creation)
1. Open game for first time
2. localStorage empty
3. Auto-create Guest_XXXXX
4. Can play single-player ✅
5. Can play free multiplayer ✅
6. Cannot wager ❌

### Test 2: Guest to Registered
1. Start as Guest_12345
2. Click "Register with Nano"
3. Complete Nano auth flow
4. Stats migrated to server
5. Now can wager ✅

### Test 3: Returning Registered Player
1. Open game
2. localStorage has valid token
3. Restore session
4. All features available ✅

### Test 4: Expired Token
1. Open game
2. localStorage has expired token
3. Downgrade to guest
4. Prompt to log in again

### Test 5: Guest Data Persistence
1. Play as guest
2. Close browser
3. Reopen (cache not cleared)
4. Same Guest_XXXXX restored ✅
5. Stats preserved ✅

---

## Summary

**Key Points:**
- ✅ Guest players auto-created on first launch
- ✅ All data stored in localStorage initially
- ✅ Registered players get server persistence
- ✅ Seamless upgrade from guest → registered
- ✅ Guest stats migrated when registering
- ✅ Feature access controlled by player type
- ✅ Nano address becomes unique identifier for registered users
- ✅ Token-based sessions (7-day expiry)

**Next Steps to Implement:**
1. Create `src/playerManager.js` module
2. Initialize on page load in `main.js`
3. Update UI to show player type and name
4. Add registration flow UI (QR code modal)
5. Integrate with multiplayer (use playerManager.getPlayerId())
6. Add server endpoints for stats migration
7. Test all scenarios
