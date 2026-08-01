// src/modes/playHole.js
import * as ui from '../ui.js';
import { savePlayHoleState } from '../gameLogic/persistentGameState.js';
import * as visuals from '../visuals.js'; // To trigger drawing
import { setShotType, getCurrentShotType, setSelectedClub, getSelectedClub, getGameState } from '../gameLogic/state.js'; // Import setShotType, getCurrentShotType, and setSelectedClub
import { showAddressHint } from '../ui/rhythmPuttHud.js';
import { BALL_RADIUS } from '../visuals/core.js'; // For calculations
import { playerManager } from '../playerManager.js'; // Import playerManager
import {
    generatePracticeGreenLayout, showPracticePanel, hidePracticePanel, getDefaultPreset, getActiveChipStyle
} from './practiceGreen.js'; // Short-game practice area
import { hasContour } from '../greenContours.js'; // For the slope-arrows hint
import { getSurfaceTypeAtPoint } from '../utils/gameUtils.js';
import { recordCompletedRound, getProfile } from '../career/careerStore.js';

// The name shown on the in-game scoreboard: the career profile name once the
// player has set one, otherwise the session identity (guest/registered).
function displayPlayerName() {
    const name = getProfile().name;
    return (name && name !== 'Player') ? name : playerManager.getDisplayName();
}
import { courseRating } from '../career/courseRating.js';
import * as GreenCard from '../career/greenCard.js';

// --- State ---
let currentHoleLayout = null;
let practiceMode = false; // True when running the chipping/putting practice green
let practiceType = 'putt'; // 'chip' | 'putt' — which placement tab opens first
let practicePlacement = null; // Last chosen placement preset {x, z, lie, ...}
let shotsTaken = 0; // Strokes for the current hole
let score = 0; // Total strokes for the round
let currentBallPosition = null;
let currentLie = 'TEE'; // Default lie
let formerBallPosition = null; // Previous ball position before last shot (for OOB handling)
let formerLie = null; // Previous lie before last shot (for OOB handling)
let holeJustCompleted = false; // Renamed from isHoledOut: true if hole was just finished, awaiting 'n'
let currentModeActive = false;
let currentHoleIndex = 0; // For now, always 0, representing the first/current hole

const HOLE_RADIUS_METERS = 0.108 / 2; // Regulation hole diameter is 4.25 inches (0.108m)

// --- Functions ---

export async function initializeMode(holeName) { // Made async, added holeName parameter
    console.log(`Initializing Play Hole mode for hole: ${holeName || 'default'}...`);
    currentModeActive = true;
    holeJustCompleted = false;

    // Check for preview mode (hole maker preview)
    const previewData = localStorage.getItem('previewHoleData');
    if (previewData && !holeName) {
        console.log('Preview mode detected, loading custom hole from hole maker...');
        try {
            localStorage.removeItem('previewHoleData');
            roundCourse = null; // Single-hole play, not a round
            const raw = JSON.parse(previewData);
            // Course holes carry their number so the HUD shows "Hole: 3",
            // not a generic 1, when a single hole is picked from a course
            await initializeHoleFromRawLayout(raw, { holeNumber: raw.holeNumber || 1 });
            console.log('Preview hole loaded and ready to play!');
            return;
        } catch (error) {
            console.error('Error loading preview hole:', error);
            alert('Failed to load preview hole: ' + error.message);
            localStorage.removeItem('previewHoleData');
            currentModeActive = false;
            return;
        }
    }

    // No preview data found
    console.error('No preview hole data found. Play Hole mode requires preview data from hole maker.');
    alert('No hole data found. Please create or preview a hole from the Hole Maker first.');
    currentModeActive = false;
}

/**
 * Loads and prepares one hole from a raw layout object (hole-maker format).
 * Used by the hole-maker preview path and by course rounds.
 */
