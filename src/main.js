import * as ui from './ui.js';
// Import specific functions, including updateEnvironmentDisplay
import { showMainMenu, showGameView, addBackToMenuClickListener, updateEnvironmentDisplay } from './ui.js';
import * as logic from './gameLogic.js'; // Game state and actions
import * as visuals from './visuals.js';
import * as inputHandler from './inputHandler.js'; // Import the new input handler
import * as environment from './gameLogic/environment.js'; // Import environment simulation
import * as closestToFlag from './modes/closestToFlag.js'; // Import the CTF mode logic
import * as playHole from './modes/playHole.js'; // Import the Play Hole mode logic
import { getRandomInRange } from './utils/gameUtils.js'; // Import getRandomInRange
import { initMultiplayerUI } from './multiplayerTest.js'; // Import multiplayer test
import { playerManager } from './playerManager.js'; // Import player manager
import * as nanoAuth from './nanoAuth.js'; // Import Nano authentication
import * as multiplayerManager from './multiplayerManager.js'; // Import multiplayer manager
import { initSwingArcVisualizer } from './swingArcVisualizer.js'; // Import swing arc visualizer
import * as playHoleModal from './playHoleModal.js'; // Import play hole modal
import { showCourseSelect } from './courseSelectModal.js'; // Course round picker
import { showCareer } from './careerModal.js'; // Career overview (handicap, rounds, stats)
import { showGreenCard } from './greenCardModal.js'; // Green Card drill checklist
import { startDrill, drillLaunchConfig, isCardEarned } from './career/greenCard.js';
import { getProfile } from './career/careerStore.js';

// The START HERE tag points brand-new players at the Green Card; it retires
// once the card is earned
try {
    const tag = document.getElementById('greencard-start-tag');
    if (tag && isCardEarned()) tag.style.display = 'none';
} catch (e) { /* menu decoration only */ }
import { initTouchControls } from './touchControls.js'; // On-screen swing zones for touch devices
import { getGameState } from './gameLogic/state.js';
import { isViewActive as measurementViewActive } from './visuals/measurementView.js';
import { aimAtScreenPoint } from './aimAtPoint.js'; // Double-click / double-tap point-to-aim

// --- Game Modes ---
export const GAME_MODES = {
    RANGE: 'range',
    CLOSEST_TO_FLAG: 'closest-to-flag',
    PLAY_HOLE: 'play-hole',
};
let currentMode = GAME_MODES.RANGE; // Default mode

// Function to generate a new CTF hole layout
function generateNewCTFHole() {
    if (currentMode !== GAME_MODES.CLOSEST_TO_FLAG) {
        console.warn("Cannot generate new CTF hole when not in CTF mode.");
        return;
    }


    // Clear the current hole config so a new one will be generated
    visuals.clearTargetViewConfig();

    // Terminate and reinitialize CTF mode (this will generate a new hole config)
    closestToFlag.terminateMode();
    const actualTargetDistance = closestToFlag.initializeMode();

    // Reset game state
    logic.resetSwing();

    // Regenerate visuals with new hole (will create new config since we cleared it)
    visuals.switchToTargetView(actualTargetDistance);
    visuals.showBallAtAddress();

    ui.updateStatus('Ready');
}


