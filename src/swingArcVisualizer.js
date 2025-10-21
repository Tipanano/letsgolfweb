// swingArcVisualizer.js
// Visualizes the golf swing as an arched path overlay on the left side of the screen

// --- Configuration Constants ---
const ARC_CONFIG = {
    // SVG viewBox dimensions (tall and narrow for vertical arc)
    viewBoxWidth: 220,
    viewBoxHeight: 600,

    // Path positioning (start at bottom, go up)
    startX: 70,           // Start point X (centered horizontally)
    startY: 560,          // Start point Y (near bottom, more margin)
    straightHeight: 450,  // Height of straight portion before curve (taller)

    // Arc parameters (adjusted by swing speed)
    maxArcRadius: 100,    // Maximum arc radius for slow swings
    minArcRadius: 45,     // Minimum arc radius for fast swings
    arcRightOffset: 85,   // How far right the arc curves at the top

    // Hip initiation affects when curve starts
    earlyHipCurveStart: 0.5,  // If hip pressed early (0-50% of backswing), curve starts here
    lateHipCurveStart: 0.8,   // If hip pressed late (70-100% of backswing), curve starts here

    // Colors
    backswingColor: '#4CAF50',      // Green
    backswingLateColor: '#ffc107',  // Yellow
    backswingOverColor: '#FFA500',  // Orange

    downswingRotationColor: '#2196F3', // Blue
    downswingArmsColor: '#9C27B0',     // Purple
    downswingWristsColor: '#FF5722',   // Red-Orange

    markerColor: '#FFD700',         // Gold for press markers
    idealZoneColor: 'rgba(0, 255, 0, 0.3)', // Semi-transparent green
};

// --- State ---
let svgElement = null;
let pathElement = null;
let progressElement = null;
let hipMarkerElement = null;
let idealZoneElement = null;
let downswingZonesGroup = null;
let pressMarkersGroup = null;

let currentPathData = '';      // SVG path data string
let currentSwingSpeed = 1.0;   // Current swing speed factor
let hipInitiationProgress = null; // When 'j' was pressed (0-1 of backswing)
let currentPhase = 'idle';     // 'idle', 'backswing', 'downswing'
let currentShotType = 'full'; // 'full', 'chip', 'putt'
let chipBackswingProgress = 0; // Track chip backswing progress for path generation

// --- Initialization ---

/**
 * Initialize the swing arc visualizer.
 * Must be called after DOM is loaded.
 */
export function initSwingArcVisualizer() {
    const container = document.getElementById('swing-arc-overlay');
    if (!container) {
        console.error('SwingArc: Container element "swing-arc-overlay" not found');
        return false;
    }

    // Create SVG element
    svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgElement.setAttribute('viewBox', `0 0 ${ARC_CONFIG.viewBoxWidth} ${ARC_CONFIG.viewBoxHeight}`);
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgElement.style.width = '100%';
    svgElement.style.height = '100%';

    // Create main path (the stroke outline)
    pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('fill', 'none');
    pathElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.5)');
    pathElement.setAttribute('stroke-width', '8');
    pathElement.setAttribute('stroke-linecap', 'round');
    svgElement.appendChild(pathElement);

    // Create progress path (fills along the main path)
    progressElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    progressElement.setAttribute('fill', 'none');
    progressElement.setAttribute('stroke', ARC_CONFIG.backswingColor);
    progressElement.setAttribute('stroke-width', '18');
    progressElement.setAttribute('stroke-linecap', 'round');
    svgElement.appendChild(progressElement);

    // Create group for downswing zones (colored sections on the path)
    downswingZonesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    downswingZonesGroup.style.display = 'none';
    svgElement.appendChild(downswingZonesGroup);

    // Create group for press markers
    pressMarkersGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svgElement.appendChild(pressMarkersGroup);

    // Create hip initiation marker
    hipMarkerElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hipMarkerElement.setAttribute('r', '12');
    hipMarkerElement.setAttribute('fill', ARC_CONFIG.markerColor);
    hipMarkerElement.setAttribute('stroke', 'rgba(0, 0, 0, 0.8)');
    hipMarkerElement.setAttribute('stroke-width', '3');
    hipMarkerElement.style.display = 'none';
    svgElement.appendChild(hipMarkerElement);

    // Create ideal zone indicator
    idealZoneElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    idealZoneElement.setAttribute('fill', ARC_CONFIG.idealZoneColor);
    idealZoneElement.setAttribute('stroke', 'rgba(0, 255, 0, 0.5)');
    idealZoneElement.setAttribute('stroke-width', '1');
    idealZoneElement.style.display = 'none';
    svgElement.appendChild(idealZoneElement);

    container.appendChild(svgElement);

    console.log('SwingArc: Visualizer initialized');
    return true;
}

