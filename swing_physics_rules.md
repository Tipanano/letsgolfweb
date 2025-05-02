# Golf Swing Physics Rules - Revision Proposal

This document outlines proposed changes to the golf swing simulation logic, moving towards a model where timing primarily influences club path and face angle, which then determine ball flight characteristics based on physics principles.

## Current Model Summary (from gameLogic.js)

*   **Club Head Speed (CHS):**
    *   Base potential speed from `clubs.js`.
    *   Scaled by `swingSpeed` slider (0.3-1.0).
    *   Modified by `powerFactor` (backswing duration vs. ideal duration `IDEAL_BACKSWING_DURATION_MS / swingSpeed`).
    *   Penalized by `sequencePenaltyFactor` (timing deviations of rotation 'a', arms 'd', wrists 'i' relative to ideal offsets from backswing end).
    *   Penalized by `overswingPenalty` (backswing duration > max duration `BACKSWING_BAR_MAX_DURATION_MS / swingSpeed`).
*   **Attack Angle (AoA):**
    *   Base AoA from `clubs.js`.
    *   Adjusted by `armsDev` (arms 'd' timing deviation).
    *   Adjusted by `ballPositionFactor` (ball position relative to center).
*   **Spin:**
    *   **Back Spin:** Calculated based on CHS, club loft, and AoA (`1000 + (CHS * 15) + (loft * 100) + (-AoA * 50)`), scaled by `club.spinRateFactor`. Reduced significantly if side spin is high.
    *   **Side Spin:** Calculated based on `faceToPath * 200`.
        *   `faceToPath = faceAngleDev - pathDev`
        *   `faceAngleDev = (wristsDev * 0.6 + rotationDev * 0.4) / (20 / swingSpeed)`
        *   `pathDev = (rotationDev * 0.7 - armsDev * 0.3) / (25 / swingSpeed)`
*   **Launch Angle:** Calculated based on club loft and AoA (`loft + AoA * dynamicLoftFactor`), clamped within min/max values. `dynamicLoftFactor` is higher for Driver.
*   **Strike Quality (Fat/Thin):** Determined by large AoA deviations from base or large `wristsDev`. Affects smash factor and rollout.
*   **Ball Flight:** Simulated step-by-step using initial velocity (from ball speed, launch angle, side angle derived from side spin) and spin vector (back/side spin). Includes drag and Magnus effect (lift), using `simulateFlightStepByStep`.

## Proposed New Model Principles

The goal is to decouple direct timing-to-outcome calculations and insert intermediate physics concepts: **Club Path** and **Clubface Angle**.

### 1. Backswing Length ('w' key duration)

*   **Current:** Influences `powerFactor` affecting potential CHS. Overswinging past max duration applies a penalty.
*   **Proposal:**
    *   Primarily determines **Potential Club Head Speed (PCHS)**. Longer backswing = higher PCHS, up to a point.
    *   **Overswing:**
        *   *Increases* PCHS further (potentially non-linearly, representing stored energy).
        *   *Increases Difficulty:* Could shrink the ideal timing windows for downswing elements (rotation, arms, wrists) or increase the penalty for missing them. Makes achieving *actual* CHS from PCHS harder due to loss of sync.

### 2. Weight Shift / Transition Timing ('j' key timing)

*   **Current:** Hip initiation ('j' key) allows the downswing sequence to start. Timing relative to backswing end (`hipInitiationOffset`) isn't directly used in core calculations yet, but is logged.
*   **Proposal:**
    *   Timing relative to the *ideal transition point* (e.g., slightly before the calculated `backswingEndTime` based on `IDEAL_BACKSWING_DURATION_MS`) influences **Actual Club Head Speed (ACHS)**.
    *   Perfect timing maximizes the conversion of PCHS to ACHS (efficient energy transfer).
    *   Early/Late timing reduces ACHS (loss of sequence).
    *   This could be a multiplier applied to PCHS.

### 3. Arms vs. Rotation Timing ('d' vs 'a' keys)

*   **Current:** `rotationDev` and `armsDev` directly influence `pathDev` (used for side spin) and `armsDev` influences AoA. The overall `sequencePenaltyFactor` based on absolute deviations affects CHS.
*   **Proposal:**
    *   The timing of Arms ('d') and Rotation ('a') has two key impacts:
        *   **Relative Timing (Arms vs. Rotation):** Determines the base **Club Path Angle** relative to the target line.
            *   **Late Arms ('d') relative to Rotation ('a'):** Tends towards Outside-in path (negative path angle, e.g., -4 degrees). Simulates "over the top".
            *   **Early Arms ('d') relative to Rotation ('a'):** Tends towards Inside-out path (positive path angle, e.g., +4 degrees).
            *   **Synchronized:** Tends towards Neutral path (zero path angle).
        *   **Absolute Timing (vs. Downswing Start):** The overall timing deviation of *both* arms and rotation from their ideal points relative to the downswing start (triggered by 'j' or 'w' release) influences:
            *   **Path Modification:** Poor absolute timing can shift the path further (e.g., very late rotation *and* arms might exaggerate an outside-in path).
            *   **Speed Efficiency:** Poor absolute timing reduces the efficiency of converting PCHS to ACHS (similar to the old `sequencePenaltyFactor`, representing loss of sync). A large deviation here significantly lowers ACHS.
    *   **Combined Effect:** The final Club Path Angle and the ACHS efficiency multiplier will be functions of both the relative and absolute timing deviations of arms and rotation.