// Function to change the game mode
// practiceType: 'chip' | 'putt' — starts play-hole mode as the short-game practice green
export async function setGameMode(newMode, initialHoleName = null, targetDistance = null, practiceType = null, courseRound = null) { // Made async, added initialHoleName and targetDistance
    if (!Object.values(GAME_MODES).includes(newMode)) {
        console.error(`Attempted to switch to invalid game mode: ${newMode}`);
        return;
    }


    // Terminate previous mode if necessary
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        closestToFlag.terminateMode();
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        playHole.terminateMode();
    }

    // Set new mode
    currentMode = newMode;
    ui.setGameModeClass(currentMode); // Update UI (body class, etc.)
    ui.createClubButtons(currentMode); // Recreate club buttons for new mode (all clubs in range, bag clubs otherwise)

    // Initialize visuals system if it hasn't been already
    if (!visualsSystemInitialized && canvas) {
        visualsSystemInitialized = visuals.initVisuals(canvas);
        if (visualsSystemInitialized) {
            environment.startWindSimulation(); // Start wind updates once visuals are ready
        } else {
            console.error("Visuals system failed to initialize. Game may not display correctly.");
            // Optionally, inform the user via an on-page message
            return; // Stop further mode setup if visuals failed
        }
    } else if (!canvas) {
        console.error("Canvas element not found, cannot initialize visuals for mode.");
        return; // Stop if canvas is missing
    }


    // Initialize new mode, switch visuals, and reset overlay
    if (currentMode === GAME_MODES.RANGE) {
        visuals.switchToRangeView();
        ui.updateVisualOverlayInfo('range', { lie: 'Tee' /* wind is live */ });
        logic.resetSwing(); // Reset swing state for Range mode
        visuals.showBallAtAddress(); // Ensure ball is shown
    } else if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        const actualTargetDistance = closestToFlag.initializeMode(targetDistance);
        visuals.switchToTargetView(actualTargetDistance);
        logic.resetSwing(); // Reset swing state for CTF mode (sets gameState to 'ready')
        visuals.showBallAtAddress(); // Ensure ball is shown
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        if (courseRound) {
            // Full round on a bundled course (sequential holes + scorecard)
            await playHole.startCourseRound(courseRound);
        } else if (practiceType) {
            // Short-game practice green (chipping/putting practice).
            // Green Card drills pass an object: { type, layout, placement, hidePanel }.
            if (typeof practiceType === 'object') {
                await playHole.initializePracticeMode(practiceType.type, practiceType);
            } else {
                await playHole.initializePracticeMode(practiceType);
            }
        } else {
            // If initialHoleName is provided (e.g. from switchGameToHole calling setGameMode), use it.
            // Otherwise, playHole.initializeMode will use its default or load saved state.
            await playHole.initializeMode(initialHoleName);
            // visuals.switchToHoleView() is called by playHole.initializeMode via visuals.activateHoleViewCamera()
            // Ball position is handled by playHole.initializeMode.
        }
    }
    

    // Update switch hole button text based on mode and multiplayer status
    const isMultiplayer = multiplayerManager.getCurrentSessionId() !== null;
    ui.updateSwitchHoleButton(currentMode, isMultiplayer);
}

// Make functions globally accessible for UI
window.generateNewCTFHole = generateNewCTFHole;
window.getCurrentGameMode = getCurrentGameMode;

// Function to get the current game mode (needed by inputHandler)
export function getCurrentGameMode() {
    return currentMode;
}

// --- Initial Setup ---

// Initialize player manager first (auto-creates guest if needed)
await playerManager.init();

// Registered players: reconcile the local career record with the server
// (no-op for guests, silent when offline)
import('./career/careerSync.js').then(s => s.scheduleCareerSync()).catch(() => {});

// Update UI with player info
ui.updatePlayerDisplay(playerManager.getDisplayName(), playerManager.currentPlayer.playerType);

// Create the club buttons first
ui.createClubButtons();

// Initial power comes from the player's profile (new players: 65%); the
// slider element still carries a static 90 in the HTML, so seed it here.
const fsPowerSlider = document.getElementById('fs-power-slider');
const initialSwingSpeed = getProfile().defaultPower || 90;
if (fsPowerSlider) fsPowerSlider.value = initialSwingSpeed;
logic.setSwingSpeed(initialSwingSpeed);

// The default club is set by createClubButtons, which also triggers the onClubChangeCallback
// if a callback is registered. We'll register the callback *after* this initial setup
// to avoid double-setting or issues if logic isn't fully ready.
// For now, we can assume a default club is selected in UI and logic will pick it up
// or we can explicitly get it if needed, but createClubButtons should handle the initial selection.

// const initialClubKey = ???; // This will be set by the default button click in createClubButtons
// logic.setSelectedClub(initialClubKey); // This will be handled by the club change listener

const initialShotType = ui.getShotType(); // Get initial shot type from UI
logic.setShotType(initialShotType); // Set initial shot type in logic

