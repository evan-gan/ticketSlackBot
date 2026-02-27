import {
  TicketInfo,
  tickets,
  ticketsByOriginalTs,
  getTicketByTicketTs,
  getTicketByOriginalTs,
  saveTicketData,
  addResolution,
  getQueueMessageTs,
  setQueueMessageTs,
  isTicketChannelMember,
} from './data';
import { GRACE_PERIOD_MS, TICKET_RESOLVED_MESSAGE } from './constants';
import { createWelcomeBlocks, getThreadUrl, createQueueMessageText, splitQueueMessage } from './utils';
import { rateLimitedCall, CallPriority } from './rateLimiter';

/**
 * Creates a new ticket from a help channel message.
 * Posts welcome message with Resolve button and creates internal tracking message.
 */
export async function createTicket(
  message: { text: string; ts: string; channel: string; user: string },
  client: any,
  logger: any
): Promise<TicketInfo | null> {
  try {
    // Post welcome message in the thread with Resolve button
    const welcomeResult: any = await rateLimitedCall('chat.postMessage', () =>
      client.chat.postMessage({
        channel: message.channel,
        thread_ts: message.ts,
        blocks: createWelcomeBlocks(),
        text: 'Thank you for creating a ticket. Someone will help you soon.',
      }),
      CallPriority.High
    );

    if (welcomeResult.ok && welcomeResult.ts) {
      // Create and store ticket information
      const ticketInfo: TicketInfo = {
        originalChannel: message.channel,
        originalTs: message.ts,
        ticketMessageTs: welcomeResult.ts,
        responders: [],
        resolved: false,
        graceTimerExpiry: null,
        forceOpen: false,
        lastResponderId: null,
        inQueue: true,
      };

      tickets[welcomeResult.ts] = ticketInfo;
      ticketsByOriginalTs[message.ts] = welcomeResult.ts;

      console.info(`✅ Ticket created for message ${message.ts}`);

      // Update the queue message
      await updateQueueMessage(client, logger);
      await saveTicketData();
      return ticketInfo;
    }
  } catch (error) {
    logger.error('❌ Error creating ticket:', error);
  }

  return null;
}



/**
 * Handles when a help staff member replies to a ticket thread.
 * Adds them to responders, removes from queue on first response, and starts grace timer.
 */
export async function handleStaffResponse(
  userId: string,
  threadTs: string,
  messageText: string,
  client: any,
  logger: any
): Promise<boolean> {
  const ticket = getTicketByOriginalTs(threadTs);
  if (!ticket) return false;

  // Check for !open command
  if (messageText.includes('!open')) {
    ticket.forceOpen = true;
    ticket.graceTimerExpiry = null;
    logger.info(`Ticket ${threadTs} force-opened with !open command`);
  } else {
    ticket.forceOpen = false;
  }

  // Add to responders if not already present
  if (!ticket.responders.includes(userId)) {
    ticket.responders.push(userId);
    
    // First response - remove from queue
    if (ticket.inQueue) {
      ticket.inQueue = false;
      await updateQueueMessage(client, logger);
    }
  }

  // Update last responder
  ticket.lastResponderId = userId;

  // Reset grace timer if not force-opened
  if (!ticket.forceOpen) {
    ticket.graceTimerExpiry = Date.now() + GRACE_PERIOD_MS;
  }

  // If ticket was resolved, un-resolve it
  if (ticket.resolved) {
    const resolveTime = ticket.lastResolvedTs || 0;
    if (Date.now() - resolveTime > 10000) {
      await unresolveTicket(ticket, client, logger);
    } else {
      logger.info(`Ignored un-resolve on staff reply for ticket ${threadTs} (within 10s grace)`);
    }
  }

  // Update the queue if needed
  await updateQueueMessage(client, logger);
  await saveTicketData();

  return true;
}

/**
 * Handles when a non-staff user replies to a ticket thread.
 * Continues grace timer countdown, un-resolves if resolved.
 */
export async function handleUserResponse(
  threadTs: string,
  client: any,
  logger: any
): Promise<boolean> {
  const ticket = getTicketByOriginalTs(threadTs);
  if (!ticket) return false;

  // Update last responder to indicate it wasn't staff
  ticket.lastResponderId = null;

  // If ticket was resolved, un-resolve it
  if (ticket.resolved) {
    const resolveTime = ticket.lastResolvedTs || 0;
    if (Date.now() - resolveTime > 10000) {
      await unresolveTicket(ticket, client, logger);
    } else {
      logger.info(`Ignored un-resolve on user reply for ticket ${threadTs} (within 10s grace)`);
    }
  }

  // Grace timer continues (doesn't reset)
  await saveTicketData();

  return true;
}

/**
 * Marks a ticket as resolved.
 * Adds white checkmark reaction and posts closure message if staff is last responder.
 */
