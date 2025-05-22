// Visuals for the "Closest to the Flag" game mode (Target View - 3D)

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';
import * as CoreVisuals from './core.js'; // May need core functions

let scene = null;
let canvasWidth = 0;
let canvasHeight = 0;
let targetDistanceYards = 0; // In yards

// --- 3D Objects ---
let greenMesh = null;
let flagstickMesh = null;
let flagMesh = null;
let groundMesh = null; // Add ground
let fairwayMesh = null; // Add fairway
let targetGroup = null; // Group to hold all target elements
const landingMarkers = []; // Array to hold landing spot markers

// --- Constants ---
const ROUGH_COLOR = 0x228B22; // Forest green
const FAIRWAY_COLOR = 0x3CB371; // Medium sea green
const GREEN_COLOR = 0x3A913F; // Darker green
const FLAG_COLOR = 0xFF0000; // Red
const FLAGSTICK_COLOR = 0xcccccc; // White/Gray

import { YARDS_TO_METERS } from '../utils/unitConversions.js';

const Y_OFFSET_GROUND = 0;
const Y_OFFSET_FAIRWAY = 0.01;
const Y_OFFSET_GREEN = 0.02;
const Y_OFFSET_FLAGSTICK = 0.02; // Base of flagstick on green level

export function setScene(coreScene, width, height) {
    scene = coreScene;
    canvasWidth = width;
    canvasHeight = height;
}

export function setTargetDistance(distanceYards) {
    targetDistanceYards = distanceYards;
}

// Creates the 3D objects for the target view
function createTargetElements() {
    if (targetGroup) {
        // Already created, maybe just update position/visibility
        targetGroup.visible = true;
        return;
    }

    targetGroup = new THREE.Group();
    const targetZ = targetDistanceYards * YARDS_TO_METERS; // Target distance in meters

    // --- Ground (Rough) ---
    // Make it wide and long enough to cover the view towards the target
    const groundWidth = 100; // Meters
    const groundLength = targetZ + 50; // Extend 50m past the target
    const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundLength);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: ROUGH_COLOR, side: THREE.DoubleSide });
    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = Y_OFFSET_GROUND;
    groundMesh.position.z = groundLength / 2; // Center the ground plane
    targetGroup.add(groundMesh);

    // --- Fairway ---
    // Simple rectangle leading to the green
    const fairwayWidth = 25; // Meters
    const fairwayLength = targetZ; // Length up to the green center
    const fairwayGeometry = new THREE.PlaneGeometry(fairwayWidth, fairwayLength);
    const fairwayMaterial = new THREE.MeshLambertMaterial({ color: FAIRWAY_COLOR, side: THREE.DoubleSide });
    fairwayMesh = new THREE.Mesh(fairwayGeometry, fairwayMaterial);
    fairwayMesh.rotation.x = -Math.PI / 2;
    fairwayMesh.position.y = Y_OFFSET_FAIRWAY; // Slightly above rough
    fairwayMesh.position.z = fairwayLength / 2; // Center it leading up to target
    targetGroup.add(fairwayMesh);

    // --- Green ---
    const greenRadiusMeters = 15 * YARDS_TO_METERS; // Example: 15 yard radius green
    const greenGeometry = new THREE.CircleGeometry(greenRadiusMeters, 32);
    const greenMaterial = new THREE.MeshLambertMaterial({ color: GREEN_COLOR, side: THREE.DoubleSide });
    greenMesh = new THREE.Mesh(greenGeometry, greenMaterial);
    greenMesh.rotation.x = -Math.PI / 2; // Rotate to lay flat
    greenMesh.position.y = Y_OFFSET_GREEN; // Slightly above fairway
    greenMesh.position.z = targetZ; // Position it AT the target distance
    targetGroup.add(greenMesh);

    // --- Flagstick ---
    const flagstickHeight = 2.5; // Meters
    const flagstickRadius = 0.03; // Meters
    const flagstickGeometry = new THREE.CylinderGeometry(flagstickRadius, flagstickRadius, flagstickHeight, 8);
    const flagstickMaterial = new THREE.MeshBasicMaterial({ color: FLAGSTICK_COLOR });
    flagstickMesh = new THREE.Mesh(flagstickGeometry, flagstickMaterial);
    // Position base on the green surface, centered at target Z
    flagstickMesh.position.set(0, flagstickHeight / 2 + Y_OFFSET_FLAGSTICK, targetZ);
    targetGroup.add(flagstickMesh);

    // --- Flag ---
    const flagGeometry = new THREE.PlaneGeometry(0.5, 0.3); // Width, height in meters
    const flagMaterial = new THREE.MeshBasicMaterial({ color: FLAG_COLOR, side: THREE.DoubleSide });
    flagMesh = new THREE.Mesh(flagGeometry, flagMaterial);
    // Position relative to the top of the flagstick
    flagMesh.position.set(0.25, flagstickMesh.position.y + flagstickHeight / 2 - 0.15, targetZ);
    targetGroup.add(flagMesh);

    // Add the whole group to the main scene
    scene.add(targetGroup);
    console.log(`Target elements created/updated at Z = ${targetZ.toFixed(1)}m`);
}

