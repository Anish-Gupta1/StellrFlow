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
import { Horizon, Networks, Keypair, TransactionBuilder, Operation, Asset, BASE_FEE } from "@stellar/stellar-sdk";
import { answerStellarQuestion } from "./sdk-chatbot.js";

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

// Optional: OpenAI chatbot configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const CHATBOT_REQUEST_TIMEOUT_MS = parseInt(
  process.env.CHATBOT_REQUEST_TIMEOUT_MS || "30000",
  10
);

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not defined in .env");
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.warn("OPENAI_API_KEY not set. AI chatbot will be unavailable.");
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const userChatIds = new Map<string, string>();

// Session management - tracks which features are enabled for each chat
const activeSessions = new Map<string, {
  features: string[];
  registeredAt: Date;
}>();

// Telegram Wallet storage - in-memory for demo (use database in production)
// These are wallets created IN the bot (user doesn't have the private key)
const userWallets = new Map<string, {
  publicKey: string;
  secretKey: string;
  createdAt: Date;
}>();

// Freighter Wallet storage - stores connected Freighter addresses
// These are external wallets (user controls the private key via Freighter)
const freighterWallets = new Map<string, {
  publicKey: string;
  network: string;
  connectedAt: Date;
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
    const hasTelegramWallet = userWallets.has(chatId);
    const hasFreighterWallet = freighterWallets.has(chatId);
    const hasAnyWallet = hasTelegramWallet || hasFreighterWallet;

    let helpText = "**StellrFlow Bot Commands**\n\n" +
      "**General:**\n" +
      "/start - Start the bot\n" +
      "/register - Get your chat ID\n" +
      "/status - Check your wallet status\n" +
      "/balance <address> - Check any Stellar address\n" +
      "/help - Show this message\n";

    if (hasAnyWallet) {
      const walletType = hasFreighterWallet ? "🦊 Freighter" : "📱 Telegram";
      const wallet = hasFreighterWallet ? freighterWallets.get(chatId)! : userWallets.get(chatId)!;
      
      helpText += `\n**${walletType} Wallet Commands:**\n` +
        "/mybalance - Check your wallet balance\n" +
        "/mywallet - Show your wallet address\n" +
        "/send <address> <amount> - Send XLM\n" +
        "/disconnect - Disconnect your wallet\n";
      
      // Only show fundwallet for Telegram wallets
      if (hasTelegramWallet && !hasFreighterWallet) {
        helpText += "/fundwallet - Get testnet XLM\n";
      }
      
      helpText += `\n_Connected: ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}_\n`;
    } else {
      helpText += "\n**Wallet Options:**\n" +
        "• Connect Freighter via StellrFlow workflow\n" +
        "• Or connect Telegram wallet via workflow\n";
    }

    bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
  });

  // Status command - shows which wallet is connected
  bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id.toString();
    const telegramWallet = userWallets.get(chatId);
    const freighterWallet = freighterWallets.get(chatId);
    const session = activeSessions.get(chatId);

    let statusText = "**📊 Your StellrFlow Status**\n\n";

    if (freighterWallet) {
      statusText += "**🦊 Wallet Type:** Freighter (Browser)\n" +
        `**Address:** \`${freighterWallet.publicKey.slice(0, 8)}...${freighterWallet.publicKey.slice(-8)}\`\n` +
        `**Network:** ${freighterWallet.network}\n\n` +
        "_Use /send to sign transactions via Freighter_\n";
    } else if (telegramWallet) {
      statusText += "**📱 Wallet Type:** Telegram (In-Bot)\n" +
        `**Address:** \`${telegramWallet.publicKey.slice(0, 8)}...${telegramWallet.publicKey.slice(-8)}\`\n\n` +
        "_Use /send to send XLM directly_\n";
    } else {
      statusText += "**Wallet:** Not connected\n\n" +
        "Connect a wallet via StellrFlow workflow:\n" +
        "• Freighter - Use your browser wallet\n" +
        "• Telegram - Create an in-bot wallet\n";
    }

    if (session) {
      statusText += `\n**Session:** Active\n` +
        `**Features:** ${session.features.join(", ") || "None"}\n`;
    }

    bot.sendMessage(chatId, statusText, { parse_mode: "Markdown" });
  });

  // === UNIFIED WALLET COMMANDS ===
  // These work for both Freighter and Telegram wallets

  // Check wallet balance (works for both wallet types)
  bot.onText(/\/mybalance/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const telegramWallet = userWallets.get(chatId);
    const freighterWallet = freighterWallets.get(chatId);

    // Determine which wallet to use (Freighter takes priority if both exist)
    const wallet = freighterWallet || telegramWallet;
    const walletType = freighterWallet ? "🦊 Freighter" : "📱 Telegram";

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ No wallet connected.\n\n" +
          "Connect a wallet via StellrFlow workflow to use this command.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    try {
      const account = await horizon.loadAccount(wallet.publicKey);
      const xlmBalance = account.balances.find((b) => b.asset_type === "native");
      const balance = xlmBalance && "balance" in xlmBalance ? xlmBalance.balance : "0";

      const otherBalances = account.balances
        .filter((b) => b.asset_type !== "native" && "asset_code" in b)
        .map((b: any) => `• ${b.balance} ${b.asset_code}`)
        .join("\n");

      const network = freighterWallet?.network || STELLAR_NETWORK;

      bot.sendMessage(
        chatId,
        `${walletType} **Wallet Balance**\n\n` +
          `**XLM:** ${balance}\n` +
          (otherBalances ? `\n**Other Assets:**\n${otherBalances}\n` : "") +
          `\nAddress: \`${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}\`\n` +
          `Network: ${network}`,
        { parse_mode: "Markdown" }
      );
    } catch (err: any) {
      if (err?.response?.status === 404) {
        bot.sendMessage(
          chatId,
          `${walletType} **Wallet Balance**\n\n` +
            `**XLM:** 0 (account not funded)\n\n` +
            (telegramWallet && !freighterWallet 
              ? `💡 Use /fundwallet to get free testnet XLM.`
              : `💡 Fund your account to activate it on Stellar.`),
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(chatId, `❌ Error: ${err.message || "Try again later"}`);
      }
    }
  });

  // Show wallet address (works for both wallet types)
  bot.onText(/\/mywallet/, (msg) => {
    const chatId = msg.chat.id.toString();
    const telegramWallet = userWallets.get(chatId);
    const freighterWallet = freighterWallets.get(chatId);

    const wallet = freighterWallet || telegramWallet;
    const walletType = freighterWallet ? "🦊 Freighter" : "📱 Telegram";

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ No wallet connected.\n\n" +
          "Connect a wallet via StellrFlow workflow.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const network = freighterWallet?.network || STELLAR_NETWORK;

    bot.sendMessage(
      chatId,
      `${walletType} **Wallet**\n\n` +
        `**Address:**\n\`${wallet.publicKey}\`\n\n` +
        `📋 Copy this address to receive XLM or other Stellar assets.\n` +
        `Network: ${network}`,
      { parse_mode: "Markdown" }
    );
  });

  // Disconnect wallet (works for both wallet types)
  bot.onText(/\/disconnect/, (msg) => {
    const chatId = msg.chat.id.toString();
    const hasFreighter = freighterWallets.has(chatId);
    const hasTelegram = userWallets.has(chatId);

    if (!hasFreighter && !hasTelegram) {
      bot.sendMessage(chatId, "❌ No wallet connected.");
      return;
    }

    const walletType = hasFreighter ? "Freighter" : "Telegram";
    
    // Remove the active wallet
    if (hasFreighter) {
      freighterWallets.delete(chatId);
    } else {
      userWallets.delete(chatId);
    }

    bot.sendMessage(
      chatId,
      `✅ ${walletType} wallet disconnected.\n\n` +
        "You can connect a new wallet via StellrFlow workflow.",
      { parse_mode: "Markdown" }
    );
  });

  // === TELEGRAM WALLET SPECIFIC COMMANDS ===
  // These only work for Telegram wallets (where we control the private key)

  // Create wallet (only for Telegram wallet)
  bot.onText(/\/createwallet/, async (msg) => {
    const chatId = msg.chat.id.toString();

    // Check if user already has a wallet
    if (userWallets.has(chatId)) {
      const wallet = userWallets.get(chatId)!;
      bot.sendMessage(
        chatId,
        `👛 You already have a wallet!\n\n` +
          `**Address:** \`${wallet.publicKey}\`\n\n` +
          `Use /mybalance to check your balance.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Create new Stellar keypair
    const keypair = Keypair.random();
    const publicKey = keypair.publicKey();
    const secretKey = keypair.secret();

    // Store wallet
    userWallets.set(chatId, {
      publicKey,
      secretKey,
      createdAt: new Date(),
    });

    bot.sendMessage(
      chatId,
      `🎉 **Wallet Created!**\n\n` +
        `**Your Stellar Address:**\n\`${publicKey}\`\n\n` +
        `⚠️ **Important:** Your wallet is stored securely. To use it on testnet:\n` +
        `1. Use /fundwallet to get free testnet XLM\n` +
        `2. Or send XLM to your address from another wallet\n\n` +
        `Use /mybalance to check your balance anytime.`,
      { parse_mode: "Markdown" }
    );
  });

  // Fund wallet with testnet XLM (Telegram wallet only)
  bot.onText(/\/fundwallet/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const wallet = userWallets.get(chatId);
    const freighterWallet = freighterWallets.get(chatId);

    // Check if using Freighter
    if (freighterWallet && !wallet) {
      bot.sendMessage(
        chatId,
        "ℹ️ You're using a **Freighter wallet**.\n\n" +
          "Fund your Freighter wallet through an exchange or another wallet.\n" +
          "This command only works for Telegram in-bot wallets.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ No wallet connected. Connect one via StellrFlow workflow.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (STELLAR_NETWORK !== "testnet") {
      bot.sendMessage(
        chatId,
        "❌ Funding is only available on testnet. You're on mainnet.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    try {
      bot.sendMessage(chatId, "⏳ Requesting testnet XLM...");

      const response = await fetch(
        `https://friendbot.stellar.org?addr=${wallet.publicKey}`
      );

      if (response.ok) {
        bot.sendMessage(
          chatId,
          `✅ **Wallet Funded!**\n\n` +
            `Your wallet has been credited with 10,000 testnet XLM.\n\n` +
            `Use /mybalance to see your balance.`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ Failed to fund wallet. It might already be funded or friendbot is busy. Try again later.`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err: any) {
      bot.sendMessage(
        chatId,
        `❌ Error: ${err.message || "Failed to fund wallet"}`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // Send XLM from wallet
  bot.onText(/\/send(?:\s+(\S+)\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const wallet = userWallets.get(chatId);
    const freighterWallet = freighterWallets.get(chatId);

    const destAddress = match?.[1]?.trim();
    const amountStr = match?.[2]?.trim();

    // Handle Freighter wallet - generate signing link
    if (freighterWallet && !wallet) {
      if (!destAddress || !amountStr) {
        bot.sendMessage(
          chatId,
          "**Usage:** /send <destination_address> <amount>\n\n" +
            "**Example:** /send GABC...XYZ 10\n\n" +
            "You'll receive a link to sign the transaction with Freighter.",
          { parse_mode: "Markdown" }
        );
        return;
      }

      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, "❌ Invalid amount. Please enter a positive number.");
        return;
      }

      // Generate link to send-transaction page
      const sendUrl = `http://localhost:3000/send-transaction?chatId=${chatId}&destination=${encodeURIComponent(destAddress)}&amount=${amount}&network=${freighterWallet.network}`;

      bot.sendMessage(
        chatId,
        `🦊 <b>Sign Transaction with Freighter</b>\n\n` +
          `<b>To:</b> <code>${destAddress.slice(0, 8)}...${destAddress.slice(-8)}</code>\n` +
          `<b>Amount:</b> ${amount} XLM\n\n` +
          `👉 <a href="${sendUrl}">Click here to sign &amp; send</a>\n\n` +
          `<i>Open this link in your browser with Freighter installed.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ No wallet connected. Connect one via StellrFlow workflow.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (!destAddress || !amountStr) {
      bot.sendMessage(
        chatId,
        "**Usage:** /send <destination_address> <amount>\n\n" +
          "**Example:** /send GABC...XYZ 10\n\n" +
          "This will send 10 XLM from your wallet.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "❌ Invalid amount. Please enter a positive number.");
      return;
    }

    try {
      bot.sendMessage(chatId, "⏳ Processing transaction...");

      // Load sender account
      const sourceKeypair = Keypair.fromSecret(wallet.secretKey);
      const sourceAccount = await horizon.loadAccount(wallet.publicKey);

      // Check if destination exists
      let destinationExists = true;
      try {
        await horizon.loadAccount(destAddress);
      } catch {
        destinationExists = false;
      }

      // Build transaction
      const networkPassphrase = STELLAR_NETWORK === "testnet" 
        ? Networks.TESTNET 
        : Networks.PUBLIC;

      let transaction;
      if (destinationExists) {
        // Regular payment
        transaction = new TransactionBuilder(sourceAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(
            Operation.payment({
              destination: destAddress,
              asset: Asset.native(),
              amount: amount.toFixed(7),
            })
          )
          .setTimeout(30)
          .build();
      } else {
        // Create account operation for new accounts
        if (amount < 1) {
          bot.sendMessage(
            chatId,
            "❌ Destination account doesn't exist. Minimum 1 XLM required to create it."
          );
          return;
        }
        transaction = new TransactionBuilder(sourceAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(
            Operation.createAccount({
              destination: destAddress,
              startingBalance: amount.toFixed(7),
            })
          )
          .setTimeout(30)
          .build();
      }

      // Sign and submit
      transaction.sign(sourceKeypair);
      const result = await horizon.submitTransaction(transaction);

      bot.sendMessage(
        chatId,
        `✅ **Transaction Successful!**\n\n` +
          `**Sent:** ${amount} XLM\n` +
          `**To:** \`${destAddress.slice(0, 8)}...${destAddress.slice(-8)}\`\n\n` +
          `🔗 [View on Explorer](https://stellar.expert/explorer/${STELLAR_NETWORK}/tx/${result.hash})`,
        { parse_mode: "Markdown" }
      );
    } catch (err: any) {
      const errorMsg = err?.response?.data?.extras?.result_codes 
        ? JSON.stringify(err.response.data.extras.result_codes)
        : err.message || "Transaction failed";
      bot.sendMessage(
        chatId,
        `❌ Transaction failed: ${errorMsg}`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // Chatbot mode: answer Stellar questions using AI (only when chatbot feature is enabled)
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id.toString();
    const text = msg.text?.trim() || "";

    // Skip commands (handled above)
    if (text.startsWith("/")) return;

    // Check if this chat has chatbot feature enabled
    const session = activeSessions.get(chatId);
    const hasChatbot = session?.features.includes("chatbot");

    // If no session or chatbot not enabled, don't respond
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

    // Chatbot is enabled - use AI to answer Stellar questions
    if (text.length > 2) {
      try {
        // Typing indicator for UX (30s is typical timeout)
        await bot.sendChatAction(chatId, "typing");

        // Get AI response from SDK chatbot module
        const aiResponse = await answerStellarQuestion(text);

        // Send response to user
        await bot.sendMessage(chatId, aiResponse, { parse_mode: "Markdown" });
      } catch (err: any) {
        console.error("Chatbot error:", err);
        await bot.sendMessage(
          chatId,
          "❌ Error: " + (err?.message || "Failed to process your question. Try again.")
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
    console.log(`Sending message to ${chatId} with parseMode: ${parseMode}`);

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

// === TELEGRAM WALLET API ENDPOINTS ===

// Create wallet for a chat
app.post("/api/wallet/create", (req, res) => {
  try {
    const { chatId } = req.body;

    if (!chatId) {
      return res.status(400).json({ error: "chatId is required" });
    }

    const chatIdStr = String(chatId).trim();

    // Check if wallet already exists
    if (userWallets.has(chatIdStr)) {
      const wallet = userWallets.get(chatIdStr)!;
      return res.json({
        success: true,
        publicKey: wallet.publicKey,
        message: "Wallet already exists",
        isNew: false,
      });
    }

    // Create new wallet
    const keypair = Keypair.random();
    userWallets.set(chatIdStr, {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
      createdAt: new Date(),
    });

    return res.json({
      success: true,
      publicKey: keypair.publicKey(),
      message: "Wallet created successfully",
      isNew: true,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to create wallet",
    });
  }
});

// Get wallet info
app.get("/api/wallet/:chatId", (req, res) => {
  const { chatId } = req.params;
  const wallet = userWallets.get(chatId);

  if (!wallet) {
    return res.status(404).json({
      success: false,
      error: "No wallet found for this chat",
    });
  }

  return res.json({
    success: true,
    publicKey: wallet.publicKey,
    createdAt: wallet.createdAt,
  });
});

// Get wallet balance (uses stored wallet address)
app.get("/api/wallet/:chatId/balance", async (req, res) => {
  try {
    const { chatId } = req.params;
    const wallet = userWallets.get(chatId);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: "No wallet found for this chat. Create one first.",
      });
    }

    try {
      const account = await horizon.loadAccount(wallet.publicKey);
      const xlmBalance = account.balances.find((b) => b.asset_type === "native");
      const balance = xlmBalance && "balance" in xlmBalance ? xlmBalance.balance : "0";

      const otherBalances = account.balances
        .filter((b) => b.asset_type !== "native" && "asset_code" in b)
        .map((b: any) => ({
          asset: b.asset_code,
          balance: b.balance,
          issuer: b.asset_issuer,
        }));

      return res.json({
        success: true,
        publicKey: wallet.publicKey,
        xlmBalance: balance,
        otherBalances,
        network: STELLAR_NETWORK,
      });
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return res.json({
          success: true,
          publicKey: wallet.publicKey,
          xlmBalance: "0",
          otherBalances: [],
          network: STELLAR_NETWORK,
          message: "Account not funded yet",
        });
      }
      throw err;
    }
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get balance",
    });
  }
});

// Fund wallet (testnet only)
app.post("/api/wallet/:chatId/fund", async (req, res) => {
  try {
    const { chatId } = req.params;
    const wallet = userWallets.get(chatId);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: "No wallet found for this chat",
      });
    }

    if (STELLAR_NETWORK !== "testnet") {
      return res.status(400).json({
        success: false,
        error: "Funding only available on testnet",
      });
    }

    const response = await fetch(
      `https://friendbot.stellar.org?addr=${wallet.publicKey}`
    );

    if (response.ok) {
      return res.json({
        success: true,
        publicKey: wallet.publicKey,
        message: "Wallet funded with 10,000 testnet XLM",
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "Failed to fund wallet. It might already be funded.",
      });
    }
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fund wallet",
    });
  }
});

