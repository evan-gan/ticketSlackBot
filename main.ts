import { App, LogLevel } from '@slack/bolt';
import * as dotenv from 'dotenv';
import * as fs from 'fs-extra';
import * as path from 'path';
dotenv.config();

// Define channel IDs from env vars
const HELP_CHANNEL = process.env.HELP_CHANNEL!;
const TICKETS_CHANNEL = process.env.TICKETS_CHANNEL!;
const DATA_FILE_PATH = path.join(__dirname, 'ticket-data.json');
const AI_ENDPOINT = process.env.AI_ENDPOINT || 'error: AI_ENDPOINT not set';

// In-memory mapping of ticket message IDs to original message info
interface TicketInfo {
    originalChannel: string;
    originalTs: string;
    ticketMessageTs: string;
    claimers: string[];
    notSure: string[];
    AIQuickResponse: string;
    AIQuestionSummery: string;
}

interface ReactionEvent {
    reaction: string;
    item: {
        channel: string;
        ts: string;
    };
    user: string;
}

const tickets: Record<string, TicketInfo> = {};
// Additional map to quickly look up tickets by original message timestamp
const ticketsByOriginalTs: Record<string, string> = {};

// Function to save ticket data to a file
async function saveTicketData() {
    try {
        const data = {
            tickets,
            ticketsByOriginalTs
        };
        await fs.writeJSON(DATA_FILE_PATH, data, { spaces: 2 });
        console.log('Ticket data saved to file');
    } catch (error) {
        console.error('Error saving ticket data to file:', error);
    }
}

// Function to load ticket data from a file
async function loadTicketData() {
    try {
        if (await fs.pathExists(DATA_FILE_PATH)) {
            const data = await fs.readJSON(DATA_FILE_PATH);

            // Clear existing data first
            Object.keys(tickets).forEach(key => delete tickets[key]);
            Object.keys(ticketsByOriginalTs).forEach(key => delete ticketsByOriginalTs[key]);

            // Load data from file
            if (data.tickets) {
                Object.assign(tickets, data.tickets);
            }
            if (data.ticketsByOriginalTs) {
                Object.assign(ticketsByOriginalTs, data.ticketsByOriginalTs);
            }

            console.log(`Loaded ${Object.keys(tickets).length} tickets from file`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error loading ticket data from file:', error);
        return false;
    }
}

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
    logLevel: LogLevel.WARN,
});

// Cache of ticket channel members (user IDs)
let ticketChannelMembers: string[] = [];

// Utility: format a Slack timestamp for a URL (remove the decimal point)
function formatTs(ts: string): string {
    return ts.replace('.', '');
}

function createTicketBlocks(AIQuestionSummery: string, AIQuickResponse: string, originalMessageChannelID: string, originalMessageTs: string, claimText?: string): any[] {
    const headerText = claimText ? claimText : 'Not Claimed';
    return [
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: "*" + headerText + "*",
                // emoji: true
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*AI summary:* ${AIQuestionSummery}`
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*Quick response:* ${AIQuickResponse}`
            }
        },
        {
            type: "actions",
            elements: [
                {
                    type: "button",
                    style: "primary",
                    text: {
                        type: "plain_text",
                        text: "Mark Resolved",
                        emoji: true
                    },
                    value: "claim_button",
                    action_id: "mark_resolved"
                },
                {
                    type: "button",
                    style: "danger",
                    text: {
                        type: "plain_text",
                        text: "Seen, Not Sure",
                        emoji: true
                    },
                    value: "not_sure_button",
                    action_id: "not_sure"
                },
                {
                    type: "users_select",
                    placeholder: {
                        type: "plain_text",
                        text: "Assign (will DM assignee)",
                        emoji: true
                    },
                    action_id: "assign_user"
                }
            ]
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: `<https://${process.env.SLACK_WORKSPACE_DOMAIN || 'yourworkspace.slack.com'}.slack.com/archives/${originalMessageChannelID}/p${formatTs(originalMessageTs)}|View Thread>`
            }
        }
    ];
}

