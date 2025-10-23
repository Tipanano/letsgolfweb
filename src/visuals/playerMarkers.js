// Player marker balls for CTF mode - shows where each player's ball landed
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js';

const MARKER_RADIUS = 0.5; // Larger than real ball (0.021m)
const MARKER_HEIGHT_OFFSET = 0.2; // Slightly above ground
const LABEL_HEIGHT = 2; // Height of label above marker

let scene = null;
const playerMarkers = new Map(); // playerId -> { mesh, label, position }

/**
 * Initialize marker system
 */
export function initMarkers(sceneRef) {
    scene = sceneRef;
}

/**
 * Create a text sprite for player label
 */
function createTextSprite(playerName, distance, color) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 256;

    // Background
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 15);
    context.fill();

    // Border with player color
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.roundRect(10, 10, canvas.width - 20, canvas.height - 20, 15);
    context.stroke();

    // Player name
    context.fillStyle = '#FFFFFF';
    context.font = 'bold 48px Arial';
    context.textAlign = 'center';
    context.fillText(playerName, canvas.width / 2, 80);

    // Distance
    context.font = '36px Arial';
    context.fillStyle = color;
    context.fillText(distance, canvas.width / 2, 140);

    // Create sprite
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(4, 2, 1);

    return sprite;
}

/**
 * Add or update a player marker
 */
export function setPlayerMarker(playerId, playerName, position, distanceYards, color) {
    if (!scene) {
        console.error('Marker system not initialized');
        return;
    }

    // Remove existing marker if any
    removePlayerMarker(playerId);

    // Create marker ball (semi-transparent sphere with player color)
    const geometry = new THREE.SphereGeometry(MARKER_RADIUS, 32, 32);
    const material = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.7,
        metalness: 0.3,
        roughness: 0.4
    });
    const markerMesh = new THREE.Mesh(geometry, material);
    markerMesh.position.set(
        position.x,
        position.y + MARKER_HEIGHT_OFFSET,
        position.z
    );
    markerMesh.castShadow = true;

    // Create label sprite
    const distanceText = `${distanceYards.toFixed(1)} yards`;
    const labelSprite = createTextSprite(playerName, distanceText, color);
    labelSprite.position.set(
        position.x,
        position.y + LABEL_HEIGHT,
        position.z
    );

    // Add to scene
    scene.add(markerMesh);
    scene.add(labelSprite);

    // Store reference
    playerMarkers.set(playerId, {
        mesh: markerMesh,
        label: labelSprite,
        position: { ...position },
        color: color
    });

}

/**
 * Remove a player's marker
 */
export function removePlayerMarker(playerId) {
    const marker = playerMarkers.get(playerId);
    if (marker && scene) {
        scene.remove(marker.mesh);
        scene.remove(marker.label);
        marker.mesh.geometry.dispose();
        marker.mesh.material.dispose();
        marker.label.material.map.dispose();
        marker.label.material.dispose();
        playerMarkers.delete(playerId);
    }
}

/**
 * Clear all markers (e.g., when starting new game)
 */
export function clearAllMarkers() {
    playerMarkers.forEach((_, playerId) => {
        removePlayerMarker(playerId);
    });
}

/**
 * Get marker position for camera targeting
 */
export function getMarkerPosition(playerId) {
    const marker = playerMarkers.get(playerId);
    return marker ? marker.position : null;
}

/**
 * Get all markers
 */
export function getAllMarkers() {
    return Array.from(playerMarkers.entries()).map(([playerId, marker]) => ({
        playerId,
        position: marker.position,
        color: marker.color
    }));
}