export async function initializeHoleFromRawLayout(rawLayout, { holeNumber = 1, preserveScore = false } = {}) {
    currentModeActive = true;
    holeJustCompleted = false;

    // Outside a course round (single holes, previews) the turf plays the
    // long-standing neutral standard; rounds roll per-course conditions in
    // startCourseRound before this runs.
    if (!roundCourse) {
        const cond = await import('../courseConditions.js');
        cond.setNeutralConditions();
        ui.setConditionsDisplay(null);
    }

    const { processHoleLayout } = await import('../holeLoader.js');
    currentHoleLayout = processHoleLayout(rawLayout);
    if (!currentHoleLayout) throw new Error('Failed to process hole layout');

    let initialX = 0, initialZ = 0;
    if (currentHoleLayout.tee?.center) {
        initialX = currentHoleLayout.tee.center.x;
        initialZ = currentHoleLayout.tee.center.z;
    }

    shotsTaken = 0;
    if (!preserveScore) score = 0;
    currentLie = 'TEE';
    formerBallPosition = null;
    formerLie = null;
    currentHoleIndex = holeNumber - 1;

    // Per-hole defaults: center stance, no club. Power deliberately carries
    // over — the profile default seeds the session at boot, and after that
    // the slider is the player's session-wide choice (resetting it every
    // hole would fight "I'm playing at 75 today").
    const { setGameState, clearSelectedClub } = await import('../gameLogic/state.js');
    clearSelectedClub();
    ui.clearClubSelection();
    ui.setBallPosition(Math.floor(ui.getBallPositionLevels() / 2));

    // Draw hole first (builds terrain mesh + field), then place the ball
    visuals.drawHole(currentHoleLayout);
    const groundHeight = visuals.queryTerrainHeight(initialX, initialZ);
    currentBallPosition = { x: initialX, y: groundHeight + BALL_RADIUS, z: initialZ };
    visuals.resetVisuals(currentBallPosition, currentLie);

    setShotType('full');
    ui.setShotTypeRadio('full');
    setGameState('ready');

    const initialDistToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
    ui.updateVisualOverlayInfo('play-hole', {
        courseName: roundCourse?.name || currentHoleLayout?.courseName || '',
        holeName: currentHoleLayout?.name || '',
        holeNum: holeNumber,
        par: currentHoleLayout.par || 4,
        distToFlag: initialDistToFlag,
        elevDelta: elevationDeltaToFlag(currentBallPosition, currentHoleLayout.flagPosition),
        shotNum: 1,
        lie: currentLie,
        wind: 'Calm',
        playerName: displayPlayerName(),
        totalScore: roundCourse ? roundRelativeToPar() : score,
        position: '1st'
    });

    visuals.activateHoleViewCamera();
    showAddressHint('full', { hasClub: false });
}

// --- Course Rounds (sequential 18-hole play with a scorecard) ---

let roundCourse = null;     // The course container being played, or null
let roundHoleIndex = 0;     // 0-based index into roundCourse.holes
let roundScores = [];       // [{ hole, par, strokes }]

export function isRoundActive() {
    return !!roundCourse;
}

export function hasNextRoundHole() {
    return !!roundCourse && roundHoleIndex < roundCourse.holes.length - 1;
}

/** Running total relative to par over COMPLETED holes. */
function roundRelativeToPar() {
    return roundScores.reduce((s, h) => s + (h.strokes - h.par), 0);
}

export async function startCourseRound(course) {
    console.log(`Starting round: ${course.name} (${course.holes.length} holes)`);
    roundCourse = course;
    roundHoleIndex = 0;
    roundScores = [];
    score = 0;
    // Today's conditions for this course: stimp + firmness rolled within
    // bounds set by its difficulty stars (same course + same day = same roll)
    const { rollConditions, conditionsLabel } = await import('../courseConditions.js');
    const { difficultyStars } = await import('../courseLibrary.js');
    const stars = course.stars || difficultyStars(course);
    rollConditions(course.name || 'course', stars);
    ui.setConditionsDisplay(conditionsLabel());
    await initializeHoleFromRawLayout(course.holes[0], { holeNumber: 1, preserveScore: true });
}

