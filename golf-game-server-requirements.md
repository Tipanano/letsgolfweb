# Golf Game Multiplayer Server Requirements

## Overview
This document outlines the server-side implementation needed for the multiplayer golf game. The client expects specific REST API endpoints and WebSocket events for real-time game synchronization.

## Technology Stack
- **Node.js** with Express.js for REST API
- **Socket.io** for WebSocket connections
- **Firebase Admin SDK** for authentication
- **Database**: PostgreSQL or MongoDB for game state persistence
- **Redis** (optional) for session management and caching

## API Endpoints Required

### Authentication
- `POST /api/auth/verify` - Verify Firebase token from client
  - Request: `{ token: string }`
  - Response: `{ userId: string, displayName: string }`

### Game Session Management
- `POST /api/game/create` - Create new game session
  - Request: `{ hostId: string, settings: { maxPlayers: number, courseId: string } }`
  - Response: `{ sessionId: string, roomCode: string }`

- `POST /api/game/join` - Join existing game session
  - Request: `{ roomCode: string, playerId: string }`
  - Response: `{ sessionId: string, players: Player[], gameState: GameState }`

- `GET /api/game/:sessionId` - Get game session details
  - Response: `{ sessionId: string, players: Player[], gameState: GameState, currentHole: number }`

### Course Data
- `GET /api/course/:courseId` - Get course/hole data
  - Response: `{ holes: HoleData[] }`

### Scoring
- `POST /api/game/:sessionId/score` - Submit final score
  - Request: `{ playerId: string, score: number, holeScores: number[] }`
  - Response: `{ success: boolean }`

### Player Stats
- `GET /api/player/:playerId/history` - Get player history
  - Response: `{ gamesPlayed: number, averageScore: number, bestScore: number }`

## WebSocket Events

### Client -> Server Events
- `player:shot` - Player takes a shot
  ```javascript
  {
    playerId: string,
    shotData: {
      startPosition: { x, y, z },
      endPosition: { x, y, z },
      club: string,
      power: number,
      spin: { x, y, z }
    }
  }
  ```

- `player:ready` - Player ready to start
- `chat:message` - Chat message
  ```javascript
  {
    playerId: string,
    message: string,
    timestamp: number
  }
  ```

### Server -> Client Events
- `player:joined` - New player joined
  ```javascript
  {
    player: {
      id: string,
      name: string,
      isHost: boolean
    }
  }
  ```

- `player:left` - Player disconnected
- `game:started` - Game has started
- `game:stateUpdate` - Full game state update
  ```javascript
  {
    players: Player[],
    currentPlayerIndex: number,
    currentHole: number,
    scores: { [playerId]: number }
  }
  ```

- `turn:changed` - Turn changed to next player
  ```javascript
  {
    currentPlayerId: string,
    turnNumber: number
  }
  ```

- `shot:received` - Shot data from another player
- `chat:message` - Chat message broadcast

## Data Models

### Player
```typescript
interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isConnected: boolean;
  position: { x: number, y: number, z: number };
  currentHole: number;
  strokes: number;
  totalScore: number;
}
```

### GameSession
```typescript
interface GameSession {
  id: string;
  roomCode: string; // 6-character code
  hostId: string;
  players: Player[];
  gameState: 'waiting' | 'playing' | 'finished';
  currentHole: number;
  maxPlayers: number;
  courseId: string;
  createdAt: Date;
  startedAt?: Date;
}
```

### GameState
```typescript
interface GameState {
  currentPlayerIndex: number;
  currentHole: number;
  holesCompleted: number;
  playerStates: {
    [playerId: string]: {
      position: { x: number, y: number, z: number };
      strokes: number;
      holeScores: number[];
      isFinished: boolean;
    }
  };
}
```

## Room Code Generation
- Generate 6-character alphanumeric codes (e.g., "ABC123")
- Ensure uniqueness across active sessions
- Codes expire after 24 hours of inactivity

## Connection Management
- Handle reconnections within 5 minutes
- Maintain player state during brief disconnections
- Clean up abandoned sessions after 30 minutes

## Security Considerations
- Validate all Firebase tokens
- Rate limit API endpoints
- Validate shot data to prevent cheating
- Sanitize chat messages
- Ensure players can only modify their own game state

## Development Server URLs
The client expects:
- REST API: `http://localhost:3001/api`
- WebSocket: `ws://localhost:3001`

## Deployment Considerations
- Use environment variables for:
  - Firebase service account credentials
  - Database connection strings
  - JWT secrets
  - CORS origins
- Enable CORS for the game client domain
- Use HTTPS/WSS in production
- Implement health check endpoint

## Error Handling
Return consistent error format:
```json
{
  "error": {
    "code": "ROOM_NOT_FOUND",
    "message": "Game room not found"
  }
}
```

## Testing Recommendations
- Unit tests for room code generation
- Integration tests for game flow
- Load testing for concurrent games
- Latency testing for WebSocket events