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

// Telegram Wallet storage - in-memory for demo (use database in production)
const userWallets = new Map<string, {
  publicKey: string;
  secretKey: string;
  createdAt: Date;
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
        "\n**Telegram Wallet:**\n" +
        "/createwallet - Create your in-bot Stellar wallet\n" +
        "/mywallet - Show your wallet address\n" +
        "/mybalance - Check your wallet balance\n" +
        "/send <address> <amount> - Send XLM from your wallet\n" +
        "/fundwallet - Fund your testnet wallet (testnet only)\n" +
        "/help - Show this message",
      { parse_mode: "Markdown" }
    );
  });

  // === TELEGRAM WALLET COMMANDS ===

  // Create wallet
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

  // Show wallet address
  bot.onText(/\/mywallet/, (msg) => {
    const chatId = msg.chat.id.toString();
    const wallet = userWallets.get(chatId);

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ You don't have a wallet yet. Use /createwallet to create one.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    bot.sendMessage(
      chatId,
      `👛 **Your Stellar Wallet**\n\n` +
        `**Address:**\n\`${wallet.publicKey}\`\n\n` +
        `📋 Copy this address to receive XLM or other Stellar assets.\n` +
        `Network: ${STELLAR_NETWORK}`,
      { parse_mode: "Markdown" }
    );
  });

  // Check own wallet balance
  bot.onText(/\/mybalance/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const wallet = userWallets.get(chatId);

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ You don't have a wallet yet. Use /createwallet to create one.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    try {
      const account = await horizon.loadAccount(wallet.publicKey);
      const xlmBalance = account.balances.find((b) => b.asset_type === "native");
      const balance = xlmBalance && "balance" in xlmBalance ? xlmBalance.balance : "0";

      // Get other asset balances
      const otherBalances = account.balances
        .filter((b) => b.asset_type !== "native" && "asset_code" in b)
        .map((b: any) => `• ${b.balance} ${b.asset_code}`)
        .join("\n");

      bot.sendMessage(
        chatId,
        `💰 **Your Wallet Balance**\n\n` +
          `**XLM:** ${balance}\n` +
          (otherBalances ? `\n**Other Assets:**\n${otherBalances}` : "") +
          `\n\nAddress: \`${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}\``,
        { parse_mode: "Markdown" }
      );
    } catch (err: any) {
      if (err?.response?.status === 404) {
        bot.sendMessage(
          chatId,
          `💰 **Your Wallet Balance**\n\n` +
            `**XLM:** 0 (account not funded)\n\n` +
            `💡 Your account needs at least 1 XLM to be activated on Stellar.\n` +
            `Use /fundwallet to get free testnet XLM.`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ Error checking balance: ${err.message || "Try again later"}`,
          { parse_mode: "Markdown" }
        );
      }
    }
  });

  // Fund wallet with testnet XLM
  bot.onText(/\/fundwallet/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const wallet = userWallets.get(chatId);

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ You don't have a wallet yet. Use /createwallet to create one.",
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

    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ You don't have a wallet yet. Use /createwallet to create one.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const destAddress = match?.[1]?.trim();
    const amountStr = match?.[2]?.trim();

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