export async function resolveTicket(
  ticket: TicketInfo,
  resolverId: string,
  client: any,
  logger: any
): Promise<boolean> {
  // Prevent double resolution if already resolved
  if (ticket.resolved) {
    logger.info(`Ticket ${ticket.originalTs} is already resolved, skipping.`);
    return true;
  }

  try {
    ticket.resolved = true;
    ticket.graceTimerExpiry = null;
    ticket.lastResolvedTs = Date.now();

    // Add white checkmark reaction
    try {
      await rateLimitedCall('reactions.add', () =>
        client.reactions.add({
          name: 'white_check_mark',
          timestamp: ticket.originalTs,
          channel: ticket.originalChannel,
        }),
        CallPriority.High
      );
    } catch (error: any) {
      // Reaction might already exist, ignore
      if (error.data?.error !== 'already_reacted') {
        logger.warn('Failed to add checkmark reaction:', error);
      }
    }

    // Post closure message if staff is resolving or was the last responder
    const isStaffResolver = isTicketChannelMember(resolverId);
    const lastResponderWasStaff = ticket.lastResponderId && ticket.responders.includes(ticket.lastResponderId);

    if (isStaffResolver || lastResponderWasStaff || resolverId === 'system') {
      const closureResult: any = await rateLimitedCall('chat.postMessage', () =>
        client.chat.postMessage({
          channel: ticket.originalChannel,
          thread_ts: ticket.originalTs,
          text: TICKET_RESOLVED_MESSAGE.replace('{HELP_CHANNEL}', `<#${process.env.HELP_CHANNEL}>`),
        }),
        CallPriority.High
      );
      ticket.closureMessageTs = closureResult.ts;
    }

    // Remove from queue
    ticket.inQueue = false;
    await updateQueueMessage(client, logger);

    // Update leaderboard
    addResolution(resolverId);

    await saveTicketData();
    logger.info(`Ticket ${ticket.originalTs} marked as resolved`);
    return true;
  } catch (error) {
    logger.error('❌ Error resolving ticket:', error);
    return false;
  }
}

/**
 * Marks a ticket as unresolved.
 * Removes white checkmark reaction and deletes closure message if it exists.
 */
export async function unresolveTicket(
  ticket: TicketInfo,
  client: any,
  logger: any
): Promise<boolean> {
  try {
    ticket.resolved = false;

    // Remove white checkmark reaction
    try {
      await rateLimitedCall('reactions.remove', () =>
        client.reactions.remove({
          name: 'white_check_mark',
          timestamp: ticket.originalTs,
          channel: ticket.originalChannel,
        })
      );
    } catch (error) {
      // Reaction might not exist, ignore
      logger.warn('Failed to remove checkmark reaction:', error);
    }

    // Delete closure message if it exists
    if (ticket.closureMessageTs) {
      try {
        await rateLimitedCall('chat.delete', () =>
          client.chat.delete({
            channel: ticket.originalChannel,
            ts: ticket.closureMessageTs,
          })
        );
        ticket.closureMessageTs = undefined;
      } catch (error) {
        logger.warn('Failed to delete closure message:', error);
      }
    }

    // Add back to queue if there are no responders or if needed
    if (!ticket.inQueue && ticket.responders.length === 0) {
      ticket.inQueue = true;
      await updateQueueMessage(client, logger);
    }

    await saveTicketData();
    logger.info(`Ticket ${ticket.originalTs} unmarked as resolved`);
    return true;
  } catch (error) {
    logger.error('❌ Error unresolving ticket:', error);
    return false;
  }
}

/**
 * Searches the tickets channel for old messages from the bot and deletes them,
 * except for the current pinned queue message.
 */
export async function cleanupOldBotMessages(client: any, logger: any): Promise<void> {
  try {
    const ticketsChannel = process.env.TICKETS_CHANNEL;
    if (!ticketsChannel) {
      logger.error('❌ TICKETS_CHANNEL environment variable is not set');
      return;
    }

    const currentQueueTs = getQueueMessageTs();
    
    // Get bot user ID
    const authResult: any = await rateLimitedCall('auth.test', () => client.auth.test());
    if (!authResult.ok) {
      logger.error('❌ Failed to get bot user ID for cleanup');
      return;
    }
    const botId = authResult.user_id;

    logger.info(`🧹 Starting cleanup of old bot messages in ${ticketsChannel}`);

    // Fetch messages from the tickets channel
    const result: any = await rateLimitedCall('conversations.history', () =>
      client.conversations.history({
        channel: ticketsChannel,
        limit: 100,
      }),
      CallPriority.Low
    );

    if (result.ok && result.messages) {
      let deletedCount = 0;
      for (const message of result.messages) {
        // If message is from the bot and is not the current queue message
        if (message.user === botId && message.ts !== currentQueueTs) {
          try {
            await rateLimitedCall('chat.delete', () =>
              client.chat.delete({
                channel: ticketsChannel,
                ts: message.ts,
              }),
              CallPriority.Low
            );
            deletedCount++;
          } catch (deleteError: any) {
            // Log individual deletion failures but don't stop cleanup
            if (deleteError?.data?.error === 'cant_delete_message') {
              logger.info(`⚠️  Could not delete message ${message.ts} (permissions or age restriction)`);
            } else {
              logger.warn(`Failed to delete message ${message.ts}:`, deleteError);
            }
          }
        }
      }
      if (deletedCount > 0) {
        logger.info(`✅ Deleted ${deletedCount} old bot messages`);
      } else {
        logger.info('✨ No old bot messages to clean up');
      }
    }
  } catch (error) {
    logger.error('❌ Error cleaning up old bot messages:', error);
  }
}

