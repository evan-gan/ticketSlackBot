import * as fs from 'fs-extra';
import * as path from 'path';

const DATA_FILE_PATH = path.join(__dirname, '../ticket-data.json');

/**
 * Represents information about a ticket created from a help channel message.
 */
export interface TicketInfo {
  originalChannel: string;
  originalTs: string;
  ticketMessageTs: string;
  claimers: string[];
  notSure: string[];
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

/**
 * Persists all ticket and leaderboard data to disk.
 */
export async function saveTicketData() {
  try {
    const data = {
      tickets,
      ticketsByOriginalTs,
      lbForToday,
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
