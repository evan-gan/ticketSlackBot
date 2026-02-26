import 'dotenv/config';

/**
 * Configuration constants for the ticketing bot.
 * Edit these values to customize bot behavior.
 */

// ============================================
// TIMER CONFIGURATION
// ============================================

/**
 * Grace period duration in milliseconds.
 * After a help staff member replies, the ticket will be re-added to the queue after this period
 * unless !open command is used to force it open.
 * Default: 20 minutes (1,200,000 ms)
 */
export const GRACE_PERIOD_MS = 20 * 60 * 1000;


/**
 * How often to check grace timers in milliseconds.
 * Lower values = more responsive but more CPU usage.
 * Default: 30 seconds (30,000 ms)
 */
export const TIMER_CHECK_INTERVAL_MS = 30 * 1000;

// ============================================
// DATA PERSISTENCE
// ============================================

/**
 * How often to automatically save ticket data as a backup in milliseconds.
 * Data is also saved on every ticket state change.
 * Default: 5 minutes (300,000 ms)
 */
export const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;

// ============================================
// SLACK INTEGRATION
// ============================================

/**
 * How often to refresh the ticket channel members cache in milliseconds.
 * This determines who is considered "help staff".
 * Default: 1 hour (3,600,000 ms)
 */
export const MEMBER_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How often to post the daily leaderboard in milliseconds.
 * Default: 24 hours (86,400,000 ms)
 */
export const LEADERBOARD_POST_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ============================================
// MESSAGES & UI
// ============================================

/**
 * Welcome message text shown to users when they create a ticket.
 */
export const WELCOME_MESSAGE_TEXT = process.env.WELCOME_MESSAGE_TEXT || ':wave-pikachu-2: Thank you for creating a ticket. Someone will help you soon. Make sure to read the FAQ pinned to this channel!';

/**
 * The button text for the resolve button.
 */
export const RESOLVE_BUTTON_TEXT = 'Resolve';

/**
 * Message shown when a ticket is resolved.
 * Use {HELP_CHANNEL} placeholder for the help channel mention.
 */
export const TICKET_RESOLVED_MESSAGE = process.env.TICKET_RESOLVED_MESSAGE || 'This ticket has been marked as resolved. Feel free to send a new message to this thread to un-resolve it and ask further questions. If you have a new question, please post it in {HELP_CHANNEL} instead of replying here.';

/**
 * Message shown in queue when all tickets are handled.
 */
export const ALL_TICKETS_RESOLVED_MESSAGE = '✅ *All tickets have been responded to!*';

/**
 * Header for the queue message.
 */
export const QUEUE_MESSAGE_HEADER = '🎫 *Tickets Needing Response:*';

/**
 * Text shown for unclaimed tickets in the queue.
 */
export const UNCLAIMED_TEXT = 'Not claimed';

/**
 * Text format for claimed tickets. Use {mentions} placeholder.
 */
export const CLAIMED_TEXT_FORMAT = 'Claimed by: {mentions}';

// ============================================
// STARTUP & LOGGING
// ============================================

/**
 * User ID to notify on bot startup (optional, set to null to disable).
 * Default: 'U05D1G4H754'
 */
export const STARTUP_NOTIFICATION_USER_ID = null;

/**
 * Message sent on startup notification.
 */
export const STARTUP_MESSAGE = 'Starting!';

// ============================================
// RATE LIMITING
// ============================================

/**
 * Slack API endpoint rate limits based on Slack's tier system.
 * Tier 1: 1+ per minute
 * Tier 2: 20+ per minute
 * Tier 3: 50+ per minute
 * Tier 4: 100+ per minute
 * Special: Varies by endpoint
 */

export const ENDPOINT_RATE_LIMITS: Record<string, { requestsPerMinute: number; requestsPerSecond?: number }> = {
  // Special tier: 1 per second (workspace-wide)
  'chat.postMessage': { requestsPerMinute: 60, requestsPerSecond: 1 },
  
  // Tier 3: 50 per minute
  'chat.update': { requestsPerMinute: 50 },
  'chat.delete': { requestsPerMinute: 50 },
  'reactions.add': { requestsPerMinute: 50 },
  'conversations.history': { requestsPerMinute: 50 },
  'conversations.replies': { requestsPerMinute: 50 },
  
  // Tier 2: 20 per minute
  'reactions.remove': { requestsPerMinute: 20 },
  'pins.add': { requestsPerMinute: 20 },
  'pins.remove': { requestsPerMinute: 20 },
  
  // Tier 4: 100 per minute
  'conversations.members': { requestsPerMinute: 100 },
  'auth.test': { requestsPerMinute: 100 },
};
