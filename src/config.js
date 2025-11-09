// Server configuration
// Change this based on environment (local development vs production)

// Production server (via Cloudflare)
export const API_BASE_URL = 'https://api.gih.golf/api';
export const WEBSOCKET_URL = 'wss://api.gih.golf';

// Local development (uncomment to use)
// export const API_BASE_URL = 'http://localhost:3001/api';
// export const WEBSOCKET_URL = 'http://localhost:3001';

// Debug mode - set to true to show debug buttons in fullscreen mode
export const DEBUG_MODE = false; // Set to false in production