export async function advanceToNextHole() {
    if (!hasNextRoundHole()) return;
    roundHoleIndex++;
    await initializeHoleFromRawLayout(roundCourse.holes[roundHoleIndex],
        { holeNumber: roundHoleIndex + 1, preserveScore: true });
}

/** Records the just-finished hole. Called from handleShotResult on hole-out. */
function recordRoundHole() {
    if (!roundCourse) return;
    roundScores.push({
        hole: roundHoleIndex + 1,
        par: currentHoleLayout?.par || 4,
        strokes: shotsTaken,
        lengthMeters: currentHoleLayout?.lengthMeters || 0,
    });
}

/** Ends the round and returns a summary { text, total, relative }. */
export function endRound() {
    const total = roundScores.reduce((s, h) => s + h.strokes, 0);
    const relative = roundRelativeToPar();
    const par = roundCourse?.par || roundScores.reduce((s, h) => s + h.par, 0);
    const name = roundCourse?.name || 'Course';
    const line = (from, to) => roundScores.slice(from, to).map(h => h.strokes).join(' ');
    let text = `${name}\n\n` +
        `Out:  ${line(0, 9)}\n` +
        (roundScores.length > 9 ? `In:   ${line(9, 18)}\n` : '') +
        `\nTotal: ${total} (${relative === 0 ? 'E' : relative > 0 ? '+' + relative : relative}) — par ${par}`;
    // Post the round to the career record. endRound only fires after the
    // final hole-out, so every round that reaches here is complete —
    // abandoned rounds never post (see doc/CAREER_MODE_DESIGN.md).
    if (roundCourse && roundScores.length === roundCourse.holes.length) {
        try {
            const posted = recordCompletedRound({
                courseName: name,
                ratingInfo: courseRating(roundCourse),
                holes: roundScores,
            });
            text += posted.prevIndex === null
                ? `\n\nFirst round posted — provisional handicap ${posted.index.toFixed(1)}`
                : `\n\nHandicap: ${posted.prevIndex.toFixed(1)} → ${posted.index.toFixed(1)}` +
                  ` (differential ${posted.differential.toFixed(1)})`;
            import('../career/careerSync.js').then(s => s.scheduleCareerSync()).catch(() => {});
        } catch (e) {
            console.error('Career: failed to post round.', e);
        }
    }
    roundCourse = null;
    roundHoleIndex = 0;
    return { text, total, relative };
}

export function terminateMode() {
    console.log("Terminating Play Hole mode.");
    // Consider saving state here if abrupt termination is possible
    // savePlayHoleState({ currentHoleIndex, ballPosition: currentBallPosition, strokesThisHole: shotsTaken, totalStrokesRound: score, currentLie });
    currentModeActive = false;
    currentHoleLayout = null;
    practiceMode = false;
    practicePlacement = null;
    roundCourse = null;
    roundScores = [];
    GreenCard.stopDrill();
    hidePracticePanel();
}

// --- Practice Green (chipping/putting practice) ---

export function isPracticeMode() {
    return practiceMode;
}

/**
 * Initializes the short-game practice area as a practice variant of
 * play-hole mode. All lie/camera/shot flow logic is shared with normal
 * hole play; scoring and persistence are disabled.
 * @param {string} type - 'chip' or 'putt': which placement tab opens first
 * @param {object} [options] - Green Card drills override the defaults:
 *   layout (raw layout instead of the practice green), placement (initial
 *   ball spot preset), hidePanel (suppress the placement panel).
 */
