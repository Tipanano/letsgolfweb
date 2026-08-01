import {
    getGameState, getCurrentShotType, getHipInitiationTime, getRotationInitiationTime,
    getArmsStartTime, getWristsStartTime, getRotationStartTime, getChipRotationStartTime,
    getChipWristsStartTime, getPuttHitTime, getBackswingDuration, getSelectedClub, getChipProfile,
    setGameState, setBackswingStartTime, setBackswingEndTime, setRotationInitiationTime,
    setHipInitiationTime, setDownswingPhaseStartTime, setArmsStartTime, setWristsStartTime,
    setRotationStartTime, setChipRotationStartTime, setChipWristsStartTime, setPuttHitTime,
    resetSwingState, resetSwingVariablesOnly, setShotDirectionAngle, clearSelectedClub, setSelectedClub // Import both reset functions and angle setter
} from './state.js';
import {
    startBackswingAnimation, stopBackswingAnimation, startFullDownswingAnimation,
    startChipDownswingAnimation, stopChipDownswingAnimation, startPuttDownswingAnimation,
    stopPuttDownswingAnimation, stopAllAnimations // Import animation controls
} from './animations.js';
import {
    updateStatus, resetUIForNewShot, updateDebugTimingInfo, clearClubSelection, setSelectedClubButton, // Import UI functions (resetUIForNewShot is already imported)
    getBallPositionIndex as getBallPositionIndexUI, getBallPositionLevels as getBallPositionLevelsUI,
    showWaterDropModal
} from '../ui.js';
import { estimateRhythmChipCarry, CHIP_PROFILES } from '../chipPhysics.js';
import { gameAlert } from '../ui/gameAlert.js';
// Import calculation functions directly
import { calculateFullSwingShot, calculateChipShot, calculatePuttShot } from './calculations.js';
// Import debug data getter directly
import { getDebugTimingData } from '../utils/gameUtils.js';
import { getCurrentGameMode } from '../main.js'; // Import mode checker
// Import necessary functions from playHole.js
import {
    getCurrentBallPosition as getPlayHoleBallPosition,
    getCurrentHoleLayout,
    getCurrentLie as getPlayHoleLie,
    getHoleJustCompleted,
    prepareForTeeShotAfterHoleOut,
    returnToTee,
    moveToFormerPosition,
    getPendingWaterDrop,
    takeWaterDropAtCrossing,
    replayFromPreviousLie,
    isPracticeMode,
    isRoundActive,
    hasNextRoundHole,
    advanceToNextHole,
    endRound
} from '../modes/playHole.js';
import { getFlagPosition, setFlagstickVisibility } from '../visuals/holeView.js'; // Import flag position getter AND visibility setter
import { getActiveCameraMode, setCameraBehindBall, snapFollowCameraToBall, CameraMode, removeTrajectoryLine, applyAimAngleToCamera, setCameraBehindBallLookingAtTarget, setInitialFollowCameraLookingAtTarget, setBallScale, resetStaticCameraZoom, setBallHalo, updateAimIndicator, BALL_RADIUS } from '../visuals/core.js'; // Import camera functions, line removal, aim application, setBallScale, AND resetStaticCameraZoom
import { getSurfaceProperties } from '../surfaces.js';
import { resetVisuals } from '../visuals.js'; // Import resetVisuals to update ball position
import { getSurfaceTypeAtPoint } from '../utils/gameUtils.js'; // Import surface checker
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js'; // Need THREE for Vector3
import * as multiplayerManager from '../multiplayerManager.js'; // Import multiplayer manager
// Rhythm putting
import * as RhythmPutt from '../rhythmPutt.js';
import { updatePuttPreview, hidePuttPreview } from '../visuals/puttPreview.js';
import { getActiveDrill } from '../career/greenCard.js';
import { updateRhythmHud, hideRhythmHud, flashBeat, showRhythmHud, showAddressHint, strikeName } from '../ui/rhythmPuttHud.js';
import { ball } from '../visuals/core.js';
import { getCurrentTargetLineAngle, getShotDirectionAngle } from './state.js';

