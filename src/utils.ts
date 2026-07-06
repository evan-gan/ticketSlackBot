import {
  WELCOME_MESSAGE_TEXT,
  RESOLVE_BUTTON_TEXT,
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
