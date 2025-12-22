import { App } from '@slack/bolt';
import {
  getTicketByOriginalTs,
  getTicketByTicketTs,
  lbForToday,
  resetLeaderboard,
  saveTicketData,
} from './data';
import {
  createTicket,
  claimTicket,
  markTicketAsNotSure,
  resolveTicket,
} from './tickets';
import { formatTs } from './utils';

// Cache of user IDs who have access to the tickets channel
let ticketChannelMembers: string[] = [];

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
    const result = await client.conversations.members({
      channel: ticketsChannel,
    });

    if (result.ok && result.members) {
      ticketChannelMembers = result.members;
      console.log(`✅ Found ${ticketChannelMembers.length} members in tickets channel`);
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
 * Checks if a user is a member of the tickets channel.
 */
export function isTicketChannelMember(userId: string): boolean {
  return ticketChannelMembers.includes(userId);
}

/**
 * Sends a startup notification DM to a specified user.
 */
export async function notifyStartup(client: any, userId: string): Promise<boolean> {
  try {
    await client.chat.postMessage({
      channel: userId,
      text: 'Starting!',
    });
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
    if ((event as any).subtype) return; // Skip edited messages, etc.

    const message = event as { text: string; ts: string; channel: string; user: string };
    await createTicket(message, client, logger);

    // Send welcome message
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: `:hii: Thank you for creating a ticket. Someone will help you soon. Make sure to read the documentation and the README before asking questions!`,
    });
  });

  // Listen for thread replies to handle claims
  app.event('message', async ({ event, client, logger }) => {
    // Only process thread replies in the help channel
    if (
      !((event as any).thread_ts) ||
      event.channel !== helpChannel ||
      (event as any).thread_ts === event.ts
    )
      return;
    if ((event as any).subtype) return; // Skip edited messages, etc.

    const threadReply = event as { thread_ts: string; user: string };

    // Verify user is in tickets channel before allowing claim
    if (!isTicketChannelMember(threadReply.user)) {
      logger.info(`User ${threadReply.user} tried to claim but is not in tickets channel`);
      return;
    }

    // Find the ticket and claim it
    const ticket = getTicketByOriginalTs(threadReply.thread_ts);
    if (ticket) {
      const success = await claimTicket(threadReply.user, ticket.ticketMessageTs, client, logger);
      if (success) {
        logger.info(`Ticket ${ticket.ticketMessageTs} claimed by ${threadReply.user}`);
      }
    }
  });

  // Handle "Mark Resolved" button
  app.action('mark_resolved', async ({ body, ack, client, logger }) => {
    await ack();

    const userId = (body.user || {}).id;
    if (!isTicketChannelMember(userId)) {
      logger.info(`User ${userId} tried to resolve but is not in tickets channel`);
      return;
    }

    const ticketTs = (body as any).message?.ts;
    if (!ticketTs) return;

    const success = await resolveTicket(ticketTs, userId, client, logger);
    if (success) {
      logger.info(`Ticket ${ticketTs} resolved by ${userId}`);
    }
  });

  // Handle "Seen, Not Sure" button
  app.action('not_sure', async ({ body, ack, client, logger }) => {
    await ack();

    const ticketTs = (body as any).message?.ts;
    const userId = (body.user || {}).id;

    if (!ticketTs || !userId) return;

    if (!isTicketChannelMember(userId)) {
      logger.info(`User ${userId} tried to mark "not sure" but is not in tickets channel`);
      return;
    }

    const success = await markTicketAsNotSure(userId, ticketTs, client, logger);
    if (success) {
      logger.info(`Ticket ${ticketTs} marked as "not sure" by ${userId}`);
    }
  });

  // Handle assign user action
  app.action('assign_user', async ({ body, ack, client, logger }) => {
    await ack();

    const userId = (body.user || {}).id;
    if (!isTicketChannelMember(userId)) {
      logger.info(`User ${userId} tried to assign but is not in tickets channel`);
      return;
    }

    const ticketTs = (body as any).message?.ts;
    const selectedUser = (body as any).actions?.[0]?.selected_user as string;

    if (!ticketTs || !selectedUser) return;

    const ticket = getTicketByTicketTs(ticketTs);
    if (!ticket) return;

    try {
      // Send DM to assigned user
      await client.chat.postMessage({
        channel: selectedUser,
        text: `You have been assigned a ticket. Please check it out and claim it by replying.\n<https://${
          process.env.SLACK_WORKSPACE_DOMAIN || 'yourworkspace.slack.com'
        }.slack.com/archives/${ticketsChannel}/p${formatTs(ticket.ticketMessageTs)}|View Ticket>`,
      });

      logger.info(`User ${selectedUser} assigned ticket ${ticketTs}`);
    } catch (error) {
      logger.error('❌ Error assigning ticket:', error);
    }
  });

  // Handle check mark reaction to resolve tickets
  app.event('reaction_added', async ({ event, client, logger }) => {
    const reactionEvent = event as {
      reaction: string;
      item: { channel: string; ts: string };
      user: string;
    };

    // Only handle check mark reactions in the help channel
    if (reactionEvent.reaction !== 'white_check_mark' || reactionEvent.item.channel !== helpChannel) {
      return;
    }

    if (!isTicketChannelMember(reactionEvent.user)) {
      logger.info(
        `User ${reactionEvent.user} tried to resolve via reaction but is not in tickets channel`
      );
      return;
    }

    const ticket = getTicketByOriginalTs(reactionEvent.item.ts);
    if (!ticket) return;

    try {
      // Verify user is the original message author or in tickets channel
      const messageInfo = await client.conversations.history({
        channel: reactionEvent.item.channel,
        latest: reactionEvent.item.ts,
        limit: 1,
        inclusive: true,
      });

      const isOriginalAuthor =
        messageInfo.messages &&
        messageInfo.messages[0] &&
        messageInfo.messages[0].user === reactionEvent.user;

      if (isOriginalAuthor || isTicketChannelMember(reactionEvent.user)) {
        const success = await resolveTicket(
          ticket.ticketMessageTs,
          reactionEvent.user,
          client,
          logger
        );
        if (success) {
          logger.info(
            `Ticket resolved via reaction by ${reactionEvent.user} (${
              isOriginalAuthor ? 'original author' : 'support member'
            })`
          );
          await client.reactions.add({
            name: 'white_check_mark',
            timestamp: reactionEvent.item.ts,
            channel: reactionEvent.item.channel,
          });
        }
      }
    } catch (error) {
      logger.error('❌ Error handling reaction resolution:', error);
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

    if (lbForToday.length === 0) {
      console.log('📊 No resolutions today, skipping leaderboard');
      return;
    }

    const sortedLB = lbForToday.sort((a, b) => b.count_of_tickets - a.count_of_tickets);
    const leaderboardText = sortedLB
      .map((entry, index) => `${index + 1}. <@${entry.slack_id}> resolved *${entry.count_of_tickets}*`)
      .join('\n');

    await client.chat.postMessage({
      channel: ticketsChannel,
      text: `📊 Today's Top Resolvers:\n${leaderboardText}`,
    });

    resetLeaderboard();
    await saveTicketData();
  } catch (error) {
    console.error('❌ Error posting leaderboard:', error);
  }
}
