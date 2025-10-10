// Simple test UI for multiplayer
import * as multiplayerManager from './multiplayerManager.js';

export function initMultiplayerUI() {
    console.log('Initializing multiplayer UI...');

    // Initialize the multiplayer manager
    multiplayerManager.init();

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
        updateStatus('Creating game...');
        const result = await multiplayerManager.hostGame('closest-to-flag');
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