export async function initializePracticeMode(type = 'putt', options = {}) {
    console.log(`Initializing practice green (${type})...`);
    currentModeActive = true;
    practiceMode = true;
    practiceType = type === 'chip' ? 'chip' : 'putt';
    holeJustCompleted = false;

    // Practice and drills always play the neutral standard turf — the
    // tutorial must teach one consistent ball behavior
    const cond = await import('../courseConditions.js');
    cond.setNeutralConditions();
    ui.setConditionsDisplay(null);

    // Green Card drill: activate NOW — the previous mode's exit (which stops
    // any drill) has already run, and the placement below must see the
    // active drill (hint visibility, attempt recording).
    if (options.drillId) GreenCard.startDrill(options.drillId);

    const { processHoleLayout } = await import('../holeLoader.js');
    currentHoleLayout = processHoleLayout(options.layout || generatePracticeGreenLayout());
    if (!currentHoleLayout) {
        console.error('Practice green layout failed to process.');
        currentModeActive = false;
        practiceMode = false;
        return;
    }

    shotsTaken = 0;
    score = 0;
    formerBallPosition = null;
    formerLie = null;
    currentHoleIndex = 0;

    // Draw the area first (builds the terrain mesh for height lookups)
    visuals.drawHole(currentHoleLayout);

    // Drop the ball at the default spot for this practice type
    await applyPracticePlacement(options.placement || getDefaultPreset(practiceType), true);

    if (options.hidePanel) {
        // Drills control placement themselves
        hidePracticePanel();
    } else {
        // Placement panel stays available so the player can move the ball anytime
        showPracticePanel(
            practiceType,
            (preset) => { applyPracticePlacement(preset); },
            (style) => { applyPracticeChipStyle(style); }
        );
    }
}

/**
 * Applies a chip shot style (club + stance recipe) from the practice panel.
 */
export function applyPracticeChipStyle(style) {
    if (!practiceMode || !style) return;
    const state = getGameState();
    if (state !== 'ready' && state !== 'result') return;

    setSelectedClub(style.club);
    ui.setSelectedClubButton(style.club);
    ui.setBallPosition(style.ballPositionIndex);
    setShotType('chip');
    ui.updateStatus(`${style.label}: ${style.club}, ${style.ballPositionIndex <= 3 ? 'ball back' : style.ballPositionIndex >= 6 ? 'ball forward' : 'ball center'} — Ready`);
}

/**
 * Places the ball at a practice preset spot and prepares the next shot
 * (visuals, camera, aim, club/shot type).
 */