// --- Sound Effects ---
const regularShotSound = new Audio('assets/sounds/regular_shot.mp3');
regularShotSound.preload = 'auto'; // Preload the sound

const chipShotSound = new Audio('assets/sounds/chip_shot.mp3');
chipShotSound.preload = 'auto'; // Preload the sound

const puttShotSound = new Audio('assets/sounds/putt_shot.mp3');
puttShotSound.preload = 'auto'; // Preload the sound

// The active rhythm short-game profile (chip vs pitch power band).
const activeChipProfile = () => CHIP_PROFILES[getChipProfile()] || CHIP_PROFILES.chip;

// True when the on-screen touch zones are the input device (status wording).
const isTouchStatus = () => typeof document !== 'undefined' && document.body.classList.contains('touch-active');

// --- Action Functions for Input Handler ---

export function startBackswing() {
    if (getGameState() !== 'ready') return;

    // Check if a club is selected
    const selectedClub = getSelectedClub();
    if (!selectedClub) {
        gameAlert.show('Please select a club before starting your swing');
        return;
    }

    // Block second shot in multiplayer CTF mode
    if (multiplayerManager.hasLocalPlayerShot()) {
        updateStatus('You have already taken your shot!');
        return;
    }

    const shotType = getCurrentShotType();

    setGameState('backswing');
    setBackswingStartTime(performance.now());
    updateStatus(`${shotType.charAt(0).toUpperCase() + shotType.slice(1)} Backswing...`);
    resetUIForNewShot(); // Reset UI elements (preserving ball position)
    hideRhythmHud(); // Swing bars/arc take over from the address prompt

    // Notify multiplayer manager that shot has started
    multiplayerManager.onShotStarted();

    // Start backswing bar animation
    startBackswingAnimation();
}

export function endBackswing() {
    const state = getGameState();
    if (state !== 'backswing') return;
    const shotType = getCurrentShotType();

    setBackswingEndTime(performance.now()); // This also calculates backswingDuration in state.js
    const duration = getBackswingDuration(); // Get the calculated duration

    // Stop backswing bar animation
    stopBackswingAnimation();

    // --- Transition logic based on shot type ---
    if (shotType === 'full') {
        // Decide next state based on whether 'j' was pressed during backswing
        if (getHipInitiationTime()) {
            startDownswingPhase(); // Hips already initiated, go straight to downswing waiting
        } else {
            // Hips not initiated yet, pause at the top
            setGameState('backswingPausedAtTop');
            updateStatus("Paused at Top... Press 'j' to start downswing");
        }
        updateDebugTimingInfo(getDebugTimingData()); // Update debug display
    } else if (shotType === 'chip') {
        // Transition to waiting for chip inputs AND start the downswing phase
        setGameState('chipDownswingWaiting');
        setDownswingPhaseStartTime(performance.now()); // Start chip downswing phase NOW
        updateStatus('Chip: Press a (rotate), then i (hit)');
        // Start chip timing bar animation
        startChipDownswingAnimation();
        // updateDebugTimingInfo(getDebugTimingData()); // Need chip-specific debug info
    } else if (shotType === 'putt') {
        // Transition to waiting for putt hit input ('i') AND start the downswing phase
        setGameState('puttDownswingWaiting');
        setDownswingPhaseStartTime(performance.now()); // Start putt downswing phase NOW (W release)
        updateStatus('Putt: Press i (hit)');
        // Start putt downswing timing bar animation
        startPuttDownswingAnimation(); // Animation module handles duration check
    }
}

export function recordRotationInitiation() {
    const state = getGameState();
    if (state === 'backswing' && !getRotationInitiationTime()) {
        setRotationInitiationTime(performance.now());
    }
}

