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
 * @param messageTs - The message timestamp
 */
export function getThreadUrl(channelId: string, messageTs: string): string {
  return `https://${process.env.SLACK_WORKSPACE_DOMAIN || 'yourworkspace.slack.com'}.slack.com/archives/${channelId}/p${formatTs(messageTs)}`;
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
