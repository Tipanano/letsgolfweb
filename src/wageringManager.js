import { playerManager } from './playerManager.js';

const API_BASE = 'http://localhost:3001/api';

/**
 * Wagering Manager - Handles client-side wagering/escrow functionality
 */
class WageringManager {
  constructor() {
    this.modal = null;
    this.setupSection = null;
    this.paymentSection = null;
    this.currentSessionId = null;
    this.currentEscrowAddress = null;
    this.wagerAmount = null;
    this.pollInterval = null;
    this.timerInterval = null;
    this.expiryTime = null;
  }

  init() {
    // Get DOM elements
    this.modal = document.getElementById('wager-modal');
    this.setupSection = document.getElementById('wager-setup-section');
    this.paymentSection = document.getElementById('wager-payment-section');

    // Setup button listeners
    document.getElementById('create-wager-game-btn')?.addEventListener('click', () => this.createWagerGame());
    document.getElementById('cancel-wager-setup-btn')?.addEventListener('click', () => this.hideModal());
    document.getElementById('cancel-wager-btn')?.addEventListener('click', () => this.cancelWager());
    document.getElementById('copy-wager-address-btn')?.addEventListener('click', () => this.copyAddress());

    console.log('Wagering Manager initialized');
  }

  /**
   * Show wager setup modal (for host)
   */
  showWagerSetup() {
    const player = playerManager.getPlayerData();

    if (player.type !== 'registered') {
      alert('You must be a registered player to create wagering games!\n\nPlease sign in with Nano first.');
      return false;
    }

    if (!player.nanoAddress) {
      alert('You must have a Nano address to create wagering games!');
      return false;
    }

    this.modal.style.display = 'flex';
    this.setupSection.style.display = 'block';
    this.paymentSection.style.display = 'none';
    return true;
  }

  /**
   * Validate that all players are registered with Nano addresses
   * @param {array} players - Array of player objects from session
   * @returns {object} - { valid: boolean, invalidPlayers: array }
   */
  validateAllPlayersRegistered(players) {
    const invalidPlayers = [];

    for (const player of players) {
      if (!player.nanoAddress) {
        invalidPlayers.push(player.name);
      }
    }

    return {
      valid: invalidPlayers.length === 0,
      invalidPlayers
    };
  }

  /**
   * Create wagering game (host only)
   */
  async createWagerGame() {
    const wagerInput = document.getElementById('wager-amount-input');
    const wagerAmount = parseFloat(wagerInput.value);

    if (!wagerAmount || wagerAmount < 0.001) {
      alert('Wager amount must be at least 0.001 NANO');
      return;
    }

    this.wagerAmount = wagerAmount;

    // Hide setup section
    this.setupSection.style.display = 'none';

    // Import multiplayerManager dynamically to avoid circular dependency
    const { hostGame } = await import('./multiplayerManager.js');

    // Create game with wagering enabled
    const result = await hostGame('closest-to-flag', { wagerAmount });

    if (result) {
      // Update status
      const statusDiv = document.getElementById('connection-status');
      if (statusDiv) {
        statusDiv.textContent = `✅ Hosting Wager Game! Code: ${result.roomCode}`;
      }

      // Close the modal - payment UI will be shown later when all players join
      this.hideModal();
    }
  }

