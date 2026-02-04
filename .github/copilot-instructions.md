# Slack Ticketing Bot - Copilot Instructions

## Project Overview
This is a Slack bot that manages a sophisticated ticketing system with automatic resolution, grace periods, and queue management for help requests.

## Architecture

### Core Files
- **`src/main.ts`**: Application entry point
  - Initializes Slack Bolt app with socket mode
  - Sets up periodic tasks (timer checks, data saves, member refresh)
  - `handleStartup()`: Handles startup and initialization sequence

- **`src/rateLimiter.ts`**: Slack API Rate Limiter
  - Manages per-endpoint rate limits
  - Implements priority queue (High, Normal, Low)
  - Prioritizes interactive tasks (resolve, welcome) over background tasks

- **`src/slack.ts`**: Slack event handlers
  - Handles message events (ticket creation, thread replies)
  - Processes button clicks and reactions
  - Posts daily leaderboard

- **`src/tickets.ts`**: Core ticket management logic
  - `createTicket()`: Creates new tickets from help channel messages
  - `handleStaffResponse()`: Processes help staff replies (adds to responders, manages timers)
  - `handleUserResponse()`: Processes regular user replies
  - `resolveTicket()`: Marks tickets as resolved (adds reaction, posts closure message if staff resolves or was last responder)
  - `unresolveTicket()`: Reverses resolution (removes reaction, deletes closure message)
  - `updateQueueMessage()`: Manages the pinned queue message in tickets channel (updates in place by default, can force repost)
  - `cleanupOldBotMessages()`: Searches for and deletes old bot messages in the tickets channel
  - `checkGraceTimers()`: Background job that checks expired timers

- **`src/startupRecovery.ts`**: Startup recovery and missed message handling
  - `scanForMissedMessages()`: Scans help channel for messages posted while bot was offline
  - `initializeQueueOnStartup()`: Initializes the queue message with current tickets
  - `performStartupRecovery()`: Verifies thread statuses and synchronizes ticket state
  - `getRecoveryStats()`: Returns statistics about tickets for monitoring

- **`src/data.ts`**: Data structures and persistence
  - `TicketInfo`: Main ticket data structure
  - In-memory storage with PostgreSQL persistence
  - Manages help staff member cache (`ticketChannelMembers`)
  - Leaderboard tracking
  - Tracks last processed message timestamp for recovery
  - Helper functions for data access
  - `initDB()`: Initializes PostgreSQL tables

- **`src/utils.ts`**: Utility functions
  - Message formatting functions
  - URL generation helpers
  - Block Kit builders

- **`src/constants.ts`**: Configuration constants
  - All timers and intervals
  - Message templates and text
  - Configurable behavior settings

## Data Model

### TicketInfo Interface
```typescript
{
  originalChannel: string;      // Help channel ID
  originalTs: string;           // Original message timestamp
  ticketMessageTs: string;      // Welcome message timestamp
  responders: string[];         // Help staff who responded
  resolved: boolean;            // Resolution state
  graceTimerExpiry: number | null;  // When grace period ends (ms timestamp)
  forceOpen: boolean;          // If !open command was used
  lastResponderId: string | null;   // Last person to reply
  inQueue: boolean;            // Currently needs help
  closureMessageTs?: string;   // Bot's closure message timestamp
  lastResolvedTs?: number;     // Timestamp of last manual resolution (transient, for 10s un-resolve buffer)
}
```

## Key Features & Logic

### 1. Ticket Creation
- Triggered when new message posted in HELP_CHANNEL (not thread reply)
- Posts welcome message with "Resolve" button in thread
- Adds to queue automatically (no individual tracking message)
- Updates the pinned queue message
- Stores ticket in memory and persists to disk

### 2. Help Staff Response Logic
- When help staff replies in thread:
  - Add to `responders` list if first time
  - Remove from queue on first response
  - Update `lastResponderId` to this staff member
  - Reset grace timer to 10 minutes (unless `!open` command used)
  - If ticket was resolved, un-resolve it
  - Update queue message

