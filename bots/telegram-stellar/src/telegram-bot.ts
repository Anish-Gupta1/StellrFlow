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
import path from "path";
import { fileURLToPath } from "url";
import { Horizon, Networks, Keypair, TransactionBuilder, Operation, Asset, BASE_FEE } from "@stellar/stellar-sdk";

// Anchor module — on/off ramp + Stellar helpers
import {
  quickDeposit,
  quickWithdrawal,
  getDepositEstimate,
  getWithdrawalEstimate,
  getDeposit,
  getWithdrawal,
  getUserDeposits,
  getUserWithdrawals,
  getExchangeRate,
  getSupportedCurrencies,
  getLogForAddress,
} from "./anchor/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

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
      "/rates - View exchange rates\n" +
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
      
      helpText += `\n**💰 On/Off Ramp (Anchor):**\n` +
        "/addfunds <amount> [currency] - Deposit fiat → XLM\n" +
        "/withdraw <xlm> [currency] - Withdraw XLM → fiat\n" +
        "/rates - View demo exchange rates\n" +
        "/txhistory - Your deposit/withdrawal history\n" +
        "/depositstatus <id> - Check deposit status\n" +
        "/withdrawstatus <id> - Check withdrawal status\n";
      
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

  // === ANCHOR ON/OFF RAMP COMMANDS ===
  // Deposit fiat → XLM (On-Ramp)

  // /addfunds [amount] [currency] - Create deposit request
  bot.onText(/\/addfunds(?:\s+(\d+(?:\.\d+)?)\s*(\w+)?)?/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id?.toString() || chatId;
    const telegramWallet = userWallets.get(chatId);
    const freighterWallet = freighterWallets.get(chatId);
    
    const wallet = freighterWallet || telegramWallet;
    
    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ No wallet connected.\n\n" +
          "Connect a wallet first via StellrFlow workflow, then use /addfunds.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const amountStr = match?.[1];
    const currency = match?.[2]?.toUpperCase() || 'USD';

    if (!amountStr) {
      // Show rate info and usage
      const usdRate = getExchangeRate('USD');
      const inrRate = getExchangeRate('INR');
      
      bot.sendMessage(
        chatId,
        "💰 **Add Funds (Deposit)**\n\n" +
          "Convert fiat to XLM and credit your wallet.\n\n" +
          "**Usage:** `/addfunds <amount> [currency]`\n\n" +
          "**Examples:**\n" +
          "• `/addfunds 100` - Deposit $100\n" +
          "• `/addfunds 100 USD` - Deposit $100\n" +
          "• `/addfunds 1000 INR` - Deposit ₹1000\n\n" +
          "**Current Rates (Demo):**\n" +
          `• 1 USD = ${usdRate.rate} XLM\n` +
          `• 1 INR = ${inrRate.rate} XLM\n\n` +
          "_Supported: USD, EUR, INR_",
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
      // Get estimate first
      const estimate = getDepositEstimate(amount, currency);
      
      bot.sendMessage(
        chatId,
        `⏳ **Processing Deposit...**\n\n` +
          `**Amount:** ${amount} ${currency}\n` +
          `**Est. XLM:** ~${estimate.estimatedXLM.toFixed(4)} XLM\n` +
          `**Rate:** 1 ${currency} = ${estimate.rate} XLM`,
        { parse_mode: "Markdown" }
      );

      // Create and auto-confirm deposit (hackathon demo mode)
      const result = await quickDeposit(userId, amount, currency, wallet.publicKey);

      if (result.success) {
        bot.sendMessage(
          chatId,
          `✅ **Deposit Successful!**\n\n` +
            `**Deposited:** ${amount} ${currency}\n` +
            `**Credited:** ${result.creditedXLM.toFixed(4)} XLM\n` +
            `**Deposit ID:** \`${result.depositId}\`\n` +
            (result.stellarTxHash ? `**Tx:** \`${result.stellarTxHash.slice(0, 12)}...\`\n` : '') +
            `\nUse /mybalance to check your updated balance.`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ **Deposit Failed**\n\n${result.message}\n\n` +
            `_For testnet, try /fundwallet instead._`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err: any) {
      bot.sendMessage(
        chatId,
        `❌ Error: ${err.message || "Deposit failed"}`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // /withdraw [amount] [currency] - Create withdrawal request
  bot.onText(/\/withdraw(?:\s+(\d+(?:\.\d+)?)\s*(\w+)?)?/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id?.toString() || chatId;
    const telegramWallet = userWallets.get(chatId);
    const freighterWallet = freighterWallets.get(chatId);
    
    const wallet = freighterWallet || telegramWallet;
    const walletType = freighterWallet ? "🦊 Freighter" : "📱 Telegram";
    
    if (!wallet) {
      bot.sendMessage(
        chatId,
        "❌ No wallet connected.\n\n" +
          "Connect a wallet first via StellrFlow workflow, then use /withdraw.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const amountStr = match?.[1];
    const currency = match?.[2]?.toUpperCase() || 'USD';

    if (!amountStr) {
      // Show rate info and usage
      const estimate = getWithdrawalEstimate(10, 'USD');
      
      bot.sendMessage(
        chatId,
        "💸 **Withdraw Funds (Off-Ramp)**\n\n" +
          "Convert XLM to fiat and withdraw.\n\n" +
          "**Usage:** `/withdraw <xlm_amount> [currency]`\n\n" +
          "**Examples:**\n" +
          "• `/withdraw 10` - Withdraw 10 XLM to USD\n" +
          "• `/withdraw 50 EUR` - Withdraw 50 XLM to EUR\n" +
          "• `/withdraw 100 INR` - Withdraw 100 XLM to INR\n\n" +
          "**Current Rate (Demo):**\n" +
          `• 10 XLM = ~$${estimate.estimatedFiat} USD\n\n` +
          "_Supported: USD, EUR, INR_",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const xlmAmount = parseFloat(amountStr);
    if (isNaN(xlmAmount) || xlmAmount <= 0) {
      bot.sendMessage(chatId, "❌ Invalid amount. Please enter a positive number.");
      return;
    }

    try {
      // Check balance first
      const account = await horizon.loadAccount(wallet.publicKey);
      const xlmBalance = account.balances.find((b: any) => b.asset_type === "native");
      const balance = xlmBalance && "balance" in xlmBalance ? parseFloat(xlmBalance.balance) : 0;

      if (balance < xlmAmount) {
        bot.sendMessage(
          chatId,
          `❌ **Insufficient Balance**\n\n` +
            `**Requested:** ${xlmAmount} XLM\n` +
            `**Available:** ${balance.toFixed(4)} XLM\n\n` +
            `Use /addfunds to deposit more.`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Get estimate
      const estimate = getWithdrawalEstimate(xlmAmount, currency);

      bot.sendMessage(
        chatId,
        `⏳ **Processing Withdrawal...**\n\n` +
          `**XLM Amount:** ${xlmAmount} XLM\n` +
          `**Est. Payout:** ~${estimate.estimatedFiat} ${currency}`,
        { parse_mode: "Markdown" }
      );

      // Process withdrawal (hackathon demo mode - simulated)
      const result = await quickWithdrawal(userId, xlmAmount, currency, wallet.publicKey);

      if (result.success) {
        bot.sendMessage(
          chatId,
          `✅ **Withdrawal Processed!**\n\n` +
            `**Withdrawn:** ${result.xlmDebited} XLM\n` +
            `**Payout:** ${result.fiatPayout} ${result.currency}\n` +
            `**Withdrawal ID:** \`${result.withdrawalId}\`\n` +
            `**ETA:** ${result.eta}\n` +
            (result.stellarTxHash ? `**Tx:** \`${result.stellarTxHash.slice(0, 12)}...\`\n` : '') +
            `\n_Demo: In production, funds would be sent to your bank._`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ **Withdrawal Failed**\n\n${result.message}`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        bot.sendMessage(
          chatId,
          `❌ Wallet not funded on Stellar network.\n\n` +
            `Use /fundwallet first to activate your account.`,
          { parse_mode: "Markdown" }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ Error: ${err.message || "Withdrawal failed"}`,
          { parse_mode: "Markdown" }
        );
      }
    }
  });

  // /rates - Show current exchange rates
  bot.onText(/\/rates/, (msg) => {
    const chatId = msg.chat.id.toString();
    
    const usdRate = getExchangeRate('USD');
    const eurRate = getExchangeRate('EUR');
    const inrRate = getExchangeRate('INR');

    bot.sendMessage(
      chatId,
      `📊 **Current Exchange Rates (Demo)**\n\n` +
        `**Deposit (Fiat → XLM):**\n` +
        `• 1 USD = ${usdRate.rate} XLM\n` +
        `• 1 EUR = ${eurRate.rate.toFixed(2)} XLM\n` +
        `• 1 INR = ${inrRate.rate} XLM\n\n` +
        `**Withdraw (XLM → Fiat):**\n` +
        `• 1 XLM = $${(1/usdRate.rate).toFixed(2)} USD\n` +
        `• 1 XLM = €${(1/eurRate.rate).toFixed(2)} EUR\n` +
        `• 1 XLM = ₹${(1/inrRate.rate).toFixed(2)} INR\n\n` +
        `_Rates are demo values for hackathon._`,
      { parse_mode: "Markdown" }
    );
  });

  // /txhistory - Show anchor transaction history for this user
  bot.onText(/\/txhistory/, (msg) => {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id?.toString() || chatId;
    const wallet = freighterWallets.get(chatId) || userWallets.get(chatId);

    if (!wallet) {
      bot.sendMessage(chatId, "❌ No wallet connected.", { parse_mode: "Markdown" });
      return;
    }

    const deps = getUserDeposits(userId);
    const wdrs = getUserWithdrawals(userId);

    if (deps.length === 0 && wdrs.length === 0) {
      bot.sendMessage(
        chatId,
        "📋 **Transaction History**\n\nNo anchor transactions yet.\n\nUse /addfunds or /withdraw to get started.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    let text = "📋 **Transaction History**\n\n";

    if (deps.length > 0) {
      text += "**Deposits (On-Ramp):**\n";
      for (const d of deps.slice(-5)) {
        const icon = d.status === 'completed' ? '✅' : d.status === 'failed' ? '❌' : '⏳';
        text += `${icon} \`${d.depositId}\` — ${d.fiatAmount} ${d.currency} → ${d.creditedXLM || d.estimatedXLM} XLM (${d.status})\n`;
      }
      text += "\n";
    }

    if (wdrs.length > 0) {
      text += "**Withdrawals (Off-Ramp):**\n";
      for (const w of wdrs.slice(-5)) {
        const icon = w.status === 'completed' ? '✅' : w.status === 'failed' ? '❌' : '⏳';
        text += `${icon} \`${w.withdrawalId}\` — ${w.xlmAmount} XLM → ${w.actualFiatPayout || w.estimatedFiat} ${w.currency} (${w.status})\n`;
      }
    }

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  // /depositstatus <id> - Check a specific deposit
  bot.onText(/\/depositstatus(?:\s+(\S+))?/, (msg, match) => {
    const chatId = msg.chat.id.toString();
    const depositId = match?.[1]?.trim();

    if (!depositId) {
      bot.sendMessage(chatId, "**Usage:** `/depositstatus DEP-XXXXX`", { parse_mode: "Markdown" });
      return;
    }

    const d = getDeposit(depositId);
    if (!d) {
      bot.sendMessage(chatId, `❌ Deposit \`${depositId}\` not found.`, { parse_mode: "Markdown" });
      return;
    }

    const icon = d.status === 'completed' ? '✅' : d.status === 'failed' ? '❌' : '⏳';
    bot.sendMessage(
      chatId,
      `${icon} **Deposit Details**\n\n` +
        `**ID:** \`${d.depositId}\`\n` +
        `**Status:** ${d.status}\n` +
        `**Amount:** ${d.fiatAmount} ${d.currency}\n` +
        `**XLM Credited:** ${d.creditedXLM || '—'}\n` +
        `**Rate:** 1 ${d.currency} = ${d.exchangeRate} XLM\n` +
        (d.stellarTxHash ? `**Stellar Tx:** \`${d.stellarTxHash.slice(0, 16)}...\`\n` : '') +
        `**Created:** ${d.createdAt.toISOString()}`,
      { parse_mode: "Markdown" }
    );
  });

  // /withdrawstatus <id> - Check a specific withdrawal
  bot.onText(/\/withdrawstatus(?:\s+(\S+))?/, (msg, match) => {
    const chatId = msg.chat.id.toString();
    const wdrId = match?.[1]?.trim();

    if (!wdrId) {
      bot.sendMessage(chatId, "**Usage:** `/withdrawstatus WDR-XXXXX`", { parse_mode: "Markdown" });
      return;
    }

    const w = getWithdrawal(wdrId);
    if (!w) {
      bot.sendMessage(chatId, `❌ Withdrawal \`${wdrId}\` not found.`, { parse_mode: "Markdown" });
      return;
    }

    const icon = w.status === 'completed' ? '✅' : w.status === 'failed' ? '❌' : '⏳';
    bot.sendMessage(
      chatId,
      `${icon} **Withdrawal Details**\n\n` +
        `**ID:** \`${w.withdrawalId}\`\n` +
        `**Status:** ${w.status}\n` +
        `**XLM Debited:** ${w.xlmAmount}\n` +
        `**Fiat Payout:** ${w.actualFiatPayout || w.estimatedFiat} ${w.currency}\n` +
        `**ETA:** ${w.eta}\n` +
        (w.stellarTxHash ? `**Stellar Tx:** \`${w.stellarTxHash.slice(0, 16)}...\`\n` : '') +
        `**Created:** ${w.createdAt.toISOString()}`,
      { parse_mode: "Markdown" }
    );
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

// === ANCHOR API ENDPOINTS ===
// These let the frontend workflow builder trigger on/off ramp flows via REST.

// POST /api/anchor/deposit — Trigger deposit (on-ramp)
app.post("/api/anchor/deposit", async (req, res) => {
  try {
    const { chatId, amount, currency } = req.body;
    if (!chatId || !amount) {
      return res.status(400).json({ success: false, error: "chatId and amount are required" });
    }
    const wallet = freighterWallets.get(String(chatId)) || userWallets.get(String(chatId));
    if (!wallet) {
      return res.status(404).json({ success: false, error: "No wallet connected for this chat" });
    }
    const result = await quickDeposit(String(chatId), parseFloat(amount), currency || 'USD', wallet.publicKey);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/anchor/withdraw — Trigger withdrawal (off-ramp)
app.post("/api/anchor/withdraw", async (req, res) => {
  try {
    const { chatId, xlmAmount, currency } = req.body;
    if (!chatId || !xlmAmount) {
      return res.status(400).json({ success: false, error: "chatId and xlmAmount are required" });
    }
    const wallet = freighterWallets.get(String(chatId)) || userWallets.get(String(chatId));
    if (!wallet) {
      return res.status(404).json({ success: false, error: "No wallet connected for this chat" });
    }
    const telegramWallet = userWallets.get(String(chatId));
    const secret = telegramWallet?.secretKey;
    const result = await quickWithdrawal(String(chatId), parseFloat(xlmAmount), currency || 'USD', wallet.publicKey, secret);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/anchor/rates — Get current exchange rates
app.get("/api/anchor/rates", (_req, res) => {
  const currencies = getSupportedCurrencies();
  const rates = currencies.map((c: string) => {
    const { rate } = getExchangeRate(c);
    return { currency: c, fiatToXLM: rate, xlmToFiat: Math.round((1 / rate) * 100) / 100 };
  });
  return res.json({ success: true, rates });
});

// GET /api/anchor/history/:chatId — Get deposit/withdrawal history
app.get("/api/anchor/history/:chatId", (req, res) => {
  const { chatId } = req.params;
  const deposits = getUserDeposits(chatId);
  const withdrawals = getUserWithdrawals(chatId);
  return res.json({ success: true, deposits, withdrawals });
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