// --- Path Generation ---

/**
 * Generate chip shot path - simpler arc based on backswing duration
 * The arc angle visually shows where ideal 'i' timing is (matching backswing position)
 * @param {number} backswingProgress - How far through backswing (0-1)
 * @returns {string} SVG path data
 */
function generateChipPath(backswingProgress) {
    const cfg = ARC_CONFIG;
    const startX = cfg.startX;
    const startY = cfg.startY;

    // For chips, the arc size is determined by backswing length
    // Longer backswing = more arc to the right, showing ideal timing visually
    const maxArcOffset = cfg.arcRightOffset * 0.5; // Chips have smaller arc than full swing
    const currentArcOffset = maxArcOffset * backswingProgress;

    // Backswing goes up and slightly right
    const backswingHeight = cfg.straightHeight * backswingProgress;
    const apexY = startY - backswingHeight;
    const apexX = startX + currentArcOffset;

    // Build path
    let pathData = `M ${startX},${startY}`;

    // Backswing: gradual curve to apex
    if (backswingProgress > 0.01) {
        const controlX1 = startX + currentArcOffset * 0.2;
        const controlY1 = startY - backswingHeight * 0.4;
        const controlX2 = startX + currentArcOffset * 0.7;
        const controlY2 = apexY + backswingHeight * 0.2;
        pathData += ` C ${controlX1},${controlY1} ${controlX2},${controlY2} ${apexX},${apexY}`;
    }

    // Downswing: arc back down
    // The ideal 'i' timing zone should align with where the backswing ended
    // End more to the right to avoid interference with backswing
    const impactX = startX + maxArcOffset * 0.6; // More forward to separate paths
    const impactY = startY;

    // Control points to create smooth downswing that passes near backswing end position
    const controlX3 = apexX + currentArcOffset * 0.15;
    const controlY3 = apexY + backswingHeight * 0.3;
    const controlX4 = impactX;
    const controlY4 = impactY - backswingHeight * 0.2;
    pathData += ` C ${controlX3},${controlY3} ${controlX4},${controlY4} ${impactX},${impactY}`;

    return pathData;
}

/**
 * Generate putt path - simple straight line matching backswing height
 * Downswing height matches backswing, but timing is always fixed (1500ms)
 * This makes short putts easier - same path length but more time to hit it
 * @param {number} backswingProgress - How far through backswing (0-1)
 * @returns {string} SVG path data
 */
function generatePuttPath(backswingProgress) {
    const cfg = ARC_CONFIG;
    const startX = cfg.startX;
    const startY = cfg.startY;

    // Putt backswing goes straight up
    const backswingHeight = cfg.straightHeight * backswingProgress;
    const apexY = startY - backswingHeight;

    // Downswing height matches backswing
    // But animation duration is always 1500ms (fixed tempo)
    const timingOffset = cfg.arcRightOffset * 0.25; // Fixed offset for visual separation

    // Build path: straight up, then slightly offset down (matching height)
    let pathData = `M ${startX},${startY}`;
    pathData += ` L ${startX},${apexY}`; // Straight up

    // Downswing with slight offset to create visual separation
    const downX = startX + timingOffset;
    pathData += ` L ${downX},${startY}`; // Back down (same height)

    return pathData;
}

/**
 * Generate the swing path based on current parameters.
 * @param {number} swingSpeed - Swing speed factor (0.3 - 1.0)
 * @param {number|null} hipProgress - Progress when hip was initiated (0-1), or null if not yet pressed
 * @param {number} currentProgress - Current backswing progress (0-1) - used to show gradual curve
 * @returns {string} SVG path data
 */