// Set other initial UI display values based on logic state
ui.setInitialSwingSpeedDisplay(initialSwingSpeed);
ui.setupBackswingBar(); // Setup backswing marker
ui.setupTimingBarWindows(initialSwingSpeed / 100); // Setup downswing windows based on initial speed

// Initialize swing arc visualizer
const swingArcInitialized = initSwingArcVisualizer();
if (swingArcInitialized) {
} else {
    console.warn("Swing arc visualizer failed to initialize.");
}

// Initialize game logic (which also calls ui.resetUI and sets initial wind/temp state)
logic.initializeGameLogic();
// Generate random base wind parameters
const initialBaseSpeed = getRandomInRange(0, 10); // Random base speed 0-10 m/s
const initialBaseDirection = getRandomInRange(0, 360); // Random base direction 0-360 degrees
// Set initial wind simulation parameters using the random base values
// Variances and interval remain the same for now, but could also be randomized or configured
environment.setWindParameters(initialBaseSpeed, initialBaseDirection, 3, 20, 2500); 
// Manually update the environment display once after setting parameters to ensure correct initial display
updateEnvironmentDisplay(); 
// Register the shot completion handler
logic.registerShotCompletionCallback(handleShotCompletion);

// Set initial UI state for the default mode (will be overridden by showMainMenu initially)
ui.setGameModeClass(currentMode);
const isMultiplayer = multiplayerManager.getCurrentSessionId() !== null;
ui.updateSwitchHoleButton(currentMode, isMultiplayer); // Set initial button text 

// Canvas and Visuals Initialization (deferred)
const canvas = document.getElementById('golf-canvas');
let visualsSystemInitialized = false; // Flag to ensure visuals are initialized only once

if (!canvas) {
    console.error("Golf canvas element not found! Game cannot start.");
    // Optionally display a more user-friendly error on the page
}

// --- Connect UI Event Listeners to Logic ---

ui.addSwingSpeedInputListener((percentage) => {
    logic.setSwingSpeed(percentage);
});

ui.addResetGameDataListener(); // Added listener for the new reset button

ui.addClubChangeListener(async (clubKey) => {
    logic.setSelectedClub(clubKey);

    // Update tee and ball position if on tee box (showBallAtAddress checks if on TEE surface)
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        visuals.showBallAtAddress(); // Refresh ball/tee for new club (CTF always at default position)
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        // In Play Hole, get current ball position and lie
        const playHole = await import('./modes/playHole.js');
        const ballPos = playHole.getCurrentBallPosition();
        const lie = playHole.getCurrentLie();
        visuals.showBallAtAddress(ballPos, lie); // Refresh with current position
    }
});

ui.addShotTypeChangeListener((shotType) => {
    logic.setShotType(shotType);

    // If in Play Hole mode and using camera 1 (hole view), refresh camera
    // The camera is distance-based so shot type change doesn't need to trigger update
    // The distance-based ranges will handle the appropriate camera position
});

ui.addNextShotClickListener(() => {
    logic.resetSwing(); // Logic reset now calls visuals.resetVisuals()
});

// --- Connect Mode Selection Buttons ---
// Helper function to check if player is in active multiplayer before starting single-player
async function checkMultiplayerBeforeSinglePlayer() {
    const { checkForActiveGame, handleLeaveActiveGameFromMenu } = await import('./multiplayerManager.js');
    const { modal } = await import('./ui/modal.js');
    const { toast } = await import('./ui/toast.js');

    const activeCheck = await checkForActiveGame();

    if (activeCheck.hasActiveGame) {
        const gameState = activeCheck.session.gameState === 'waiting' ? 'lobby' : 'game';
        const wagerInfo = activeCheck.session.isWageringGame
            ? `\n\nThis is a wagering game. ${gameState === 'lobby' ? 'You will be refunded your wager.' : 'You will lose your wager of ' + activeCheck.session.wagerAmount + ' NANO.'}`
            : '';

        const confirmed = await modal.confirm(
            `You are currently in an active multiplayer ${gameState} (Room: ${activeCheck.session.roomCode}).${wagerInfo}\n\nLeave the multiplayer game to play single-player?`,
            'Leave Multiplayer Game?',
            'warning'
        );

        if (confirmed) {
            const success = await handleLeaveActiveGameFromMenu();
            if (success) {
                toast.success('Left multiplayer game');
                return true; // Proceed with single-player
            } else {
                return false; // Failed to leave, don't start single-player
            }
        } else {
            return false; // User cancelled, don't start single-player
        }
    }

    return true; // No active game, proceed with single-player
}