### 3. User Response Logic  
- When non-staff user replies:
  - Set `lastResponderId` to null
  - Grace timer continues (doesn't reset)
  - If ticket was resolved, un-resolve it

### 4. Grace Timer System
- `checkGraceTimers()` runs every minute
- For each ticket with expired timer:
  - If staff is last responder → auto-resolve
  - If user is last responder → re-add to queue
- Timer disabled if `!open` command present in staff message

### 5. Resolution System
- Can be triggered by:
  - "Resolve" button in welcome message
  - Automatic (grace timer expiry with staff as last responder)
- Resolution actions:
  - Set `resolved` = true
  - Add white checkmark reaction
  - Post closure message if staff resolves or was last responder
  - Remove from queue
  - Update leaderboard

### 6. Un-Resolution System
- Triggered when anyone replies to resolved ticket
- **Grace Buffer**: If reply is within 10 seconds of manual resolution, un-resolution is skipped (prevents race conditions)
- Actions:
  - Set `resolved` = false
  - Remove white checkmark reaction
  - Delete closure message if exists
  - Timer system resumes based on who replied

### 7. Queue Management
- Pinned message(s) in TICKETS_CHANNEL supporting multi-part messages for large queues
- **Multi-part Queue Handling**:
  - When queue exceeds ~3800 characters, automatically splits across multiple messages (up to 2 parts)
  - Both parts are pinned to the channel
  - Header appears on each part, with continuation part labeled "(continued)"
  - All old queue messages are cleaned up on startup
- Updates whenever queue changes
- Shows format:
  - "Not claimed - View Thread" (no responders)
  - "Claimed by: @user1, @user2 - View Thread" (has responders)
- Created/updated via `updateQueueMessage()` in `src/tickets.ts`
- Uses `splitQueueMessage()` in `src/utils.ts` to handle message splitting
- Updates in place by default, can force repost to keep at bottom when users message in channel
- Queue message timestamps stored in array (`queueMessageTs: string[]`) in database

### 8. Startup Recovery
- **Missed Message Scanning**: On startup, scans help channel for messages posted while bot was offline
  - Uses `lastProcessedMessageTs` to track most recent processed message
  - Creates tickets for any missed messages (up to 100 messages)
  - Filters out thread replies, edited messages, and messages that already have tickets
  - Runs before thread status verification
- **Thread Status Verification**: Validates existing unresolved tickets
  - Checks if original messages still exist
  - Marks tickets as resolved if thread was deleted
  - Verifies thread activity
  - Uses rate-limited API calls to avoid overwhelming Slack
- **Queue Initialization**: Updates queue message with current ticket state

### 9. Cleanup System
- Searches `TICKETS_CHANNEL` for messages sent by the bot
- Deletes any bot message that is NOT in the current `queueMessageTs` array
- Runs on startup
- Ensures the channel stays clean of old leaderboard posts or duplicate queue messages
- Handles both single and multi-part queue messages correctly

## Leaderboard & History Tracking

### Daily Leaderboard
- Posted every 24 hours to `TICKETS_CHANNEL`
- Shows top resolvers for the day
- Resets after posting
- **Leaderboard History**: 
  - All past leaderboard data is now persisted to `leaderboard_history` table
  - Each day's leaderboard is saved with the date before resetting
  - Historical data can be queried for analytics and trends
  - Leaderboard persists across bot restarts

## Environment Variables
```
HELP_CHANNEL=C0123456789           # Where users post questions
TICKETS_CHANNEL=C9876543210        # Internal help staff channel
SLACK_BOT_TOKEN=xoxb-...           # Bot OAuth token
SLACK_APP_TOKEN=xapp-...           # App-level token (socket mode)
SLACK_WORKSPACE_DOMAIN=yourworkspace # For building thread URLs
DATABASE_URL=postgres://...        # PostgreSQL connection string
WELCOME_MESSAGE_TEXT="..."         # (Optional) Custom welcome message
TICKET_RESOLVED_MESSAGE="..."      # (Optional) Custom resolution message
```

## Periodic Tasks
- **Grace timer checks**: Every 1 minute
- **Data persistence**: Every 5 minutes (backup to PostgreSQL)
- **Member cache refresh**: Every 1 hour
- **Daily leaderboard**: Every 24 hours

## Special Commands
- **!open**: Include in help staff message to prevent auto-resolution and disable grace timer

## Permission Requirements
The bot needs these Slack permissions (see manifest.yaml):
- `channels:history` - Read messages
- `channels:read` - Access channel info
- `chat:write` - Post messages
- `reactions:write` - Add/remove reactions
- `reactions:read` - Read reactions
- `pins:write` - Pin queue message
- `users:read` - Get user info
- Event subscriptions for messages and reactions

## Data Persistence
- Primary storage: PostgreSQL database
- Saves on:
  - Every ticket state change
  - Every 5 minutes (automatic backup)
  - Queue updates (both single and multi-part messages)
  - Daily leaderboard (saved to history table before reset)
- Loads on startup to restore state
- **Queue Messages**: Stored as JSON array to support 1-2 part messages
- **Leaderboard History**: Persisted to separate table with date keys for historical tracking

## Testing Considerations
- Test with actual Slack workspace
- Verify both channels exist and bot is member
- Check permissions in manifest match actual bot
- Test all resolution paths (button, reaction, auto)
- Verify timer logic with different scenarios
- Test !open command behavior
- Confirm queue updates correctly

## Common Modifications

### Changing Grace Period
Edit `GRACE_PERIOD_MS` in `src/constants.ts`:
```typescript
export const GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes
```

### Changing Any Timer or Interval
All timing values are in `src/constants.ts`:
- `TIMER_CHECK_INTERVAL_MS` - How often timers are checked
- `AUTO_SAVE_INTERVAL_MS` - Backup save frequency
- `MEMBER_REFRESH_INTERVAL_MS` - Help staff list refresh rate
- `LEADERBOARD_POST_INTERVAL_MS` - Daily leaderboard frequency
- `CLEANUP_INTERVAL_MS` - Old message cleanup frequency

### Customizing Messages
Edit message templates in `src/constants.ts` or set them in `.env`:
- `WELCOME_MESSAGE_TEXT` - Initial message to users
- `TICKET_RESOLVED_MESSAGE` - Closure message
- `QUEUE_MESSAGE_HEADER` - Queue header text
- `UNCLAIMED_TEXT` / `CLAIMED_TEXT_FORMAT` - Status labels

### Changing Welcome Emoji
Edit `WELCOME_EMOJI` in `src/constants.ts`:
```typescript
export const WELCOME_EMOJI = ':wave:'; // or any Slack emoji
```

### Adding New Resolution Methods
1. Add action handler in `src/slack.ts`
2. Call `resolveTicket()` from `src/tickets.ts`
3. Ensure proper permission checks

### Modifying Queue Format
Edit `createQueueMessageText()` in `src/utils.ts`

### Adding Ticket Fields
1. Update `TicketInfo` interface in `src/data.ts`
2. Update save/load logic if needed
3. Adjust ticket creation logic in `src/tickets.ts`

## Code Style Notes
- All functions have JSDoc comments explaining purpose
- Comprehensive error logging with descriptive messages
- Uses async/await for all Slack API calls
- TypeScript strict mode enabled
- Proper error handling with try/catch blocks
- Data saved after every state change for consistency

## Known Limitations
- Grace timer resolution is 1 minute (check interval)
- Queue message limited to ~3800 characters per part (splits to 2 messages max for Slack 4000 char limit)
- Relies on in-memory state + periodic PostgreSQL saves
- Single instance only (no multi-bot coordination)