function generateSwingPath(swingSpeed, hipProgress, currentProgress = 1.0) {
    const cfg = ARC_CONFIG;

    // Start point (bottom)
    const startX = cfg.startX;
    const startY = cfg.startY;

    // If 'j' hasn't been pressed yet, just draw a straight line up
    if (hipProgress === null) {
        const straightTopY = startY - cfg.straightHeight;
        // Just a straight line up (and back down the same path for downswing)
        let pathData = `M ${startX},${startY} L ${startX},${straightTopY}`;
        // Downswing path (same straight line back down)
        pathData += ` L ${startX},${startY}`;
        return pathData;
    }

    const totalHeight = cfg.straightHeight;
    const straightPartHeight = totalHeight * hipProgress; // Straight until 'j' was pressed

    // Point where 'j' was pressed
    const curveStartX = startX;
    const curveStartY = startY - straightPartHeight;

    // Full apex position (where the path would end at 100% progress)
    const fullApexX = startX + cfg.arcRightOffset;
    const fullApexY = startY - totalHeight - 25;

    // Build path progressively:
    // 1. Straight up from start to where 'j' was pressed
    let pathData = `M ${startX},${startY} L ${curveStartX},${curveStartY}`;

    // Track where backswing actually ends (for downswing to start from)
    let backswingEndX = curveStartX;
    let backswingEndY = curveStartY;

    // 2. After 'j' is pressed, gradually curve based on current progress
    if (currentProgress > hipProgress) {
        // How far through the curving portion are we? (0 to 1)
        const curveProgress = Math.min(1.0, (currentProgress - hipProgress) / (1.0 - hipProgress));

        // Current height (continues upward)
        const remainingHeight = totalHeight - straightPartHeight;
        const currentAdditionalHeight = remainingHeight * curveProgress;
        const currentY = curveStartY - currentAdditionalHeight;

        // X position curves gradually - use smooth easing
        // Starts at startX (straight), gradually moves right
        const easedCurve = Math.pow(curveProgress, 1.2); // Ease-in: starts slow, accelerates
        const currentX = startX + (cfg.arcRightOffset * easedCurve);

        // Update backswing end position
        backswingEndX = currentX;
        backswingEndY = currentY;

        // Create smooth progressive curve with proper bow at top
        // Control points should create a downward bow WITHOUT going left
        const controlX1 = curveStartX + (currentX - curveStartX) * 0.6;
        const controlY1 = curveStartY - currentAdditionalHeight * 0.5;
        const controlX2 = currentX; // Keep at current X - never go left!
        const controlY2 = currentY - currentAdditionalHeight * 0.15; // Bow downward

        pathData += ` C ${controlX1},${controlY1} ${controlX2},${controlY2} ${currentX},${currentY}`;
    }

    // 3. Downswing path (inverted U-shape - ends forward of start)
    // Start from where backswing actually ended, not from fullApex
    const impactForwardOffset = cfg.arcRightOffset * 0.4; // About 40% forward
    const downEndX = startX + impactForwardOffset;
    const downEndY = startY;

    // Create smooth downswing curve from actual backswing end to impact
    const controlX3 = backswingEndX + (fullApexX - backswingEndX) * 0.3;
    const controlY3 = backswingEndY - (backswingEndY - fullApexY) * 0.2;
    const controlX4 = downEndX + cfg.arcRightOffset * 0.2;
    const controlY4 = downEndY - (downEndY - backswingEndY) * 0.3;
    pathData += ` C ${controlX3},${controlY3} ${controlX4},${controlY4} ${downEndX},${downEndY}`;

    return pathData;
}

/**
 * Get a point along the path at a given progress (0-1).
 * Approximation using path length calculations.
 */
function getPointOnPath(pathData, progress) {
    // Create a temporary path to measure
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', pathData);
    const pathLength = tempPath.getTotalLength();
    const point = tempPath.getPointAtLength(pathLength * progress);
    return point;
}

// --- Backswing Updates ---

/**
 * Start the backswing visualization.
 * @param {number} swingSpeed - Swing speed factor (0.3 - 1.0)
 * @param {string} shotType - 'full', 'chip', or 'putt'
 */
export function startBackswingArc(swingSpeed, shotType = 'full') {
    currentSwingSpeed = swingSpeed;
    currentPhase = 'backswing';
    currentShotType = shotType;
    hipInitiationProgress = null;
    chipBackswingProgress = 0;

    // Generate initial path based on shot type
    if (shotType === 'chip') {
        // Chips start with minimal path
        currentPathData = generateChipPath(0.01);
    } else if (shotType === 'putt') {
        // Putts start with minimal straight path
        currentPathData = generatePuttPath(0.01);
    } else {
        // Full swings start with straight path
        currentPathData = generateSwingPath(swingSpeed, null);
    }

    pathElement.setAttribute('d', currentPathData);
    progressElement.setAttribute('d', currentPathData);
    progressElement.setAttribute('stroke-dasharray', '0 10000'); // Start empty
    progressElement.setAttribute('stroke', ARC_CONFIG.backswingColor);

    // Hide downswing elements
    downswingZonesGroup.style.display = 'none';
    hipMarkerElement.style.display = 'none';
    idealZoneElement.style.display = 'none';
    clearPressMarkers();

    console.log(`SwingArc: Backswing started (${shotType})`);
}

