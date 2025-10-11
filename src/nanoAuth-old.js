// Nano Authentication Handler
import { playerManager } from './playerManager.js';
import * as ui from './ui.js';

const API_BASE = 'http://localhost:3001/api';

// Modal elements
const modal = document.getElementById('nano-auth-modal');
const usernameSection = document.getElementById('username-input-section');
const qrCodeSection = document.getElementById('qr-code-section');
const usernameInput = document.getElementById('nano-username-input');
const usernameSubmitBtn = document.getElementById('nano-username-submit');
const cancelBtn = document.getElementById('nano-auth-cancel');
const qrCodeContainer = document.getElementById('qr-code-container');
const addressDisplay = document.getElementById('nano-address-display');
const statusMessage = document.getElementById('auth-status-message');
const timerCountdown = document.getElementById('auth-timer-countdown');

// State
let currentLoginSecret = null;
let pollInterval = null;
let expiryInterval = null;
let expiryTime = null;

/**
 * Show the registration modal
 */
export function showRegistrationModal() {
    modal.style.display = 'flex';
    usernameSection.style.display = 'block';
    qrCodeSection.style.display = 'none';
    usernameInput.value = '';
    usernameInput.focus();
}

/**
 * Hide the modal and clean up
 */
function hideModal() {
    modal.style.display = 'none';
    stopPolling();
    currentLoginSecret = null;
}

/**
 * Start registration process
 */
async function startRegistration() {
    const username = usernameInput.value.trim();

    if (!username || username.length < 3) {
        alert('Username must be at least 3 characters');
        return;
    }

    try {
        statusMessage.textContent = 'Creating registration...';

        const response = await fetch(`${API_BASE}/auth/register/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Registration failed');
        }

        const data = await response.json();

        // Store login secret
        currentLoginSecret = data.login_secret;
        expiryTime = Date.now() + (data.expires_in * 1000);

        // Show QR code section
        usernameSection.style.display = 'none';
        qrCodeSection.style.display = 'block';

        // Display address
        addressDisplay.textContent = data.ephemeral_address;

        // Generate QR code
        generateQRCode(data.qr_code_data);

        // Start polling for status
        startPolling();

        // Start expiry countdown
        startExpiryTimer();

        statusMessage.textContent = 'Waiting for payment...';
    } catch (error) {
        console.error('Registration error:', error);
        alert(error.message);
    }
}

/**
 * Generate QR code
 */
function generateQRCode(data) {
    // Clear previous QR code
    qrCodeContainer.innerHTML = '';

    // Use simple canvas-based QR code generation
    // For production, use a library like qrcodejs or qrcode-generator
    // For now, we'll create a simple text display
    const qrDiv = document.createElement('div');
    qrDiv.style.cssText = 'padding: 20px; background: white; font-family: monospace; font-size: 10px; word-break: break-all;';
    qrDiv.textContent = data;
    qrCodeContainer.appendChild(qrDiv);

    // Add copy button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy Address';
    copyBtn.style.cssText = 'margin-top: 10px; padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer;';
    copyBtn.onclick = () => {
        const address = data.split(':')[1].split('?')[0];
        navigator.clipboard.writeText(address);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Address'; }, 2000);
    };
    qrCodeContainer.appendChild(copyBtn);
}

/**
 * Poll for registration status
 */
function startPolling() {
    statusMessage.textContent = 'Waiting for payment...';

    pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/auth/register/status/${currentLoginSecret}`);
            const status = await response.json();

            console.log('Registration status:', status);

            if (status.status === 'confirmed') {
                // Success!
                stopPolling();
                statusMessage.textContent = '✅ Payment received! Logging in...';

                // Upgrade player to registered
                await playerManager.upgradeToRegistered(
                    status.username,
                    status.nano_address,
                    status.session_token
                );

                // Update UI
                ui.updatePlayerDisplay(status.username, 'registered');

                // Show success message
                setTimeout(() => {
                    hideModal();
                    alert(`Welcome, ${status.username}! You're now signed in.`);
                }, 1000);
            } else if (status.status === 'expired') {
                stopPolling();
                statusMessage.textContent = '⏰ Registration expired. Please try again.';
            } else if (status.status === 'invalid_sender') {
                stopPolling();
                statusMessage.textContent = '❌ Payment from wrong address';
            }
        } catch (error) {
            console.error('Polling error:', error);
        }
    }, 2000); // Poll every 2 seconds
}

/**
 * Stop polling
 */
function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    if (expiryInterval) {
        clearInterval(expiryInterval);
        expiryInterval = null;
    }
}

/**
 * Start expiry countdown timer
 */
function startExpiryTimer() {
    expiryInterval = setInterval(() => {
        const remaining = expiryTime - Date.now();

        if (remaining <= 0) {
            timerCountdown.textContent = '0:00';
            stopPolling();
            statusMessage.textContent = '⏰ Registration expired';
            return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        timerCountdown.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
}

/**
 * Initialize event listeners
 */
export function init() {
    usernameSubmitBtn?.addEventListener('click', startRegistration);
    cancelBtn?.addEventListener('click', hideModal);

    // Allow Enter key to submit username
    usernameInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            startRegistration();
        }
    });

    console.log('Nano Auth initialized');
}