export function recordHipInitiation() {
    const state = getGameState();
    if ((state === 'backswing' || state === 'backswingPausedAtTop') && !getHipInitiationTime()) {
        const time = performance.now();
        setHipInitiationTime(time);
        // UI updates (status, marker) are handled directly in inputHandler for now
    }
}

// Called when 'j' is pressed while paused, or automatically after 'w' release if 'j' was pressed during backswing
export function startDownswingPhase() {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType === 'full' && (state === 'backswingPausedAtTop' || (state === 'backswing' && getHipInitiationTime()))) {
        setGameState('downswingWaiting');
        updateStatus('Downswing: Press a, d, i...');
        setDownswingPhaseStartTime(performance.now()); // Set common downswing start time
        startFullDownswingAnimation();
    }
    // Add logic for chip/putt if needed, though their downswing starts on 'w' release
}


export function recordDownswingKey(keyType, timestamp) {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType !== 'full' || state !== 'downswingWaiting' || !getHipInitiationTime()) return;

    switch (keyType) {
        case 'arms':
            if (!getArmsStartTime()) setArmsStartTime(timestamp);
            break;
        case 'wrists':
            if (!getWristsStartTime()) setWristsStartTime(timestamp);
            break;
        case 'rotation':
             // Only record if not initiated early ('a' during backswing)
            if (!getRotationStartTime() && !getRotationInitiationTime()) setRotationStartTime(timestamp);
            break;
    }
    // UI updates (marker, debug) handled in inputHandler
}

export function recordChipKey(keyType, timestamp) {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType !== 'chip' || state !== 'chipDownswingWaiting') return;

    switch (keyType) {
        case 'rotation':
            if (!getChipRotationStartTime()) setChipRotationStartTime(timestamp);
            break;
        case 'hit':
            // Must be after rotation
            if (getChipRotationStartTime() && !getChipWristsStartTime()) setChipWristsStartTime(timestamp);
            break;
    }
     // UI updates (marker, status) handled in inputHandler
}

export function recordPuttKey(keyType, timestamp) {
    const shotType = getCurrentShotType();
    const state = getGameState();
    if (shotType !== 'putt' || state !== 'puttDownswingWaiting') return;

    if (keyType === 'hit' && !getPuttHitTime()) {
        setPuttHitTime(timestamp);
        // Stop the putt downswing animation loop immediately when hit is recorded
        stopPuttDownswingAnimation();
    }
    // UI updates handled in inputHandler
}

// Play impact sound based on current shot type
export function playImpactSound() {
    const shotType = getCurrentShotType();
    if (shotType === 'full') {
        regularShotSound.play().catch(e => console.error("Error playing regular shot sound:", e));
    } else if (shotType === 'chip') {
        chipShotSound.play().catch(e => console.error("Error playing chip shot sound:", e));
    } else if (shotType === 'putt') {
        puttShotSound.play().catch(e => console.error("Error playing putt shot sound:", e));
    }
}

export function triggerFullSwingCalc() {
    const shotType = getCurrentShotType();
    const state = getGameState(); // Keep only one declaration
    if (shotType === 'full' && state === 'downswingWaiting') {
        // Check if all required keys are pressed
        if (getArmsStartTime() && getWristsStartTime() && (getHipInitiationTime() || getRotationStartTime())) {
            regularShotSound.play().catch(e => console.error("Error playing regular shot sound:", e));
            calculateFullSwingShot(); // Call the calculation function directly
        } else {
            console.warn("Action: Attempted to trigger full swing calc prematurely (missing keys).");
            // Optionally trigger anyway if timeout occurred (handled in animation loop)
            // Or maybe force calculation with missing inputs here if needed?
            // For now, rely on animation timeout to trigger if keys missing.
        }
    }
}

