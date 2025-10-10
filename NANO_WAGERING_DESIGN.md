# Nano Wagering System Design

## Overview
Players can wager Nano cryptocurrency on multiplayer golf games. The system uses a **custodial escrow** approach where funds are temporarily held during games and automatically distributed to winners.

## Core Principles
- **Non-custodial user wallets**: Players use their own Nano wallets (Nault, Natrium, etc.)
- **Temporary escrow**: Server holds funds only during active games
- **Automatic payouts**: Winners receive funds automatically when game ends
- **Transparent**: All transactions verifiable on Nano blockchain
- **Fair dispute resolution**: Bugs/issues result in even distribution of escrowed funds

---

## User Types

### Guest User (No Account)
- Auto-generated username ("Guest_12345")
- Can play single-player modes
- Can play free multiplayer (no wagering)
- Stats stored in localStorage only
- **Cannot wager**

### Registered User (With Nano Address)
- Provides their own Nano address from existing wallet
- Username secured (unique, stored in database)
- Firebase auth for session management
- Can participate in wager games
- Stats and history stored on server
- Leaderboard eligible

---

## Authentication Flow

**Inspired by Subnano's passwordless login method** ([Read more](https://subnano.me/@noom/how-we-built-passwordless-login-using-nano))

We use a **challenge-response authentication** system where users prove ownership of their Nano address by sending a microtransaction to a unique, ephemeral address.

### Registration
1. User enters desired username
2. User clicks "Register with Nano"
3. **Server generates ephemeral login address**:
   - Derives unique address from master seed + deterministic index
   - Includes secure random login secret
   - Address expires after 5 minutes
   - Each address used exactly once (prevents replay attacks)
4. **QR code displayed** with the ephemeral address and suggested amount (0.000001 NANO)
5. User scans QR code with Nano wallet (Natrium, Nault, etc.)
6. User sends payment from their personal Nano address
7. **Server monitors via WebSocket** for incoming transaction
8. When confirmed (2-3 seconds):
   - Records user's sending address as their identity
   - Creates account linked to that Nano address
   - **Automatically refunds** the full amount to user's address
   - **Generates JWT session token** (signed with server secret)
9. User authenticated and logged in

### Login/Sign In
1. User enters username OR clicks "Login with Nano"
2. **Server generates new ephemeral login address** (same process as registration)
3. QR code displayed
4. User sends payment from their **verified Nano address**
5. Server confirms sender matches stored address for that username
6. **Automatically refunds** the payment
7. **User logged in via JWT session token**

### Technical Implementation Details

**Ephemeral Address Generation:**
```javascript
// Deterministic address derivation
const loginSecret = generateSecureRandom(); // Unique per login attempt
const index = hashLoginSecret(loginSecret); // Deterministic index from secret
const address = deriveAddress(masterSeed, index);

// Store in cache with expiration
cache.set(address, {
  loginSecret,
  username: null, // null for registration, populated for login
  expiresAt: Date.now() + 300000, // 5 minutes
  status: 'pending'
});
```

**Transaction Monitoring:**
```javascript
// WebSocket connection to Nano node
ws.on('confirmation', (block) => {
  const loginAttempt = cache.get(block.account); // Check if sent to our ephemeral address

  if (loginAttempt && loginAttempt.status === 'pending') {
    // Verify sender
    const senderAddress = block.link_as_account;

    // For registration: new user
    if (!loginAttempt.username) {
      createUser(senderAddress);
    } else {
      // For login: verify sender matches stored address
      verifyUserAddress(loginAttempt.username, senderAddress);
    }

    // Immediately refund
    refundPayment(senderAddress, block.amount);

    // Generate JWT session token
    const sessionToken = generateJWT(senderAddress, loginAttempt.username);
  }
});
```

**JWT Token Generation:**
```javascript
const jwt = require('jsonwebtoken');

function generateJWT(nanoAddress, username) {
  const payload = {
    nano_address: nanoAddress,
    username: username,
    issued_at: Date.now()
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '7d' // 7 day session
  });
}

function verifyJWT(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null; // Invalid or expired
  }
}
```

**Automatic Refund:**
```javascript
async function refundPayment(userAddress, amount) {
  // Send from ephemeral address back to user
  await nanoRPC.send({
    source: ephemeralAddress,
    destination: userAddress,
    amount: amount // Full refund
  });
}
```

