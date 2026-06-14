import {
  WELCOME_MESSAGE_TEXT,
  RESOLVE_BUTTON_TEXT,
  ALL_TICKETS_RESOLVED_MESSAGE,
  QUEUE_MESSAGE_HEADER,
  UNCLAIMED_TEXT,
  CLAIMED_TEXT_FORMAT,
} from './constants';

/**
 * Formats a Slack timestamp for use in URLs by removing the decimal point.
 * Example: "1234567890.123456" -> "1234567890123456"
 */
export function formatTs(ts: string): string {
  return ts.replace('.', '');
}

/**
 * Generates a Slack thread URL.
 * @param channelId - The channel ID
 * @param messageTs - The message timestamp (thread root)
 * @param replyTs - The reply timestamp in the thread (optional, links to specific reply and opens thread)
 */
export function getThreadUrl(channelId: string, messageTs: string, replyTs?: string): string {
  const baseUrl = `https://${process.env.SLACK_WORKSPACE_DOMAIN || 'yourworkspace.slack.com'}.slack.com/archives/${channelId}/p${formatTs(messageTs)}`;
  if (replyTs) {
    return `${baseUrl}?thread_ts=${messageTs}&cid=${channelId}&message_ts=${replyTs}`;
  }
  return baseUrl;
}

/**
 * Creates Slack Block Kit blocks for the initial welcome message with Resolve button.
 * This button allows users (both OP and help staff) to mark their issue as resolved.
 */
export function createWelcomeBlocks(): any[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${WELCOME_MESSAGE_TEXT}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: {
            type: 'plain_text',
            text: RESOLVE_BUTTON_TEXT,
            emoji: true,
          },
          value: 'resolve_button',
          action_id: 'resolve_ticket_button',
        },
      ],
    },
  ];
}

/**
 * Creates the queue message text that lists all tickets needing help.
 * @param ticketsInQueue - Array of ticket info for tickets currently in queue
 */
export function createQueueMessageText(ticketsInQueue: Array<{ threadUrl: string; responders: string[] }>): string {
  if (ticketsInQueue.length === 0) {
    return ALL_TICKETS_RESOLVED_MESSAGE;
  }

  // Format timestamp as "Last updated: Jan 1, 2026 at 12:34 PM"
  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  let queueText = `${QUEUE_MESSAGE_HEADER}\n_Last updated: ${timestamp}_\n\n`;
  ticketsInQueue.forEach((ticket, index) => {
    const claimStatus = ticket.responders.length === 0 
      ? UNCLAIMED_TEXT
      : CLAIMED_TEXT_FORMAT.replace('{mentions}', ticket.responders.map(id => `<@${id}>`).join(', '));
    queueText += `${index + 1}. ${claimStatus} - <${ticket.threadUrl}|View Thread>\n`;
  });

  return queueText;
}

/**
 * Builds the entire ticket queue as a single canvas markdown string.
 * One section = one lookup + one delete + one insert per update cycle, which is
 * reliable. Always includes the header so the section is findable by
 * contains_text: "Tickets Needing Response".
 */
export function buildCanvasContent(ticketsInQueue: Array<{ threadUrl: string; responders: string[] }>): string {
  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const lines: string[] = [`**🎫 Tickets Needing Response** — _Last updated: ${timestamp}_`];

  if (ticketsInQueue.length === 0) {
    lines.push('✅ All tickets have been responded to!');
  } else {
    ticketsInQueue.forEach((ticket, index) => {
      const claimStatus = ticket.responders.length === 0
        ? UNCLAIMED_TEXT
        : CLAIMED_TEXT_FORMAT.replace('{mentions}', ticket.responders.map(name => `\`@${name}\``).join(', '));
      lines.push(`**${index + 1}. ${claimStatus}** — [View thread](${ticket.threadUrl})`);
    });
  }

  // Two trailing spaces before \n = CommonMark hard line break within one paragraph.
  // Slack canvas renders this as <br> inside a single <p> section — one section total,
  // which means only one delete + one insert per queue update.
  return lines.join('  \n');
}

/**
 * Splits the queue message into parts if it exceeds Slack's 4000 character limit.
 * Returns an array with 1-2 parts.
 * @param ticketsInQueue - Array of ticket info for tickets currently in queue
 */
export function splitQueueMessage(
  ticketsInQueue: Array<{ threadUrl: string; responders: string[] }>
): string[] {
  if (ticketsInQueue.length === 0) {
    return [ALL_TICKETS_RESOLVED_MESSAGE];
  }

  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const header = `${QUEUE_MESSAGE_HEADER}\n_Last updated: ${timestamp}_\n\n`;
  const maxCharsPerMessage = 3800; // Leave buffer for Slack limits
  const parts: string[] = [];
  let currentPart = header;

  for (let index = 0; index < ticketsInQueue.length; index++) {
    const ticket = ticketsInQueue[index];
    const claimStatus = ticket.responders.length === 0 
      ? UNCLAIMED_TEXT
      : CLAIMED_TEXT_FORMAT.replace('{mentions}', ticket.responders.map(id => `<@${id}>`).join(', '));
    const ticketLine = `${index + 1}. ${claimStatus} - <${ticket.threadUrl}|View Thread>\n`;

    // Check if adding this line would exceed limit
    if ((currentPart + ticketLine).length > maxCharsPerMessage && currentPart !== header) {
      // Save current part and start a new one
      parts.push(currentPart);
      currentPart = `${QUEUE_MESSAGE_HEADER} (continued)\n\n`;
    }

    currentPart += ticketLine;
  }

  // Add the last part
  if (currentPart !== header) {
    parts.push(currentPart);
  }

  return parts.length > 0 ? parts : [header];
}