// Send XLM from wallet
app.post("/api/wallet/:chatId/send", async (req, res) => {
  try {
    const { chatId } = req.params;
    const { destination, amount } = req.body;
    const wallet = userWallets.get(chatId);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: "No wallet found for this chat",
      });
    }

    if (!destination || !amount) {
      return res.status(400).json({
        success: false,
        error: "destination and amount are required",
      });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount",
      });
    }

    // Load sender account
    const sourceKeypair = Keypair.fromSecret(wallet.secretKey);
    const sourceAccount = await horizon.loadAccount(wallet.publicKey);

    // Check if destination exists
    let destinationExists = true;
    try {
      await horizon.loadAccount(destination);
    } catch {
      destinationExists = false;
    }

    const networkPassphrase = STELLAR_NETWORK === "testnet" 
      ? Networks.TESTNET 
      : Networks.PUBLIC;

    let transaction;
    if (destinationExists) {
      transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount: amountNum.toFixed(7),
          })
        )
        .setTimeout(30)
        .build();
    } else {
      if (amountNum < 1) {
        return res.status(400).json({
          success: false,
          error: "Minimum 1 XLM required to create new account",
        });
      }
      transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({
            destination,
            startingBalance: amountNum.toFixed(7),
          })
        )
        .setTimeout(30)
        .build();
    }

    transaction.sign(sourceKeypair);
    const result = await horizon.submitTransaction(transaction);

    return res.json({
      success: true,
      hash: result.hash,
      amount: amountNum,
      destination,
      explorerUrl: `https://stellar.expert/explorer/${STELLAR_NETWORK}/tx/${result.hash}`,
    });
  } catch (error: any) {
    const errorMsg = error?.response?.data?.extras?.result_codes 
      ? JSON.stringify(error.response.data.extras.result_codes)
      : error.message || "Transaction failed";
    return res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

// === FREIGHTER WALLET API ENDPOINTS ===

// Register/Connect Freighter wallet for a chat
app.post("/api/freighter/connect", (req, res) => {
  try {
    const { chatId, publicKey, network } = req.body;

    if (!chatId || !publicKey) {
      return res.status(400).json({ 
        success: false,
        error: "chatId and publicKey are required" 
      });
    }

    const chatIdStr = String(chatId).trim();

    // Store Freighter wallet
    freighterWallets.set(chatIdStr, {
      publicKey,
      network: network || "testnet",
      connectedAt: new Date(),
    });

    console.log(`Freighter wallet connected for ${chatIdStr}: ${publicKey}`);

    return res.json({
      success: true,
      publicKey,
      network: network || "testnet",
      message: "Freighter wallet connected successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to connect Freighter wallet",
    });
  }
});

// Get Freighter wallet info
app.get("/api/freighter/:chatId", (req, res) => {
  const { chatId } = req.params;
  const wallet = freighterWallets.get(chatId);

  if (!wallet) {
    return res.status(404).json({
      success: false,
      error: "No Freighter wallet connected for this chat",
    });
  }

  return res.json({
    success: true,
    publicKey: wallet.publicKey,
    network: wallet.network,
    connectedAt: wallet.connectedAt,
  });
});

// Get Freighter wallet balance
app.get("/api/freighter/:chatId/balance", async (req, res) => {
  try {
    const { chatId } = req.params;
    const wallet = freighterWallets.get(chatId);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: "No Freighter wallet connected. Connect via StellrFlow workflow.",
      });
    }

    try {
      const account = await horizon.loadAccount(wallet.publicKey);
      const xlmBalance = account.balances.find((b) => b.asset_type === "native");
      const balance = xlmBalance && "balance" in xlmBalance ? xlmBalance.balance : "0";

      const otherBalances = account.balances
        .filter((b) => b.asset_type !== "native" && "asset_code" in b)
        .map((b: any) => ({
          asset: b.asset_code,
          balance: b.balance,
          issuer: b.asset_issuer,
        }));

      return res.json({
        success: true,
        publicKey: wallet.publicKey,
        xlmBalance: balance,
        otherBalances,
        network: wallet.network,
      });
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return res.json({
          success: true,
          publicKey: wallet.publicKey,
          xlmBalance: "0",
          otherBalances: [],
          network: wallet.network,
          message: "Account not funded yet",
        });
      }
      throw err;
    }
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get balance",
    });
  }
});

