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
import { parseIntervalFormat, formatIntervalForDisplay } from "./interval-parser.js";

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

// ===== AUTOPAY STORAGE & TYPES =====

interface ActiveAutopay {
  autopayId: string;
  chatId: string;
  walletPublicKey: string;
  destination: string;
  amount: number;
  intervalMs: number;
  totalDurationMs: number;
  executionCount: number;
  intervalHandle: NodeJS.Timeout;
  createdAt: Date;
  lastExecutedAt?: Date;
  nextExecutionAt: Date;
}

const activeAutopays = new Map<string, ActiveAutopay>();

// ===== MULTISIG STORAGE & TYPES =====

interface MultisigTransaction {
  transactionId: string;
  chatId: string;
  unsignedXdr: string;
  requiredSigners: string[];
  signedBy: Set<string>;
  compiledXdr?: string;
  createdAt: Date;
  expiresAt: Date;
  autoExecute: boolean;
  executed: boolean;
  executionHash?: string;
}

const pendingMultisigTransactions = new Map<string, MultisigTransaction>();

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
        "• `/connectfreighter` - Connect your Freighter browser wallet\n" +
        "• Connect via StellrFlow workflow (Telegram wallet)\n\n" +
        "**📱 Telegram Wallet:**\nConnect via the StellrFlow workflow to create an in-bot wallet.\n\n" +
        "**🦊 Freighter Wallet:**\nUse /connectfreighter anytime to generate a connection link for your Freighter extension wallet.\n";
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

  // Connect Freighter wallet (opens connection page)
  bot.onText(/\/connectfreighter/, async (msg) => {
    const chatId = msg.chat.id.toString();

    // Check if user already has a Freighter wallet connected
    if (freighterWallets.has(chatId)) {
      const wallet = freighterWallets.get(chatId)!;
      bot.sendMessage(
        chatId,
        `🦊 You already have a Freighter wallet connected!\n\n` +
          `**Address:** \`${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}\`\n` +
          `**Network:** ${wallet.network}\n\n` +
          `Use /mybalance, /send, or /mywallet to manage your wallet.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const connectionUrl = `http://localhost:${PORT}/connect-wallet?chatId=${chatId}`;
    const network = STELLAR_NETWORK;

    // Send message to user with Freighter connection link (HTML format for clickable links)
    const message =
      `🦊 <b>Freighter Wallet Integration</b>\n\n` +
      `Connect your Freighter browser extension wallet to Stellar:\n\n` +
      `👉 <a href="${connectionUrl}">Click here to connect</a>\n\n` +
      `<b>After connecting you can:</b>\n` +
      `• View your wallet balances\n` +
      `• Sign and approve transactions\n` +
      `• Interact with Stellar dApps\n\n` +
      `<b>Requirements:</b>\n` +
      `• Freighter extension installed\n` +
      `• Open link in browser with Freighter\n\n` +
      `Network: ${network}\n\n` +
      `🔗 Get Freighter: <a href="https://freighter.app">freighter.app</a>`;

    bot.sendMessage(chatId, message, { parse_mode: "HTML" });
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

  // List active AutoPays
  bot.onText(/\/autopay-list/, (msg) => {
    const chatId = msg.chat.id.toString();
    const autopays = Array.from(activeAutopays.values())
      .filter(ap => ap.chatId === chatId);

    if (autopays.length === 0) {
      bot.sendMessage(
        chatId,
        "No active AutoPays. Use `/autopay` block in StellrFlow to start one.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    let message = "**📋 Active AutoPays**\n\n";
    autopays.forEach((ap) => {
      message += `**ID:** \`${ap.autopayId}\`\n`;
      message += `**Amount:** ${ap.amount} XLM\n`;
      message += `**To:** \`${ap.destination.slice(0, 8)}...${ap.destination.slice(-8)}\`\n`;
      message += `**Interval:** ${formatIntervalForDisplay(ap.intervalMs)}\n`;
      message += `**Payments:** ${ap.executionCount}\n`;
      message += `**Next:** ${ap.nextExecutionAt.toLocaleTimeString()}\n\n`;
    });

    message += `Use \`/autopay-stop <id>\` to stop any AutoPay.`;

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  });

  // Stop AutoPay by ID
  bot.onText(/\/autopay-stop\s+(.+)?/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const autopayId = match?.[1]?.trim();

    if (!autopayId) {
      bot.sendMessage(
        chatId,
        "Usage: `/autopay-stop <autopay-id>`\n\nGet the ID from `/autopay-list`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const autopay = activeAutopays.get(autopayId);

    if (!autopay) {
      bot.sendMessage(chatId, `❌ AutoPay not found: \`${autopayId}\``);
      return;
    }

    if (autopay.chatId !== chatId) {
      bot.sendMessage(chatId, "❌ This AutoPay doesn't belong to you.");
      return;
    }

    // Stop the AutoPay
    clearInterval(autopay.intervalHandle);
    activeAutopays.delete(autopayId);

    bot.sendMessage(
      chatId,
      `⏸️ **AutoPay Stopped**\n\n` +
      `**ID:** \`${autopayId}\`\n` +
      `**Total payments executed:** ${autopay.executionCount}\n` +
      `**Amount per payment:** ${autopay.amount} XLM`,
      { parse_mode: "Markdown" }
    );
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

// === FREIGHTER CONNECTION LINK GENERATION ===

// Serve Freighter connection page
app.get("/connect-wallet", (req, res) => {
  const { chatId } = req.query;

  if (!chatId) {
    return res.status(400).send("Missing chatId parameter");
  }

  // Serve the HTML connection page
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connect Freighter Wallet</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 40px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            text-align: center;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        .icon {
            font-size: 60px;
            margin: 20px 0;
        }
        p {
            color: #666;
            line-height: 1.6;
            margin: 15px 0;
        }
        button {
            background-color: #667eea;
            color: white;
            border: none;
            padding: 12px 30px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 20px;
            transition: background-color 0.3s;
        }
        button:hover {
            background-color: #764ba2;
        }
        button:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
        .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 5px;
            font-weight: bold;
        }
        .status.loading {
            background-color: #e3f2fd;
            color: #1976d2;
        }
        .status.success {
            background-color: #e8f5e9;
            color: #388e3c;
        }
        .status.error {
            background-color: #ffebee;
            color: #c62828;
        }
        .info {
            background-color: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🦊</div>
        <h1>Connect Freighter Wallet</h1>
        <p>Click the button below to connect your Freighter browser extension wallet to StellrFlow Telegram Bot.</p>

        <div class="info">
            <strong>Requirements:</strong><br>
            • Freighter extension installed<br>
            • Active Stellar account<br>
            • Browser with Freighter enabled
        </div>

        <button id="connectBtn" onclick="connectFreighter()">🔗 Connect Freighter</button>

        <div id="status"></div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/@stellar/freighter-api@1.9.0/build/index.min.js"></script>
    <script>
        const chatId = "${chatId}";
        const apiUrl = "http://localhost:3003";

        async function connectFreighter() {
            const btn = document.getElementById("connectBtn");
            const status = document.getElementById("status");

            btn.disabled = true;
            status.className = "status loading";
            status.textContent = "⏳ Connecting to Freighter...";

            try {
                // Check if Freighter is connected
                const connected = await window.freighter.isConnected();

                if (!connected) {
                    // Request access
                    await window.freighter.requestAccess();
                }

                // Get public key (address)
                const publicKey = await window.freighter.getAddress();

                // Get network
                const network = await window.freighter.getNetwork();

                status.textContent = "📡 Registering wallet...";

                // Send the connected wallet to the bot API
                const response = await fetch(apiUrl + "/api/freighter/connect", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        chatId: chatId,
                        publicKey: publicKey,
                        network: network.network || "testnet",
                    }),
                });

                const data = await response.json();

                if (data.success) {
                    status.className = "status success";
                    status.textContent = "✅ Wallet connected successfully!\\n\\nYour Freighter wallet is now linked to your Telegram. You can use /mybalance, /send, and other wallet functions.";
                    btn.style.display = "none";

                    // Show success for a few seconds then suggest closing
                    setTimeout(() => {
                        status.textContent += "\\n\\nYou can close this window now.";
                    }, 2000);
                } else {
                    throw new Error(data.error || "Failed to register wallet");
                }
            } catch (error) {
                console.error("Connection error:", error);
                status.className = "status error";
                status.textContent = "❌ Error: " + error.message;
                btn.disabled = false;
            }
        }

        // Check Freighter on page load
        async function checkFreighter() {
            try {
                const isAvailable = typeof window.freighter !== 'undefined';
                if (!isAvailable) {
                    throw new Error("Freighter extension not found");
                }
                // Freighter is available, button stays enabled
                document.getElementById("connectBtn").disabled = false;
            } catch (error) {
                const status = document.getElementById("status");
                status.className = "status error";
                status.textContent = "❌ Freighter not detected. Please install the Freighter browser extension: https://freighter.app";
                document.getElementById("connectBtn").disabled = true;
            }
        }

        // Give CDN script time to load
        setTimeout(checkFreighter, 1000);
    </script>
</body>
</html>`;

  res.send(html);
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

// ===== AUTOPAY API ENDPOINTS =====

app.post("/api/autopay/start", async (req, res) => {
  try {
    const { chatId, destination, amount, interval, totalDuration } = req.body;

    if (!chatId) return res.status(400).json({ error: "chatId required" });
    if (!destination) return res.status(400).json({ error: "destination required" });
    if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: "valid amount required" });
    if (!interval) return res.status(400).json({ error: "interval required" });

    const wallet = userWallets.get(chatId);
    if (!wallet) return res.status(404).json({ error: "Wallet not found. Create one first." });

    const intervalMs = parseIntervalFormat(interval);
    const totalDurationMs = totalDuration ? parseIntervalFormat(totalDuration) : Infinity;
    const amountNum = parseFloat(amount);

    const autopayId = `autopay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const autopay: ActiveAutopay = {
      autopayId,
      chatId,
      walletPublicKey: wallet.publicKey,
      destination,
      amount: amountNum,
      intervalMs,
      totalDurationMs,
      executionCount: 0,
      createdAt: new Date(),
      nextExecutionAt: new Date(Date.now() + intervalMs),
      intervalHandle: null as any,
    };

    // Start interval - first payment immediately
    autopay.intervalHandle = setInterval(async () => {
      try {
        await executeAutopayment(chatId, autopayId);
      } catch (err) {
        console.error(`AutoPay error for ${autopayId}:`, err);
        await bot.sendMessage(chatId, `❌ AutoPay Failed: ${(err as any).message}`);
      }
    }, intervalMs);

    // Execute first payment immediately
    setImmediate(() => executeAutopayment(chatId, autopayId));

    activeAutopays.set(autopayId, autopay);

    await bot.sendMessage(
      chatId,
      `✅ **AutoPay Started!**\n\n` +
      `**Amount:** ${amountNum} XLM\n` +
      `**To:** ${destination.slice(0, 8)}...${destination.slice(-8)}\n` +
      `**Interval:** ${formatIntervalForDisplay(intervalMs)}\n` +
      `**Duration:** ${totalDurationMs === Infinity ? 'Indefinite' : formatIntervalForDisplay(totalDurationMs)}\n\n` +
      `Use /autopay-list to view, /autopay-stop <id> to cancel.`,
      { parse_mode: "Markdown" }
    );

    return res.json({
      success: true,
      autopayId,
      destination,
      amount: amountNum,
      interval: formatIntervalForDisplay(intervalMs),
      message: "AutoPay started successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to start AutoPay",
    });
  }
});

app.post("/api/autopay/stop/:autopayId", (req, res) => {
  try {
    const { autopayId } = req.params;
    const autopay = activeAutopays.get(autopayId);

    if (!autopay) {
      return res.status(404).json({ error: "AutoPay not found" });
    }

    clearInterval(autopay.intervalHandle);
    activeAutopays.delete(autopayId);

    bot.sendMessage(
      autopay.chatId,
      `⏸️ **AutoPay Stopped**\n\n` +
      `Total payments executed: ${autopay.executionCount}`,
      { parse_mode: "Markdown" }
    );

    return res.json({
      success: true,
      message: "AutoPay stopped",
      executedPayments: autopay.executionCount,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to stop AutoPay",
    });
  }
});

app.get("/api/autopay/list/:chatId", (req, res) => {
  try {
    const { chatId } = req.params;
    const autopays = Array.from(activeAutopays.values())
      .filter(ap => ap.chatId === chatId)
      .map(ap => ({
        autopayId: ap.autopayId,
        destination: ap.destination,
        amount: ap.amount,
        interval: formatIntervalForDisplay(ap.intervalMs),
        executionCount: ap.executionCount,
        nextExecutionAt: ap.nextExecutionAt.toISOString(),
      }));

    return res.json({ success: true, autopays });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to execute a single AutoPay payment
async function executeAutopayment(chatId: string, autopayId: string) {
  const autopay = activeAutopays.get(autopayId);
  if (!autopay) return;

  // Check if total duration exceeded
  const elapsed = Date.now() - autopay.createdAt.getTime();
  if (elapsed > autopay.totalDurationMs) {
    clearInterval(autopay.intervalHandle);
    activeAutopays.delete(autopayId);
    await bot.sendMessage(
      chatId,
      `✅ **AutoPay Completed**\n\n` +
      `Total payments: ${autopay.executionCount}\n` +
      `Completed at: ${new Date().toLocaleTimeString()}`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const wallet = userWallets.get(chatId);
  if (!wallet) {
    clearInterval(autopay.intervalHandle);
    activeAutopays.delete(autopayId);
    await bot.sendMessage(chatId, `❌ AutoPay failed: Wallet no longer exists`);
    return;
  }

  try {
    const sourceKeypair = Keypair.fromSecret(wallet.secretKey);
    const sourceAccount = await horizon.loadAccount(wallet.publicKey);

    let destinationExists = true;
    try {
      await horizon.loadAccount(autopay.destination);
    } catch {
      destinationExists = false;
    }

    const networkPassphrase = STELLAR_NETWORK === "testnet" ? Networks.TESTNET : Networks.PUBLIC;

    let transaction;
    if (destinationExists) {
      transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: autopay.destination,
            asset: Asset.native(),
            amount: autopay.amount.toFixed(7),
          })
        )
        .setTimeout(30)
        .build();
    } else {
      if (autopay.amount < 1) {
        await bot.sendMessage(
          chatId,
          `⚠️ AutoPay Payment Failed: Minimum 1 XLM required for new accounts. Continuing...`
        );
        return;
      }
      transaction = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.createAccount({
            destination: autopay.destination,
            startingBalance: autopay.amount.toFixed(7),
          })
        )
        .setTimeout(30)
        .build();
    }

    transaction.sign(sourceKeypair);
    const result = await horizon.submitTransaction(transaction);

    autopay.executionCount++;
    autopay.lastExecutedAt = new Date();
    autopay.nextExecutionAt = new Date(Date.now() + autopay.intervalMs);

    console.log(`AutoPay #${autopay.executionCount} executed: ${autopay.amount} XLM to ${autopay.destination}`);

    // Send confirmation every 5 payments or first
    if (autopay.executionCount === 1 || autopay.executionCount % 5 === 0) {
      await bot.sendMessage(
        chatId,
        `✅ Payment #${autopay.executionCount} sent\n` +
        `Address: ${autopay.destination.slice(0, 8)}...\n` +
        `Amount: ${autopay.amount} XLM\n` +
        `Next: ${autopay.nextExecutionAt.toLocaleTimeString()}`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err: any) {
    console.error(`AutoPay execution error:`, err);
    await bot.sendMessage(
      chatId,
      `⚠️ Payment failed: ${err.message || "Unknown error"}. Continuing...`
    );
  }
}

// ===== MULTISIG API ENDPOINTS =====

app.post("/api/multisig/create", async (req, res) => {
  try {
    const { chatId, signers, approvalTimeout, autoExecute } = req.body;

    if (!chatId) return res.status(400).json({ error: "chatId required" });
    if (!Array.isArray(signers) || signers.length === 0) {
      return res.status(400).json({ error: "at least 1 signer required" });
    }

    const timeoutMs = parseIntervalFormat(approvalTimeout || "300s");
    const transactionId = `msig-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const expiresAt = new Date(Date.now() + timeoutMs);

    const msigTx: MultisigTransaction = {
      transactionId,
      chatId,
      unsignedXdr: "",
      requiredSigners: signers,
      signedBy: new Set(),
      createdAt: new Date(),
      expiresAt,
      autoExecute: autoExecute === true || autoExecute === 'true',
      executed: false,
    };

    pendingMultisigTransactions.set(transactionId, msigTx);

    // Auto-cleanup expired transaction
    setTimeout(() => {
      if (pendingMultisigTransactions.has(transactionId) && !msigTx.executed) {
        pendingMultisigTransactions.delete(transactionId);
        bot.sendMessage(
          chatId,
          `❌ **Multi-sig Approval Expired**\n\n` +
          `Transaction: ${transactionId}\n` +
          `Timeout: ${formatIntervalForDisplay(timeoutMs)}\n` +
          `Signed by: ${msigTx.signedBy.size}/${msigTx.requiredSigners.length}`,
          { parse_mode: "Markdown" }
        );
      }
    }, timeoutMs);

    return res.json({
      success: true,
      transactionId,
      requiredSigners: signers,
      approvalTimeout: formatIntervalForDisplay(timeoutMs),
      expiresAt: expiresAt.toISOString(),
      message: "Multi-sig transaction created",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to create multi-sig",
    });
  }
});

app.post("/api/multisig/sign", async (req, res) => {
  try {
    const { transactionId, signerAddress, signedXdr } = req.body;

    if (!transactionId) return res.status(400).json({ error: "transactionId required" });
    if (!signerAddress) return res.status(400).json({ error: "signerAddress required" });
    if (!signedXdr) return res.status(400).json({ error: "signedXdr required" });

    const msigTx = pendingMultisigTransactions.get(transactionId);
    if (!msigTx) return res.status(404).json({ error: "Transaction not found or expired" });

    if (!msigTx.requiredSigners.includes(signerAddress)) {
      return res.status(400).json({ error: "Not an authorized signer for this transaction" });
    }

    if (msigTx.signedBy.has(signerAddress)) {
      return res.status(400).json({ error: "Already signed by this address" });
    }

    msigTx.signedBy.add(signerAddress);
    msigTx.compiledXdr = signedXdr;

    await bot.sendMessage(
      msigTx.chatId,
      `✅ **Signature Received**\n\n` +
      `Signer: ${signerAddress.slice(0, 8)}...\n` +
      `Signed: ${msigTx.signedBy.size}/${msigTx.requiredSigners.length}\n\n` +
      `${msigTx.signedBy.size === msigTx.requiredSigners.length ? 'Ready to execute!' : 'Waiting for more signatures...'}`,
      { parse_mode: "Markdown" }
    );

    return res.json({
      success: true,
      transactionId,
      signedCount: msigTx.signedBy.size,
      requiredCount: msigTx.requiredSigners.length,
      ready: msigTx.signedBy.size === msigTx.requiredSigners.length,
      message: "Signature received",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to process signature",
    });
  }
});

app.get("/api/multisig/:transactionId", (req, res) => {
  try {
    const { transactionId } = req.params;
    const msigTx = pendingMultisigTransactions.get(transactionId);

    if (!msigTx) return res.status(404).json({ error: "Transaction not found" });

    return res.json({
      success: true,
      transactionId,
      signedCount: msigTx.signedBy.size,
      requiredCount: msigTx.requiredSigners.length,
      signedBy: Array.from(msigTx.signedBy),
      requiredSigners: msigTx.requiredSigners,
      executed: msigTx.executed,
      expiresAt: msigTx.expiresAt.toISOString(),
      message: msigTx.executed ? "Executed" : `${msigTx.requiredSigners.length - msigTx.signedBy.size} signatures remaining`,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
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
    activeAutopays: activeAutopays.size,
    pendingMultisigs: pendingMultisigTransactions.size,
    timestamp: new Date().toISOString(),
  });
});

initBot();

app.listen(PORT, () => {
  console.log(`StellrFlow Telegram Bot API running on port ${PORT}`);
  console.log(`Stellar network: ${STELLAR_NETWORK}`);
});
