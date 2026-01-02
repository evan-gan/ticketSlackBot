# A basic slack FAQ ticketing system with AI quesiton summerys!
That's about it. More features to come!

## Setup
1. Navigate to the project directory and copy the example .env `cp .env.example .env`
2. Go to [Slack API Apps](https://api.slack.com/apps)
3. Click "Create New App"
4. Click "From a manifest"
5. Select "YAML"
6. Copy and paste the manifest from `manifest.yaml`
7. Install the app to your workspace
8. Navigate to "OAuth & Permissions" (in left sidebar once app created)
9. Copy the "Bot User OAuth Token" (starts with `xoxb-`) & put it in the .env
10. Navigate to "Basic Information"
11. Scroll down to "App-Level Tokens" and click "Generate token and Scopes"
12. Select all the options from the dropdown and name your token
13. Click generate and copy it (starts with `xapp-`) and put it in the .env
14. Add the main chanel and ticket channel ID's to the .env _Note: you MUST add the bot to both channels_
15. Run `npm start`

## Configuration

All bot behavior can be easily customized by editing **[`src/constants.ts`](src/constants.ts)**:

### Timers
- **`GRACE_PERIOD_MS`**: How long to wait before auto-resolving (default: 10 minutes)
- **`TIMER_CHECK_INTERVAL_MS`**: How often to check timers (default: 1 minute)

### Data & Persistence
- **`AUTO_SAVE_INTERVAL_MS`**: Backup save frequency (default: 5 minutes)
- **`DATA_FILE_NAME`**: Filename for data storage (default: 'ticket-data.json')

### Slack Integration
- **`MEMBER_REFRESH_INTERVAL_MS`**: How often to refresh help staff list (default: 1 hour)
- **`LEADERBOARD_POST_INTERVAL_MS`**: Daily leaderboard frequency (default: 24 hours)

### Messages & UI
- **`WELCOME_EMOJI`**: Emoji in welcome message (default: ':wave-pikachu-2:')
- **`WELCOME_MESSAGE_TEXT`**: Text shown to users when they create a ticket
- **`RESOLVE_BUTTON_TEXT`**: Button label (default: 'Resolve')
- **`TICKET_RESOLVED_MESSAGE`**: Message shown when ticket is closed
- **`QUEUE_MESSAGE_HEADER`**: Header text for the queue message
- **`UNCLAIMED_TEXT`**: Text for unclaimed tickets (default: 'Not claimed')
- **`CLAIMED_TEXT_FORMAT`**: Format for claimed tickets (use `{mentions}` placeholder)

### Startup
- **`STARTUP_NOTIFICATION_USER_ID`**: User to notify on startup (set to `null` to disable)
- **`STARTUP_MESSAGE`**: Startup notification text

**All constants include detailed comments in the file explaining their purpose and usage!**