import { playerManager } from './playerManager.js';
import { toast } from './ui/toast.js';
import { modal } from './ui/modal.js';

import { API_BASE_URL } from './config.js';

const API_BASE = API_BASE_URL;

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
      modal.alert('You must be a registered player to create wagering games!\n\nPlease sign in with Nano first.', 'Registration Required', 'warning');
      return false;
    }

    if (!player.nanoAddress) {
      modal.alert('You must have a Nano address to create wagering games!', 'Nano Address Required', 'warning');
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
      modal.alert('Wager amount must be at least 0.001 NANO', 'Invalid Amount', 'warning');
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
   * Create escrow without showing UI (for host)
   * Server will broadcast escrow:created which shows UI for all players
   */
  async createEscrow(sessionId, wagerAmount) {
    const player = playerManager.getPlayerData();

    try {
      const response = await fetch(`${API_BASE}/escrow/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${player.sessionToken}`
        },
        body: JSON.stringify({
          sessionId,
          wagerAmount
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create escrow account');
      }

      const data = await response.json();
      console.log('✅ Escrow created:', data);
      // Don't show UI here - wait for broadcast
    } catch (error) {
      console.error('Error creating escrow:', error);
      await modal.alert('Failed to create wagering game: ' + error.message, 'Escrow Error', 'error');
      throw error;
    }
  }

  /**
   * Show payment UI from broadcast event (for all players including host)
   * Called when escrow:created event is received
   */
  showPaymentUIFromBroadcast(sessionId, escrowAddress, wagerAmount, expiresIn, players) {
    this.currentSessionId = sessionId;
    this.currentEscrowAddress = escrowAddress;
    this.wagerAmount = wagerAmount;
    this.expiryTime = Date.now() + (expiresIn * 1000);
    this.players = players;

    // Show modal with payment info
    this.modal.style.display = 'flex';
    this.setupSection.style.display = 'none';
    this.paymentSection.style.display = 'block';

    // Update UI
    document.getElementById('wager-amount-display').textContent = `${wagerAmount} NANO`;
    document.getElementById('wager-escrow-address').textContent = escrowAddress;

    // Generate QR code
    this.generateQRCode(`nano:${escrowAddress}?amount=${wagerAmount}`);

    // Show initial player list (all waiting)
    this.updatePlayerStatusUI([], players);

    // Start polling for payments
    this.startPolling();

    // Start countdown timer
    this.startTimer();
  }

  /**
   * Generate QR code for payment
   */
  generateQRCode(data) {
    const container = document.getElementById('wager-qr-container');
    container.innerHTML = '';

    new QRCode(container, {
      text: data,
      width: 134,
      height: 134,
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

        if (!response.ok) {
          console.error(`❌ [WAGER] Payment status check failed: ${response.status}`);
          return;
        }

        const status = await response.json();

        // Update player status UI
        if (status.players && this.players) {
          this.updatePlayerStatusUI(status.players, this.players);
        }

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
   * @param {array} paymentPlayers - Payment status from server (address, hasPaid)
   * @param {array} gamePlayers - Full player objects from game (name, nanoAddress, linkedAddresses)
   */
  updatePlayerStatusUI(paymentPlayers, gamePlayers) {
    const statusList = document.getElementById('wager-player-status-list');
    statusList.innerHTML = '';

    const currentPlayer = playerManager.getPlayerData();
    const currentPlayerAddress = currentPlayer?.nanoAddress;

    // Add warning about linked addresses (only shown to current player)
    const warning = document.createElement('div');
    warning.style.cssText = 'padding: 10px; margin-bottom: 10px; background: #FFF3E0; border-left: 4px solid #FF9800; font-size: 13px; line-height: 1.4;';
    warning.innerHTML = '<strong>⚠️ Important:</strong> Pay with one of your linked addresses below, or funds will be lost!';
    statusList.appendChild(warning);

    gamePlayers.forEach(gamePlayer => {
      const paymentStatus = paymentPlayers.find(p => p.address === gamePlayer.nanoAddress);
      const hasPaid = paymentStatus?.hasPaid || false;
      const isCurrentPlayer = gamePlayer.nanoAddress === currentPlayerAddress;

      const statusItem = document.createElement('div');
      statusItem.style.cssText = 'padding: 10px; margin: 5px 0; background: white; border-radius: 5px; border: 1px solid #e0e0e0;';

      const statusIcon = hasPaid ? '✅' : '⏳';
      const statusText = hasPaid ? 'Paid' : 'Waiting';

      // Only show linked addresses for the current player
      const linkedAddressesHTML = isCurrentPlayer && gamePlayer.linkedAddresses && gamePlayer.linkedAddresses.length > 0
        ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">
             <div style="font-style: italic; margin-bottom: 2px;">Your linked addresses:</div>
             ${gamePlayer.linkedAddresses.map(addr =>
               `<div style="font-family: monospace;">${addr.substring(0, 12)}...${addr.substring(addr.length - 8)}</div>`
             ).join('')}
           </div>`
        : '';

      statusItem.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 600;">${gamePlayer.name}${isCurrentPlayer ? ' (You)' : ''}</div>
            ${linkedAddressesHTML}
          </div>
          <span style="font-size: 14px;">${statusIcon} ${statusText}</span>
        </div>
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
    // Show confirmation dialog
    const confirmed = await modal.confirm(
      'Cancelling the payment will make you leave the game and you will not be able to rejoin. Are you sure?',
      'Leave Game',
      'warning'
    );

    if (!confirmed) {
      return; // User cancelled
    }

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

    // Trigger leaving the game
    window.dispatchEvent(new CustomEvent('leave-game'));
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