  /**
   * Show payment UI for all players (including host)
   * @param {string} sessionId - Game session ID
   * @param {array} playerAddresses - Array of all player Nano addresses
   */
  async showPaymentUI(sessionId, playerAddresses) {
    this.currentSessionId = sessionId;
    const player = playerManager.getPlayerData();

    if (!player.nanoAddress) {
      alert('You must have a Nano address to participate in wagering games!');
      return;
    }

    try {
      // Create escrow account on server
      const response = await fetch(`${API_BASE}/escrow/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${player.sessionToken}`
        },
        body: JSON.stringify({
          sessionId,
          wagerAmount: this.wagerAmount,
          playerAddresses
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create escrow account');
      }

      const data = await response.json();
      this.currentEscrowAddress = data.escrowAddress;
      this.expiryTime = Date.now() + (data.expiresIn * 1000);

      // Show modal with payment info
      this.modal.style.display = 'flex';
      this.setupSection.style.display = 'none';
      this.paymentSection.style.display = 'block';

      // Update UI
      document.getElementById('wager-amount-display').textContent = `${this.wagerAmount} NANO`;
      document.getElementById('wager-escrow-address').textContent = data.escrowAddress;

      // Generate QR code
      this.generateQRCode(`nano:${data.escrowAddress}?amount=${this.wagerAmount}`);

      // Start polling for payments
      this.startPolling(playerAddresses);

      // Start countdown timer
      this.startTimer();

    } catch (error) {
      console.error('Error creating escrow:', error);
      alert('Failed to create wagering game: ' + error.message);
      this.hideModal();
    }
  }

  /**
   * Generate QR code for payment
   */
  generateQRCode(data) {
    const container = document.getElementById('wager-qr-container');
    container.innerHTML = '';

    new QRCode(container, {
      text: data,
      width: 256,
      height: 256,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  /**
   * Copy escrow address to clipboard
   */
  copyAddress() {
    const btn = document.getElementById('copy-wager-address-btn');
    navigator.clipboard.writeText(this.currentEscrowAddress);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy Address'; }, 2000);
  }

  /**
   * Start polling for payment status
   */
  startPolling(playerAddresses) {
    this.pollInterval = setInterval(async () => {
      try {
        const player = playerManager.getPlayerData();
        const response = await fetch(`${API_BASE}/escrow/${this.currentSessionId}/status`, {
          headers: {
            'Authorization': `Bearer ${player.sessionToken}`
          }
        });

        const status = await response.json();

        // Update player status UI
        this.updatePlayerStatusUI(status.players, playerAddresses);

        // Check if all paid
        if (status.allPaid && status.status === 'ready') {
          this.stopPolling();
          document.getElementById('wager-status-message').textContent = '✅ All players paid! Game starting...';

          setTimeout(() => {
            this.hideModal();
            // Emit event that game can start
            window.dispatchEvent(new CustomEvent('wager-ready', { detail: { sessionId: this.currentSessionId } }));
          }, 2000);
        } else if (status.status === 'expired' || status.status === 'cancelled') {
          this.stopPolling();
          document.getElementById('wager-status-message').textContent = '❌ Payment expired or cancelled';
        }

      } catch (error) {
        console.error('Error checking payment status:', error);
      }
    }, 3000); // Poll every 3 seconds
  }

  /**
   * Update player payment status UI
   */
  updatePlayerStatusUI(players, playerAddresses) {
    const statusList = document.getElementById('wager-player-status-list');
    statusList.innerHTML = '';

    playerAddresses.forEach(address => {
      const playerStatus = players.find(p => p.address === address);
      const hasPaid = playerStatus?.hasPaid || false;

      const statusItem = document.createElement('div');
      statusItem.style.cssText = 'padding: 8px; margin: 5px 0; background: white; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;';

      const addressShort = address.substring(0, 10) + '...' + address.substring(address.length - 6);
      const statusIcon = hasPaid ? '✅' : '⏳';
      const statusText = hasPaid ? 'Paid' : 'Waiting';

      statusItem.innerHTML = `
        <span style="font-family: monospace; font-size: 12px;">${addressShort}</span>
        <span>${statusIcon} ${statusText}</span>
      `;

      statusList.appendChild(statusItem);
    });
  }

  /**
   * Start countdown timer
   */
  startTimer() {
    this.timerInterval = setInterval(() => {
      const remaining = this.expiryTime - Date.now();

      if (remaining <= 0) {
        document.getElementById('wager-timer-countdown').textContent = '0:00';
        this.stopPolling();
        document.getElementById('wager-status-message').textContent = '⏰ Payment expired';
        return;
      }

      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      document.getElementById('wager-timer-countdown').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  /**
   * Stop polling
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Cancel wager
   */
  async cancelWager() {
    if (this.currentSessionId) {
      try {
        const player = playerManager.getPlayerData();
        await fetch(`${API_BASE}/escrow/${this.currentSessionId}/cancel`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${player.sessionToken}`
          }
        });
      } catch (error) {
        console.error('Error cancelling wager:', error);
      }
    }

    this.hideModal();
  }

  /**
   * Hide modal
   */
  hideModal() {
    this.stopPolling();
    this.modal.style.display = 'none';
    this.currentSessionId = null;
    this.currentEscrowAddress = null;
    this.wagerAmount = null;
  }

  /**
   * Get current wager amount
   */
  getWagerAmount() {
    return this.wagerAmount;
  }
}

export const wageringManager = new WageringManager();