export async function applyPracticePlacement(preset, force = false) {
    if (!practiceMode || !preset) return;

    // Don't teleport the ball mid-swing or mid-animation
    const state = getGameState();
    if (!force && state !== 'ready' && state !== 'result') {
        console.log(`Practice placement ignored during state '${state}'`);
        return;
    }

    const groundHeight = visuals.queryTerrainHeight(preset.x, preset.z);
    currentBallPosition = { x: preset.x, y: groundHeight + BALL_RADIUS, z: preset.z };
    // Preset lies are hand-authored guesses; the ground the ball visibly
    // sits on wins (a random pitching spot can land on the rough surround).
    // TEE presets keep their lie — the tee mat isn't a layout polygon.
    const detected = getSurfaceTypeAtPoint({ x: preset.x, z: preset.z }, currentHoleLayout);
    currentLie = (preset.lie !== 'TEE' && detected && detected !== 'OUT_OF_BOUNDS' && detected !== 'WATER')
        ? detected : preset.lie;
    // Keep the corrected lie in the stored placement — resetSwing's
    // return-to-spot path re-reads it (prepareForTeeShotAfterHoleOut).
    practicePlacement = { ...preset, lie: currentLie };
    formerBallPosition = null;
    formerLie = null;
    shotsTaken = 0;
    holeJustCompleted = false;

    // Move the ball visually, then run the standard next-shot preparation
    // (camera behind ball, aim at flag, auto club selection).
    visuals.resetVisuals(currentBallPosition, currentLie);
    // Flag out when the ball is placed ON the green (matching the post-shot
    // flow) — with the stick pulled the cup halo marks the hole.
    const { setFlagstickVisibility } = await import('../visuals/holeView.js');
    setFlagstickVisibility(currentLie !== 'GREEN');
    const logic = await import('../gameLogic.js');
    logic.resetSwing();

    // Practice presets can override the auto-selected club/shot type.
    // An explicit preset club always wins (drills pin it: driver off the
    // tee, sand wedge from the bunker, gap wedge for pitches); otherwise
    // chips use the currently active shot style (club + stance recipe).
    if (preset.club) {
        setSelectedClub(preset.club);
        ui.setSelectedClubButton(preset.club);
        if (preset.shotType) setShotType(preset.shotType);
    } else if (preset.shotType === 'chip') {
        const style = getActiveChipStyle();
        setSelectedClub(style.club);
        ui.setSelectedClubButton(style.club);
        ui.setBallPosition(style.ballPositionIndex);
        setShotType('chip');
    }
    // Putt presets: green placement auto-selects the putter already.

    const distToFlag = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
    ui.updateVisualOverlayInfo('play-hole', {
        holeNum: 'P',
        par: currentHoleLayout.par || 3,
        distToFlag: distToFlag,
        elevDelta: elevationDeltaToFlag(currentBallPosition, currentHoleLayout.flagPosition),
        shotNum: 1,
        lie: currentLie,
        wind: 'Calm',
        playerName: displayPlayerName(),
        totalScore: 0,
        position: '–'
    });
    ui.updateStatus(hasContour()
        ? `${preset.label} — Ready · press g to read the slopes`
        : `${preset.label} — Ready`);

    // Assert the at-address prompt after mode-entry churn (fullscreen toggle,
    // control rebuilds) settles — the last writer wins on the shared pill.
    // During a drill the hint IS the tutorial: assert it even if the state
    // machine hasn't settled to 'ready' yet (mode-entry under load).
    setTimeout(() => {
        if (getGameState() === 'ready' || GreenCard.getActiveDrill()) {
            showAddressHint(getCurrentShotType(), { hasClub: !!getSelectedClub() });
        }
    }, 600);
}

