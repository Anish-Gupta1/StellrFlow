/**
 * StellrFlow Telegram Bot - Stellar Integration
 *
 * Adapted from fluid-labs/core/bots/telegram (AO) for Stellar.
 * Uses @stellar/stellar-sdk for balance checks and payments.
 *
 * @see https://stellar.github.io/js-stellar-sdk/
 * @see https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup
 */

import TelegramBot from "node-telegram-bot-api";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Horizon, Networks } from "@stellar/stellar-sdk";

dotenv.config();

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const PORT = parseInt(process.env.PORT || "3003", 10);
const STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
const RPC_URL =
  process.env.STELLAR_RPC_URL ||
  (STELLAR_NETWORK === "testnet"
    ? "https://soroban-testnet.stellar.org"
    : "https://soroban-mainnet.stellar.org");
const HORIZON_URL =
  process.env.HORIZON_URL ||
  (STELLAR_NETWORK === "testnet"
    ? "https://horizon-testnet.stellar.org"
    : "https://horizon.stellar.org");

// Optional: Stellar secret key for /send (bot-funded payments)
const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY || "";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not defined in .env");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const userChatIds = new Map<string, string>();

// Session management - tracks which features are enabled for each chat
const activeSessions = new Map<string, {
  features: string[];
  registeredAt: Date;
}>();

// Stellar Horizon client (for balance queries)
const horizon = new Horizon.Server(HORIZON_URL);