export function triggerChipCalc() {
    const shotType = getCurrentShotType();
    const state = getGameState(); // Keep only one declaration
    if (shotType === 'chip' && state === 'chipDownswingWaiting') {
        // Check if hit key is pressed (rotation is checked implicitly by state)
        if (getChipWristsStartTime()) {
             // Stop the chip animation loop (if not already stopped by timeout)
            stopChipDownswingAnimation();
            chipShotSound.play().catch(e => console.error("Error playing chip shot sound:", e));
            setGameState('calculatingChip'); // Set state BEFORE calling calculation
            calculateChipShot(); // Call the calculation function directly
        } else {
             console.warn("Action: Attempted to trigger chip calc prematurely (missing hit key).");
             // Rely on animation timeout to trigger if 'i' missing.
        }
    }
}

// --- Rhythm Putting Actions ---

/**
 * Handles a 'w' tap for the rhythm putt input. The first tap moves the game
 * into the 'puttRhythm' state; subsequent taps refine the tempo.
 */
export function recordPuttRhythmTap() {
    if (getCurrentShotType() !== 'putt') return;
    const state = getGameState();
    if (state !== 'ready' && state !== 'puttRhythm') return;

    if (state === 'ready') {
        if (!getSelectedClub()) {
            gameAlert.show('Please select a club before starting your swing');
            return;
        }
        if (multiplayerManager.hasLocalPlayerShot()) {
            updateStatus('You have already taken your shot!');
            return;
        }
        if (!multiplayerManager.isLocalPlayerTurn()) {
            updateStatus('Wait for your turn!');
            return;
        }
        setGameState('puttRhythm');
        resetUIForNewShot();
        multiplayerManager.onShotStarted();
        showRhythmHud();
        updateStatus(isTouchStatus() ? 'Putt: tap a tempo...' : 'Putt: tap w to a rhythm...');
    }

    const result = RhythmPutt.recordTap(performance.now());
    if (!result.accepted) return;

    flashBeat();
    if (result.restarted) {
        updateStatus('Tempo expired — building a new rhythm');
    }
    refreshRhythmPuttUI(result);
}

/** Refreshes the HUD and ground preview from the current rhythm state. */
export function refreshRhythmPuttUI(snapshot = null) {
    if (getGameState() !== 'puttRhythm') return;
    const snap = snapshot || RhythmPutt.getSnapshot();

    updateRhythmHud(snap, RhythmPutt.MIN_TAPS_TO_ARM);

    if (snap.tempoMs && ball) {
        const aimAngleRad = (getCurrentTargetLineAngle() + getShotDirectionAngle()) * Math.PI / 180;
        // Dispersion preview: ± roughly 2 sigma of the injected distance noise
        const spreadFrac = Math.min(0.5, 2 * snap.cv * 0.6 + 0.02);
        updatePuttPreview({
            ballPos: ball.position,
            aimAngleRad,
            distanceMeters: snap.distanceMeters,
            spreadFrac,
            armed: snap.armed,
        });
    }
}

/**
 * Handles the 'i' press: scores the strike against the player's own beat and
 * fires the putt calculation.
 */
export function strikeRhythmPutt() {
    if (getCurrentShotType() !== 'putt' || getGameState() !== 'puttRhythm') return;

    const strike = RhythmPutt.scoreStrike(performance.now());
    if (!strike) {
        // Not armed yet, or the rhythm expired (scoreStrike resets it then)
        updateRhythmHud(RhythmPutt.getSnapshot(), RhythmPutt.MIN_TAPS_TO_ARM);
        updateStatus('Keep tapping w — need a settled tempo before striking');
        return;
    }

    hidePuttPreview();
    hideRhythmHud();
    puttShotSound.play().catch(e => console.error("Error playing putt shot sound:", e));
    setGameState('calculatingPutt');
    calculatePuttShot();
    RhythmPutt.reset();
}

/** Cancels an in-progress rhythm putt (Escape). */
export function cancelPuttRhythm() {
    if (getGameState() !== 'puttRhythm') return;
    RhythmPutt.reset();
    hidePuttPreview();
    setGameState('ready');
    updateStatus('Putt cancelled — Ready');
    showAddressHint('putt');
}