export function handleShotResult(shotData) {
    if (!currentModeActive || holeJustCompleted) { // Don't process if hole was just finished and awaiting 'n'
        // If holeJustCompleted is true, it means we already processed the hole-out,
        // and are waiting for the player to press 'n' to start the next shot from the tee.
        // The actual reset to tee happens in prepareForTeeShotAfterHoleOut, called by resetSwing.
        console.log("PlayHole: Shot result received, but hole was just completed. Awaiting 'n'.");
        return;
    }

    // Store previous position and lie before updating (for OOB handling)
    formerBallPosition = currentBallPosition ? { ...currentBallPosition } : null;
    formerLie = currentLie;

    shotsTaken++;
    score++; // Increment total round score for each shot taken
    console.log(`PlayHole: Handling shot ${shotsTaken} (Total round: ${score}) result:`, shotData);

    if (shotData.finalPosition) {
        currentBallPosition = { ...shotData.finalPosition }; // Ensure clean copy
        // Don't clamp Y position - simulation already accounts for ballLieOffset
        console.log(`New ball position (meters): x=${currentBallPosition.x.toFixed(2)}, y=${currentBallPosition.y.toFixed(2)}, z=${currentBallPosition.z.toFixed(2)}`);
    } else {
        console.error("PlayHole Error: Shot data did not contain finalPosition!");
        return;
    }

    // Don't update lie immediately - wait for animation to complete to avoid spoilers!
    const finalLie = shotData.surfaceName || 'unknown';

    // Outcome text is computed NOW (state must update immediately) but only
    // DISPLAYED once the ball has visually stopped — announcing "Fairway
    // hit 2/5" or "Birdie!" while the ball is mid-air spoils the shot.
    let outcomeStatus = null;

    if (shotData.isHoledOut) {
        holeJustCompleted = true; // Set flag that hole is done, awaiting 'n'
        console.log(`HOLE OUT! Strokes this hole: ${shotsTaken}. Total round score: ${score}`);
        if (practiceMode) {
            outcomeStatus = `Holed it! 🎉 Press (n) to replay this spot, or pick a new one.`;
        } else if (roundCourse) {
            recordRoundHole();
            const par = currentHoleLayout?.par || 4;
            const diff = shotsTaken - par;
            const scoreName = diff <= -2 ? 'Eagle!' : diff === -1 ? 'Birdie!' : diff === 0 ? 'Par.' :
                              diff === 1 ? 'Bogey.' : `+${diff}.`;
            const rel = roundRelativeToPar();
            const relText = rel === 0 ? 'E' : rel > 0 ? '+' + rel : rel;
            outcomeStatus = hasNextRoundHole()
                ? `${scoreName} ${shotsTaken} on hole ${roundHoleIndex + 1} (${relText} thru ${roundHoleIndex + 1}). Press (n) for hole ${roundHoleIndex + 2}.`
                : `${scoreName} Round complete: ${score} (${relText}). Press (n) for the scorecard.`;
        } else {
            outcomeStatus = `Hole ${currentHoleIndex + 1} complete! Score: ${shotsTaken}. Press (n) to play again.`;
        }
        // Ball position remains at the hole for now. It will be reset to tee in prepareForTeeShotAfterHoleOut.
        // shotsTaken for this completed hole is now fixed.
    } else {
        console.log("Ball is not holed out. Ready for next shot.");
    }

    // Green Card drill: every shot is one attempt, scored by where it
    // finishes. The drill sets the next placement, so pressing (n) drops
    // the next ball automatically.
    if (practiceMode && GreenCard.getActiveDrill()) {
        const endDist = calculateDistanceToFlag(currentBallPosition, currentHoleLayout.flagPosition);
        const attempt = GreenCard.recordShot({
            lie: finalLie,
            holed: !!shotData.isHoledOut,
            distToFlag: endDist,
            shotDistance: formerBallPosition
                ? Math.hypot(currentBallPosition.x - formerBallPosition.x,
                             currentBallPosition.z - formerBallPosition.z)
                : 0,
        });
        if (attempt) {
            holeJustCompleted = true; // attempt over — (n) places the next ball
            if (attempt.nextSpot) practicePlacement = { ...attempt.nextSpot };
            outcomeStatus = attempt.statusText; // shown when the ball stops
        }
    }

    // Save the updated state (ball at its current location, or at hole if just holed out)
    // Practice sessions are throwaway — never persisted.
    if (!practiceMode) savePlayHoleState({
        currentHoleIndex: currentHoleIndex,
        ballPosition: currentBallPosition, // This is where the ball physically is
        strokesThisHole: shotsTaken, // Strokes for the current attempt (or completed hole)
        totalStrokesRound: score,
        currentLie: currentLie,
        formerPosition: formerBallPosition, // Previous position before this shot
        formerLie: formerLie, // Previous lie before this shot
        holeLayoutData: currentHoleLayout,
        holeJustCompletedState: holeJustCompleted // Save this new flag
    });

    // Hide distance/lie during animation to avoid spoilers
    ui.updateVisualOverlayInfo('play-hole', {
        courseName: roundCourse?.name || currentHoleLayout?.courseName || '',
        holeName: currentHoleLayout?.name || '',
        holeNum: currentHoleIndex + 1,
        par: currentHoleLayout.par,
        distToFlag: '...', // Hide during animation
        shotNum: shotsTaken,
        lie: '...', // Hide during animation
        wind: 'Calm', // placeholder
        playerName: displayPlayerName(),
        totalScore: score,
        position: '1st' // placeholder
    });

    // Update lie and UI after animation completes
    // Note: Animation callbacks are handled in visuals.js
    // We'll use a timeout based on animation duration as a fallback
    // The outcome text is revealed by the animation-complete callback in
    // visuals.js — never mid-flight, never overwritten at landing
    if (outcomeStatus) ui.setPendingOutcomeStatus(outcomeStatus);

    const animationDuration = (shotData.timeOfFlight || 3) * 1000; // Convert seconds to ms
    setTimeout(() => {
        console.log(`PlayHole: Updating lie after animation. finalLie from shotData: "${finalLie}"`);
        currentLie = finalLie; // Update lie after animation
        console.log(`PlayHole: currentLie is now: "${currentLie}"`);


        const displayBallPos = getCurrentBallPosition();
        const displayLie = getCurrentLie();
        const displayShotNum = getDisplayShotNumber();
        const distToFlag = calculateDistanceToFlag(displayBallPos, currentHoleLayout.flagPosition);

        ui.updateVisualOverlayInfo('play-hole', {
            courseName: roundCourse?.name || currentHoleLayout?.courseName || '',
        holeName: currentHoleLayout?.name || '',
        holeNum: currentHoleIndex + 1,
            par: currentHoleLayout.par,
            distToFlag: distToFlag,
            elevDelta: elevationDeltaToFlag(displayBallPos, currentHoleLayout.flagPosition),
            shotNum: displayShotNum,
            lie: displayLie,
            wind: 'Calm',
            playerName: displayPlayerName(),
            totalScore: score,
            position: '1st'
        });

        // Check for tap-in distance (1 foot = 0.3048 meters) — not in practice,
        // where holing everything out is the whole point.
        const TAP_IN_DISTANCE_METERS = 0.3048;
        if (!practiceMode && currentLie === 'GREEN' && distToFlag <= TAP_IN_DISTANCE_METERS && distToFlag > 0) {
            // Ball is within tap-in range - offer gimme
            import('../ui/gameAlert.js').then(module => {
                module.gameAlert.show(
                    `Tap-in putt! (${(distToFlag * 3.28084).toFixed(1)}" from hole)\n\nWould you like to hole out?`,
                    'Hole Out'
                ).then(() => {
                    // User accepted - hole it out
                    shotsTaken++;
                    score++;
                    holeJustCompleted = true;
                    console.log(`TAP-IN! Strokes this hole: ${shotsTaken}. Total round score: ${score}`);
                    ui.updateStatus(`Hole ${currentHoleIndex + 1} complete! Score: ${shotsTaken}. Press (n) to play again.`);
                });
            });
        }
    }, animationDuration + 200); // Add 200ms buffer
}


