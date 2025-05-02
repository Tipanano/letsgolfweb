// Handles keyboard input events and translates them into game logic actions or visual changes.

import * as GameLogic from './gameLogic.js'; // Import game logic functions/getters
import * as Visuals from './visuals.js'; // Import visuals for camera controls later
// Import specific UI functions needed for input feedback (markers, status updates)
import {
    adjustBallPosition,
    updateStatus,
    resetUIForNewShot, // May not be needed here if GameLogic.resetSwing handles it
    markHipInitiationOnBackswingBar,
    updateDebugTimingInfo, // May need data from GameLogic getters
    showKeyPressMarker,
    // Timing bar updates are likely handled within GameLogic's animation loops now
} from './ui.js';

// --- Event Handlers ---

export function handleKeyDown(event) {
    // Get current state from GameLogic
    const gameState = GameLogic.getGameState();
    const currentShotType = GameLogic.getCurrentShotType();
    const swingSpeed = GameLogic.getSwingSpeed(); // Needed for marker placement

    console.log(`inputHandler keydown: Key='${event.key}', State='${gameState}', ShotType='${currentShotType}'`);

    // --- Camera Controls (Independent of game state) ---
    if (event.key === '1') {
        Visuals.switchToStaticCamera();
        return; // Consume event
    } else if (event.key === '2') {
        Visuals.activateFollowBallCamera();
        return; // Consume event
    } else if (event.key === '3') {
        Visuals.activateReverseCamera();
        return; // Consume event
    } else if (event.key === '4') {
        Visuals.activateGreenCamera();
        return; // Consume event
    }

    // --- Ball Position Adjustment (Only when ready) ---
    if (gameState === 'ready') {
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            adjustBallPosition(1); // Directly calls UI function
            return;
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            adjustBallPosition(-1); // Directly calls UI function
            return;
        }
    }

    // --- Shot Type Specific Logic ---
    if (currentShotType === 'full') {
        handleFullSwingKeyDown(event, gameState, swingSpeed);
    } else if (currentShotType === 'chip') {
        handleChipKeyDown(event, gameState);
    } else if (currentShotType === 'putt') {
        handlePuttKeyDown(event, gameState);
    }
}

export function handleKeyUp(event) {
    // Get current state from GameLogic
    const gameState = GameLogic.getGameState();
    const currentShotType = GameLogic.getCurrentShotType();

    console.log(`inputHandler keyup: Key='${event.key}', State='${gameState}', ShotType='${currentShotType}'`);

    // --- Shot Type Specific Logic ---
    if (currentShotType === 'full') {
        handleFullSwingKeyUp(event, gameState);
    } else if (currentShotType === 'chip') {
        handleChipKeyUp(event, gameState);
    } else if (currentShotType === 'putt') {
        handlePuttKeyUp(event, gameState);
    }
}


// --- Helper Functions for KeyDown by Shot Type ---

function handleFullSwingKeyDown(event, gameState, swingSpeed) {
    // Start Backswing with 'w'
    if (event.key === 'w' && gameState === 'ready') {
        GameLogic.startBackswing(); // Call action function in GameLogic
    }

    // Reset with 'n'
    if (event.key === 'n' && gameState === 'result') {
        GameLogic.resetSwing(); // Call action function in GameLogic
    }

    // Capture 'a' during backswing (early rotation)
    if (event.key === 'a' && gameState === 'backswing' && !GameLogic.getRotationInitiationTime()) {
         GameLogic.recordRotationInitiation(); // Call action function
         console.log("InputHandler: Recorded early rotation ('a')");
    }

    // Capture 'j' (Hip Initiation)
    if (event.key === 'j' && (gameState === 'backswing' || gameState === 'backswingPausedAtTop') && !GameLogic.getHipInitiationTime()) {
        GameLogic.recordHipInitiation(); // Call action function
        markHipInitiationOnBackswingBar(); // Update UI directly
        updateStatus("Hips Initiated..."); // Update UI directly

        // If paused at top, pressing 'j' starts the downswing phase immediately
        if (gameState === 'backswingPausedAtTop') {
             GameLogic.startDownswingPhase(); // New action function needed
             console.log("InputHandler: Transitioning from Paused to DownswingWaiting due to 'j' press.");
             // updateDebugTimingInfo(GameLogic.getDebugTimingData()); // Update debug UI
        }
    }

    // Capture downswing sequence keys *only if hips have been initiated*
    if (gameState === 'downswingWaiting' && GameLogic.getHipInitiationTime()) {
        const timeNow = performance.now();
        // Offset relative to backswing end (need backswing end time from GameLogic)
        const backswingEndTime = GameLogic.getBackswingEndTime();
        const offset = backswingEndTime ? timeNow - backswingEndTime : null;

        let keyRecorded = false;
        if (event.key === 'd' && !GameLogic.getArmsStartTime()) {
            GameLogic.recordDownswingKey('arms', timeNow); // New action function
            if (offset !== null) showKeyPressMarker('d', offset, swingSpeed); // Update UI
            keyRecorded = true;
            console.log(`InputHandler: Recorded 'd' (Arms) at offset: ${offset?.toFixed(0)} ms`);
        } else if (event.key === 'i' && !GameLogic.getWristsStartTime()) {
            GameLogic.recordDownswingKey('wrists', timeNow); // New action function
            if (offset !== null) showKeyPressMarker('i', offset, swingSpeed); // Update UI
            keyRecorded = true;
            console.log(`InputHandler: Recorded 'i' (Wrists) at offset: ${offset?.toFixed(0)} ms`);
        } else if (event.key === 'a' && !GameLogic.getRotationStartTime() && !GameLogic.getRotationInitiationTime()) {
            GameLogic.recordDownswingKey('rotation', timeNow); // New action function
            if (offset !== null) showKeyPressMarker('a', offset, swingSpeed); // Update UI
            keyRecorded = true;
            console.log(`InputHandler: Recorded 'a' (Rotation) post-backswing at offset: ${offset?.toFixed(0)} ms`);
        }

        if (keyRecorded) {
            // updateDebugTimingInfo(GameLogic.getDebugTimingData()); // Update debug UI
            // Check if all required keys are pressed to trigger calculation
            if (GameLogic.getArmsStartTime() && GameLogic.getWristsStartTime() && (GameLogic.getHipInitiationTime() || GameLogic.getRotationStartTime())) {
                GameLogic.triggerFullSwingCalc(); // New action function
            }
        }
    }
}

