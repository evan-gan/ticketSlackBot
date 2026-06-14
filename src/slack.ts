import { App } from '@slack/bolt';
import {
  getTicketByOriginalTs,
  lbForToday,
  resetLeaderboard,
  saveTicketData,
  setLastProcessedMessageTs,
  setTicketChannelMembers,
  isTicketChannelMember,
  saveLeaderboardHistory,
} from './data';
import { STARTUP_MESSAGE } from './constants';
import { rateLimitedCall, CallPriority } from './rateLimiter';
import {
  createTicket,
  handleStaffResponse,
  handleUserResponse,
  resolveTicket,
  updateQueueMessage,
} from './tickets';
import { checkFAQ } from './hcai';

// Bot's own user ID to filter out bot messages
let botUserId: string | null = null;

/**
 * Gets and stores the bot's user ID.
 */
export async function getBotUserId(client: any): Promise<void> {
  try {
    const result = await client.auth.test();
    if (result.ok && result.user_id) {
      botUserId = result.user_id;
      console.log(`🤖 Bot user ID: ${botUserId}`);
    }
  } catch (error: any) {
    console.error('❌ Failed to get bot user ID:', error.message);
  }
}

/**
 * Refreshes the cache of ticket channel members by fetching from Slack.
 */
export async function refreshTicketChannelMembers(client: any): Promise<boolean> {
  try {
    const ticketsChannel = process.env.TICKETS_CHANNEL;
    if (!ticketsChannel) {
      console.error('❌ TICKETS_CHANNEL environment variable is not set');
      return false;
    }

    console.log(`📋 Fetching members for channel: ${ticketsChannel}`);
    const result: any = await rateLimitedCall('conversations.members', () =>
      client.conversations.members({
        channel: ticketsChannel,
      }),
      CallPriority.Low
    );

    if (result.ok && result.members) {
      setTicketChannelMembers(result.members);
      console.log(`✅ Found ${result.members.length} members in tickets channel`);
      return true;
    }
    
    console.warn(`⚠️  Failed to fetch members. Response: ${JSON.stringify(result)}`);
    return false;
  } catch (error: any) {
    console.error('❌ Failed to fetch ticket channel members:', error.message);
    console.error('   Make sure the bot has access to the channel and the TICKETS_CHANNEL ID is correct');
    return false;
  }
}

/**
 * Sends a startup notification DM to a specified user.
 */
export async function notifyStartup(client: any, userId: string): Promise<boolean> {
  try {
    await rateLimitedCall('chat.postMessage', () =>
      client.chat.postMessage({
        channel: userId,
        text: STARTUP_MESSAGE,
      }),
      CallPriority.Low
    );
    console.log(`✅ Sent startup notification to <@${userId}>`);
    return true;
  } catch (error: any) {
    console.error(`❌ Failed to send startup notification to ${userId}:`, error.message);
    return false;
  }
}

/**
 * Registers all Slack event handlers with the app.
 */