// --- Rhythm Chipping Actions ---
// Same tap mechanic as putting, plus an optional SECOND 'i' scored against the
// beat after the strike: early = draw, on the beat = extra spin, late = fade.

let chipShapeTimerId = null;

/** Handles a 'w' tap for the rhythm chip input. */
export function recordChipRhythmTap() {
    if (getCurrentShotType() !== 'chip') return;
    const state = getGameState();
    if (state !== 'ready' && state !== 'chipRhythm') return;

    if (state === 'ready') {
        if (!getSelectedClub()) {
            gameAlert.show('Please select a club before starting your swing');
            return;
        }
        if (multiplayerManager.hasLocalPlayerShot()) {
            updateStatus('You have already taken your shot!');
            return;
        }
        if (!multiplayerManager.isLocalPlayerTurn()) {
            updateStatus('Wait for your turn!');
            return;
        }
        setGameState('chipRhythm');
        resetUIForNewShot();
        multiplayerManager.onShotStarted();
        showRhythmHud();
        const profileLabel = activeChipProfile().label;
        updateStatus(isTouchStatus() ? `${profileLabel}: tap a tempo...` : `${profileLabel}: tap w to a rhythm...`);
    }

    const result = RhythmPutt.recordTap(performance.now());
    if (!result.accepted) return;

    flashBeat();
    if (result.restarted) {
        updateStatus('Tempo expired — building a new rhythm');
    }
    refreshRhythmChipUI(result);
}

/** Refreshes the HUD and carry preview from the current rhythm state (chip). */
export function refreshRhythmChipUI(snapshot = null) {
    if (getGameState() !== 'chipRhythm') return;
    const snap = snapshot || RhythmPutt.getSnapshot();
    const club = getSelectedClub();

    let carry = null;
    if (snap.tempoMs && club) {
        const { lie, ballPositionFactor } = _getChipContext();
        carry = estimateRhythmChipCarry(snap.tempoMs, club, ballPositionFactor, lie, activeChipProfile());
    }

    updateRhythmHud({ ...snap, distanceMeters: carry }, RhythmPutt.MIN_TAPS_TO_ARM,
        snap.armed ? `${strikeName()} on the beat to ${activeChipProfile().label.toLowerCase()}` : null);

    if (carry !== null && ball) {
        const aimAngleRad = (getCurrentTargetLineAngle() + getShotDirectionAngle()) * Math.PI / 180;
        const spreadFrac = Math.min(0.5, 2 * snap.cv * 0.8 + 0.04);
        updatePuttPreview({
            ballPos: ball.position,
            aimAngleRad,
            distanceMeters: carry,
            spreadFrac,
            armed: snap.armed,
        });
    }
}

/** Current lie + ball position factor for chip physics/preview. */
function _getChipContext() {
    let lie = 'FAIRWAY';
    if (getCurrentGameMode() === 'play-hole') {
        lie = (getPlayHoleLie() || 'FAIRWAY').toUpperCase().replace(' ', '_');
    }
    const levels = getBallPositionLevelsUI();
    const centerIndex = Math.floor(levels / 2);
    const index = getBallPositionIndexUI();
    const ballPositionFactor = levels > 1 ? (centerIndex - index) / centerIndex : 0;
    return { lie, ballPositionFactor };
}

