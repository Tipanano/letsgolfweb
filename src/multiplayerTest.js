// Simple test UI for multiplayer
import * as multiplayerManager from './multiplayerManager.js';
import { wageringManager } from './wageringManager.js';
import { playerManager } from './playerManager.js';

export function initMultiplayerUI() {
    console.log('Initializing multiplayer UI...');

    // Initialize the multiplayer manager
    multiplayerManager.init();

    // Initialize the wagering manager
    wageringManager.init();

    // Test Connection button
    document.getElementById('test-connection-btn')?.addEventListener('click', async () => {
        updateStatus('Testing connection...');
        try {
            const response = await fetch('http://localhost:3001/health');
            const data = await response.json();
            updateStatus(`✅ Connected! Active sessions: ${data.activeSessions}`);
            console.log('Server health:', data);
        } catch (error) {
            updateStatus('❌ Connection failed: ' + error.message);
            console.error('Connection test failed:', error);
        }
    });

    // Host Game button
    document.getElementById('host-game-btn')?.addEventListener('click', async () => {
        const player = playerManager.getPlayerData();

        // Ask if they want wagering (only for registered players)
        let wagerAmount = null;
        if (player.type === 'registered') {
            const wantWagering = confirm('Do you want to create a wagering game?\n\nAll players will need to pay a Nano wager to play. Winner takes all!');

            if (wantWagering) {
                // Show wager setup modal
                const canWager = wageringManager.showWagerSetup();
                if (!canWager) {
                    return; // User not eligible for wagering
                }

                // Wait for user to set wager amount in modal
                // The modal will close when they click "Create Wagering Game"
                return; // The wager modal's "Create Wagering Game" button will handle the rest
            }
        }

        // Create regular (non-wagering) game
        updateStatus('Creating game...');
        const result = await multiplayerManager.hostGame('closest-to-flag', { wagerAmount: null });
        if (result) {
            updateStatus(`✅ Hosting! Code: ${result.roomCode}`);
        }
    });

    // Join Game button
    document.getElementById('join-game-btn')?.addEventListener('click', async () => {
        const roomCode = prompt('Enter room code:');
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
    console.log('Status:', message);
}
