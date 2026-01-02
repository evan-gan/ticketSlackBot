# Migration Guide: Old System → New Ticketing System

## Overview
This guide helps you transition from the old claim-based system to the new smart ticketing system with auto-resolution, grace periods, and queue management.

## Key Changes

### Data Structure Changes

#### Old TicketInfo
```typescript
{
  claimers: string[];
  notSure: string[];
}
```

#### New TicketInfo
```typescript
{
  responders: string[];           // Replaces 'claimers'
  resolved: boolean;
  graceTimerExpiry: number | null;
  forceOpen: boolean;
  lastResponderId: string | null;
  inQueue: boolean;
  closureMessageTs?: string;
  internalMessageTs?: string;
}
```

### Behavior Changes

| Old Behavior | New Behavior |
|-------------|--------------|
| Manual "Mark Resolved" button in tickets channel | "Resolve" button in thread welcome message |
| Tickets deleted when resolved | Tickets stay, marked with ✅ reaction |
| Manual "Seen, Not Sure" button | Removed (not needed with auto-queue) |
| Static ticket messages with buttons | Simple one-line status messages |
| Manual assignment via dropdown | Removed (natural claiming by replying) |
| No auto-resolution | Auto-resolves after 10min if staff is last reply |
| No queue system | Smart queue that updates in real-time |

## Migration Steps

### 1. Back Up Existing Data
```bash
cp ticket-data.json ticket-data-backup.json
```

### 2. Clear Old Ticket Data (Optional)
Since the data structure changed significantly, you may want to start fresh:
```bash
rm ticket-data.json
```

Or manually migrate if you have active tickets - update the structure:
```json
{
  "tickets": {
    "1234567890.123456": {
      "originalChannel": "C...",
      "originalTs": "1234567890.123456",
      "ticketMessageTs": "1234567890.123457",
      "responders": [],
      "resolved": false,
      "graceTimerExpiry": null,
      "forceOpen": false,
      "lastResponderId": null,
      "inQueue": true
    }
  },
  "ticketsByOriginalTs": {
    "1234567890.123456": "1234567890.123456"
  },
  "lbForToday": [],
  "queueMessageTs": null
}
```

### 3. Update Slack App Permissions
The new system requires an additional permission:
1. Go to your Slack app settings
2. Navigate to "OAuth & Permissions"
3. Add the `pins:write` scope
4. Reinstall the app to your workspace

### 4. Update Environment Variables
Ensure these are set in your `.env`:
```env
HELP_CHANNEL=C0123456789
TICKETS_CHANNEL=C9876543210
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_WORKSPACE_DOMAIN=yourworkspace
```

### 5. Deploy New Code
```bash
pnpm install  # Ensure dependencies are up to date
pnpm build    # Build TypeScript
pnpm start    # Start the bot
```

### 6. Verify Startup
Check for these log messages:
- `✅ Loaded X tickets from file`
- `✅ Found X members in tickets channel`
- `⚡️ Slack Bolt app is running!`

### 7. Test Basic Functionality

#### Test Ticket Creation
1. Post a message in the help channel
2. Verify you see the welcome message with "Resolve" button
3. Check tickets channel for simple status message
4. Confirm queue message is created and pinned

#### Test Help Staff Response
1. Reply to the thread as a help staff member
2. Verify:
   - Ticket removed from queue
   - Status shows "Claimed by: @you"
   - Grace timer started (check logs)

#### Test User Response
1. Reply to the thread as a regular user
2. Verify:
   - Ticket NOT removed from queue (if it was in queue)
   - Grace timer continues

#### Test Auto-Resolution
1. Have help staff reply to a ticket
2. Wait 10 minutes
3. Verify ticket auto-resolves:
   - ✅ reaction added
   - Closure message posted
   - Removed from queue

#### Test !open Command
1. Have help staff reply with `!open` in the message
2. Verify ticket stays in queue
3. Wait 10+ minutes - ticket should NOT auto-resolve

#### Test Manual Resolution
1. Click "Resolve" button in welcome message
2. Verify ✅ reaction added and closure message posted

#### Test Un-Resolution
1. Resolve a ticket
2. Reply to it
3. Verify ✅ removed and ticket active again

## Troubleshooting

### Queue Message Not Appearing
- Check `pins:write` permission
- Verify bot is in TICKETS_CHANNEL
- Check logs for errors

### Timers Not Working
- Timers check every 1 minute
- Check server system time
- Look for "grace period expired" in logs

### Old Buttons Don't Work
- Old action IDs removed: `mark_resolved`, `not_sure`, `assign_user`
- New action ID: `resolve_ticket_button`
- Users should use the new Resolve button in threads

### Data Not Persisting
- Check file permissions for `ticket-data.json`
- Verify no errors in save/load logs
- Data saves every 5 minutes and on changes

## Communication Plan

### For Help Staff
Send this message before deploying:
```
🚀 Ticketing System Update!

We're upgrading to a smarter ticketing system. Here's what's new:

✅ Auto-Resolution: If you're the last to reply, tickets auto-resolve after 10 minutes
⏰ Smart Timers: Tickets with no staff response go back to the queue
🎯 Easy Override: Use !open in your message to keep investigating
📋 Live Queue: See all tickets needing help in real-time

The "Resolve" button moved to the thread itself. Just reply normally and the system handles the rest!
```

### For Users
Post in help channel:
```
📢 Our ticket system got an upgrade!

When you post a question, you'll now see a welcome message with a "Resolve" button. Click it when your issue is solved!

If you keep getting help, the conversation continues naturally. The bot is smarter about when tickets are truly done. 🤖✨
```

## Rollback Plan

If issues arise, you can rollback:

1. Stop the bot
2. Checkout the previous version:
   ```bash
   git checkout old_simple_bot_refrence
   ```
3. Restore old data:
   ```bash
   cp ticket-data-backup.json ticket-data.json
   ```
4. Start the bot with old code:
   ```bash
   pnpm start
   ```

## Post-Migration Validation

After 24 hours, verify:
- [ ] Tickets are being created correctly
- [ ] Queue updates in real-time
- [ ] Grace timers are working
- [ ] Auto-resolution happens correctly
- [ ] Manual resolution works
- [ ] Un-resolution works when people reply
- [ ] Leaderboard still tracking resolutions
- [ ] No error messages in logs

## Support

If you encounter issues:
1. Check logs for error messages
2. Verify all environment variables are set
3. Confirm bot permissions are correct
4. Check GitHub issues for similar problems
5. Review the copilot-instructions.md for architecture details