export function registerSlackHandlers(app: App) {
  const helpChannel = process.env.HELP_CHANNEL;
  const ticketsChannel = process.env.TICKETS_CHANNEL;

  if (!helpChannel || !ticketsChannel) {
    throw new Error('Missing required environment variables: HELP_CHANNEL and TICKETS_CHANNEL');
  }

  // Listen for new messages in the help channel to create tickets
  app.event('message', async ({ event, client, logger }) => {
    // Only process new messages in the help channel (not thread replies)
    if (event.channel !== helpChannel || (event as any).thread_ts) return;
    const subtype = (event as any).subtype;
    if (subtype && subtype !== 'file_share') return;// Skip edited messages, etc.

    const message = event as { text: string; ts: string; channel: string; user: string };
    const ticket = await createTicket(message, client, logger);
    
    // Update last processed message timestamp
    setLastProcessedMessageTs(message.ts);

    // Check FAQ in background (fire and forget)
    if (ticket && message.text) {
      (async () => {
        try {
          const faqResult = await checkFAQ(message.text);
          console.log("FAQ RESULT:", faqResult);
          if (faqResult) {
            // Post FAQ as reply in the same thread
            await rateLimitedCall('chat.postMessage', () =>
              client.chat.postMessage({
                channel: message.channel,
                thread_ts: message.ts,
                text: faqResult + '\n\nPlease reply in this thread if this doesn\'t answer your question!',
              }),
              CallPriority.Normal
            );

            await resolveTicket(ticket, 'system', client, logger); // Auto-resolve with FAQ answer
          }
        } catch (error) {
          logger.warn('Failed to check FAQ:', error);
        }
      })();
    }
  });

  // Listen for new messages in the tickets channel to repost queue message at bottom
  app.event('message', async ({ event, client, logger }) => {
    const message = event as any;
    
    // Debug logging
    if (event.channel === ticketsChannel) {
      logger.info(`📨 Message in tickets channel - user: ${message.user}, bot_id: ${message.bot_id}, thread: ${message.thread_ts}, subtype: ${message.subtype}`);
    }
    
    // Only process new messages in tickets channel (not thread replies)
    if (event.channel !== ticketsChannel) return;
    if (message.thread_ts) return; // Skip thread replies
    if (message.subtype) return; // Skip edited messages, message_deleted, etc.
    
    // Skip bot messages - check if user is the bot itself
    if (!message.user) return; // No user means it's not a regular message
    if (message.user === botUserId) return; // Skip messages from the bot itself
    if (message.bot_id) return; // Skip any bot messages
    
    // !reset-canvas: user has manually cleared the canvas; just rewrite current queue
    if (message.text?.includes('!reset-canvas')) {
      logger.info('🔄 Rewriting canvas after manual clear');
      await updateQueueMessage(client, logger);
      return;
    }

    logger.info(`📌 User message detected in tickets channel, reposting queue message`);

    // Repost queue message to keep it at the bottom
    await updateQueueMessage(client, logger, true);
  });

  // Listen for thread replies to handle staff responses and user responses
  app.event('message', async ({ event, client, logger }) => {
    // Only process thread replies in the help channel
    if (
      !((event as any).thread_ts) ||
      event.channel !== helpChannel ||
      (event as any).thread_ts === event.ts
    )
      return;
    const subtype = (event as any).subtype;
    if (subtype && subtype !== 'file_share') return; // Skip edited messages, etc.

    const threadReply = event as { thread_ts: string; user: string; text?: string };

    // Check if user is help staff
    if (isTicketChannelMember(threadReply.user)) {
      // Help staff response
      await handleStaffResponse(
        threadReply.user,
        threadReply.thread_ts,
        threadReply.text || '',
        client,
        logger
      );
    } else {
      // Regular user response
      await handleUserResponse(threadReply.thread_ts, client, logger);
    }
  });

  // Handle "Resolve" button from welcome message
  app.action('resolve_ticket_button', async ({ body, ack, client, logger }) => {
    await ack();

    const userId = (body.user || {}).id;
    const messageTs = (body as any).message?.thread_ts || (body as any).message?.ts;

    if (!messageTs) return;

    // Find the ticket by original thread timestamp
    const ticket = getTicketByOriginalTs(messageTs);
    if (!ticket) {
      logger.warn(`No ticket found for thread ${messageTs}`);
      return;
    }

    // Verify user is either thread OP or help staff
    try {
      const messageInfo = await rateLimitedCall('conversations.history', () =>
        client.conversations.history({
          channel: ticket.originalChannel,
          latest: ticket.originalTs,
          limit: 1,
          inclusive: true,
        }),
        CallPriority.High
      );

      const isOriginalAuthor =
        messageInfo.messages &&
        messageInfo.messages[0] &&
        messageInfo.messages[0].user === userId;

      if (isOriginalAuthor || isTicketChannelMember(userId)) {
        const success = await resolveTicket(ticket, userId, client, logger);
        if (success) {
          logger.info(
            `Ticket ${ticket.originalTs} resolved via button by ${userId} (${
              isOriginalAuthor ? 'original author' : 'help staff'
            })`
          );
        }
      } else {
        logger.info(
          `User ${userId} tried to resolve ticket but is neither OP nor help staff`
        );
      }
    } catch (error) {
      logger.error('❌ Error handling resolve button:', error);
    }
  });
}

/**
 * Posts the daily leaderboard to the tickets channel and resets it.
 */
export async function postLeaderboardAndReset(client: any) {
  try {
    const ticketsChannel = process.env.TICKETS_CHANNEL;
    if (!ticketsChannel) {
      console.error('❌ TICKETS_CHANNEL environment variable is not set');
      return;
    }

    const staffLB = lbForToday.filter(entry => isTicketChannelMember(entry.slack_id));

    if (staffLB.length === 0) {
      console.log('📊 No staff resolutions today, skipping leaderboard');
    } else {
      const sortedLB = staffLB.sort((a, b) => b.count_of_tickets - a.count_of_tickets);
      const leaderboardText = sortedLB
        .map((entry, index) => `${index + 1}. <@${entry.slack_id}> resolved *${entry.count_of_tickets}*`)
        .join('\n');

      await rateLimitedCall('chat.postMessage', () =>
        client.chat.postMessage({
          channel: ticketsChannel,
          text: `📊 Today's Top Resolvers:\n${leaderboardText}`,
        }),
        CallPriority.Low
      );
    }

    // Save leaderboard to history before resetting
    await saveLeaderboardHistory();
    resetLeaderboard();
    await saveTicketData();
  } catch (error) {
    console.error('❌ Error posting leaderboard:', error);
  }
}
