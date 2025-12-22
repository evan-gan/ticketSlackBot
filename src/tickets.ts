import {
  TicketInfo,
  tickets,
  ticketsByOriginalTs,
  getTicketByTicketTs,
  getTicketByOriginalTs,
  saveTicketData,
  addResolution,
} from './data';
import { createTicketBlocks, formatTs } from './utils';

/**
 * Creates a new ticket from a help channel message.
 * Posts the ticket to the tickets channel and sets up tracking.
 */
export async function createTicket(
  message: { text: string; ts: string; channel: string; user: string },
  client: any,
  logger: any
): Promise<TicketInfo | null> {
  try {
    // Post the ticket message to the tickets channel
    const result = await client.chat.postMessage({
      text: 'Open to view message',
      channel: process.env.TICKETS_CHANNEL,
      blocks: createTicketBlocks(message.channel, message.ts),
    });

    if (result.ok && result.ts) {
      // Create and store ticket information
      const ticketInfo: TicketInfo = {
        originalChannel: message.channel,
        originalTs: message.ts,
        ticketMessageTs: result.ts,
        claimers: [],
        notSure: [],
      };

      tickets[result.ts] = ticketInfo;
      ticketsByOriginalTs[message.ts] = result.ts;

      console.info(`✅ Ticket created for message ${message.ts} as ${result.ts}`);

      await saveTicketData();
      return ticketInfo;
    }
  } catch (error) {
    logger.error('❌ Error creating ticket:', error);
  }

  return null;
}

/**
 * Updates a ticket message with current status and claim information.
 */
export async function updateTicketMessage(
  ticket: TicketInfo,
  client: any,
  logger: any
): Promise<boolean> {
  if (!ticket) return false;

  try {
    // Build header text based on current claims
    let headerText = 'Not Claimed';

    if (ticket.claimers.length > 0) {
      headerText = `Claimed by: ${ticket.claimers.map((id) => `<@${id}>`).join(', ')}`;
    } else if (ticket.notSure.length > 0) {
      headerText = `Not Claimed | Not sure: ${ticket.notSure.map((id) => `<@${id}>`).join(', ')}`;
    }

    // Update the ticket message
    await client.chat.update({
      channel: process.env.TICKETS_CHANNEL,
      ts: ticket.ticketMessageTs,
      text: 'Open to view message',
      blocks: createTicketBlocks(ticket.originalChannel, ticket.originalTs, headerText),
    });

    await saveTicketData();
    return true;
  } catch (error) {
    logger.error('❌ Error updating ticket message:', error);
    return false;
  }
}

/**
 * Adds a user to a ticket's claimers list and updates the message.
 */
export async function claimTicket(
  userId: string,
  ticketTs: string,
  client: any,
  logger: any
): Promise<boolean> {
  const ticket = getTicketByTicketTs(ticketTs);
  if (!ticket) return false;

  // Add user to claimers if not already present
  if (!ticket.claimers.includes(userId)) {
    ticket.claimers.push(userId);
  }

  return await updateTicketMessage(ticket, client, logger);
}

/**
 * Marks a ticket as "seen but not sure" for a specific user.
 */
export async function markTicketAsNotSure(
  userId: string,
  ticketTs: string,
  client: any,
  logger: any
): Promise<boolean> {
  const ticket = getTicketByTicketTs(ticketTs);
  if (!ticket) return false;

  if (!ticket.notSure.includes(userId)) {
    ticket.notSure.push(userId);
  }

  return await updateTicketMessage(ticket, client, logger);
}

/**
 * Resolves a ticket by deleting it and updating the original thread.
 * Also records the resolution for the leaderboard.
 */
export async function resolveTicket(
  ticketTs: string,
  resolverId: string,
  client: any,
  logger: any
): Promise<boolean> {
  try {
    const ticket = getTicketByTicketTs(ticketTs);
    if (!ticket) return false;

    // Verify original message still exists and post resolution notification
    try {
      const messageHistory = await client.conversations.history({
        channel: ticket.originalChannel,
        latest: ticket.originalTs,
        inclusive: true,
        limit: 1,
      });

      if (messageHistory.ok && messageHistory.messages && messageHistory.messages.length > 0) {
        // Post resolution message to original thread
        await client.chat.postMessage({
          channel: ticket.originalChannel,
          thread_ts: ticket.originalTs,
          text: `This ticket has been marked as resolved. Please send a new message in <#${process.env.HELP_CHANNEL}> to create a new ticket. (new ticket = faster response)`,
        });
      } else {
        logger.warn(
          `Original message for ticket ${ticketTs} no longer exists. Proceeding with resolution.`
        );
      }
    } catch (error) {
      logger.warn(`Failed to notify original thread for ticket ${ticketTs}:`, error);
    }

    // Delete the ticket message from the tickets channel
    await client.chat.delete({
      channel: process.env.TICKETS_CHANNEL,
      ts: ticketTs,
    });

    // Clean up tracking records
    delete ticketsByOriginalTs[ticket.originalTs];
    delete tickets[ticketTs];

    // Update leaderboard
    addResolution(resolverId);

    await saveTicketData();
    return true;
  } catch (error) {
    logger.error('❌ Error resolving ticket:', error);
    return false;
  }
}