// Function to refresh the list of ticket channel members
async function refreshTicketChannelMembers(client) {
    try {
        const result = await client.conversations.members({
            channel: TICKETS_CHANNEL
        });

        if (result.ok && result.members) {
            ticketChannelMembers = result.members;
            return true;
        }
        return false;
    } catch (error) {
        console.error("Failed to fetch ticket channel members:", error);
        return false;
    }
}

// Check if a user is a member of the tickets channel
function isTicketChannelMember(userId: string): boolean {
    return ticketChannelMembers.includes(userId);
}

// Function to get a ticket by its original thread timestamp
function getTicketByOriginalTs(originalTs: string): TicketInfo | null {
    const ticketTs = ticketsByOriginalTs[originalTs];
    return ticketTs ? tickets[ticketTs] : null;
}

// Function to get a ticket by its ticket timestamp
function getTicketByTicketTs(ticketTs: string): TicketInfo | null {
    return tickets[ticketTs] || null;
}

// Function to create a ticket
async function createTicket(message: { text: string; ts: string; channel: string; user: string }, client, logger) {
    try {
        const aiResponse = JSON.parse(await fetchAIResponse(
            "Please return ONLY A JSON of a summery of a users question and a potential response. " +
            "The JSON should have the accessors of .response & .summary. " +
            "Please make the potential response really friendly while not being cheesy. " +
            "The summery ideally should be sorter than the question and make it super basic to what the underlying ask is. " +
            "Please have a normal reply tone, for example, if the user asks what is 1+2, you would reply 1+2 is 3. Another example, If the user asks how to get from boston logan to the aquarium, you would reply Take the silver line to the blue line" +
            "DO NOT REPOND IN A CODE BLOCK, JUST A PURE JSON. Here is the question:" + message.text
        ));

        // Post the ticket message to the tickets channel
        const result = await client.chat.postMessage({
            text: "Open to view message",
            channel: TICKETS_CHANNEL,
            blocks: createTicketBlocks(aiResponse.summary, aiResponse.response, message.channel, message.ts)
        });

        if (result.ok && result.ts) {
            // Save mapping of ticket message to original message info
            const ticketInfo: TicketInfo = {
                originalChannel: message.channel,
                originalTs: message.ts,
                ticketMessageTs: result.ts,
                claimers: [],
                notSure: [],
                AIQuickResponse: aiResponse.response,
                AIQuestionSummery: aiResponse.summary
            };

            tickets[result.ts] = ticketInfo;
            ticketsByOriginalTs[message.ts] = result.ts;

            console.info(`Ticket created for message ${message.ts} as ${result.ts}`);

            // Save ticket data after creating a new ticket
            await saveTicketData();

            return ticketInfo;
        }
    } catch (error) {
        logger.error("Error creating ticket:", error);
    }
    return null;
}

// Function to update a ticket message with new information
async function updateTicketMessage(ticket: TicketInfo, client, logger) {
    if (!ticket) return false;

    try {
        // Create claim text based on who has claimed it
        let headerText = 'Not Claimed';

        if (ticket.claimers.length > 0) {
            headerText = `Claimed by: ${ticket.claimers.map(id => `<@${id}>`).join(', ')}`;
        } else if (ticket.notSure.length > 0) {
            headerText = `Not Claimed | Not sure: ${ticket.notSure.map(id => `<@${id}>`).join(', ')}`;
        }

        // Update the ticket message with the current information
        await client.chat.update({
            channel: TICKETS_CHANNEL,
            ts: ticket.ticketMessageTs,
            text: "Open to view message",
            blocks: createTicketBlocks(
                ticket.AIQuestionSummery,
                ticket.AIQuickResponse,
                ticket.originalChannel,
                ticket.originalTs,
                headerText
            )
        });

        // Save ticket data after updating a ticket
        await saveTicketData();

        return true;
    } catch (error) {
        logger.error("Error updating ticket message:", error);
        return false;
    }
}