### Benefits of This Approach
- ✅ **Cryptographically secure**: Transaction signature proves ownership
- ✅ **Passwordless**: No passwords to remember, store, or leak
- ✅ **Fast**: 2-3 seconds average authentication time
- ✅ **Privacy-preserving**: No personal information required
- ✅ **Free for users**: Full refund makes it cost-free
- ✅ **Cross-device**: Scan QR code from any device
- ✅ **Replay attack prevention**: Each address used exactly once
- ✅ **No phishing risk**: Users send to address they verify
- ✅ **More secure than passwords**: Cryptographic proof vs shared secret

### Security Considerations
- Ephemeral addresses expire after 5 minutes
- Each address derived deterministically but used only once
- WebSocket connection secured via TLS
- Login secrets use cryptographically secure randomness
- All transactions verified on Nano blockchain
- No private keys ever transmitted or stored by server

---

## Wager Game Flow

### 1. Creating a Wager Game
```
Player A (Host):
├── Clicks "Create Wager Game"
├── Selects game mode (CTF, Play Hole, etc.)
├── Sets wager amount (e.g., 0.5 NANO)
├── Sets max players (2-4)
└── Creates lobby with room code
```

### 2. Server Creates Escrow
```
Server:
├── Generates unique game ID (UUID)
├── Creates dedicated escrow Nano account for this game
├── Stores escrow seed (encrypted) in database
├── Returns escrow address to clients
└── Game status: "WAITING_FOR_DEPOSITS"
```

### 3. Players Deposit to Escrow
```
Each Player:
├── Shown escrow address: nano_escrow_abc123
├── Shown required amount: 0.5 NANO
├── Sends from their wallet to escrow address
└── Server monitors blockchain for deposit

Server (for each deposit):
├── Detects incoming transaction via RPC
├── Verifies amount matches wager
├── Verifies sender is registered player in game
├── Waits for confirmation (recommended: 1 confirmation)
├── Marks player as "DEPOSITED"
└── Updates game status when all players deposited
```

### 4. Game Start
```
When all deposits confirmed:
├── Game status: "ACTIVE"
├── Escrow locked (no withdrawals possible)
├── Players can now play the game
└── Turn-based gameplay begins
```

### 5. Game Completion
```
Server determines winner(s):
├── CTF: Closest to flag wins
├── Play Hole: Lowest score wins
├── Ties: Split pot evenly
└── Game status: "COMPLETED"
```

### 6. Automatic Payout
```
Server:
├── Calculates payout amounts
│   ├── Winner: (total pot) - (house fee)
│   ├── House fee: total pot * HOUSE_FEE_PERCENT
│   └── Example: 1 NANO pot, 10% fee = 0.9 NANO to winner
├── Signs transaction from escrow to winner's address
├── Broadcasts to network via RPC
├── Waits for confirmation
├── Updates player balances in database
├── Records transaction in history
└── Game status: "PAID_OUT"
```

