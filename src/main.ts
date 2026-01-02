import * as dotenv from 'dotenv';
dotenv.config();

import { App, LogLevel } from '@slack/bolt';
import { loadTicketData } from './data';
import { registerSlackHandlers, refreshTicketChannelMembers, postLeaderboardAndReset, notifyStartup, getBotUserId } from './slack';
import {
  TIMER_CHECK_INTERVAL_MS,
  AUTO_SAVE_INTERVAL_MS,
  MEMBER_REFRESH_INTERVAL_MS,
  LEADERBOARD_POST_INTERVAL_MS,
  STARTUP_NOTIFICATION_USER_ID,
} from './constants';

// Validate required environment variables
const HELP_CHANNEL = process.env.HELP_CHANNEL;
const TICKETS_CHANNEL = process.env.TICKETS_CHANNEL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!HELP_CHANNEL || !TICKETS_CHANNEL || !SLACK_BOT_TOKEN || !SLACK_APP_TOKEN || !DATABASE_URL) {
  throw new Error(
    'Missing required environment variables: HELP_CHANNEL, TICKETS_CHANNEL, SLACK_BOT_TOKEN, SLACK_APP_TOKEN, DATABASE_URL'
  );
}

// Initialize the Slack app
const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.WARN,
});

/**
 * Starts the bot, loads persisted data, and sets up periodic tasks.
 */
async function startBot() {
  try {
    // Load persisted ticket data
    await loadTicketData();

    // Register all Slack event handlers
    registerSlackHandlers(app);

    // Start the app
    await app.start();
    console.log('⚡️ Slack Bolt app is running!');

    // Send startup notification
    const client = app.client;
    if (STARTUP_NOTIFICATION_USER_ID) {
      await notifyStartup(client, STARTUP_NOTIFICATION_USER_ID);
    }

    // Get bot user ID for message filtering
    await getBotUserId(client);

    // Initialize ticket channel members cache
    const membersLoaded = await refreshTicketChannelMembers(client);
    if (!membersLoaded) {
      console.warn(
        '⚠️  Could not load ticket channel members initially. The bot will attempt to fetch them periodically.'
      );
    }

    // Initialize queue message and perform startup recovery
    const { initializeQueueOnStartup, performStartupRecovery, scanForMissedMessages } = await import('./startupRecovery');
    await initializeQueueOnStartup(client, console);
    
    // Scan for missed messages (must run before regular recovery to catch offline messages)
    await scanForMissedMessages(client, console);
    
    // Run recovery in background (non-blocking)
    performStartupRecovery(client, console).catch((error) => {
      console.error('❌ Background recovery failed:', error);
    });

    // Refresh ticket channel members periodically
    setInterval(() => refreshTicketChannelMembers(client), MEMBER_REFRESH_INTERVAL_MS);

    // Check grace timers periodically
    const { checkGraceTimers } = await import('./tickets');
    setInterval(() => checkGraceTimers(client, console), TIMER_CHECK_INTERVAL_MS);

    // Save ticket data periodically as a backup
    const { saveTicketData } = await import('./data');
    setInterval(saveTicketData, AUTO_SAVE_INTERVAL_MS);

    // Post daily leaderboard and reset for next day
    setInterval(() => postLeaderboardAndReset(client), LEADERBOARD_POST_INTERVAL_MS);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

startBot();
