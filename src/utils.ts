/**
 * Formats a Slack timestamp for use in URLs by removing the decimal point.
 * Example: "1234567890.123456" -> "1234567890123456"
 */
export function formatTs(ts: string): string {
  return ts.replace('.', '');
}

/**
 * Creates Slack Block Kit blocks for displaying a ticket with action buttons.
 * @param originalMessageChannelId - The channel ID of the original help message
 * @param originalMessageTs - The timestamp of the original help message
 * @param claimText - Header text showing ticket status (e.g., "Claimed by: <@user>")
 * @param showAIResponse - Whether to display a quick response section (unused, kept for compatibility)
 */
export function createTicketBlocks(
  originalMessageChannelId: string,
  originalMessageTs: string,
  claimText: string = 'Not Claimed',
  showAIResponse: boolean = false
): any[] {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${claimText}*`,
      },
    },
  ];

  // Add action buttons
  blocks.push({
    type: 'actions',
    // @ts-ignore - Slack types are incomplete
    elements: [
      {
        type: 'button',
        style: 'primary',
        text: {
          type: 'plain_text',
          text: 'Mark Resolved',
          emoji: true,
        },
        value: 'claim_button',
        action_id: 'mark_resolved',
      },
      {
        type: 'button',
        style: 'danger',
        text: {
          type: 'plain_text',
          text: 'Seen, Not Sure',
          emoji: true,
        },
        value: 'not_sure_button',
        action_id: 'not_sure',
      },
      {
        type: 'users_select',
        placeholder: {
          type: 'plain_text',
          text: 'Assign (will DM assignee)',
          emoji: true,
        },
        action_id: 'assign_user',
      },
    ],
  });

  // Add link to original thread
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `<https://${process.env.SLACK_WORKSPACE_DOMAIN || 'yourworkspace.slack.com'}.slack.com/archives/${originalMessageChannelId}/p${formatTs(
        originalMessageTs
      )}|View Thread>`,
    },
  });

  return blocks;
}