---

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  uid VARCHAR(255) PRIMARY KEY,           -- Firebase UID
  username VARCHAR(50) UNIQUE NOT NULL,   -- Unique username
  nano_address VARCHAR(65) UNIQUE NOT NULL, -- User's Nano address
  verification_amount VARCHAR(39),        -- Last verification amount sent
  verification_status ENUM('pending', 'verified') DEFAULT 'pending',
  total_wagered BIGINT DEFAULT 0,         -- Total NANO wagered (in raw)
  total_won BIGINT DEFAULT 0,             -- Total NANO won (in raw)
  games_played INT DEFAULT 0,
  games_won INT DEFAULT 0,
  reputation_score INT DEFAULT 100,       -- For future anti-cheat
  created_at TIMESTAMP DEFAULT NOW(),
  last_login TIMESTAMP
);
```

### Wager Games Table
```sql
CREATE TABLE wager_games (
  game_id VARCHAR(36) PRIMARY KEY,        -- UUID
  game_mode ENUM('ctf', 'play-hole') NOT NULL,
  wager_amount_raw VARCHAR(39) NOT NULL,  -- Wager in Nano raw
  max_players INT NOT NULL,               -- 2-4 players
  escrow_address VARCHAR(65) NOT NULL,    -- Escrow Nano address
  escrow_seed_encrypted TEXT NOT NULL,    -- Encrypted seed for escrow
  house_fee_percent DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  status ENUM(
    'created',
    'waiting_deposits',
    'active',
    'completed',
    'paid_out',
    'cancelled',
    'disputed'
  ) DEFAULT 'created',
  winner_uid VARCHAR(255),                -- NULL if tie or game ongoing
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  paid_out_at TIMESTAMP
);
```

### Game Players Table
```sql
CREATE TABLE game_players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_id VARCHAR(36) NOT NULL,
  user_uid VARCHAR(255) NOT NULL,
  is_host BOOLEAN DEFAULT FALSE,
  deposit_status ENUM('pending', 'confirmed') DEFAULT 'pending',
  deposit_hash VARCHAR(64),               -- Nano block hash of deposit
  deposited_at TIMESTAMP,
  final_score DECIMAL(10,2),              -- Game-specific score
  distance_from_hole DECIMAL(10,2),       -- For CTF mode
  placement INT,                          -- 1st, 2nd, 3rd, 4th
  payout_amount_raw VARCHAR(39),          -- Amount won (in raw)
  payout_hash VARCHAR(64),                -- Nano block hash of payout

  FOREIGN KEY (game_id) REFERENCES wager_games(game_id),
  FOREIGN KEY (user_uid) REFERENCES users(uid),
  UNIQUE KEY unique_game_player (game_id, user_uid)
);
```

### Nano Transactions Table
```sql
CREATE TABLE nano_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_uid VARCHAR(255) NOT NULL,
  transaction_type ENUM(
    'verification_in',
    'verification_out',
    'wager_deposit',
    'wager_payout',
    'house_fee'
  ) NOT NULL,
  amount_raw VARCHAR(39) NOT NULL,
  nano_hash VARCHAR(64) UNIQUE,           -- Blockchain hash
  from_address VARCHAR(65),
  to_address VARCHAR(65),
  game_id VARCHAR(36),                    -- NULL for verifications
  status ENUM('pending', 'confirmed', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP,

  FOREIGN KEY (user_uid) REFERENCES users(uid),
  FOREIGN KEY (game_id) REFERENCES wager_games(game_id),
  INDEX idx_nano_hash (nano_hash),
  INDEX idx_user_transactions (user_uid, created_at)
);
```

---

## Configuration Variables

### Server Environment Variables
```bash
# Nano RPC Node
NANO_RPC_URL=https://rpc.nano.to
NANO_WORK_SERVER_URL=https://work.nano.to  # For PoW generation

# House Settings
HOUSE_FEE_PERCENT=10.0                      # 10% house fee
HOUSE_WALLET_ADDRESS=nano_house_address     # Where fees go

# Verification Settings
VERIFICATION_MIN_AMOUNT=0.000001            # Minimum verification amount
VERIFICATION_MAX_AMOUNT=0.000100            # Maximum verification amount
VERIFICATION_TIMEOUT_SECONDS=300            # 5 minutes to send verification

# Game Settings
MIN_WAGER_AMOUNT=0.001                      # Minimum wager (0.001 NANO)
MAX_WAGER_AMOUNT=100.0                      # Maximum wager (100 NANO)
DEPOSIT_CONFIRMATIONS_REQUIRED=1            # Blocks to wait
DEPOSIT_TIMEOUT_MINUTES=10                  # Time to deposit before cancel

# Security
MAX_GAMES_PER_USER_ACTIVE=5                 # Prevent spam
RATE_LIMIT_WAGER_GAMES_PER_HOUR=10         # Rate limiting
```

---

## Nano RPC Integration

### Key Operations

#### 1. Generate Escrow Account
```javascript
// Generate new seed for escrow
const seed = generateSeed(); // 64 hex chars
const privateKey = derivePrivateKey(seed, index: 0);
const publicKey = derivePublicKey(privateKey);
const address = deriveAddress(publicKey);

// Store encrypted in database
const encrypted = encrypt(seed, ESCROW_ENCRYPTION_KEY);
```

#### 2. Monitor Incoming Deposits
```javascript
// Use RPC: account_history or confirmation_history
POST /api/rpc
{
  "action": "account_history",
  "account": escrow_address,
  "count": 10
}

