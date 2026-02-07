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
  executeTelegramConnect: async (config: any) => {
    const chatId = config.chatId?.trim();
    if (!chatId) {
      throw new Error("Telegram Chat ID is required. Send /register to the bot to get yours.");
    }
    if (chatId.startsWith("@")) {
      throw new Error(
        "Use your numeric Chat ID, not username. Open the bot in Telegram and send /register to get your Chat ID."
      );
    }

    const result = await telegramApi.sendAuthMessage(
      chatId,
      config.label || "Workflow"
    );

    if (!result.success) {
      throw new Error(result.error || "Failed to send auth message. Is the bot running?");
    }

    return { success: true, chatId, message: "Auth message sent" };
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
    const operation = config.operation || "balance";
    const chatId = inputData?.chatId;

    if (operation === "chatbot") {
      // Chatbot mode: Bot handles Stellar Q&A in Telegram. We pass chatId.
      if (!chatId) {
        throw new Error("Chat ID required for chatbot mode. Connect from Telegram trigger.");
      }
      return {
        success: true,
        operation: "chatbot",
        chatId,
        message: "Chatbot mode active. Ask Stellar questions in Telegram.",
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
    // When connected to Telegram: bot acts as Stellar wallet
    // Uses Stellar Wallet SDK / SEP-10 for auth
    // https://developers.stellar.org/docs/build/apps/wallet
    const chatId = inputData?.chatId || config.chatId;
    if (!chatId) {
      throw new Error("Telegram Chat ID required for wallet mode. Connect from Telegram trigger.");
    }

    return {
      success: true,
      mode: "telegram_wallet",
      chatId,
      message: "Wallet mode: User can sign transactions via Telegram. Connect Freighter for full wallet features.",
    };
  },
};