// Function to claim a ticket
async function claimTicket(userId: string, ticketTs: string, client, logger) {
    const ticket = getTicketByTicketTs(ticketTs);
    if (!ticket) return false;

    // Add the user to claimers if not already there
    if (!ticket.claimers.includes(userId)) {
        ticket.claimers.push(userId);
    }

    return await updateTicketMessage(ticket, client, logger);
}

// Function to mark a ticket as "not sure"
async function markTicketAsNotSure(userId: string, ticketTs: string, client, logger) {
    const ticket = getTicketByTicketTs(ticketTs);
    if (!ticket) return false;

    if (!ticket.notSure.includes(userId)) {
        ticket.notSure.push(userId);
    }

    return await updateTicketMessage(ticket, client, logger);
}

// Function to resolve (delete) a ticket
async function resolveTicket(ticketTs: string, client, logger) {
    try {
        const ticket = getTicketByTicketTs(ticketTs);
        if (!ticket) return false;

        // Reply to the original thread to notify the user
        await client.chat.postMessage({
            channel: ticket.originalChannel,
            thread_ts: ticket.originalTs,
            text: `This ticket has been marked as resolved. Please send a new message in <#${HELP_CHANNEL}> to create a new ticket. (new ticket = faster response)`
        });

        // Delete the ticket message from the tickets channel
        await client.chat.delete({
            channel: TICKETS_CHANNEL,
            ts: ticketTs
        });

        // Clean up our records
        delete ticketsByOriginalTs[ticket.originalTs];
        delete tickets[ticketTs];

        // Save ticket data after resolving a ticket
        await saveTicketData();

        return true;
    } catch (error) {
        logger.error("Error resolving ticket:", error);
        return false;
    }
}

// Listen for messages in the help channel to create tickets
app.event('message', async ({ event, client, logger }) => {
    // Only process new messages in the help channel (not thread replies)
    if (event.channel !== HELP_CHANNEL || (event as any).thread_ts) return;
    if ((event as any).subtype) return; // Skip edited messages, etc.

    const message = event as { text: string; ts: string; channel: string; user: string };
    await createTicket(message, client, logger);
});

// Listen for thread replies in the help channel to handle claims
app.event('message', async ({ event, client, logger }) => {
    // Only process thread replies in the help channel
    if (!((event as any).thread_ts) || event.channel !== HELP_CHANNEL || (event as any).thread_ts === event.ts) return;
    if ((event as any).subtype) return; // Skip edited messages, etc.

    const threadReply = event as { thread_ts: string; user: string };

    // Skip if user is not a member of the tickets channel
    if (!isTicketChannelMember(threadReply.user)) {
        logger.info(`User ${threadReply.user} tried to claim a ticket but is not in the tickets channel`);
        return;
    }

    // Get the ticket by the original thread timestamp
    const ticket = getTicketByOriginalTs(threadReply.thread_ts);

    if (ticket) {
        // Use the claimTicket function to claim the ticket
        const success = await claimTicket(threadReply.user, ticket.ticketMessageTs, client, logger);
        if (success) {
            logger.info(`Ticket ${ticket.ticketMessageTs} claimed by ${threadReply.user}`);
        }
    }
});

// Handle button action "Mark Resolved"
app.action('mark_resolved', async ({ body, ack, client, logger }) => {
    await ack();

    const userId = (body.user || {}).id;
    // Skip if user is not a member of the tickets channel
    if (!isTicketChannelMember(userId)) {
        logger.info(`User ${userId} tried to resolve a ticket but is not in the tickets channel`);
        return;
    }

    const ticketTs = (body as any).message?.ts;
    if (!ticketTs) return;

    const success = await resolveTicket(ticketTs, client, logger);
    if (success) {
        logger.info(`Ticket ${ticketTs} marked as resolved (deleted) by ${userId}`);
    }
});

