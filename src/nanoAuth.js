// Nano Authentication Handler - Revised Flow
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
let userNanoAddress = null; // Store nano address when payment received

/**
 * Show the auth modal and start the flow
 */
export async function showRegistrationModal() {
    modal.style.display = 'flex';

    // Hide username section, show QR code section
    usernameSection.style.display = 'none';
    qrCodeSection.style.display = 'block';

    statusMessage.textContent = 'Starting authentication...';

    try {
        // Step 1: Start auth (no username needed)
        const response = await fetch(`${API_BASE}/auth/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('Failed to start authentication');
        }

        const data = await response.json();

        // Store login secret
        currentLoginSecret = data.login_secret;
        expiryTime = Date.now() + (data.expires_in * 1000);

        // Display address
        addressDisplay.textContent = data.ephemeral_address;

        // Generate QR code
        generateQRCode(data.qr_code_data);

        // Start polling for payment
        startPolling();

        // Start expiry timer
        startExpiryTimer();

        statusMessage.textContent = 'Waiting for payment...';
    } catch (error) {
        console.error('Auth start error:', error);
        alert(error.message);
        hideModal();
    }
}

/**
 * Hide the modal and clean up
 */
function hideModal() {
    modal.style.display = 'none';
    stopPolling();
    currentLoginSecret = null;
    userNanoAddress = null;
}

/**
 * Generate QR code using QRCode.js library
 */
function generateQRCode(data) {
    qrCodeContainer.innerHTML = '';

    // Create QR code using the library
    new QRCode(qrCodeContainer, {
        text: data,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });
}

/**
 * Poll for auth status
 */
function startPolling() {
    pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/auth/status/${currentLoginSecret}`);
            const status = await response.json();

            console.log('Auth status:', status);

            if (status.status === 'needs_username') {
                // Payment received, but new user - need username
                stopPolling();
                userNanoAddress = status.nano_address;
                showUsernameInput();
            } else if (status.status === 'confirmed') {
                // Existing user logged in OR registration complete
                stopPolling();
                await handleLoginSuccess(status);
            } else if (status.status === 'expired') {
                stopPolling();
                statusMessage.textContent = '⏰ Authentication expired. Please try again.';
            } else if (status.status === 'error') {
                stopPolling();
                statusMessage.textContent = '❌ Error: ' + status.message;
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
 * Show username input for new users
 */
function showUsernameInput() {
    qrCodeSection.style.display = 'none';
    usernameSection.style.display = 'block';
    usernameInput.value = '';
    usernameInput.focus();
    statusMessage.textContent = '✅ Payment received! Choose your username:';
}

/**
 * Submit username for new user registration
 */
async function submitUsername() {
    const username = usernameInput.value.trim();

    if (!username || username.length < 3) {
        alert('Username must be at least 3 characters');
        return;
    }

    try {
        statusMessage.textContent = 'Creating account...';

        const response = await fetch(`${API_BASE}/auth/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                login_secret: currentLoginSecret,
                username
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Registration failed');
        }

        const result = await response.json();
        await handleLoginSuccess(result);
    } catch (error) {
        console.error('Username submission error:', error);
        alert(error.message);
    }
}

/**
 * Handle successful login/registration
 */
async function handleLoginSuccess(data) {
    statusMessage.textContent = '✅ Success! Logging in...';

    // Upgrade player to registered
    await playerManager.upgradeToRegistered(
        data.username,
        data.nano_address,
        data.session_token
    );

    // Update UI
    ui.updatePlayerDisplay(data.username, 'registered');

    // Show success message
    setTimeout(() => {
        hideModal();
        const message = data.is_new_user
            ? `Welcome, ${data.username}! Your account has been created.`
            : `Welcome back, ${data.username}!`;
        alert(message);
    }, 1000);
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
            statusMessage.textContent = '⏰ Authentication expired';
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
    usernameSubmitBtn?.addEventListener('click', submitUsername);
    cancelBtn?.addEventListener('click', hideModal);

    usernameInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitUsername();
        }
    });

    console.log('Nano Auth initialized (new flow)');
}
