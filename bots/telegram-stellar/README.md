# StellrFlow Telegram Bot - Stellar Integration

Telegram bot with Stellar integration for the StellrFlow workflow builder. Adapted from [fluid-labs/core/bots/telegram](https://github.com/fluid-labs/core/tree/main/bots) (AO) for Stellar.

## Features

- **/start** - Welcome message
- **/register** - Get your chat ID (for workflows)
- **/balance &lt;address&gt;** - Check XLM balance via Horizon
- **/help** - List commands
- **POST /api/telegram/send** - Send notifications (used by frontend workflows)
- **GET /api/stellar/balance/:address** - Balance API for workflows

## Setup

### 1. Create Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the bot token

### 2. Install & Run

```bash
cd bots/telegram-stellar
cp .env.example .env
# Edit .env and add TELEGRAM_BOT_TOKEN
npm install
npm run dev
```

### 3. Get Chat ID

1. Start a chat with your bot
2. Send `/register`
3. The bot replies with your chat ID

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/telegram/send` | POST | Send message: `{ chatId, message }` |
| `/api/stellar/balance/:address` | GET | Get XLM balance |
| `/api/telegram/health` | GET | Health check |

## Integration with StellrFlow Frontend

Set the API base URL in the frontend to point to this bot (e.g. `http://localhost:3003`) when using the Stellar Telegram workflow nodes.

## References

- [Stellar Developer Docs](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)
- [@stellar/stellar-sdk](https://stellar.github.io/js-stellar-sdk/)
