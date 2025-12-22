import { App, LogLevel } from '@slack/bolt';
import * as dotenv from 'dotenv';
import { loadTicketData } from './data';
import { registerSlackHandlers, refreshTicketChannelMembers, postLeaderboardAndReset, notifyStartup } from './slack';

dotenv.config();

// Validate required environment variables
const HELP_CHANNEL = process.env.HELP_CHANNEL;
const TICKETS_CHANNEL = process.env.TICKETS_CHANNEL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

if (!HELP_CHANNEL || !TICKETS_CHANNEL || !SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
  throw new Error(
    'Missing required environment variables: HELP_CHANNEL, TICKETS_CHANNEL, SLACK_BOT_TOKEN, SLACK_APP_TOKEN'
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
    await notifyStartup(client, 'U05D1G4H754');

    // Initialize ticket channel members cache
    const membersLoaded = await refreshTicketChannelMembers(client);
    if (!membersLoaded) {
      console.warn(
        '⚠️  Could not load ticket channel members initially. The bot will attempt to fetch them periodically.'
      );
    }

    // Refresh ticket channel members every hour
    setInterval(() => refreshTicketChannelMembers(client), 60 * 60 * 1000);

    // Save ticket data every 5 minutes as a backup
    const { saveTicketData } = await import('./data');
    setInterval(saveTicketData, 5 * 60 * 1000);

    // Post daily leaderboard at 11:59 PM and reset for next day
    setInterval(() => postLeaderboardAndReset(client), 24 * 60 * 60 * 1000);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

startBot();