// Disconnect Freighter wallet
app.delete("/api/freighter/:chatId", (req, res) => {
  const { chatId } = req.params;
  
  if (!freighterWallets.has(chatId)) {
    return res.status(404).json({
      success: false,
      error: "No Freighter wallet connected",
    });
  }

  freighterWallets.delete(chatId);

  return res.json({
    success: true,
    message: "Freighter wallet disconnected",
  });
});

// === TRANSACTION API ENDPOINTS (for Freighter signing) ===

// Build unsigned transaction XDR (for Freighter to sign)
app.post("/api/transaction/build", async (req, res) => {
  try {
    const { sourceAddress, destination, amount, network } = req.body;

    if (!sourceAddress || !destination || !amount) {
      return res.status(400).json({
        success: false,
        error: "sourceAddress, destination, and amount are required",
      });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid amount",
      });
    }

    // Load source account
    const sourceAccount = await horizon.loadAccount(sourceAddress);

    // Check if destination exists
    let destinationExists = true;
    try {
      await horizon.loadAccount(destination);
    } catch {
      destinationExists = false;
    }

    const networkPassphrase = (network || STELLAR_NETWORK) === "testnet"
      ? Networks.TESTNET
      : Networks.PUBLIC;

    let transaction;
    if (destinationExists) {
      // Regular payment
      transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount: amountNum.toFixed(7),
          })
        )
        .setTimeout(300) // 5 minutes for user to sign
        .build();
    } else {
      // Create account operation
      if (amountNum < 1) {
        return res.status(400).json({
          success: false,
          error: "Minimum 1 XLM required to create new account",
        });
      }
      transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({
            destination,
            startingBalance: amountNum.toFixed(7),
          })
        )
        .setTimeout(300)
        .build();
    }

    // Return unsigned XDR for Freighter to sign
    return res.json({
      success: true,
      xdr: transaction.toXDR(),
      network: network || STELLAR_NETWORK,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to build transaction",
    });
  }
});

// Submit signed transaction
app.post("/api/transaction/submit", async (req, res) => {
  try {
    const { signedXdr, chatId } = req.body;

    if (!signedXdr) {
      return res.status(400).json({
        success: false,
        error: "signedXdr is required",
      });
    }

    // Submit the signed transaction
    const result = await horizon.submitTransaction(
      TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
    );

    return res.json({
      success: true,
      hash: result.hash,
      explorerUrl: `https://stellar.expert/explorer/${STELLAR_NETWORK}/tx/${result.hash}`,
    });
  } catch (error: any) {
    const errorMsg = error?.response?.data?.extras?.result_codes
      ? JSON.stringify(error.response.data.extras.result_codes)
      : error.message || "Transaction submission failed";
    return res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

app.get("/api/telegram/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "stellrflow-telegram-stellar",
    network: STELLAR_NETWORK,
    activeSessions: activeSessions.size,
    freighterWallets: freighterWallets.size,
    telegramWallets: userWallets.size,
    timestamp: new Date().toISOString(),
  });
});

initBot();

app.listen(PORT, () => {
  console.log(`StellrFlow Telegram Bot API running on port ${PORT}`);
  console.log(`Stellar network: ${STELLAR_NETWORK}`);
});
