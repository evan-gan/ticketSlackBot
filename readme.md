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
15. Make a Mongodb and link it up!
16. Run `npm start`