/** First 'i': strike. Opens the shape window (one beat) before the shot fires. */
export function strikeRhythmChip() {
    if (getCurrentShotType() !== 'chip' || getGameState() !== 'chipRhythm') return;

    const strike = RhythmPutt.scoreStrike(performance.now());
    if (!strike) {
        updateRhythmHud(RhythmPutt.getSnapshot(), RhythmPutt.MIN_TAPS_TO_ARM);
        updateStatus('Keep tapping w — need a settled tempo before striking');
        return;
    }

    setGameState('chipShapeWindow');
    updateStatus(`Shape it: ${strikeName()} early = draw · on beat = spin · late = fade`);
    updateRhythmHud({ ...RhythmPutt.getSnapshot(), tempoMs: strike.tempoMs, cv: strike.cv, armed: true, distanceMeters: null },
        RhythmPutt.MIN_TAPS_TO_ARM, `Shape: ${strikeName()} early=draw · beat=spin · late=fade`);

    // No shape tap within the window → fire with stock spin
    chipShapeTimerId = setTimeout(() => {
        chipShapeTimerId = null;
        _fireRhythmChip();
    }, RhythmPutt.shapeWindowMs());
}

/** Second 'i': shape tap (draw/spinner/fade), then fire. */
export function shapeRhythmChip() {
    if (getCurrentShotType() !== 'chip' || getGameState() !== 'chipShapeWindow') return;
    if (chipShapeTimerId) {
        clearTimeout(chipShapeTimerId);
        chipShapeTimerId = null;
    }
    RhythmPutt.scoreShape(performance.now());
    _fireRhythmChip();
}

function _fireRhythmChip() {
    if (getGameState() !== 'chipShapeWindow') return;
    hidePuttPreview();
    hideRhythmHud();
    chipShotSound.play().catch(e => console.error("Error playing chip shot sound:", e));
    setGameState('calculatingChip');
    calculateChipShot();
    RhythmPutt.reset();
}

/** Cancels an in-progress rhythm chip (Escape, before the strike). */
export function cancelChipRhythm() {
    if (getGameState() !== 'chipRhythm') return;
    RhythmPutt.reset();
    hidePuttPreview();
    setGameState('ready');
    updateStatus('Chip cancelled — Ready');
    showAddressHint('chip');
}

export function triggerPuttCalc() {
    const shotType = getCurrentShotType();
    const state = getGameState(); // Keep only one declaration
     if (shotType === 'putt' && state === 'puttDownswingWaiting') {
        // Check if hit key is pressed
        if (getPuttHitTime()) {
             // Animation loop is stopped in recordPuttKey
            puttShotSound.play().catch(e => console.error("Error playing putt shot sound:", e));
            setGameState('calculatingPutt'); // Set state BEFORE calling calculation
            calculatePuttShot(); // Call the calculation function directly
        } else {
            console.warn("Action: Attempted to trigger putt calc prematurely (missing hit key).");
            // Rely on animation timeout to trigger if 'i' missing.
        }
    }
}

// --- Reset Function ---
// This function performs a FULL reset, including visual ball position. Used for range mode, etc.
/**
 * NEW UNIFIED RESET FUNCTION
 * Prepares for the next shot based on current game mode and state.
 * Handles: Range (always tee), CTF (always tee), Play Hole (tee if holed out, else current position)
 */
