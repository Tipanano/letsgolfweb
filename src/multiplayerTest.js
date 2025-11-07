// Simple test UI for multiplayer
import * as multiplayerManager from './multiplayerManager.js';
import { wageringManager } from './wageringManager.js';
import { playerManager } from './playerManager.js';
import { modal } from './ui/modal.js';

export function initMultiplayerUI() {

    // Initialize the multiplayer manager
    multiplayerManager.init();

    // Initialize the wagering manager
    wageringManager.init();

    // Test Connection button
    document.getElementById('test-connection-btn')?.addEventListener('click', async () => {
        updateStatus('Testing connection...');
        try {
            const { API_BASE_URL } = await import('./config.js');
            // Remove trailing /api from the URL (only at the end)
            const baseUrl = API_BASE_URL.replace(/\/api$/, '');
            const response = await fetch(`${baseUrl}/health`);
            const data = await response.json();
            updateStatus(`✅ Connected! Active sessions: ${data.activeSessions}`);
        } catch (error) {
            updateStatus('❌ Connection failed: ' + error.message);
            console.error('Connection test failed:', error);
        }
    });

    // Host Game button
    document.getElementById('host-game-btn')?.addEventListener('click', () => {
        const player = playerManager.getPlayerData();

        // Show game type choice modal (only for registered players)
        if (player.type === 'registered') {
            showGameTypeModal();
        } else {
            // Guests can only create regular games
            createRegularGame();
        }
    });

    // Setup game type modal handlers
    setupGameTypeModal();

    // Join Game button
    document.getElementById('join-game-btn')?.addEventListener('click', async () => {
        const roomCode = await modal.prompt('Enter room code:', 'Join Game', '', 'ABC123');
        if (!roomCode) return;

        updateStatus('Joining...');
        const result = await multiplayerManager.joinGame(roomCode);
        if (result) {
            updateStatus(`✅ Joined game!`);
        }
    });
}

function updateStatus(message) {
    const statusDiv = document.getElementById('connection-status');
    if (statusDiv) {
        statusDiv.textContent = message;
    }
}

// Game Type Modal Functions
function showGameTypeModal() {
    const modal = document.getElementById('game-type-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function hideGameTypeModal() {
    const modal = document.getElementById('game-type-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function setupGameTypeModal() {
    // Regular game button
    document.getElementById('create-regular-game-btn')?.addEventListener('click', () => {
        hideGameTypeModal();
        createRegularGame();
    });

    // Wagering game button
    document.getElementById('create-wagering-game-choice-btn')?.addEventListener('click', () => {
        hideGameTypeModal();
        // Show wager setup modal
        const canWager = wageringManager.showWagerSetup();
        if (!canWager) {
            updateStatus('❌ You must be registered to create wagering games');
        }
        // The wager modal's "Create Wagering Game" button will handle the rest
    });

    // Cancel button
    document.getElementById('cancel-game-type-btn')?.addEventListener('click', () => {
        hideGameTypeModal();
    });
}

async function createRegularGame() {
    updateStatus('Creating game...');
    const result = await multiplayerManager.hostGame('closest-to-flag', { wagerAmount: null });
    if (result) {
        updateStatus(`✅ Hosting! Code: ${result.roomCode}`);
    }
}
