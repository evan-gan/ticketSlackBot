import * as fs from 'fs-extra';
import * as path from 'path';
import { GRACE_PERIOD_MS, DATA_FILE_NAME } from './constants';

const DATA_FILE_PATH = path.join(__dirname, '..', DATA_FILE_NAME);

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
 * Persists all ticket and leaderboard data to disk.
 */
export async function saveTicketData() {
  try {
    const data = {
      tickets,
      ticketsByOriginalTs,
      lbForToday,
      queueMessageTs,
      lastProcessedMessageTs,
    };
    await fs.writeJSON(DATA_FILE_PATH, data, { spaces: 2 });
    console.log('✅ Ticket data saved to file');
  } catch (error) {
    console.error('❌ Error saving ticket data to file:', error);
  }
}

/**
 * Loads all ticket and leaderboard data from disk.
 * Returns true if data was loaded, false if file doesn't exist or on error.
 */
export async function loadTicketData(): Promise<boolean> {
  try {
    if (await fs.pathExists(DATA_FILE_PATH)) {
      const data = await fs.readJSON(DATA_FILE_PATH);

      // Clear existing data first
      Object.keys(tickets).forEach((key) => delete tickets[key]);
      Object.keys(ticketsByOriginalTs).forEach((key) => delete ticketsByOriginalTs[key]);
      lbForToday.length = 0;

      // Load data from file
      if (data.tickets) {
        Object.assign(tickets, data.tickets);
      }
      if (data.ticketsByOriginalTs) {
        Object.assign(ticketsByOriginalTs, data.ticketsByOriginalTs);
      }
      if (data.lbForToday) {
        lbForToday = data.lbForToday;
      }
      if (data.queueMessageTs) {
        queueMessageTs = data.queueMessageTs;
      }
      if (data.lastProcessedMessageTs) {
        lastProcessedMessageTs = data.lastProcessedMessageTs;
      }

      console.log(`✅ Loaded ${Object.keys(tickets).length} tickets from file`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Error loading ticket data from file:', error);
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
