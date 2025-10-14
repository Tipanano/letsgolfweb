// Shot Timer for Multiplayer Mode
// Manages the countdown timer for player turns

const SHOT_TIME_LIMIT = 60; // seconds
let timerInterval = null;
let timeRemaining = SHOT_TIME_LIMIT;
let isRunning = false;
let onTimeoutCallback = null;
let messageTemplate = 'Your shot, {time} seconds left'; // Default message format

// UI Elements - using top center status display
const statusDisplay = document.getElementById('status-text-display');

/**
 * Starts the shot timer
 * @param {function} onTimeout - Callback when timer reaches 0
 * @param {string} template - Message template with {time} placeholder (optional)
 */
export function startTimer(onTimeout, template = null) {
    console.log('Starting shot timer...');

    // Clear any existing timer
    stopTimer();

    // Reset
    timeRemaining = SHOT_TIME_LIMIT;
    onTimeoutCallback = onTimeout;
    isRunning = true;

    // Set message template
    if (template) {
        messageTemplate = template;
    }

    // Update display immediately
    updateDisplay();

    // Start countdown
    timerInterval = setInterval(() => {
        timeRemaining--;
        updateDisplay();

        // Time's up!
        if (timeRemaining <= 0) {
            handleTimeout();
        }
    }, 1000);
}

/**
 * Stops the timer
 */
export function stopTimer() {
    console.log('Stopping shot timer');

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    isRunning = false;

    // Clear the status display
    if (statusDisplay) {
        statusDisplay.textContent = 'Ready...';
    }
}

/**
 * Updates the timer display
 */
function updateDisplay() {
    if (statusDisplay) {
        // Replace {time} placeholder with actual time
        const message = messageTemplate.replace('{time}', timeRemaining);
        statusDisplay.textContent = message;
    }
}

/**
 * Updates the status display with a custom message (used by multiplayer manager)
 * @param {string} message - The message to display
 */
export function setStatusMessage(message) {
    if (statusDisplay) {
        statusDisplay.textContent = message;
    }
}

/**
 * Handles timer reaching 0
 */
function handleTimeout() {
    console.log('Shot timer expired!');
    stopTimer();

    if (onTimeoutCallback) {
        onTimeoutCallback();
    }
}

/**
 * Gets remaining time
 * @returns {number} Seconds remaining
 */
export function getTimeRemaining() {
    return timeRemaining;
}

/**
 * Checks if timer is running
 * @returns {boolean}
 */
export function isTimerRunning() {
    return isRunning;
}