### 4. Wrist Release Timing ('i' key)

*   **Current:** `wristsDev` influences `faceAngleDev` (for side spin) and determines Fat/Thin strike quality if deviation is large.
*   **Proposal:**
    *   This timing is the primary determinant of **Dynamic Loft** and **Clubface Angle relative to the Club Path** at impact.
        *   **Very Early Release ('i'):** "Fat" strike. Hits ground first. Low compression, high dynamic loft added (scooping), potentially increased back spin, significantly reduced ball speed.
        *   **Early Release ('i'):** "Flipping". Adds dynamic loft, increases spin, reduces compression (lower ball speed), higher launch angle. Tends towards a **closed face relative to path** (hook spin tendency).
        *   **Ideal Release ('i'):** Optimal compression, desired launch and spin based on club loft and AoA. **Square face relative to path**.
        *   **Late Release ('i'):** "Punchy". Decreases dynamic loft (delofting), lower spin, lower launch angle, potentially increased ball speed due to compression. Tends towards an **open face relative to path** (slice spin tendency).
        *   **Very Late Release ('i'):** "Thin" strike. Hits top half of ball. Very low launch, low spin, significantly reduced ball speed.

### 5. Clubface Angle (Absolute - Relative to Target Line)

*   **Current:** Implicitly calculated via `faceAngleDev` (wrists + rotation timing).
*   **Proposal:** This needs to be explicitly calculated based on the elements that control it:
    *   **Club Path Angle** (from Arms vs. Rotation timing - see #3).
    *   **Face Angle relative to Path** (from Wrist Release timing - see #4).
    *   **Calculation:** `Absolute Face Angle = Club Path Angle + Face Angle relative to Path`.
    *   *Example:* Inside-out path (+4 deg) + Square face relative to path (0 deg) = Absolute Face Angle of +4 deg (open to target).
    *   *Example:* Outside-in path (-4 deg) + Closed face relative to path (-2 deg) = Absolute Face Angle of -6 deg (closed to target).

### 6. Ball Flight Laws (Combining Path and Face)

*   **Inputs:**
    *   Actual Club Head Speed (ACHS)
    *   Club Path Angle (relative to target line)
    *   Absolute Clubface Angle (relative to target line)
    *   Attack Angle (AoA - still influenced by ball position, maybe slightly by arms/rotation?)
    *   Dynamic Loft (influenced by wrist release, AoA, and base club loft)
    *   Strike Quality / Point (Center, Fat, Thin, Heel, Toe - currently simplified to Fat/Thin based on wrists/AoA, could be expanded)
*   **Outputs (determined by physics):**
    *   **Ball Speed:** Based on ACHS and Smash Factor (influenced by strike quality/centeredness).
    *   **Launch Angle:** Based on Dynamic Loft and AoA.
    *   **Spin Axis (Tilt):** Determined primarily by the difference between **Absolute Clubface Angle** and **Club Path Angle** (Face-to-Path). This dictates curve (side spin). `Spin Axis Tilt Angle ≈ atan(sin(FaceAngle - PathAngle) / cos(DynamicLoft))` (simplified).
    *   **Spin Rate (Back Spin):** Determined by Dynamic Loft, ACHS, AoA, and compression/friction (strike quality). `Back Spin ≈ f(Loft, Speed, AoA, Friction)`.
*   **Simulation:** Use these initial ball parameters (speed, launch, spin axis/rate) as inputs to the existing `simulateFlightStepByStep` physics simulation.

## Next Steps

1.  Review and refine these proposed rules and relationships.
2.  Define the exact mathematical formulas and sensitivity (e.g., how many degrees does path change per 10ms of arms/rotation deviation? How much does dynamic loft change per 10ms of wrist deviation?).
3.  **Refactor:** Implement these new calculation functions within a dedicated file, `src/swingPhysics.js`. This file should define tunable parameters (e.g., sensitivity of path to timing deviations, base PCHS factors) at the top for easier adjustment and testing.
4.  **Integrate:** Modify `src/gameLogic.js` to import and utilize the functions from `src/swingPhysics.js` within its `calculateShot` method, passing the necessary timing inputs (backswing duration, key press times relative to downswing start) and receiving the calculated path, face, speed, etc., before proceeding to the ball flight simulation.