// Handle button action "Seen, Not Sure"
app.action('not_sure', async ({ body, ack, client, logger }) => {
    await ack();

    const ticketTs = (body as any).message?.ts;
    const userId = (body.user || {}).id;

    if (!ticketTs || !userId) return;

    // Skip if user is not a member of the tickets channel
    if (!isTicketChannelMember(userId)) {
        logger.info(`User ${userId} tried to mark "not sure" but is not in the tickets channel`);
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
    // Skip if user is not a member of the tickets channel
    if (!isTicketChannelMember(userId)) {
        logger.info(`User ${userId} tried to assign a ticket but is not in the tickets channel`);
        return;
    }

    const ticketTs = (body as any).message?.ts;
    const selectedUser = (body as any).actions?.[0]?.selected_user as string;

    if (!ticketTs || !selectedUser) return;

    const ticket = getTicketByTicketTs(ticketTs);
    if (!ticket) return;

    try {
        // DM the assigned user
        await client.chat.postMessage({
            channel: selectedUser,
            text: `You have been assigned a ticket from <#${TICKETS_CHANNEL}>. Please check it out & claim it by replying.\n<https://${process.env.SLACK_WORKSPACE_DOMAIN || 'yourworkspace.slack.com'}.slack.com/archives/${TICKETS_CHANNEL}/p${formatTs(ticket.ticketMessageTs)}|View Ticket>`
        });

        logger.info(`User ${selectedUser} was assigned ticket ${ticketTs}`);
    } catch (error) {
        logger.error(error);
    }
});

// Listen for reaction added events to resolve tickets
app.event('reaction_added', async ({ event, client, logger }) => {
    const reactionEvent = event as ReactionEvent;

    // Skip if user is not a member of the tickets channel
    if (!isTicketChannelMember(reactionEvent.user)) {
        logger.info(`User ${reactionEvent.user} tried to resolve a ticket via reaction but is not in the tickets channel`);
        return;
    }

    // Check for the check mark reaction in the help channel
    if (reactionEvent.reaction === 'white_check_mark' && reactionEvent.item.channel === HELP_CHANNEL) {
        // Get the ticket by its original timestamp
        const ticket = getTicketByOriginalTs(reactionEvent.item.ts);
        if (!ticket) return;

        // Allow resolving if:
        // 1. User is the original message author, OR
        // 2. User is in the tickets channel
        try {
            // Get the original message to check the author
            const messageInfo = await client.conversations.history({
                channel: reactionEvent.item.channel,
                latest: reactionEvent.item.ts,
                limit: 1,
                inclusive: true
            });

            const isOriginalAuthor = messageInfo.messages &&
                messageInfo.messages[0] &&
                messageInfo.messages[0].user === reactionEvent.user;

            if (isOriginalAuthor || isTicketChannelMember(reactionEvent.user)) {
                const success = await resolveTicket(ticket.ticketMessageTs, client, logger);
                if (success) {
                    logger.info(`Ticket resolved via reaction by ${reactionEvent.user} (${isOriginalAuthor ? 'original author' : 'support team member'})`);
                }
            } else {
                logger.info(`User ${reactionEvent.user} tried to resolve a ticket via reaction but is not authorized`);
            }
        } catch (error) {
            logger.error("Error checking message author:", error);
        }
    }
});

// Fetch AI response from the Hack Club AI service
async function fetchAIResponse(userInput) {
    try {
        const response = await fetch(AI_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: [{ role: 'user', content: userInput }],
                stream: false
            })
        });

        if (!response.ok) throw new Error("Failed to fetch AI response");

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "Error: No response content";
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

// Start the app
(async () => {
    // Load ticket data from file before starting the app
    await loadTicketData();

    await app.start();

    // Initialize the ticket channel members cache
    const client = app.client;
    await refreshTicketChannelMembers(client);

    // Refresh the ticket channel members list every hour
    setInterval(() => refreshTicketChannelMembers(client), 60 * 60 * 1000);

    // Periodically save ticket data (every 5 minutes as a backup)
    setInterval(saveTicketData, 5 * 60 * 1000);

    console.log(`⚡️ Slack Bolt app is running!`);
})();
