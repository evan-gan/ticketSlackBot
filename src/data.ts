import { Pool } from 'pg';
import { GRACE_PERIOD_MS } from './constants';

let pool: Pool;

// Cache of user IDs who have access to the tickets channel (help staff)
export let ticketChannelMembers: string[] = [];

/**
 * Checks if a user is a member of the tickets channel (i.e., help staff).
 */
export function isTicketChannelMember(userId: string): boolean {
  return ticketChannelMembers.includes(userId);
}

/**
 * Updates the cache of ticket channel members.
 */
export function setTicketChannelMembers(members: string[]) {
  ticketChannelMembers = members;
}

/**
 * Gets the database connection pool, initializing it if necessary.
 */
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  }
  return pool;
}

/**
 * Initializes the PostgreSQL database tables if they don't exist.
 */
export async function initDB() {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_ts TEXT PRIMARY KEY,
        original_channel TEXT NOT NULL,
        original_ts TEXT NOT NULL,
        responders TEXT[] NOT NULL,
        resolved BOOLEAN NOT NULL,
        grace_timer_expiry BIGINT,
        force_open BOOLEAN NOT NULL,
        last_responder_id TEXT,
        in_queue BOOLEAN NOT NULL,
        closure_message_ts TEXT
      );

      CREATE TABLE IF NOT EXISTS leaderboard (
        slack_id TEXT PRIMARY KEY,
        count_of_tickets INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    console.log('✅ PostgreSQL tables initialized');
  } catch (error) {
    console.error('❌ Error initializing PostgreSQL tables:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Represents information about a ticket created from a help channel message.
 */
export interface TicketInfo {
  originalChannel: string;
  originalTs: string;
  ticketMessageTs: string;
  // List of help staff members who have responded to this ticket
  responders: string[];
  // Whether ticket is currently marked as resolved
  resolved: boolean;
  // Timestamp when the grace period timer should expire (null if no timer active)
  graceTimerExpiry: number | null;
  // Whether the ticket is force-kept open with !open command
  forceOpen: boolean;
  // Last message author's user ID to track who replied last
  lastResponderId: string | null;
  // Whether ticket currently needs help (shown in queue)
  inQueue: boolean;
  // The timestamp of the bot's "ticket closed" message (if exists)
  closureMessageTs?: string;
}

/**
 * Represents a leaderboard entry for ticket resolutions.
 */
export interface LBEntry {
  slack_id: string;
  count_of_tickets: number;
}

// In-memory storage for tickets, keyed by ticket message timestamp
export const tickets: Record<string, TicketInfo> = {};

// Maps original message timestamps to ticket message timestamps for quick lookup
export const ticketsByOriginalTs: Record<string, string> = {};

// Tracks ticket resolutions for the current day's leaderboard
export let lbForToday: LBEntry[] = [];

// Timestamp of the pinned queue message in the tickets channel
export let queueMessageTs: string | null = null;

// Timestamp of the last processed message in the help channel (for recovery)
let lastProcessedMessageTs: string | null = null;

/**
 * Persists all ticket and leaderboard data to PostgreSQL.
 */
export async function saveTicketData() {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Save tickets
    for (const [ts, ticket] of Object.entries(tickets)) {
      await client.query(`
        INSERT INTO tickets (
          ticket_ts, original_channel, original_ts, responders, resolved, 
          grace_timer_expiry, force_open, last_responder_id, in_queue, closure_message_ts
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (ticket_ts) DO UPDATE SET
          original_channel = EXCLUDED.original_channel,
          original_ts = EXCLUDED.original_ts,
          responders = EXCLUDED.responders,
          resolved = EXCLUDED.resolved,
          grace_timer_expiry = EXCLUDED.grace_timer_expiry,
          force_open = EXCLUDED.force_open,
          last_responder_id = EXCLUDED.last_responder_id,
          in_queue = EXCLUDED.in_queue,
          closure_message_ts = EXCLUDED.closure_message_ts
      `, [
        ts, ticket.originalChannel, ticket.originalTs, ticket.responders, ticket.resolved,
        ticket.graceTimerExpiry, ticket.forceOpen, ticket.lastResponderId, ticket.inQueue, ticket.closureMessageTs
      ]);
    }

    // Save leaderboard
    await client.query('DELETE FROM leaderboard');
    for (const entry of lbForToday) {
      await client.query('INSERT INTO leaderboard (slack_id, count_of_tickets) VALUES ($1, $2)', [entry.slack_id, entry.count_of_tickets]);
    }

    // Save metadata
    await client.query("INSERT INTO metadata (key, value) VALUES ('queueMessageTs', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [queueMessageTs]);
    await client.query("INSERT INTO metadata (key, value) VALUES ('lastProcessedMessageTs', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [lastProcessedMessageTs]);

    await client.query('COMMIT');
    console.log('✅ Ticket data saved to PostgreSQL');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error saving ticket data to PostgreSQL:', error);
  } finally {
    client.release();
  }
}

/**
 * Loads all ticket and leaderboard data from PostgreSQL.
 * Returns true if data was loaded, false on error.
 */
export async function loadTicketData(): Promise<boolean> {
  try {
    await initDB();

    const client = await getPool().connect();
    try {
      // Clear existing data first
      Object.keys(tickets).forEach((key) => delete tickets[key]);
      Object.keys(ticketsByOriginalTs).forEach((key) => delete ticketsByOriginalTs[key]);
      lbForToday.length = 0;

      // Load tickets
      const ticketsRes = await client.query('SELECT * FROM tickets');
      for (const row of ticketsRes.rows) {
        const ticket: TicketInfo = {
          originalChannel: row.original_channel,
          originalTs: row.original_ts,
          ticketMessageTs: row.ticket_ts,
          responders: row.responders,
          resolved: row.resolved,
          graceTimerExpiry: row.grace_timer_expiry ? parseInt(row.grace_timer_expiry) : null,
          forceOpen: row.force_open,
          lastResponderId: row.last_responder_id,
          inQueue: row.in_queue,
          closureMessageTs: row.closure_message_ts,
        };
        tickets[row.ticket_ts] = ticket;
        ticketsByOriginalTs[row.original_ts] = row.ticket_ts;
      }

      // Load leaderboard
      const lbRes = await client.query('SELECT * FROM leaderboard');
      lbForToday = lbRes.rows.map(row => ({
        slack_id: row.slack_id,
        count_of_tickets: row.count_of_tickets
      }));

      // Load metadata
      const metaRes = await client.query('SELECT * FROM metadata');
      for (const row of metaRes.rows) {
        if (row.key === 'queueMessageTs') queueMessageTs = row.value;
        if (row.key === 'lastProcessedMessageTs') lastProcessedMessageTs = row.value;
      }

      console.log(`✅ Loaded ${Object.keys(tickets).length} tickets from PostgreSQL`);
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error loading ticket data from PostgreSQL:', error);
    return false;
  }
}

/**
 * Retrieves a ticket by its original message timestamp.
 */
export function getTicketByOriginalTs(originalTs: string): TicketInfo | null {
  const ticketTs = ticketsByOriginalTs[originalTs];
  return ticketTs ? tickets[ticketTs] : null;
}

/**
 * Retrieves a ticket by its ticket message timestamp.
 */
export function getTicketByTicketTs(ticketTs: string): TicketInfo | null {
  return tickets[ticketTs] || null;
}

/**
 * Adds a ticket resolution to the leaderboard.
 */
export function addResolution(userId: string) {
  const existingIndex = lbForToday.findIndex((e) => e.slack_id === userId);
  if (existingIndex !== -1) {
    lbForToday[existingIndex].count_of_tickets += 1;
  } else {
    lbForToday.push({
      slack_id: userId,
      count_of_tickets: 1,
    });
  }
}

/**
 * Resets the leaderboard for a new day.
 */
export function resetLeaderboard() {
  lbForToday = [];
}

/**
 * Updates the queue message timestamp.
 */
export function setQueueMessageTs(ts: string | null) {
  queueMessageTs = ts;
}

/**
 * Gets the current queue message timestamp.
 */
export function getQueueMessageTs(): string | null {
  return queueMessageTs;
}

/**
 * Gets the last processed message timestamp.
 */
export function getLastProcessedMessageTs(): string | null {
  return lastProcessedMessageTs;
}

/**
 * Updates the last processed message timestamp.
 */
export function setLastProcessedMessageTs(ts: string) {
  lastProcessedMessageTs = ts;
}