function initBot() {
  console.log("Initializing StellrFlow Telegram Bot (Stellar)...");

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id.toString();
    const username = msg.from?.username || "User";

    if (msg.from?.id) {
      userChatIds.set(msg.from.id.toString(), chatId);
    }

    bot.sendMessage(
      chatId,
      `Hello, ${username}! I'm the StellrFlow Stellar Bot.\n\n` +
        `**Your Chat ID:** \`${chatId}\`\n` +
        `_Use this in the workflow Telegram node._\n\n` +
        `/balance <address> - Check XLM balance\n` +
        `/help - Show commands`,
      { parse_mode: "Markdown" }
    );
  });

  bot.onText(/\/register/, (msg) => {
    const chatId = msg.chat.id.toString();
    const username = msg.from?.username || "User";

    if (msg.from?.id) {
      userChatIds.set(msg.from.id.toString(), chatId);
      bot.sendMessage(
        chatId,
        `Registered! ${username}, your chat ID is: \`${chatId}\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id.toString();
    bot.sendMessage(
      chatId,
      "StellrFlow Bot commands:\n" +
        "/start - Start the bot\n" +
        "/register - Register & get chat ID\n" +
        "/balance <address> - Check Stellar account balance (XLM)\n" +
        "/help - Show this message"
    );
  });

  // Chatbot mode: answer Stellar questions (only when chatbot feature is enabled)
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id.toString();
    const text = msg.text?.trim() || "";

    // Skip commands (handled above)
    if (text.startsWith("/")) return;

    // Check if this chat has chatbot feature enabled
    const session = activeSessions.get(chatId);
    const hasChatbot = session?.features.includes("chatbot");

    // If no session or chatbot not enabled, send a helpful message
    if (!session) {
      // No active session - user hasn't connected via StellrFlow
      return; // Silent - don't respond to random messages
    }

    if (!hasChatbot) {
      // Session exists but chatbot not enabled
      await bot.sendMessage(
        chatId,
        "💡 To enable the AI chatbot, connect the **Stellar SDK (Chatbot)** block to your Telegram trigger in StellrFlow and run the workflow again.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Chatbot is enabled - answer Stellar-related questions using SDK/docs
    if (text.length > 2) {
      try {
        const lower = text.toLowerCase();
        let reply = "";

        if (lower.includes("balance") || lower.includes("xlm")) {
          const addrMatch = text.match(/G[A-Z2-7]{55}/);
          if (addrMatch) {
            const account = await horizon.loadAccount(addrMatch[0]);
            const xlm = account.balances.find((b) => b.asset_type === "native");
            const bal = xlm && "balance" in xlm ? xlm.balance : "0";
            reply = `💰 Balance: **${bal} XLM**`;
          } else {
            reply = "Send `/balance G...` with a Stellar address to check balance.";
          }
        } else if (lower.includes("what is stellar") || lower.includes("about stellar")) {
          reply =
            "🌟 **Stellar** is a decentralized, open-source blockchain network designed for fast, low-cost cross-border payments and asset transfers.\n\n" +
            "Key features:\n" +
            "• Transactions settle in 3-5 seconds\n" +
            "• Fees are ~0.00001 XLM (~$0.000001)\n" +
            "• Built-in DEX for asset exchange\n" +
            "• Supports tokenization of any asset\n\n" +
            "📚 Docs: https://developers.stellar.org";
        } else if (lower.includes("soroban")) {
          reply =
            "🔧 **Soroban** is Stellar's smart contract platform.\n\n" +
            "Features:\n" +
            "• Written in Rust, compiled to WASM\n" +
            "• Predictable gas fees\n" +
            "• Built-in testing framework\n" +
            "• Interoperable with Stellar's asset layer\n\n" +
            "📚 Start building: https://soroban.stellar.org";
        } else if (lower.includes("anchor") || lower.includes("sep")) {
          reply =
            "⚓ **Anchors** are bridges between Stellar and traditional finance.\n\n" +
            "Key SEPs (Stellar Ecosystem Proposals):\n" +
            "• **SEP-6** - Deposit/withdraw fiat\n" +
            "• **SEP-10** - Authentication\n" +
            "• **SEP-24** - Interactive deposits\n" +
            "• **SEP-31** - Cross-border payments\n\n" +
            "📚 Docs: https://developers.stellar.org/docs/anchoring-assets";
        } else if (lower.includes("xlm") || lower.includes("lumen")) {
          reply =
            "💫 **XLM (Lumens)** is Stellar's native cryptocurrency.\n\n" +
            "Uses:\n" +
            "• Pay transaction fees\n" +
            "• Minimum balance requirements\n" +
            "• Bridge currency for asset exchange\n\n" +
            "Current network: " + STELLAR_NETWORK;
        } else if (lower.includes("freighter") || lower.includes("wallet")) {
          reply =
            "👛 **Freighter** is the most popular Stellar wallet browser extension.\n\n" +
            "Features:\n" +
            "• Secure key management\n" +
            "• Sign Soroban transactions\n" +
            "• Multiple account support\n\n" +
            "🔗 Install: https://freighter.app";
        } else if (lower.includes("horizon") || lower.includes("api")) {
          reply =
            "🌐 **Horizon** is Stellar's REST API server.\n\n" +
            "Endpoints:\n" +
            "• `/accounts/{id}` - Account info\n" +
            "• `/transactions` - Submit/query txns\n" +
            "• `/assets` - Asset info\n\n" +
            "📚 API Docs: https://developers.stellar.org/api/horizon";
        } else if (lower.includes("help") || lower.includes("?")) {
          reply =
            "🤖 I can help with Stellar! Ask about:\n\n" +
            "• What is Stellar?\n" +
            "• What is Soroban?\n" +
            "• What is XLM?\n" +
            "• What are Anchors?\n" +
            "• Tell me about Freighter wallet\n" +
            "• /balance <address>\n\n" +
            "Just type your question!";
        } else {
          reply =
            "🤔 I'm not sure about that. Try asking about:\n" +
            "• Stellar basics\n" +
            "• Soroban smart contracts\n" +
            "• XLM / Lumens\n" +
            "• Anchors & SEPs\n" +
            "• Freighter wallet\n\n" +
            "Or use `/balance <address>` to check a balance.";
        }

        if (reply) {
          await bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
        }
      } catch (err: any) {
        await bot.sendMessage(
          chatId,
          `❌ Error: ${err?.response?.data?.detail || err.message || "Try again"}`
        );
      }
    }
  });

  bot.onText(/\/balance(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const address = match?.[1]?.trim();

    if (!address) {
      bot.sendMessage(
        chatId,
        "Usage: /balance <Stellar address>\nExample: /balance GABC..."
      );
      return;
    }

    try {
      const account = await horizon.loadAccount(address);
      const xlmBalance = account.balances.find(
        (b) => b.asset_type === "native" || (b as any).asset_code === "XLM"
      );
      const balanceStr =
        xlmBalance && "balance" in xlmBalance
          ? xlmBalance.balance
          : "0";

      bot.sendMessage(
        chatId,
        `Balance for \`${address.slice(0, 8)}...\`:\n` +
          `**${balanceStr} XLM**`,
        { parse_mode: "Markdown" }
      );
    } catch (err: any) {
      bot.sendMessage(
        chatId,
        `Error: ${err?.response?.data?.detail || err.message || "Failed to fetch balance"}`
      );
    }
  });

  console.log("Telegram Bot initialized");
}