/**
 * Update backswing progress.
 * @param {number} progress - Progress from 0 to 1
 * @param {boolean} isIdeal - Whether timing is in ideal range
 * @param {boolean} isLate - Whether timing is getting late
 */
export function updateBackswingArc(progress, isIdeal, isLate) {
    if (currentPhase !== 'backswing') return;

    // Regenerate path based on shot type
    if (currentShotType === 'chip') {
        chipBackswingProgress = progress;
        currentPathData = generateChipPath(progress);
    } else if (currentShotType === 'putt') {
        currentPathData = generatePuttPath(progress);
    } else {
        // Full swing
        currentPathData = generateSwingPath(currentSwingSpeed, hipInitiationProgress, progress);
    }

    pathElement.setAttribute('d', currentPathData);

    // Calculate stroke-dasharray for progress
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', currentPathData);
    const totalLength = tempPath.getTotalLength();
    const halfLength = totalLength / 2; // Backswing is first half
    const currentLength = halfLength * progress;

    progressElement.setAttribute('d', currentPathData);
    progressElement.setAttribute('stroke-dasharray', `${currentLength} ${totalLength}`);

    // Update color based on timing
    if (!isIdeal && isLate) {
        progressElement.setAttribute('stroke', ARC_CONFIG.backswingLateColor);
    } else if (progress > 1.0) {
        progressElement.setAttribute('stroke', ARC_CONFIG.backswingOverColor);
    } else {
        progressElement.setAttribute('stroke', ARC_CONFIG.backswingColor);
    }
}

/**
 * Mark hip initiation on the arc.
 * @param {number} progress - Progress when 'j' was pressed (0-1)
 */
export function markHipInitiationOnArc(progress) {
    hipInitiationProgress = progress;

    // Path will be regenerated in the next updateBackswingArc call with current progress
    // Mark where 'j' was pressed (on the straight portion)
    const straightY = ARC_CONFIG.startY - (ARC_CONFIG.straightHeight * progress);
    hipMarkerElement.setAttribute('cx', ARC_CONFIG.startX);
    hipMarkerElement.setAttribute('cy', straightY);
    hipMarkerElement.style.display = 'block';

    console.log(`SwingArc: Hip initiated at ${(progress * 100).toFixed(0)}%`);
}

/**
 * End the backswing and prepare for downswing.
 */
export function endBackswingArc() {
    // Show ideal zone at apex if needed
    // (Could add visual feedback here)
    console.log('SwingArc: Backswing ended');
}

// --- Downswing Updates ---

/**
 * Start the downswing visualization.
 */
export function startDownswingArc() {
    currentPhase = 'downswing';

    // Show downswing zones
    createDownswingZones();
    downswingZonesGroup.style.display = 'block';

    // Reset progress to apex
    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', currentPathData);
    const totalLength = tempPath.getTotalLength();
    const halfLength = totalLength / 2;

    progressElement.setAttribute('stroke-dasharray', `${halfLength} ${totalLength}`);
    progressElement.setAttribute('stroke', ARC_CONFIG.downswingRotationColor);

    console.log('SwingArc: Downswing started');
}

/**
 * Update downswing progress.
 * @param {number} progress - Progress from 0 to 1 (0 = apex, 1 = impact)
 */
export function updateDownswingArc(progress) {
    if (currentPhase !== 'downswing') return;

    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', currentPathData);
    const totalLength = tempPath.getTotalLength();
    const halfLength = totalLength / 2;
    const currentLength = halfLength + (halfLength * progress);

    progressElement.setAttribute('stroke-dasharray', `${currentLength} ${totalLength}`);

    // Update color based on which zone we're in
    if (progress < 0.33) {
        progressElement.setAttribute('stroke', ARC_CONFIG.downswingRotationColor);
    } else if (progress < 0.67) {
        progressElement.setAttribute('stroke', ARC_CONFIG.downswingArmsColor);
    } else {
        progressElement.setAttribute('stroke', ARC_CONFIG.downswingWristsColor);
    }
}

