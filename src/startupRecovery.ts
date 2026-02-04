/**
 * Startup recovery system.
 * Handles initialization of queue message and recovery from offline periods.
 * Checks thread statuses and synchronizes ticket state with reality.
 */

import { tickets, getQueueMessageTs, getLastProcessedMessageTs, ticketsByOriginalTs, setQueueMessageTs } from './data';
import { updateQueueMessage, createTicket } from './tickets';
import { rateLimitedCall, CallPriority } from './rateLimiter';
import { QUEUE_MESSAGE_HEADER } from './constants';

/**
 * Cleans up old queue messages in the tickets channel on startup.
 * Deletes any previous queue messages that might have been left behind.
 */
export async function cleanupOldQueueMessages(
  client: any,
  logger: any
): Promise<void> {
  try {
    const ticketsChannel = process.env.TICKETS_CHANNEL;
    if (!ticketsChannel) {
      logger.error('❌ TICKETS_CHANNEL environment variable is not set');
      return;
    }

    logger.info('🧹 Cleaning up old queue messages...');

    // Get the stored queue message timestamps
    const storedQueueTsList = getQueueMessageTs();
    const storedQueueTsSet = new Set(storedQueueTsList || []);

    // Fetch recent messages from tickets channel to find old queue messages
    const result: any = await rateLimitedCall('conversations.history', () =>
      client.conversations.history({
        channel: ticketsChannel,
        limit: 100, // Check last 100 messages
      }),
      CallPriority.Low
    );

    if (!result.ok || !result.messages) {
      logger.warn('⚠️  Failed to fetch tickets channel history');
      return;
    }

    let deletedCount = 0;
    for (const msg of result.messages) {
      // Check if message is a queue message (contains the header and is from the bot)
      if (msg.bot_id && msg.text && msg.text.includes(QUEUE_MESSAGE_HEADER)) {
        // If it's not one of the currently stored queue messages, delete it
        if (!storedQueueTsSet.has(msg.ts)) {
          try {
            await rateLimitedCall('chat.delete', () =>
              client.chat.delete({
                channel: ticketsChannel,
                ts: msg.ts,
              }),
              CallPriority.Low
            );
            deletedCount++;
            logger.info(`🗑️  Deleted old queue message: ${msg.ts}`);
          } catch (error) {
            logger.warn(`Failed to delete old queue message ${msg.ts}:`, error);
          }
        }
      }
    }

    if (deletedCount > 0) {
      logger.info(`✅ Cleaned up ${deletedCount} old queue message(s)`);
    } else {
      logger.info('✅ No old queue messages to clean up');
    }

    // If stored queue messages were deleted or don't exist, clear the timestamps
    if (storedQueueTsList && storedQueueTsList.length > 0) {
      const validTsList = storedQueueTsList.filter((ts) =>
        result.messages.some((msg: any) => msg.ts === ts)
      );
      if (validTsList.length !== storedQueueTsList.length) {
        logger.info('ℹ️  Some stored queue messages no longer exist, will create new ones');
        setQueueMessageTs(validTsList.length > 0 ? validTsList : null);
      }
    }
  } catch (error) {
    logger.error('❌ Failed to clean up old queue messages:', error);
  }
}

/**
 * Scans the help channel for messages posted while bot was offline.
 * Creates tickets for any missed messages that don't already have tickets.
 */
export async function scanForMissedMessages(
  client: any,
  logger: any
): Promise<void> {
  try {
    const helpChannel = process.env.HELP_CHANNEL;
    if (!helpChannel) {
      logger.error('❌ HELP_CHANNEL environment variable is not set');
      return;
    }

    const lastProcessedTs = getLastProcessedMessageTs();
    
    // If no last processed timestamp, skip scanning (first run or data loss)
    if (!lastProcessedTs) {
      logger.info('ℹ️  No last processed message timestamp found, skipping missed message scan');
      return;
    }

    logger.info('🔍 Scanning help channel for missed messages...');

    // Fetch messages since last processed timestamp
    const result: any = await rateLimitedCall('conversations.history', () =>
      client.conversations.history({
        channel: helpChannel,
        oldest: lastProcessedTs,
        limit: 100, // Get up to 100 messages (should be more than enough for typical downtime)
      }),
      CallPriority.Low
    );

    if (!result.ok || !result.messages) {
      logger.warn('⚠️  Failed to fetch channel history');
      return;
    }

    // Filter for messages that:
    // 1. Are not thread replies (no thread_ts or thread_ts === ts)
    // 2. Don't have subtypes (edited, deleted, etc.)
    // 3. Don't already have tickets
    // 4. Are newer than last processed (exclude the last processed message itself)
    const missedMessages = result.messages
      .filter((msg: any) => {
        const isNotThreadReply = !msg.thread_ts || msg.thread_ts === msg.ts;
        const hasNoSubtype = !msg.subtype;
        const isNewerThanLastProcessed = msg.ts > lastProcessedTs;
        const noExistingTicket = !ticketsByOriginalTs[msg.ts];
        
        return isNotThreadReply && hasNoSubtype && isNewerThanLastProcessed && noExistingTicket;
      })
      .reverse(); // Process oldest first

    if (missedMessages.length === 0) {
      logger.info('✅ No missed messages found');
      return;
    }

    logger.info(`📋 Found ${missedMessages.length} missed message(s), creating tickets...`);

    let createdCount = 0;
    for (const msg of missedMessages) {
      try {
        // Create ticket for missed message
        await createTicket(
          {
            text: msg.text || '',
            ts: msg.ts,
            channel: helpChannel,
            user: msg.user,
          },
          client,
          logger
        );
        createdCount++;
        logger.info(`✓ Created ticket for missed message ${msg.ts}`);
      } catch (error) {
        logger.error(`❌ Failed to create ticket for message ${msg.ts}:`, error);
      }
    }

    logger.info(`✅ Created ${createdCount} ticket(s) from missed messages`);
  } catch (error) {
    logger.error('❌ Failed to scan for missed messages:', error);
  }
}