export function resetSwing() {
    const currentMode = getCurrentGameMode();

    stopAllAnimations();
    RhythmPutt.reset();
    hidePuttPreview();
    hideRhythmHud();
    if (chipShapeTimerId) {
        clearTimeout(chipShapeTimerId);
        chipShapeTimerId = null;
    }

    // RANGE MODE: Always return to tee
    if (currentMode === 'range') {
        resetSwingState(); // Full reset with UI and visuals
        showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });
        return;
    }

    // CLOSEST TO FLAG MODE: Always return to tee
    if (currentMode === 'closest-to-flag') {
        resetSwingState(); // Full reset with UI and visuals
        showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });
        return;
    }

    // PLAY HOLE MODE: Complex logic based on ball state
    if (currentMode === 'play-hole') {
        const holeJustCompleted = getHoleJustCompleted();

        // Case 1: Holed out
        if (holeJustCompleted) {
            // Course round: advance to the next hole, or show the scorecard
            if (isRoundActive()) {
                if (hasNextRoundHole()) {
                    advanceToNextHole().catch(e => console.error('Round advance failed:', e));
                } else {
                    const summary = endRound();
                    gameAlert.show(summary.text, 'Round Complete');
                    returnToTee();
                    resetSwingState();
                    showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });
                }
                return;
            }
            console.log('resetSwing: Hole completed, returning to tee');
            returnToTee(); // Updates playHole internal state
            resetSwingState(); // Full reset with UI and visuals (gets position from playHole)
            showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });
            return;
        }

        // Case 2: Ball in play - check lie and handle accordingly
        // Green Card drills: every shot is one attempt, so 'next' ALWAYS
        // places the next drill ball — never "play on from where it lies",
        // regardless of how the hole-completed flag fared.
        if (isPracticeMode() && getActiveDrill()) {
            returnToTee(); // practice: returns to the drill placement spot
            resetSwingState();
            showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });
            return;
        }

        const currentLie = getPlayHoleLie();
        console.log('resetSwing: Play Hole mode - Current lie:', currentLie);

        // Handle OOB - move to former position with penalty
        if (currentLie === 'OUT_OF_BOUNDS') {
            console.log('resetSwing: OOB detected! Moving to former position with penalty');
            moveToFormerPosition(); // Moves ball and adds penalty stroke

            // Update visuals to show ball at former position
            const ballPos = getPlayHoleBallPosition();
            const lie = getPlayHoleLie();
            resetVisuals(ballPos, lie); // Move ball visually to former position

            _prepareNextShotAtCurrentPosition(); // Setup camera/aim/UI for next shot
            console.log('resetSwing: OOB handling complete');
            return;
        }

        // A ball in a penalty area cannot simply be played from where it
        // stopped — until now it was, which is how you ended up swinging from
        // the bottom of a lake. A bunker is NOT this case: sand is a hazard
        // you play out of, and it is a real lie now that surfaces report it.
        if (currentLie === 'WATER') {
            const drop = getPendingWaterDrop();
            if (drop && (drop.dropPoint || drop.canReplay)) {
                console.log('resetSwing: ball in a penalty area, offering a drop', drop);
                showWaterDropModal(drop, (choice) => {
                    const done = choice === 'drop' ? takeWaterDropAtCrossing() : replayFromPreviousLie();
                    if (!done) console.warn('resetSwing: drop choice could not be applied:', choice);
                    resetVisuals(getPlayHoleBallPosition(), getPlayHoleLie());
                    _prepareNextShotAtCurrentPosition();
                });
                return;   // the modal drives the rest
            }
            console.warn('resetSwing: in water with no drop offer — playing it as it lies');
        }

        // Case 3: Normal shot - continue from current position
        console.log('resetSwing: Normal shot, continuing from current position');
        _prepareNextShotAtCurrentPosition();
        return;
    }

    // Fallback: just do a full reset
    resetSwingState();
}

/**
 * PRIVATE HELPER: Prepare for next shot at current ball position (Play Hole mode only)
 * Resets timing/UI, updates camera, aim, flagstick, and auto-selects putter if on green.
 * This is called when the ball stays where it landed (not holed out, not returning to tee).
 * NOTE: stopAllAnimations() is called by the caller (resetSwing)
 */