/**
 * Create visual zones on the downswing path for rotation/arms/wrists.
 */
function createDownswingZones() {
    // Clear existing zones
    downswingZonesGroup.innerHTML = '';

    const tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('d', currentPathData);
    const totalLength = tempPath.getTotalLength();
    const halfLength = totalLength / 2;

    let zones;

    if (currentShotType === 'chip') {
        // For chips, show two zones:
        // 1. Small rotation zone early (~10% of downswing, around 100ms mark)
        // 2. Hit zone aligned with where backswing ended (ideal timing matches backswing)
        // The arc angle visually shows where ideal timing is
        zones = [
            { start: 0.5, end: 0.55, color: ARC_CONFIG.downswingRotationColor },
            { start: 0.70, end: 0.95, color: ARC_CONFIG.downswingWristsColor } // Hit zone near backswing end position
        ];
    } else if (currentShotType === 'putt') {
        // For putts, show single hit zone centered around ideal timing
        // Path is 50% backswing, 50% downswing
        // Ideal is at 82.5% of DOWNSWING = 0.5 + (0.825 * 0.5) = 0.9125 of total path
        // Zone spans 77.5-87.5% of downswing = 0.8875-0.9375 of total path
        zones = [
            { start: 0.8875, end: 0.9375, color: ARC_CONFIG.downswingWristsColor } // Hit zone centered on ideal
        ];
    } else {
        // Full swing: three zones (rotation, arms, wrists)
        zones = [
            { start: 0.5, end: 0.667, color: ARC_CONFIG.downswingRotationColor },
            { start: 0.667, end: 0.833, color: ARC_CONFIG.downswingArmsColor },
            { start: 0.833, end: 1.0, color: ARC_CONFIG.downswingWristsColor }
        ];
    }

    zones.forEach(zone => {
        const startLength = totalLength * zone.start;
        const endLength = totalLength * zone.end;
        const zoneLength = endLength - startLength;

        const zonePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        zonePath.setAttribute('d', currentPathData);
        zonePath.setAttribute('fill', 'none');
        zonePath.setAttribute('stroke', zone.color);
        zonePath.setAttribute('stroke-width', '24');
        zonePath.setAttribute('stroke-linecap', 'round');
        zonePath.setAttribute('opacity', '0.6');
        zonePath.setAttribute('stroke-dasharray', `0 ${startLength} ${zoneLength} ${totalLength}`);
        downswingZonesGroup.appendChild(zonePath);
    });
}

/**
 * Mark a key press on the downswing arc.
 * @param {string} key - The key pressed ('a', 'd', 'i')
 * @param {number} progress - Progress when key was pressed (0-1 of downswing)
 */
export function markKeyPressOnArc(key, progress) {
    const point = getPointOnPath(currentPathData, 0.5 + (progress * 0.5)); // Second half of path

    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('cx', point.x);
    marker.setAttribute('cy', point.y);
    marker.setAttribute('r', '12');
    marker.setAttribute('fill', ARC_CONFIG.markerColor);
    marker.setAttribute('stroke', 'rgba(0, 0, 0, 0.9)');
    marker.setAttribute('stroke-width', '4');
    pressMarkersGroup.appendChild(marker);

    // No label needed - the colored zones show ideal ranges, marker shows actual timing
    console.log(`SwingArc: Marked ${key} press at ${(progress * 100).toFixed(0)}%`);
}

/**
 * Clear all press markers.
 */
function clearPressMarkers() {
    pressMarkersGroup.innerHTML = '';
}

// --- Reset and Hide ---

/**
 * Reset the visualizer to idle state.
 */
export function resetSwingArc() {
    currentPhase = 'idle';
    hipInitiationProgress = null;
    currentSwingSpeed = 1.0;

    // Clear all visual elements
    progressElement.setAttribute('stroke-dasharray', '0 10000');
    downswingZonesGroup.style.display = 'none';
    hipMarkerElement.style.display = 'none';
    idealZoneElement.style.display = 'none';
    clearPressMarkers();

    console.log('SwingArc: Reset');
}

/**
 * Hide the entire visualizer.
 */
export function hideSwingArc() {
    if (svgElement) {
        svgElement.style.display = 'none';
    }
}

/**
 * Show the visualizer.
 */
export function showSwingArc() {
    if (svgElement) {
        svgElement.style.display = 'block';
    }
}
