import { toast } from './ui/toast.js';
import { modal } from './ui/modal.js';
import { API_BASE_URL } from './config.js';

/**
 * Profile Manager - handles user profile and game history
 */

let currentUser = null;

/**
 * Get auth token from localStorage
 */
function getAuthToken() {
  const playerData = localStorage.getItem('golfGamePlayer');
  if (!playerData) {
    return null;
  }

  try {
    const player = JSON.parse(playerData);
    return player.sessionToken; // Use sessionToken for registered users
  } catch (error) {
    console.error('Error parsing player data:', error);
    return null;
  }
}

/**
 * Get auth headers for API requests
 */
function getAuthHeaders() {
  const token = getAuthToken();
  if (!token) {
    return null;
  }

  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

/**
 * Initialize profile view
 */
export async function initProfile() {
  // Check if user is registered (not just authenticated)
  const playerData = localStorage.getItem('golfGamePlayer');
  if (!playerData) {
    toast.error('Please sign in to view profile');
    return;
  }

  let player;
  try {
    player = JSON.parse(playerData);
  } catch (e) {
    toast.error('Invalid player data');
    return;
  }

  if (player.playerType !== 'registered') {
    toast.error('Please sign in with Nano to access your profile');
    return;
  }

  // Show profile view, hide main menu
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('profile-view').style.display = 'block';

  // Load profile data
  await loadUserProfile();
  await loadGameHistory();

  // Set up event listeners
  setupEventListeners();
}

/**
 * Load user profile data
 */
async function loadUserProfile() {
  try {
    const response = await fetch(`${API_BASE_URL}/user/profile`, {
      headers: getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Failed to load profile');
    }

    currentUser = await response.json();

    // Display username
    const usernameEl = document.getElementById('current-username');
    usernameEl.textContent = currentUser.playerName || currentUser.email || 'Guest';

  } catch (error) {
    console.error('Error loading profile:', error);
    toast.error('Failed to load profile');
  }
}

/**
 * Load game history
 */
async function loadGameHistory() {
  const historyList = document.getElementById('game-history-list');

  try {
    const response = await fetch(`${API_BASE_URL}/user/game-history`, {
      headers: getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Failed to load game history');
    }

    const games = await response.json();

    if (games.length === 0) {
      historyList.innerHTML = '<p style="text-align: center; color: #666;">No games played yet</p>';
      return;
    }

    // Render game history
    historyList.innerHTML = games.map(game => renderGameCard(game)).join('');

    // Add click handlers to view details
    games.forEach(game => {
      const card = document.getElementById(`game-${game.sessionId}`);
      if (card) {
        card.addEventListener('click', () => showGameDetails(game));
      }
    });

  } catch (error) {
    console.error('Error loading game history:', error);
    historyList.innerHTML = '<p style="text-align: center; color: #ff0000;">Failed to load game history</p>';
  }
}

/**
 * Render a game card
 */
function renderGameCard(game) {
  const date = new Date(game.createdAt).toLocaleDateString();
  const time = new Date(game.createdAt).toLocaleTimeString();
  const status = game.gameState === 'finished' ? '✅ Finished' :
                 game.gameState === 'playing' ? '🎮 In Progress' :
                 '⏸️ Waiting';

  const wagerBadge = game.isWageringGame
    ? `<span style="background: #ffc107; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; margin-left: 5px;">💰 ${game.wagerAmount} NANO</span>`
    : '';

  const isWinner = game.winner && game.winner.id === currentUser?.uid;
  const winnerBadge = game.gameState === 'finished' && isWinner
    ? '<span style="background: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; margin-left: 5px;">🏆 Winner</span>'
    : '';

  return `
    <div id="game-${game.sessionId}" style="background: white; padding: 12px; margin-bottom: 10px; border-radius: 5px; border: 1px solid #ddd; cursor: pointer; transition: background 0.2s;"
         onmouseover="this.style.background='#f9f9f9'"
         onmouseout="this.style.background='white'">
      <div style="font-weight: bold; margin-bottom: 5px;">
        ${game.gameMode === 'closest-to-flag' ? '🎯 Closest to Flag' : '⛳ Play Hole'}
        ${wagerBadge}
        ${winnerBadge}
      </div>
      <div style="font-size: 0.9em; color: #666;">
        ${status} • ${game.players.length} players • ${date} ${time}
      </div>
    </div>
  `;
}

/**
 * Show detailed game info in modal
 */
async function showGameDetails(game) {
  const isWinner = game.winner && game.winner.id === currentUser?.uid;

  let detailsHTML = `
    <div style="text-align: left;">
      <h3>${game.gameMode === 'closest-to-flag' ? '🎯 Closest to Flag' : '⛳ Play Hole'}</h3>

      <p><strong>Room Code:</strong> ${game.roomCode || 'N/A'}</p>
      <p><strong>Status:</strong> ${game.gameState}</p>
      <p><strong>Created:</strong> ${new Date(game.createdAt).toLocaleString()}</p>
      ${game.startedAt ? `<p><strong>Started:</strong> ${new Date(game.startedAt).toLocaleString()}</p>` : ''}
      ${game.finishedAt ? `<p><strong>Finished:</strong> ${new Date(game.finishedAt).toLocaleString()}</p>` : ''}

      <h4>Players (${game.players.length})</h4>
      <ul>
        ${game.players.map(p => {
          const isMe = p.id === currentUser?.uid;
          const isWinnerPlayer = game.winner && p.id === game.winner.id;
          return `<li>${p.name}${isMe ? ' (You)' : ''}${isWinnerPlayer ? ' 🏆' : ''}</li>`;
        }).join('')}
      </ul>
  `;

  // Wagering info
  if (game.isWageringGame) {
    detailsHTML += `
      <h4>💰 Wagering Details</h4>
      <p><strong>Wager Amount:</strong> ${game.wagerAmount} NANO per player</p>
      <p><strong>Escrow Status:</strong> ${game.escrowStatus || 'N/A'}</p>
    `;

    // Try to fetch escrow details
    try {
      const response = await fetch(`${API_BASE_URL}/game/escrow-details/${game.sessionId}`, {
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const escrow = await response.json();

        detailsHTML += `
          <p><strong>Escrow Address:</strong>
            <span style="font-family: monospace; font-size: 0.85em; word-break: break-all;">${escrow.escrowAddress}</span>
            <button onclick="navigator.clipboard.writeText('${escrow.escrowAddress}'); alert('Copied!');" style="margin-left: 5px; font-size: 0.8em;">Copy</button>
          </p>
          <p style="font-size: 0.85em; color: #666;">
            You can look up this escrow account in a Nano block explorer to see all transactions.
          </p>
        `;

        if (escrow.status === 'completed' && isWinner) {
          detailsHTML += `<p style="color: #4CAF50;"><strong>✅ You won this game and received the payout!</strong></p>`;
        } else if (escrow.status === 'cancelled') {
          detailsHTML += `<p style="color: #ff9800;"><strong>⚠️ This game was cancelled and refunds were issued.</strong></p>`;
        }

        // Show player's prepaid balance if any
        const myEscrowData = escrow.players?.find(p => p.userId === currentUser?.uid);
        if (myEscrowData && parseFloat(myEscrowData.prepaidBalance) > 0) {
          detailsHTML += `
            <p style="color: #2196F3;">
              <strong>💵 You have a prepaid balance of ${myEscrowData.prepaidBalance} NANO</strong><br>
              <span style="font-size: 0.85em;">This can be used for future games or refunded if you leave.</span>
            </p>
          `;
        }
      }
    } catch (error) {
      console.error('Error fetching escrow details:', error);
    }
  }

  detailsHTML += '</div>';

  await modal.alert(detailsHTML, 'Game Details');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Back button
  document.getElementById('profile-back-btn').addEventListener('click', () => {
    document.getElementById('profile-view').style.display = 'none';
    document.getElementById('main-menu').style.display = 'flex'; // Use flex to maintain centering
  });

  // Change username
  document.getElementById('change-username-btn').addEventListener('click', () => {
    document.getElementById('username-display').style.display = 'none';
    document.getElementById('username-edit').style.display = 'block';
    document.getElementById('username-input').value = currentUser?.playerName || '';
    document.getElementById('username-input').focus();
  });

  // Save username
  document.getElementById('save-username-btn').addEventListener('click', async () => {
    await saveUsername();
  });

  // Cancel username edit
  document.getElementById('cancel-username-btn').addEventListener('click', () => {
    document.getElementById('username-display').style.display = 'block';
    document.getElementById('username-edit').style.display = 'none';
  });

  // Enter key to save username
  document.getElementById('username-input').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      await saveUsername();
    }
  });
}

/**
 * Save new username
 */
async function saveUsername() {
  const newUsername = document.getElementById('username-input').value.trim();

  if (!newUsername) {
    toast.error('Username cannot be empty');
    return;
  }

  if (newUsername.length < 3 || newUsername.length > 20) {
    toast.error('Username must be 3-20 characters');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/user/update-username`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: newUsername })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update username');
    }

    currentUser.playerName = newUsername;
    document.getElementById('current-username').textContent = newUsername;
    document.getElementById('username-display').style.display = 'block';
    document.getElementById('username-edit').style.display = 'none';

    // Update localStorage so the main menu and playerManager reflect the change
    const playerData = localStorage.getItem('golfGamePlayer');
    if (playerData) {
      try {
        const player = JSON.parse(playerData);
        player.username = newUsername;
        localStorage.setItem('golfGamePlayer', JSON.stringify(player));

        // Update the main menu display
        document.getElementById('player-name').textContent = newUsername;
      } catch (e) {
        console.error('Error updating localStorage:', e);
      }
    }

    toast.success('Username updated!');

  } catch (error) {
    console.error('Error updating username:', error);
    toast.error(error.message || 'Failed to update username');
  }
}