// Or use WebSocket subscriptions for real-time
```

#### 3. Send Payout
```javascript
// Sign and broadcast send block
POST /api/rpc
{
  "action": "send",
  "wallet": escrow_wallet_id,
  "source": escrow_address,
  "destination": winner_address,
  "amount": payout_amount_raw
}
```

#### 4. Auto-Return Verification Amount
```javascript
// Same as payout, but to original sender
// Called immediately after verification deposit confirmed
```

---

## Multi-Player Support (2-4 Players)

### Payout Distribution

#### 2 Players (Head to Head)
```
Winner: 100% - house_fee
Loser: 0%
```

#### 3 Players
```
1st Place: 60% - house_fee
2nd Place: 40% - house_fee
3rd Place: 0%
```

#### 4 Players (Tournament Style)
```
1st Place: 50% - house_fee
2nd Place: 30% - house_fee
3rd Place: 20% - house_fee
4th Place: 0%
```

#### Ties
```
If 2-way tie for 1st:
  Each gets 50% - (house_fee / 2)

If 3-way tie for 1st:
  Each gets 33.33% - (house_fee / 3)

Etc.
```

### Game Modes Per Player Count
- **CTF**: 2-4 players (everyone shoots once, closest wins)
- **Play Hole**: 2-4 players (stroke play, lowest score wins)
- **Future**: Match play, team modes, etc.

---

## Error Handling & Dispute Resolution

### Automatic Refund Scenarios

1. **Server Bug During Game**
   - Status: "DISPUTED"
   - Action: Distribute escrow evenly to all players
   - Log incident for review

2. **Player Disconnect During Active Game**
   - Grace period: 5 minutes to reconnect
   - If not returned: Other players can vote to cancel or continue
   - Refund or continue based on vote

3. **Deposit Timeout**
   - If not all players deposit within DEPOSIT_TIMEOUT_MINUTES
   - Status: "CANCELLED"
   - Refund any players who already deposited

4. **Network Issues (Nano Node Down)**
   - Queue payouts
   - Retry when node back online
   - Manual admin intervention if needed

### Manual Dispute Process
1. Player reports issue via support
2. Admin reviews game logs, blockchain transactions
3. Admin can manually trigger refunds/payouts
4. All actions logged in audit trail

---

## Security Considerations

### Escrow Seed Protection
- Seeds encrypted at rest using AES-256
- Encryption key stored in secure environment variable
- Seeds never logged or exposed via API
- Separate encryption key per environment (dev/prod)

### Anti-Fraud Measures
- Max active games per user (prevent multi-accounting abuse)
- Rate limiting on game creation
- Monitor for collusion (same IPs playing repeatedly)
- Reputation system (future)
- Require minimum account age for wagering (future)

### Blockchain Verification
- All deposits verified on-chain (not just RPC response)
- Wait for confirmations before game start
- Store transaction hashes for audit trail
- Periodically verify escrow balances match database

---

## API Endpoints (New)

### Authentication (Passwordless via Nano)

```
POST /api/auth/register/start
  Body: { username }
  Response: {
    login_secret: "abc123...",       // Unique login attempt ID
    ephemeral_address: "nano_xyz...", // Send payment here
    qr_code_data: "nano:nano_xyz?amount=0.000001",
    suggested_amount: "0.000001",     // In NANO
    expires_in: 300                   // Seconds (5 minutes)
  }

GET /api/auth/register/status/:login_secret
  Response: {
    status: "pending" | "confirmed" | "expired",
    nano_address: "nano_abc...",      // User's address (when confirmed)
    session_token: "eyJhbGc...",      // JWT token (when confirmed)
    refund_hash: "..."                // Blockchain hash of refund (when confirmed)
  }

POST /api/auth/login/start
  Body: { username }
  Response: {
    login_secret: "def456...",
    ephemeral_address: "nano_xyz...",
    qr_code_data: "nano:nano_xyz?amount=0.000001",
    suggested_amount: "0.000001",
    expires_in: 300
  }

GET /api/auth/login/status/:login_secret
  Response: {
    status: "pending" | "confirmed" | "expired" | "invalid_sender",
    nano_address: "nano_abc...",
    session_token: "eyJhbGc...",      // JWT token
    refund_hash: "..."
  }