async function sendNotification(
  chatId: string,
  message: string,
  options: { parseMode?: string; disableNotification?: boolean } = {}
): Promise<boolean> {
  await bot.sendMessage(chatId, message, {
    parse_mode: (options.parseMode as any) || undefined,
    disable_notification: options.disableNotification,
  });
  return true;
}

// Express API
const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Send Telegram message (called by frontend / workflow)
app.post("/api/telegram/send", async (req, res) => {
  try {
    const { chatId, message, parseMode, disableNotification } = req.body;

    if (!chatId || !message) {
      return res
        .status(400)
        .json({ error: "chatId and message are required" });
    }

    const chatIdStr = String(chatId).trim();
    if (chatIdStr.startsWith("@")) {
      return res.status(400).json({
        error:
          "Use numeric Chat ID, not @username. Send /register to the bot to get your Chat ID.",
      });
    }

    const success = await sendNotification(chatIdStr, message, {
      parseMode,
      disableNotification,
    });

    if (success) {
      return res
        .status(200)
        .json({ success: true, message: "Notification sent" });
    }
    return res
      .status(500)
      .json({ success: false, error: "Failed to send" });
  } catch (error: any) {
    const tgDesc = error?.response?.body?.description || "";
    const friendlyMessage =
      tgDesc.includes("chat not found") || tgDesc.includes("chat_id")
        ? "Chat not found. Use your numeric Chat ID (send /register to the bot to get it), not @username."
        : error?.message || "Failed to send";
    return res.status(400).json({ success: false, error: friendlyMessage });
  }
});

// Stellar balance check (for workflow/API)
app.get("/api/stellar/balance/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const account = await horizon.loadAccount(address);
    const xlmBalance = account.balances.find(
      (b) => b.asset_type === "native"
    );
    const balance =
      xlmBalance && "balance" in xlmBalance ? xlmBalance.balance : "0";

    return res.json({ success: true, balance, address });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: error?.response?.data?.detail || error.message,
    });
  }
});

// Session registration - called by frontend when workflow starts
app.post("/api/session/register", (req, res) => {
  try {
    const { chatId, features } = req.body;

    if (!chatId) {
      return res.status(400).json({ error: "chatId is required" });
    }

    const chatIdStr = String(chatId).trim();
    const featureList = Array.isArray(features) ? features : [];

    // Register or update session
    activeSessions.set(chatIdStr, {
      features: featureList,
      registeredAt: new Date(),
    });

    console.log(`Session registered for ${chatIdStr} with features:`, featureList);

    return res.json({
      success: true,
      chatId: chatIdStr,
      features: featureList,
      message: `Session registered with ${featureList.length} feature(s)`,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to register session",
    });
  }
});

// Get session info
app.get("/api/session/:chatId", (req, res) => {
  const { chatId } = req.params;
  const session = activeSessions.get(chatId);

  if (!session) {
    return res.status(404).json({
      success: false,
      error: "No active session for this chat",
    });
  }

  return res.json({
    success: true,
    chatId,
    ...session,
  });
});

// Clear session
app.delete("/api/session/:chatId", (req, res) => {
  const { chatId } = req.params;
  activeSessions.delete(chatId);

  return res.json({
    success: true,
    message: "Session cleared",
  });
});

app.get("/api/telegram/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "stellrflow-telegram-stellar",
    network: STELLAR_NETWORK,
    activeSessions: activeSessions.size,
    timestamp: new Date().toISOString(),
  });
});

initBot();

app.listen(PORT, () => {
  console.log(`StellrFlow Telegram Bot API running on port ${PORT}`);
  console.log(`Stellar network: ${STELLAR_NETWORK}`);
});