/**
 * Updates or creates the pinned queue message in the tickets channel.
 * Shows all tickets currently needing help.
 */
/**
 * Updates the queue message in the tickets channel.
 * Updates the message in place by default, or reposts if needed.
 * Handles large queues by splitting across multiple messages if needed (max 2 parts).
 * @param client - Slack client
 * @param logger - Logger instance
 * @param forceRepost - If true, deletes and reposts message instead of updating in place
 */
export async function updateQueueMessage(
  client: any,
  logger: any,
  forceRepost: boolean = false
): Promise<boolean> {
  try {
    const ticketsChannel = process.env.TICKETS_CHANNEL;
    if (!ticketsChannel) return false;

    // Get all tickets in queue
    const ticketsInQueue = Object.values(tickets)
      .filter(t => t.inQueue && !t.resolved)
      .map(t => ({
        threadUrl: getThreadUrl(t.originalChannel, t.originalTs),
        responders: t.responders,
      }));

    // Split queue message into parts if needed (Slack 4000 char limit)
    const queueParts = splitQueueMessage(ticketsInQueue);
    const currentQueueTs = getQueueMessageTs();
    const newQueueTs: string[] = [];

    // Try to update existing messages if same number of parts
    if (!forceRepost && currentQueueTs.length === queueParts.length && currentQueueTs.length > 0) {
      let updateSuccess = true;
      for (let i = 0; i < queueParts.length; i++) {
        try {
          await rateLimitedCall('chat.update', () =>
            client.chat.update({
              channel: ticketsChannel,
              ts: currentQueueTs[i],
              text: queueParts[i],
            }),
            CallPriority.Low
          );
          newQueueTs.push(currentQueueTs[i]);
        } catch (error) {
          logger.warn(`Failed to update queue message part ${i + 1}, will repost:`, error);
          updateSuccess = false;
          break;
        }
      }
      if (updateSuccess) {
        return true;
      }
    }

    // Delete old queue messages if they exist
    if (currentQueueTs.length > 0) {
      for (const ts of currentQueueTs) {
        try {
          await rateLimitedCall('chat.delete', () =>
            client.chat.delete({
              channel: ticketsChannel,
              ts: ts,
            }),
            CallPriority.Low
          );
        } catch (error) {
          // Message might already be deleted, that's fine
          logger.info(`Old queue message ${ts} not found or already deleted`);
        }
      }
    }

    // Post new queue messages
    for (let i = 0; i < queueParts.length; i++) {
      const result: any = await rateLimitedCall('chat.postMessage', () =>
        client.chat.postMessage({
          channel: ticketsChannel,
          text: queueParts[i],
        }),
        CallPriority.Low
      );
      newQueueTs.push(result.ts);
      
      // Pin the message (try-catch to prevent losing timestamp if pinning fails)
      try {
        await rateLimitedCall('pins.add', () =>
          client.pins.add({
            channel: ticketsChannel,
            timestamp: result.ts,
          }),
          CallPriority.Low
        );
      } catch (pinError) {
        logger.warn(`Failed to pin queue message part ${i + 1}, but timestamp was saved:`, pinError);
      }
    }
    
    setQueueMessageTs(newQueueTs);
    
    // Save immediately after setting new timestamps
    await saveTicketData();
    
    return true;
  } catch (error) {
    logger.error('❌ Error updating queue message:', error);
    return false;
  }
}

/**
 * Checks all tickets with active grace timers.
 * Re-adds to queue if timer expired and staff is not last responder.
 */
export async function checkGraceTimers(
  client: any,
  logger: any
): Promise<void> {
  const now = Date.now();
  let queueChanged = false;

  for (const ticket of Object.values(tickets)) {
    if (
      !ticket.resolved &&
      !ticket.forceOpen &&
      ticket.graceTimerExpiry &&
      ticket.graceTimerExpiry <= now &&
      !ticket.inQueue
    ) {
      // Grace period expired and ticket not already in queue
      // Re-add to queue
      ticket.inQueue = true;
      queueChanged = true;
      logger.info(`Ticket ${ticket.originalTs} grace period expired, re-adding to queue`);
    }
  }

  if (queueChanged) {
    await updateQueueMessage(client, logger);
    await saveTicketData();
  }
}