/**
 * Initializes the queue message on startup with current unresolved tickets.
 * Cleans up any old queue messages first.
 */
export async function initializeQueueOnStartup(
  client: any,
  logger: any
): Promise<void> {
  try {
    logger.info('🔄 Initializing queue message with stored tickets...');

    // First, clean up any old queue messages
    await cleanupOldQueueMessages(client, logger);

    // Update/create queue message with all current tickets in queue
    await updateQueueMessage(client, logger);

    logger.info('✅ Queue message initialized successfully');
  } catch (error) {
    logger.error('❌ Failed to initialize queue message:', error);
  }
}

/**
 * Performs startup recovery in the background.
 * Checks thread statuses to detect any changes that happened while offline.
 * Uses rate-limited API calls, so no manual batching needed.
 */
export async function performStartupRecovery(
  client: any,
  logger: any
): Promise<void> {
  try {
    logger.info('🔍 Starting startup recovery - checking thread statuses...');

    const allTickets = Object.values(tickets);
    const unresolvedTickets = allTickets.filter((t) => !t.resolved);

    if (unresolvedTickets.length === 0) {
      logger.info('✅ No unresolved tickets to check');
      return;
    }

    logger.info(`📋 Checking ${unresolvedTickets.length} unresolved tickets from newest to oldest...`);

    let recoveredCount = 0;
    let errorCount = 0;

    // Sort tickets by timestamp (newest first) - higher timestamp = more recent
    const sortedTickets = unresolvedTickets.sort((a, b) => {
      const tsA = parseFloat(a.originalTs);
      const tsB = parseFloat(b.originalTs);
      return tsB - tsA; // Descending order (newest first)
    });

    // Check all tickets - rate limiter will handle throttling
    await Promise.all(
      sortedTickets.map(async (ticket) => {
        try {
          await checkThreadStatus(ticket, client, logger);
          recoveredCount++;
        } catch (error) {
          errorCount++;
          logger.error(
            `❌ Failed to check thread ${ticket.originalTs}:`,
            error
          );
        }
      })
    );

    logger.info(
      `✅ Startup recovery complete: ${recoveredCount} tickets checked, ${errorCount} errors`
    );

    // Update queue message after recovery
    await updateQueueMessage(client, logger);
  } catch (error) {
    logger.error('❌ Startup recovery failed:', error);
  }
}

/**
 * Checks the status of a specific thread to detect changes.
 * Verifies if thread still exists and updates ticket state if needed.
 */
async function checkThreadStatus(
  ticket: any,
  client: any,
  logger: any
): Promise<void> {
  try {
    // Check if original message still exists
    const messageExists = await rateLimitedCall('conversations.history', async () => {
      try {
        const result = await client.conversations.history({
          channel: ticket.originalChannel,
          latest: ticket.originalTs,
          inclusive: true,
          limit: 1,
        });

        return result.ok && result.messages && result.messages.length > 0;
      } catch (error: any) {
        // If we get a channel_not_found error, the channel was deleted
        if (error.data?.error === 'channel_not_found') {
          return false;
        }
        throw error;
      }
    }, CallPriority.Low);

    if (!messageExists) {
      logger.info(
        `⚠️  Thread ${ticket.originalTs} no longer exists, marking as resolved`
      );
      ticket.resolved = true;
      ticket.inQueue = false;
      return;
    }

    // Check for recent replies to update lastResponderId
    const hasRecentReplies = await rateLimitedCall('conversations.replies', async () => {
      try {
        const result = await client.conversations.replies({
          channel: ticket.originalChannel,
          ts: ticket.originalTs,
          limit: 5,
        });

        if (result.ok && result.messages && result.messages.length > 1) {
          // Get the most recent reply (excluding the original message)
          const replies = result.messages.slice(1);
          if (replies.length > 0) {
            const lastReply = replies[replies.length - 1];
            return lastReply.user;
          }
        }
        return null;
      } catch (error) {
        logger.warn(`Failed to check replies for ${ticket.originalTs}:`, error);
        return null;
      }
    }, CallPriority.Low);

    if (hasRecentReplies) {
      // Note: We don't automatically update lastResponderId during recovery
      // because we don't have full context. This just verifies the thread exists.
      logger.info(
        `✓ Thread ${ticket.originalTs} verified - has ${hasRecentReplies ? 'recent' : 'no'} activity`
      );
    }
  } catch (error) {
    logger.error(`Error checking thread ${ticket.originalTs}:`, error);
    throw error;
  }
}

/**

 * Gets recovery statistics.
 */
export function getRecoveryStats(): {
  totalTickets: number;
  unresolvedTickets: number;
  inQueueTickets: number;
} {
  const allTickets = Object.values(tickets);
  const unresolvedTickets = allTickets.filter((t) => !t.resolved);
  const inQueueTickets = allTickets.filter((t) => t.inQueue);

  return {
    totalTickets: allTickets.length,
    unresolvedTickets: unresolvedTickets.length,
    inQueueTickets: inQueueTickets.length,
  };
}
