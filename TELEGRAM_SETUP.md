# Telegram Notifications Setup Guide

This guide explains how to set up Telegram notifications for breakout alerts and backtest results.

## Prerequisites

- A Telegram account
- Access to Telegram on your mobile device or desktop

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Start a chat with BotFather and send `/newbot`
3. Follow the instructions:
   - Choose a name for your bot (e.g., "Hyperliquid Alerts")
   - Choose a username for your bot (must end in 'bot', e.g., "hyperliquid_alerts_bot")
4. BotFather will give you a **bot token** that looks like:
   ```
   1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
5. **Save this token** - you'll need it for your `.env` file

## Step 2: Get Your Chat ID

### Method 1: Using the Bot (Recommended)

1. Search for your bot by its username in Telegram
2. Click **Start** or send any message to the bot
3. Open this URL in your browser (replace `<YourBOTToken>` with your actual bot token):
   ```
   https://api.telegram.org/bot<YourBOTToken>/getUpdates
   ```
4. Look for the `"chat":{"id":` field in the JSON response. Your chat ID will look like:
   ```json
   "chat": {
     "id": 123456789,
     "first_name": "Your Name",
     ...
   }
   ```
5. Copy the **chat ID** (the number after `"id":`)

### Method 2: Using @userinfobot

1. Search for **@userinfobot** in Telegram
2. Start a chat and it will immediately send you your ID
3. Use this ID as your chat ID

## Step 3: Configure Your Environment

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit the `.env` file and add your Telegram credentials:
   ```dotenv
   # Telegram Bot Configuration
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   TELEGRAM_CHAT_ID=123456789
   ```

3. Make sure your `.env` file is in the root directory of the project

## Step 4: Install Dependencies

Run the following command to install the required Telegram bot package:

```bash
npm install
# or
yarn install
```

## Step 5: Test Your Setup

### Test with Live Breakout Detection

Start the main application:

```bash
npm run build
npm start
```

When a breakout is detected, you should receive a Telegram message like:

```
🚀 BREAKOUT DETECTED

Coin: BTC
Type: STRONG
Confidence: 85/100

Price: $45,123.45
Price Change: +3.25%
Volume Ratio: 4.2x
Resistance: $44,000.00
Consolidation: 12h

Time: 11/18/2025, 3:05:00 PM
```

### Test with Backtest Runner

Run a backtest:

```bash
npm run build
node dist/backtest/backtestRunner.js run 1
```

After the backtest completes, you should receive a summary message like:

```
📊 BACKTEST COMPLETED

Period: 1 month
Coins Analyzed: 150

Results:
• Total Breakouts: 45
• Success Rate: 68.9%
• Avg 24h Gain: +4.23%
• Strong Signals: 12 (26.7%)

Rating: 🟡 Good
```

## Notification Types

### 1. Breakout Alerts (Live Detection)

Sent whenever a high-confidence breakout is detected (confidence score ≥ 50):

- **Strong breakouts** (≥75 confidence): 🚀 emoji
- **Moderate breakouts** (50-74 confidence): 📈 emoji
- **Weak breakouts** (not sent, filtered out)

### 2. Backtest Results

Sent when a backtest completes, includes:

- Period analyzed
- Number of coins
- Total breakouts found
- Success rate
- Average gains
- Quality rating

## Troubleshooting

### Bot Not Sending Messages

1. **Check credentials**: Make sure your bot token and chat ID are correct in `.env`
2. **Start the bot**: You must send at least one message to your bot before it can message you
3. **Check logs**: Look for Telegram-related errors in the console output

### "Telegram credentials not configured" Warning

This means either:
- Your `.env` file is missing
- `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` are not set in `.env`
- The application can't read the `.env` file

**Solution**: Make sure your `.env` file exists and contains both values.

### Invalid Bot Token Error

- Double-check your bot token from BotFather
- Make sure there are no extra spaces in your `.env` file
- Verify the token format: `number:alphanumeric_string`

### Invalid Chat ID Error

- Make sure you're using your personal chat ID, not the bot's ID
- Chat IDs are typically positive numbers (e.g., `123456789`)
- If you created a group, you need the group's chat ID (negative number)

## Disabling Notifications

To disable Telegram notifications:

1. Remove or comment out the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` lines in your `.env` file
2. Restart the application

The system will still work normally, but won't send Telegram messages.

## Privacy & Security

- **Keep your bot token secret**: Anyone with your bot token can send messages as your bot
- **Don't commit `.env`**: Make sure `.env` is in your `.gitignore` file
- **Bot permissions**: Your bot can only send messages to chats where it has been started/added

## Advanced: Group/Channel Notifications

To send notifications to a Telegram group or channel:

1. Add your bot to the group/channel as an administrator
2. Get the group/channel ID using the bot API method above
3. Use the group/channel ID (typically negative) as your `TELEGRAM_CHAT_ID`

Example group ID format: `-1001234567890`