// Practice button toggles the practice submenu (Range / Chipping / Putting)
document.getElementById('mode-btn-practice')?.addEventListener('click', (e) => {
    const submenu = document.getElementById('practice-submenu');
    if (submenu) {
        const open = submenu.style.display === 'none';
        submenu.style.display = open ? 'flex' : 'none';
        e.currentTarget.classList.toggle('expanded', open);
        // Belt and braces: if the row still lands off-screen, bring it in
        if (open) submenu.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
});

document.getElementById('mode-btn-range')?.addEventListener('click', async () => {
    const canProceed = await checkMultiplayerBeforeSinglePlayer();
    if (canProceed) {
        ui.showGameView();
        setGameMode(GAME_MODES.RANGE);
    }
});

document.getElementById('mode-btn-chipping')?.addEventListener('click', async () => {
    const canProceed = await checkMultiplayerBeforeSinglePlayer();
    if (canProceed) {
        ui.showGameView();
        setGameMode(GAME_MODES.PLAY_HOLE, null, null, 'chip');
    }
});

document.getElementById('mode-btn-putting')?.addEventListener('click', async () => {
    const canProceed = await checkMultiplayerBeforeSinglePlayer();
    if (canProceed) {
        ui.showGameView();
        setGameMode(GAME_MODES.PLAY_HOLE, null, null, 'putt');
    }
});

document.getElementById('mode-btn-closest')?.addEventListener('click', async () => {
    const canProceed = await checkMultiplayerBeforeSinglePlayer();
    if (canProceed) {
        // Clear any existing hole config from multiplayer to generate a fresh random hole
        visuals.clearTargetViewConfig();
        ui.showGameView();
        setGameMode(GAME_MODES.CLOSEST_TO_FLAG);
    }
});

function openHoleModal() {
    playHoleModal.showModal(
        (holeData) => {
            // Single hole selected
            ui.showGameView();
            setGameMode(GAME_MODES.PLAY_HOLE);
        },
        (course) => {
            // Full round selected
            ui.showGameView();
            setGameMode(GAME_MODES.PLAY_HOLE, null, null, null, course);
        }
    );
}

document.getElementById('mode-btn-hole')?.addEventListener('click', async () => {
    const canProceed = await checkMultiplayerBeforeSinglePlayer();
    if (canProceed) openHoleModal();
});

document.getElementById('mode-btn-career')?.addEventListener('click', () => {
    showCareer(); // Read-only overview — no mode change, no multiplayer check needed
});

document.getElementById('mode-btn-greencard')?.addEventListener('click', async () => {
    const canProceed = await checkMultiplayerBeforeSinglePlayer();
    if (!canProceed) return;
    showGreenCard(async (drillId) => {
        const cfg = drillLaunchConfig(drillId);
        ui.showGameView();
        // startDrill must come AFTER the mode switch: setGameMode exits any
        // current play-hole session, and playHole.exitMode() stops the
        // active drill — starting first meant entering a drill from inside
        // another play-hole session silently killed it (no attempt
        // recording, no return to the tee).
        await setGameMode(GAME_MODES.PLAY_HOLE, null, null, cfg);
        startDrill(drillId);
        // Full-swing drills open with a ghost demo of the ideal rhythm.
        // Touch: it waits for the ADDRESS phase (the zones must be on
        // screen); desktop plays right away on a key-pill row.
        if (drillId === 'driving' || drillId === 'approach') {
            const demo = await import('./swingDemo.js');
            demo.armSwingDemo();
            if (!document.body.classList.contains('touch-active')) {
                demo.maybePlayArmedDemo(900);
            }
        }
    });
});

document.getElementById('mode-btn-course')?.addEventListener('click', async () => {
    const canProceed = await checkMultiplayerBeforeSinglePlayer();
    if (canProceed) {
        showCourseSelect(async (course) => {
            ui.showGameView();
            await setGameMode(GAME_MODES.PLAY_HOLE, null, null, null, course);
        });
    }
});

// --- Connect "Back to Menu" Button ---
function handleBackToMenu() {

    // Clear the hole configuration to prevent stale data from persisting
    // This ensures a clean slate when starting a new game (especially important for multiplayer)
    visuals.clearTargetViewConfig();

    // Terminate current mode-specific logic if active
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        closestToFlag.terminateMode();
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        playHole.terminateMode();
    }
    // Reset core game logic and UI elements (like shot result, timing bars)
    logic.resetSwing(); // This also calls ui.resetUI() and visuals.resetVisuals()

    // visuals.resetVisuals(); // Covered by logic.resetSwing() -> ui.resetUI() -> visuals.resetVisuals()
    // ui.resetUI(); // Covered by logic.resetSwing()

    // currentMode = null; // Or set to a default if needed, though ui.showMainMenu handles view
    // The ui.showMainMenu() is called by the event listener in ui.js directly.
}
ui.addBackToMenuClickListener(handleBackToMenu);

