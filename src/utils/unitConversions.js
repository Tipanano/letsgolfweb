// Centralized unit conversion utilities for the golf game
// All internal calculations should be done in meters
// Conversions to yards/feet should only happen at display time

// Conversion constants
export const METERS_TO_YARDS = 1.09361;
export const YARDS_TO_METERS = 1 / METERS_TO_YARDS;
export const METERS_TO_FEET = 3.28084;
export const FEET_TO_METERS = 1 / METERS_TO_FEET;

// Conversion functions
export function metersToYards(meters) {
    return meters * METERS_TO_YARDS;
}

export function yardsToMeters(yards) {
    return yards * YARDS_TO_METERS;
}

export function metersToFeet(meters) {
    return meters * METERS_TO_FEET;
}

export function feetToMeters(feet) {
    return feet * FEET_TO_METERS;
}

// Format functions for display
export function formatDistanceYards(meters, decimals = 1) {
    const yards = metersToYards(meters);
    return yards.toFixed(decimals) + ' yd';
}

export function formatDistanceMeters(meters, decimals = 1) {
    return meters.toFixed(decimals) + ' m';
}

// Helper to format distance based on user preference (future feature)
export function formatDistance(meters, unit = 'yards', decimals = 1) {
    switch (unit) {
        case 'meters':
            return formatDistanceMeters(meters, decimals);
        case 'yards':
        default:
            return formatDistanceYards(meters, decimals);
    }
}