// API service for StellrFlow - Stellar Telegram bot integration
// No AO/Arweave dependencies

const STELLAR_BOT_URL =
  (typeof process !== "undefined" &&
    (process as any).env?.NEXT_PUBLIC_STELLAR_BOT_URL) ||
  "http://localhost:3003";

let isBotActive = false;

// Telegram API - uses Stellar bot backend
export const telegramApi = {
  sendMessage: async (chatId: string, message: string) => {
    const response = await fetch(`${STELLAR_BOT_URL}/api/telegram/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message }),
    });
    return response.json();
  },

  // Send welcome message when only Telegram block is connected (no other blocks)
  sendWelcomeMessage: async (chatId: string) => {
    const message =
      `🎉 **Connected to StellrFlow!**\n\n` +
      `Your Telegram is now linked to StellrFlow.\n\n` +
      `⚠️ _No workflow blocks connected yet._\n\n` +
      `Add blocks in the workflow builder to enable features:\n` +
      `• **Stellar SDK (Chatbot)** - Ask questions about Stellar\n` +
      `• **Wallet Integration** - Connect Freighter wallet\n` +
      `• **Send Telegram** - Send notifications\n\n` +
      `_Powered by Stellar_`;
    return telegramApi.sendMessage(chatId, message);
  },

  // Send message when Stellar SDK chatbot is connected
  sendChatbotEnabledMessage: async (chatId: string) => {
    const message =
      `🤖 **Stellar AI Chatbot Activated!**\n\n` +
      `You can now ask me anything about Stellar:\n` +
      `• What is Stellar?\n` +
      `• How does Soroban work?\n` +
      `• What are Stellar anchors?\n` +
      `• /balance <address> - Check XLM balance\n\n` +
      `Just type your question and I'll help!\n\n` +
      `_Powered by Stellar_`;
    return telegramApi.sendMessage(chatId, message);
  },

  // Send message when Wallet Integration is connected
  sendWalletSetupMessage: async (chatId: string, walletUrl: string) => {
    const message =
      `👛 **Wallet Integration Enabled!**\n\n` +
      `Connect your Freighter wallet to interact with Stellar:\n\n` +
      `👉 [Click here to connect Freighter](${walletUrl})\n\n` +
      `Once connected, you can:\n` +
      `• View your balances\n` +
      `• Sign transactions\n` +
      `• Interact with Stellar dApps\n\n` +
      `_Powered by Stellar_`;
    return telegramApi.sendMessage(chatId, message);
  },

  // Register session with enabled features
  registerSession: async (chatId: string, features: string[]) => {
    try {
      const response = await fetch(`${STELLAR_BOT_URL}/api/session/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, features }),
      });
      return response.json();
    } catch (error) {
      return { success: false, error: "Failed to register session" };
    }
  },

  sendAuthMessage: async (chatId: string, workflowName?: string) => {
    const message =
      `🔐 **StellrFlow Authentication**\n\n` +
      `You're connected! Your workflow${workflowName ? ` "${workflowName}"` : ""} has started.\n\n` +
      `Reply with:\n` +
      `• /balance <address> - Check Stellar balance\n` +
      `• Ask any Stellar question for help\n\n` +
      `_Powered by Stellar_`;
    return telegramApi.sendMessage(chatId, message);
  },

  getStatus: async () => {
    try {
      const response = await fetch(`${STELLAR_BOT_URL}/api/telegram/health`);
      const data = await response.json();
      return { success: data.status === "ok", ...data };
    } catch {
      return { success: false, error: "Bot unreachable" };
    }
  },
};

// Stellar API
export const stellarApi = {
  getBalance: async (address: string) => {
    try {
      const response = await fetch(
        `${STELLAR_BOT_URL}/api/stellar/balance/${encodeURIComponent(address)}`
      );
      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data.error || "Failed to fetch balance" };
      }
      return {
        success: true,
        balance: data.balance,
        address: data.address,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  sendTelegram: async (chatId: string, message: string) => {
    try {
      const response = await fetch(`${STELLAR_BOT_URL}/api/telegram/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message }),
      });
      const data = await response.json();
      return data.success ? { success: true } : { success: false, error: data.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  health: async () => {
    try {
      const response = await fetch(`${STELLAR_BOT_URL}/api/telegram/health`);
      const data = await response.json();
      return { ok: data.status === "ok", network: data.network };
    } catch {
      return { ok: false };
    }
  },
};

// Node executors
export const nodeExecutors = {
  // Execute Telegram trigger - now accepts connectedNodeTypes to determine behavior
  executeTelegramConnect: async (config: any, connectedNodeTypes: string[] = []) => {
    const chatId = config.chatId?.trim();
    if (!chatId) {
      throw new Error("Telegram Chat ID is required. Send /register to the bot to get yours.");
    }
    if (chatId.startsWith("@")) {
      throw new Error(
        "Use your numeric Chat ID, not username. Open the bot in Telegram and send /register to get your Chat ID."
      );
    }

    // Determine which features are enabled based on connected nodes
    const features: string[] = [];
    const hasChatbot = connectedNodeTypes.includes("stellar-sdk");
    const hasWallet = connectedNodeTypes.includes("wallet-integration");
    const hasTelegramSend = connectedNodeTypes.includes("telegram-send");

    if (hasChatbot) features.push("chatbot");
    if (hasWallet) features.push("wallet");
    if (hasTelegramSend) features.push("telegram-send");

    // Register session with backend to enable/disable features
    await telegramApi.registerSession(chatId, features);

    let result;

    if (connectedNodeTypes.length === 0) {
      // No blocks connected - just welcome message
      result = await telegramApi.sendWelcomeMessage(chatId);
    } else if (hasChatbot && !hasWallet) {
      // Chatbot enabled only
      result = await telegramApi.sendChatbotEnabledMessage(chatId);
    } else if (hasWallet && !hasChatbot) {
      // Wallet enabled only - send wallet setup message
      const walletUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/connect-wallet?chatId=${chatId}`;
      result = await telegramApi.sendWalletSetupMessage(chatId, walletUrl);
    } else if (hasChatbot && hasWallet) {
      // Both enabled - send combined message with wallet link
      const walletUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/connect-wallet?chatId=${chatId}`;
      const message =
        `🚀 **Full Stellar Integration Activated!**\n\n` +
        `✅ **AI Chatbot** - Ask me anything about Stellar\n` +
        `✅ **Wallet Integration** - Connect your Freighter wallet\n\n` +
        `👛 **Connect Wallet:** [Click here](${walletUrl})\n\n` +
        `💬 Type your question or use /balance <address>\n\n` +
        `_Powered by Stellar_`;
      result = await telegramApi.sendMessage(chatId, message);
    } else {
      // Other combinations (like telegram-send only)
      result = await telegramApi.sendAuthMessage(chatId, config.label || "Workflow");
    }

    if (!result.success) {
      throw new Error(result.error || "Failed to send message. Is the bot running?");
    }

    return { success: true, chatId, features, message: "Connected successfully" };
  },

  executeTelegramSend: async (config: any, inputData?: any) => {
    const chatId = config.chatId || inputData?.chatId || "";
    let message = config.message || "";

    if (!chatId) {
      throw new Error("Telegram Chat ID is required");
    }

    if (inputData?.balance) {
      message = message.replace(/\{balance\}/g, String(inputData.balance));
    }
    if (inputData?.address) {
      message = message.replace(/\{address\}/g, String(inputData.address));
    }

    const result = await stellarApi.sendTelegram(chatId, message || "Notification from StellrFlow");

    if (!result.success) {
      throw new Error(result.error || "Failed to send message");
    }

    return { success: true, sentTo: chatId, message, inputData };
  },

  executeStellarSDK: async (config: any, inputData?: any) => {
    const operation = config.operation || "chatbot";
    const chatId = inputData?.chatId;

    if (!chatId) {
      throw new Error("Chat ID required. Connect this block to a Telegram trigger first.");
    }

    if (operation === "chatbot") {
      // Chatbot mode is now handled by the backend based on registered session
      // Just confirm activation
      return {
        success: true,
        operation: "chatbot",
        chatId,
        message: "Stellar AI Chatbot is now active. User can ask questions in Telegram.",
      };
    }

    const destination =
      config.destination || inputData?.destination || inputData?.address || "";
    if (!destination) {
      throw new Error("Stellar address is required for balance check");
    }

    const result = await stellarApi.getBalance(destination);
    if (!result.success) {
      throw new Error(result.error || "Failed to fetch balance");
    }

    return {
      success: true,
      operation: "balance",
      address: result.address || destination,
      balance: result.balance,
      network: config.network || "testnet",
      chatId,
    };
  },

  executeWalletIntegration: async (config: any, inputData?: any) => {
    const chatId = inputData?.chatId || config.chatId;
    if (!chatId) {
      throw new Error("Connect this block to a Telegram trigger first.");
    }

    // Generate wallet connection URL
    const walletUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/connect-wallet?chatId=${chatId}`;

    return {
      success: true,
      mode: "wallet",
      chatId,
      walletUrl,
      message: "Wallet integration activated. User will receive Freighter connection link.",
    };
  },
};