// --- Initial View ---
// Show the main menu after all initializations are complete
ui.showMainMenu();

// Initialize multiplayer UI
initMultiplayerUI();

// Initialize Nano authentication
nanoAuth.init();

// Check for preview mode from hole maker.
// Deferred out of module evaluation: main.js uses top-level await and sits in
// an import cycle (visuals.js imports main.js), so dynamic import() calls made
// while main.js is still evaluating deadlock. setTimeout lets the module graph
// settle first.
if (localStorage.getItem('previewHoleData')) {
    setTimeout(async () => {
        ui.showGameView();
        await setGameMode(GAME_MODES.PLAY_HOLE);
    }, 0);
}

// Hook up "Sign in with Nano" button
const registerBtn = document.getElementById('register-btn-placeholder');
if (registerBtn) {
    registerBtn.addEventListener('click', () => {
        nanoAuth.showRegistrationModal();
    });
}

// Hook up "Logout" button
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        playerManager.logout();
        // Update UI to reflect guest status
        const player = playerManager.currentPlayer;
        ui.updatePlayerDisplay(player.guestName, player.playerType);
    });
}

// Hook up "Profile" button
const profileBtn = document.getElementById('profile-btn');
if (profileBtn) {
    profileBtn.addEventListener('click', async () => {
        const { initProfile } = await import('./profileManager.js');
        await initProfile();
    });
}

// Hook up "View Manual" button
const manualBtn = document.getElementById('manual-btn-placeholder');
const manualModal = document.getElementById('manual-modal');
const closeManualBtn = document.getElementById('close-manual-btn');

if (manualBtn && manualModal) {
    manualBtn.addEventListener('click', () => {
        manualModal.style.display = 'flex';
    });
}

if (closeManualBtn && manualModal) {
    closeManualBtn.addEventListener('click', () => {
        manualModal.style.display = 'none';
    });

    // Also close when clicking outside the modal content
    manualModal.addEventListener('click', (e) => {
        if (e.target === manualModal) {
            manualModal.style.display = 'none';
        }
    });
}


// On-screen touch zones (touch devices only) — they dispatch synthetic
// KeyboardEvents, so they ride the same listeners registered below.
initTouchControls();

// Add global key listeners that call the input handler
document.addEventListener('keydown', (event) => {
    inputHandler.handleKeyDown(event); // Call the input handler
});

document.addEventListener('keyup', (event) => {
    inputHandler.handleKeyUp(event); // Call the input handler
});

// Double-click to aim: same point-to-aim path as the touch double-tap.
// Drags don't trigger dblclick, so rotate-drag and this coexist cleanly.
canvas?.addEventListener('dblclick', (event) => {
    const menu = document.getElementById('main-menu');
    const menuVisible = menu && (menu.checkVisibility
        ? menu.checkVisibility()
        : menu.getClientRects().length > 0);
    if (menuVisible) return;
    if (getGameState() !== 'ready') return; // never mid-swing
    if (measurementViewActive()) return; // measurement clicks own the canvas
    aimAtScreenPoint(event.clientX, event.clientY);
});