```

**Frontend Flow:**
1. Call `/api/auth/register/start` with username
2. Display QR code from `qr_code_data`
3. Poll `/api/auth/register/status/:login_secret` every 1-2 seconds
4. When status = "confirmed", store `session_token` and `nano_address` in localStorage
5. User is now logged in!

**Auth Middleware for Protected Routes:**
```javascript
// Server-side middleware
function authenticateJWT(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const decoded = verifyJWT(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded; // { nano_address, username, issued_at }
  next();
}

// Usage
app.post('/api/wager/create', authenticateJWT, (req, res) => {
  // req.user.nano_address is available
  // req.user.username is available
});
```

### Wager Games
```
POST /api/wager/create
  Headers: Authorization: Bearer <firebase_token>
  Body: {
    game_mode,
    wager_amount,
    max_players
  }
  Response: {
    game_id,
    escrow_address,
    room_code,
    deposit_deadline
  }

POST /api/wager/join
  Headers: Authorization: Bearer <firebase_token>
  Body: { room_code }
  Response: {
    game_id,
    escrow_address,
    wager_amount,
    deposit_deadline
  }

GET /api/wager/:gameId/status
  Response: {
    status,
    players: [{ username, deposit_status }],
    escrow_balance
  }

POST /api/wager/:gameId/cancel
  Headers: Authorization: Bearer <firebase_token>
  Response: { success, refund_hashes }
```

### User Stats
```
GET /api/user/:username/stats
  Response: {
    games_played,
    games_won,
    total_wagered,
    total_won,
    win_rate,
    recent_games: []
  }
```

---

## Future Enhancements

### Phase 2
- **Withdrawals**: Allow users to cash out winnings to external wallet
- **Deposits**: Let users keep a balance on server for faster wagering
- **Leaderboards**: Top wagerers, biggest wins, win rates
- **Achievements**: Badges for milestones
- **Social**: Friend lists, private lobbies

### Phase 3
- **Team games**: 2v2 wagering
- **Tournaments**: Multi-round brackets with prize pools
- **Handicap system**: Level playing field for different skill levels
- **Spectator mode**: Watch wager games live
- **Replay system**: Review past games

### Phase 4
- **NFT integration**: Nano-based NFTs as prizes/collectibles
- **Sponsorships**: Branded tournaments with larger prize pools
- **Mobile apps**: Native iOS/Android with better wallet integration

---

## Development Phases

### Phase 1: Foundation (Current)
- [ ] User registration with Nano address verification
- [ ] Firebase auth integration
- [ ] Database schema implementation
- [ ] Basic escrow account generation

### Phase 2: Core Wagering
- [ ] Escrow deposit monitoring
- [ ] Automatic verification refunds
- [ ] Game start when all deposited
- [ ] Winner determination
- [ ] Automatic payouts

### Phase 3: Multi-Player
- [ ] 3-4 player support
- [ ] Payout distribution logic
- [ ] Tournament brackets

### Phase 4: Polish
- [ ] Dispute resolution UI
- [ ] Admin panel for manual overrides
- [ ] Stats and leaderboards
- [ ] Anti-fraud measures

---

## Testing Checklist

### Test Network
- [ ] Use Nano test network (beta network) for development
- [ ] Get test NANO from faucet
- [ ] Test all flows without real money

### Unit Tests
- [ ] Escrow account generation
- [ ] Payout calculation logic
- [ ] Deposit verification
- [ ] Transaction signing

### Integration Tests
- [ ] Full registration flow
- [ ] Full wager game flow (2 players)
- [ ] Multi-player games (3-4 players)
- [ ] Refund scenarios
- [ ] Timeout handling

### Security Tests
- [ ] Attempt to withdraw from escrow as non-owner
- [ ] Attempt to fake deposits
- [ ] Test encryption/decryption of seeds
- [ ] SQL injection prevention
- [ ] Rate limiting effectiveness

---

## Notes

- House fee percentage is configurable via `HOUSE_FEE_PERCENT` environment variable
- All Nano amounts stored in database as **raw** (smallest unit) to avoid floating point issues
- Verification amounts are automatically returned to prove non-custodial nature
- Escrow accounts are single-use per game for transparency
- System can scale to 4 players per game without major changes
- Future: Could support N players with custom payout structures