// Shows the target elements (creates if needed)
export function drawTargetView() {
    if (!scene) return;
    console.log("Drawing Target View (3D) for distance:", targetDistanceYards);

    if (!targetGroup) {
        createTargetElements();
    } else {
        // Instead of moving the group, we might need to recreate or update individual element positions/sizes
        // if the target distance changes significantly, especially for ground/fairway length.
        // For simplicity now, let's assume createTargetElements handles placing things correctly based on targetDistanceYards.
        // We just need to ensure it's visible.
        targetGroup.visible = true;
        // Update positions based on current targetDistanceYards
        const targetZ = targetDistanceYards * YARDS_TO_METERS;
        if (groundMesh) {
             // Adjust ground length and position if needed (more complex)
             // groundMesh.geometry = new THREE.PlaneGeometry(100, targetZ + 50); // Recreate geometry?
             groundMesh.position.z = (targetZ + 50) / 2; // Recenter
        }
         if (fairwayMesh) {
             // Adjust fairway length and position
             // fairwayMesh.geometry = new THREE.PlaneGeometry(25, targetZ); // Recreate geometry?
             fairwayMesh.position.z = targetZ / 2; // Recenter
         }
         if (greenMesh) greenMesh.position.z = targetZ;
         if (flagstickMesh) flagstickMesh.position.z = targetZ;
         if (flagMesh) flagMesh.position.z = targetZ;

         console.log(`Target elements updated for Z = ${targetZ.toFixed(1)}m`);
    }
    // TODO: Adjust camera for target view?
    // CoreVisuals.setCameraForTargetView(targetDistanceYards * YARDS_TO_METERS);
}

// Hides the target elements
export function hideTargetElements() {
    if (targetGroup) {
        targetGroup.visible = false;
    }
    // Hide landing markers too
    landingMarkers.forEach(marker => marker.visible = false);
}

// Removes the target elements from the scene entirely
export function removeTargetElements() {
     if (targetGroup) {
        // Remove individual elements first
        if(groundMesh) targetGroup.remove(groundMesh);
        if(fairwayMesh) targetGroup.remove(fairwayMesh);
        if(greenMesh) targetGroup.remove(greenMesh);
        if(flagstickMesh) targetGroup.remove(flagstickMesh);
        if(flagMesh) targetGroup.remove(flagMesh);
        // Then remove the group itself
        scene.remove(targetGroup);

        // Dispose geometries and materials if needed
        groundMesh?.geometry.dispose(); groundMesh?.material.dispose();
        fairwayMesh?.geometry.dispose(); fairwayMesh?.material.dispose();
        greenMesh?.geometry.dispose(); greenMesh?.material.dispose();
        flagstickMesh?.geometry.dispose(); flagstickMesh?.material.dispose();
        flagMesh?.geometry.dispose(); flagMesh?.material.dispose();

        targetGroup = null;
        groundMesh = null;
        fairwayMesh = null;
        greenMesh = null;
        flagstickMesh = null;
        flagMesh = null;
        console.log("Target elements removed and disposed.");
     }
     // Remove landing markers
     landingMarkers.forEach(marker => {
         scene.remove(marker);
         marker.geometry.dispose();
         marker.material.dispose();
     });
     landingMarkers.length = 0; // Clear the array
}


export function animateShotLanding(shotData) {
    if (!scene) return;
    console.log("TargetView (3D): Animating shot landing", shotData);

    // Use the trajectory end point for landing position
    if (!shotData.trajectory || shotData.trajectory.length === 0) {
        console.warn("TargetView: No trajectory data for landing marker.");
        return;
    }
    const landingPos = shotData.trajectory[shotData.trajectory.length - 1]; // Last point {x, y, z} in meters

    // Create a simple sphere marker
    const markerGeometry = new THREE.SphereGeometry(0.3, 16, 8); // Radius 0.3m
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); // White
    const landingMarker = new THREE.Mesh(markerGeometry, markerMaterial);

    // Position the marker at the landing spot
    // Ensure y is slightly above ground to avoid z-fighting
    landingMarker.position.set(landingPos.x, Math.max(0.15, landingPos.y), landingPos.z);
    landingMarker.visible = true; // Ensure it's visible

    //Drop displaying landing marker for now
    //scene.add(landingMarker);
    //landingMarkers.push(landingMarker); // Keep track to remove later

    //console.log(`TargetView (3D): Added landing marker at (${landingPos.x.toFixed(1)}, ${landingPos.y.toFixed(1)}, ${landingPos.z.toFixed(1)})`);

    // TODO: Add actual animation later if desired (e.g., marker fades in/out)
}

export function resetView() {
    // Remove previous landing markers
    landingMarkers.forEach(marker => {
        marker.visible = false; // Hide first
        scene.remove(marker);
        // Optionally dispose geometry/material here if creating many markers
        // marker.geometry.dispose();
        // marker.material.dispose();
    });
    landingMarkers.length = 0; // Clear the array

    // Ensure target elements are visible if the mode is active
    if (targetGroup) {
        targetGroup.visible = true;
        // Redraw or update position if needed based on current targetDistance
        drawTargetView();
    }

    console.log("TargetView (3D): Reset complete (landing markers removed).");
}

// Duplicate setScene removed. The correct one is defined near the top.

// --- Getters for External Use (e.g., Camera Control) ---

// Returns the center position of the green mesh
export function getGreenCenter() {
    return greenMesh ? greenMesh.position.clone() : null; // Return a clone to prevent external modification
}

// Returns the radius of the green in meters
export function getGreenRadius() {
    // Assuming greenGeometry is CircleGeometry and radius is stored
    return greenMesh?.geometry?.parameters?.radius || null;
}