// Add mouse down listener for measurement view clicks
canvas?.addEventListener('mousedown', (event) => {
    inputHandler.handleMouseDown(event); // Call the input handler
});




// --- Shot Completion Handler ---
function handleShotCompletion(shotData) {

    // 1. Update Standard UI Result Display
    // Pass all relevant properties from shotData to the UI function
    ui.updateResultDisplay({
        message: shotData.message,
        clubHeadSpeed: shotData.clubHeadSpeed, // Renamed from chs for consistency
        ballSpeed: shotData.ballSpeed,
        launchAngle: shotData.launchAngle,
        attackAngle: shotData.attackAngle,
        attackAngle: shotData.attackAngle,
        clubPathAngle: shotData.clubPathAngle, // Added
        absoluteFaceAngle: shotData.absoluteFaceAngle, // Added
        faceAngleRelPath: shotData.faceAngleRelPath, // Added
        backSpin: shotData.backSpin,
        sideSpin: shotData.sideSpin,
        peakHeight: shotData.peakHeight,
        carryDistance: shotData.carryDistance,
        rolloutDistance: shotData.rolloutDistance,
        totalDistance: shotData.totalDistance,
        // Pass other potentially useful data if needed by UI later
        strikeQuality: shotData.strikeQuality
    });
    // Update debug timing (assuming getDebugTimingData exists and is accessible or passed)
    // ui.updateDebugTimingInfo(logic.getDebugTimingData()); // Need to expose getDebugTimingData or pass data

    // 2. Show shot feedback message immediately (while ball is in flight)
    ui.updateStatus(shotData.message);

    // 3. Trigger Visual Animation (using the version with landing callback)
    // Get local player color for trajectory line
    const localPlayerId = playerManager.getPlayerId();
    const players = multiplayerManager.getPlayers();
    const localPlayer = players.find(p => p.id === localPlayerId);
    const playerColor = localPlayer?.color ? parseInt(localPlayer.color.replace('#', '0x')) : 0xffff00;

    visuals.animateBallFlightWithLanding(shotData, playerColor);

    // 4. Update Game Mode Logic (if applicable)
    let modeHandledStatusUpdate = false;
    if (currentMode === GAME_MODES.CLOSEST_TO_FLAG) {
        const distanceResult = closestToFlag.handleShotResult(shotData);
        if (distanceResult) {
            shotData.distanceFromHoleMeters = distanceResult.distanceFromHoleMeters;
            shotData.distanceFromHoleYards = distanceResult.distanceFromHoleYards;
        }
        // if (closestToFlag.isModeComplete()) modeHandledStatusUpdate = true; // Example if CTF sets a final status
    } else if (currentMode === GAME_MODES.PLAY_HOLE) {
        playHole.handleShotResult(shotData);
        // playHole.handleShotResult will call ui.updateStatus if the hole is completed.
        if (shotData.isHoledOut) {
            modeHandledStatusUpdate = true;
        }
    } else if (currentMode === GAME_MODES.RANGE) {
        // Update overlay specifically for range mode
        ui.updateVisualOverlayInfo('range', {
            lastShotDist: shotData.totalDistance,
            backSpin: shotData.backSpin,
            sideSpin: shotData.sideSpin,
            lie: 'Tee' // Assuming range is always off a tee for now
            // Removed wind placeholder - live wind is handled separately
        });
    }
}


// --- Connect Logic Calculation to Visuals (Example) --- - This section might be obsolete now
// We need a way for gameLogic to trigger the visual animation.
// This could be done via a callback or an event system.
// For now, let's imagine gameLogic could directly call visuals:

// Example (needs modification in gameLogic.js):
// Inside calculateShot() in gameLogic.js, after calculating results:
/*
const shotDataForVisuals = {
    carryDistance: carryDistance,
    peakHeight: peakHeight,
    sideSpin: sideSpin, // To calculate curve
    // Potentially add timeOfFlight, launchAngle etc. if needed by animation
};
visuals.animateBallFlight(shotDataForVisuals);
*/