export function prepareForTeeShotAfterHoleOut() {
    if (!currentModeActive) return;

    // Practice: 'return to tee' means 'return to the chosen practice spot'
    if (practiceMode && practicePlacement) {
        shotsTaken = 0;
        currentLie = practicePlacement.lie;
        const groundHeight = visuals.queryTerrainHeight(practicePlacement.x, practicePlacement.z);
        currentBallPosition = { x: practicePlacement.x, y: groundHeight + BALL_RADIUS, z: practicePlacement.z };
        formerBallPosition = null;
        formerLie = null;
        holeJustCompleted = false;
        console.log('Practice: ball returned to placement spot.', currentBallPosition);
        return;
    }

    console.log("PlayHole: Preparing for tee shot after hole out.");
    shotsTaken = 0;
    currentLie = 'TEE';
    formerBallPosition = null; // Reset when starting from tee
    formerLie = null; // Reset when starting from tee
    let initialX = 0;
    let initialZ = 0;
    if (currentHoleLayout?.tee?.center) {
        initialX = currentHoleLayout.tee.center.x;
        initialZ = currentHoleLayout.tee.center.z;
    }
    currentBallPosition = { x: initialX, y: BALL_RADIUS, z: initialZ };
    holeJustCompleted = false; // Reset the flag, we are now starting the new attempt

    savePlayHoleState({
        currentHoleIndex: currentHoleIndex,
        ballPosition: currentBallPosition,
        strokesThisHole: shotsTaken,
        totalStrokesRound: score, // Total score persists
        currentLie: currentLie,
        formerPosition: null, // Reset when starting from tee
        formerLie: null, // Reset when starting from tee
        holeLayoutData: currentHoleLayout,
        holeJustCompletedState: holeJustCompleted
    });
    console.log("PlayHole: State reset to tee. Ball at:", currentBallPosition, "Shots:", shotsTaken);
    // Visuals and UI update for this new state will be handled by the resetSwing flow in main.js/ui.js
}