function _prepareNextShotAtCurrentPosition() {
    removeTrajectoryLine(); // Remove the visual trajectory line
    resetStaticCameraZoom(); // Reset the static camera zoom level

    resetSwingVariablesOnly(); // Calls the variable-only reset in state.js
    resetUIForNewShot(); // Reset timing bars and other relevant UI elements (includes setting status to 'Ready')

    // --- Update Camera Position, Aim, and Flag Visibility for PlayHole Mode ---
    const currentMode = getCurrentGameMode();
    if (currentMode === 'play-hole') {
        const ballPosData = getPlayHoleBallPosition(); // Get the new ball position (meters {x, y, z})
        const targetPos = getFlagPosition(); // Get the flag position (meters THREE.Vector3)
        const activeCamMode = getActiveCameraMode();
        const shotType = getCurrentShotType(); // Get current shot type ('full', 'chip', 'putt')

        // Ensure ballPos is a Vector3 for calculations
        const ballPos = ballPosData ? new THREE.Vector3(ballPosData.x, ballPosData.y, ballPosData.z) : null;

        // --- Toggle Flagstick Visibility AND Set Ball Scale ---
        const layout = getCurrentHoleLayout(); // Get layout
        let isOnGreen = false; // Default
        let isBunker = false;  // Default
        if (ballPos && layout) {
            // Pass only X and Z for surface check
            const surface = getSurfaceTypeAtPoint({ x: ballPos.x, z: ballPos.z }, layout);
            isBunker = (surface === 'BUNKER');
            isOnGreen = (surface === 'GREEN' && !isBunker); // Only on green if not also in a bunker for this logic

            setFlagstickVisibility(!isOnGreen); // Hide if on green (and not bunker), show otherwise
        } else {
            setFlagstickVisibility(true); // Default to visible if info missing
        }
        // Set ball scale based on whether it's on the green (and not a bunker for this specific scaling logic)
        setBallScale(!isOnGreen); // Use enlarged scale if NOT on green (or if in a bunker on the green)

        // Re-show the locator halo at the resting ball. The shot animation
        // hides it, and this path doesn't re-place the ball (it already
        // rests where it landed), so nothing else would bring it back.
        if (ballPos) {
            const surfaceHere = layout ? getSurfaceTypeAtPoint({ x: ballPos.x, z: ballPos.z }, layout) : null;
            const layerHeight = getSurfaceProperties(surfaceHere || 'FAIRWAY')?.height ?? 0;
            setBallHalo(true, ballPos.x, ballPos.z, (ballPos.y - BALL_RADIUS) + layerHeight);
        }

        // --- Auto-select Putter on Green, Clear Club Otherwise ---
        if (isOnGreen) {
            // Auto-select putter when on the green
            setSelectedClub('PT');
            setSelectedClubButton('PT');
        } else if (!isPracticeMode()) {
            // Clear club selection - player must choose club for each shot.
            // Practice keeps the current club so repeated chips flow.
            clearSelectedClub(); // Clear from game state
            clearClubSelection(); // Clear from UI
        }

        // --- Set Default Aim Angle ---
        let angleDeg = 0; // Initialize angleDeg
        if (ballPos && targetPos) {
            const dx = targetPos.x - ballPos.x;
            const dz = targetPos.z - ballPos.z;
            // Calculate angle relative to positive Z-axis (0 degrees)
            // atan2 gives angle in radians from -PI to PI
            const angleRad = Math.atan2(dx, dz);
            // Convert to degrees (0-360 or -180 to 180, doesn't matter as long as consistent)
            angleDeg = angleRad * (180 / Math.PI); // Assign calculated angle
            setShotDirectionAngle(angleDeg);
        } else {
            setShotDirectionAngle(0); // Default to 0 if positions are missing
            console.warn("Action: Could not get ball/target position for default aim. Setting angle to 0.");
        }

        // The aim angle set above will be automatically used by the camera setting functions

        if (ballPos && targetPos) { // Ensure we have positions before setting camera
            const distance = ballPos.distanceTo(targetPos);
            // Always switch to camera 1 (STATIC) for next shot
            setCameraBehindBallLookingAtTarget(ballPos, targetPos, distance, angleDeg);
        } else {
             console.warn("Action: Cannot update camera position for next shot, missing ball or target position.");
             // Optionally reset to a default view if positions are missing
             // CoreVisuals.resetCameraPosition(); // Example fallback
        }

        // At-address prompt for the next shot (re-read the type: auto putter
        // selection above may have just changed it)
        showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });

        // Aim chevron: refresh now that the default aim toward the flag is set
        // (the halo was placed before the aim angle was computed)
        updateAimIndicator();
    }
    // Does NOT call visuals.resetVisuals()
}