function handleChipKeyDown(event, gameState) {
    // Start Backswing with 'w'
    if (event.key === 'w' && gameState === 'ready') {
        GameLogic.startBackswing();
    }

    // Reset with 'n'
    if (event.key === 'n' && gameState === 'result') {
        GameLogic.resetSwing();
    }

    // Capture chip downswing keys ('a', then 'i')
    if (gameState === 'chipDownswingWaiting' && GameLogic.getDownswingPhaseStartTime()) {
        const timeNow = performance.now();
        const downswingStartTime = GameLogic.getDownswingPhaseStartTime();
        const offset = timeNow - downswingStartTime;

        // Chip uses 'a' for rotation start
        if (event.key === 'a' && !GameLogic.getChipRotationStartTime()) {
            GameLogic.recordChipKey('rotation', timeNow); // New action function
            showKeyPressMarker('a', offset, 1.0); // Update UI
            updateStatus('Chip: Rotation...'); // Update UI
            console.log(`InputHandler: Recorded Chip 'a' (Rotation) at offset ${offset.toFixed(0)} ms`);
            // updateDebugTimingInfo(...); // Chip debug needed
        }
        // Chip uses 'i' for hit/wrists, must be after 'a'
        else if (event.key === 'i' && GameLogic.getChipRotationStartTime() && !GameLogic.getChipWristsStartTime()) {
            GameLogic.recordChipKey('hit', timeNow); // New action function
            showKeyPressMarker('i', offset, 1.0); // Update UI
            console.log(`InputHandler: Recorded Chip 'i' (Hit) at offset ${offset.toFixed(0)} ms`);
            // updateDebugTimingInfo(...);
            GameLogic.triggerChipCalc(); // Trigger calculation
        }
    }
}

function handlePuttKeyDown(event, gameState) {
    // Start Backswing with 'w'
    if (event.key === 'w' && gameState === 'ready') {
        GameLogic.startBackswing();
    }

    // Reset with 'n'
    if (event.key === 'n' && gameState === 'result') {
        GameLogic.resetSwing();
    }

    // Capture putt hit key ('i')
    if (gameState === 'puttDownswingWaiting' && GameLogic.getDownswingPhaseStartTime()) {
        const timeNow = performance.now();
        const downswingStartTime = GameLogic.getDownswingPhaseStartTime();
        const offset = timeNow - downswingStartTime;

        if (event.key === 'i' && !GameLogic.getPuttHitTime()) {
            GameLogic.recordPuttKey('hit', timeNow); // New action function
            console.log(`InputHandler: Recorded Putt 'i' (Hit) at offset ${offset.toFixed(0)} ms`);
            GameLogic.triggerPuttCalc(); // Trigger calculation
        }
    }
}


// --- Helper Functions for KeyUp by Shot Type ---

function handleFullSwingKeyUp(event, gameState) {
    if (event.key === 'w' && gameState === 'backswing') {
        GameLogic.endBackswing(); // Call action function in GameLogic
        // updateDebugTimingInfo(GameLogic.getDebugTimingData()); // Update debug UI
    }
}

function handleChipKeyUp(event, gameState) {
    if (event.key === 'w' && gameState === 'backswing') {
        GameLogic.endBackswing(); // Re-use same action function
        // updateDebugTimingInfo(...); // Chip debug needed
    }
}

function handlePuttKeyUp(event, gameState) {
     if (event.key === 'w' && gameState === 'backswing') {
        GameLogic.endBackswing(); // Re-use same action function
    }
}