// Helper function to calculate distance to flag
function calculateDistanceToFlag(ballPos, flagPos) {
    if (!ballPos || !flagPos) return 0;
    // Calculate horizontal distance (x, z plane)
    const dx = flagPos.x - ballPos.x;
    const dz = flagPos.z - ballPos.z;
    return Math.sqrt(dx * dx + dz * dz);
}

// Elevation difference (m) from the ball's lie up/down to the hole
function elevationDeltaToFlag(ballPos, flagPos) {
    if (!ballPos || !flagPos) return null;
    return visuals.queryTerrainHeight(flagPos.x, flagPos.z) -
           visuals.queryTerrainHeight(ballPos.x, ballPos.z);
}

// --- Getters (optional) ---
export function getCurrentHoleLayout() {
    return currentHoleLayout;
}

export function getCurrentScore() {
    return score;
}

export function getHoleJustCompleted() { // Renamed getter
    return holeJustCompleted;
}

export function getCurrentBallPosition() {
    if (holeJustCompleted) {
        // Practice: the "next" shot replays from the chosen practice spot
        if (practiceMode && practicePlacement) {
            const groundHeight = visuals.queryTerrainHeight(practicePlacement.x, practicePlacement.z);
            return { x: practicePlacement.x, y: groundHeight + BALL_RADIUS, z: practicePlacement.z };
        }
        if (currentHoleLayout?.tee?.center) {
            // If hole was just completed, the "next" shot is from the tee.
            // The tee sits at its real elevation on DEM courses — a bare
            // BALL_RADIUS here means "sea level", which is metres off the
            // ground on any imported course.
            const teeX = currentHoleLayout.tee.center.x;
            const teeZ = currentHoleLayout.tee.center.z;
            return {
                x: teeX,
                y: visuals.queryTerrainHeight(teeX, teeZ) + BALL_RADIUS,
                z: teeZ
            };
        }
    }
    // Otherwise, return the actual current ball position
    return { ...currentBallPosition };
}

export function getCurrentLie() {
    if (holeJustCompleted) {
        return (practiceMode && practicePlacement) ? practicePlacement.lie : 'TEE';
    }
    return currentLie;
}

export function getDisplayShotNumber() {
    if (holeJustCompleted) {
        return 1; // Next shot will be the 1st from the tee
    }
    return shotsTaken + 1;
}

export function getFormerBallPosition() {
    return formerBallPosition ? { ...formerBallPosition } : null;
}

export function getFormerLie() {
    return formerLie;
}

// Move ball back to former position (for OOB handling)
export function moveToFormerPosition() {
    if (!currentModeActive) return;

    if (formerBallPosition) {
        currentBallPosition = { ...formerBallPosition };
        currentLie = formerLie || 'TEE';

        // Add penalty stroke for OOB
        shotsTaken++; // Penalty stroke
        score++;

        console.log(`PlayHole: Ball moved to former position (OOB penalty). Position:`, currentBallPosition, `Lie: ${currentLie}`);

        // Save updated state (not persisted for practice sessions)
        if (!practiceMode) savePlayHoleState({
            currentHoleIndex: currentHoleIndex,
            ballPosition: currentBallPosition,
            strokesThisHole: shotsTaken,
            totalStrokesRound: score,
            currentLie: currentLie,
            formerPosition: formerBallPosition, // Keep the same former position
            formerLie: formerLie,
            holeLayoutData: currentHoleLayout,
            holeJustCompletedState: holeJustCompleted
        });
    } else {
        console.warn('PlayHole: No former position available for OOB handling');
    }
}

// Rename prepareForTeeShotAfterHoleOut to returnToTee for clarity
export function returnToTee() {
    prepareForTeeShotAfterHoleOut();
}
