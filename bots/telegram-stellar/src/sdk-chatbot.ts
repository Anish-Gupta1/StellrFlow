/**
 * Stellar SDK Chatbot Module
 *
 * Provides AI-powered Q&A for Stellar SDK and documentation questions.
 * Uses OpenAI GPT API with system prompts to ensure responses are Stellar-focused.
 *
 * @see https://developers.stellar.org
 * @see https://github.com/stellar/stellar-sdk-js
 */

import OpenAI from "openai";

// Configuration defaults (will be overridden by .env values at runtime)
const OPENAI_MODEL = "gpt-3.5-turbo";
const OPENAI_MAX_TOKENS = 1024;
const OPENAI_TEMPERATURE = 0.3;
const CHATBOT_REQUEST_TIMEOUT_MS = 30000;

// System prompt that bounds the AI to only answer Stellar-related questions
const STELLAR_SYSTEM_PROMPT = `You are a helpful Stellar blockchain expert assistant that ONLY answers questions about Stellar and related technologies.

IMPORTANT: You MUST only answer questions about:
- Stellar network and blockchain
- Soroban smart contracts
- XLM (Lumens) token
- Stellar SDKs and APIs
- Anchors and SEP protocols
- Freighter wallet and Stellar wallets
- Horizon API and Stellar RPC
- Application development on Stellar

REJECT non-Stellar questions with: "I only help with Stellar-related questions. Ask me about Stellar, Soroban, XLM, anchors, or how to build on Stellar!"

**Official Resources:**
- Stellar Developers: https://developers.stellar.org
- JavaScript SDK: https://github.com/stellar/stellar-sdk-js
- SDK Documentation: https://stellar.github.io/js-stellar-sdk/
- Soroban: https://soroban.stellar.org
- Stellar Network: https://stellar.network
- Horizon API: https://developers.stellar.org/api/horizon
- Soroban RPC: https://developers.stellar.org/docs/data/api/soroban-rpc

Guidelines:
- Be concise for Telegram (max 2-3 paragraphs)
- Include relevant doc links when helpful
- For code examples, use @stellar/stellar-sdk and TypeScript/JavaScript
- If unsure about a topic, be honest and direct to official docs`;

/**
 * Answer a Stellar SDK question using OpenAI GPT API
 *
 * @param question - The user's question about Stellar
 * @param chatId - Optional Telegram chat ID for logging
 * @param options - Optional configuration (maxTokens, temperature, timeoutMs)
 * @returns Promise resolving to the AI-generated response
 */
export async function answerStellarQuestion(
  question: string,
  chatId?: string,
  options: {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
  } = {}
): Promise<string> {
  // Read environment variables at runtime (after dotenv.config() has been called)
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
  const OPENAI_MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS || "1024", 10);
  const OPENAI_TEMPERATURE = parseFloat(process.env.OPENAI_TEMPERATURE || "0.3");
  const TIMEOUT = parseInt(process.env.CHATBOT_REQUEST_TIMEOUT_MS || "30000", 10);

  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY not configured. Set it in .env file. Get key from: https://platform.openai.com/api-keys"
    );
  }

  if (!question || question.trim().length === 0) {
    throw new Error("Question cannot be empty");
  }

  const maxTokens = options.maxTokens || OPENAI_MAX_TOKENS;
  const temperature = options.temperature ?? OPENAI_TEMPERATURE;
  const timeoutMs = options.timeoutMs || TIMEOUT;

  try {
    // Initialize OpenAI client
    const client = new OpenAI({
      apiKey: OPENAI_API_KEY,
      timeout: timeoutMs,
    });

    // Create a timeout promise for additional safety
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Request timeout after ${timeoutMs}ms. Try a simpler question.`
          )
        );
      }, timeoutMs);
    });

    // Call OpenAI API
    const contentPromise = client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: temperature,
      max_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: STELLAR_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: question,
        },
      ],
    });

    const response = await Promise.race([contentPromise, timeoutPromise]);

    // Extract text from response
    const text = response.choices[0]?.message?.content?.trim();

    if (!text || text.length === 0) {
      throw new Error("No response generated from AI model");
    }

    // Log successful request (optional - for debugging)
    if (chatId) {
      console.log(
        `[Chatbot] Chat ${chatId} - Question processed successfully`
      );
    }

    return text;
  } catch (error: any) {
    // Handle specific API errors
    if (error?.status === 429) {
      throw new Error("Too many requests. Please wait a moment.");
    }

    if (error?.status === 401 || error?.status === 403) {
      console.error("OpenAI API authentication error:", error?.message);
      throw new Error("AI chatbot not configured. Contact bot administrator.");
    }

    if (error?.message?.includes("timeout")) {
      throw error; // Re-throw our timeout error
    }

    if (error?.message?.includes("API key")) {
      throw error; // Re-throw our API key error
    }

    // Network/connection errors
    if (
      error?.message?.includes("ECONNREFUSED") ||
      error?.message?.includes("ENOTFOUND") ||
      error?.message?.includes("ERR_NETWORK")
    ) {
      throw new Error(
        "Unable to connect to AI service. Try rephrasing your question."
      );
    }

    // Generic error
    throw new Error(
      `Error generating response: ${error?.message || "Unknown error"}`
    );
  }
}

/**
 * Check if response indicates the question was off-topic
 * Useful for logging or analytics
 */
export function isOffTopicResponse(response: string): boolean {
  const offTopicIndicators = [
    "only help with stellar",
    "only answer questions about",
    "stellar-related questions",
  ];
  return offTopicIndicators.some((indicator) =>
    response.toLowerCase().includes(indicator)
  );
}

/**
 * Truncate response to fit Telegram's character limit (4096 chars)
 * Preserves markdown formatting when possible
 */
export function truncateForTelegram(
  text: string,
  maxLength: number = 4000
): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Try to cut at a paragraph boundary
  const truncated = text.substring(0, maxLength);
  const lastNewline = truncated.lastIndexOf("\n");

  if (lastNewline > maxLength * 0.8) {
    // If we found a newline reasonably close to the end, use it
    return text.substring(0, lastNewline) + "\n\n*[Response truncated]*";
  }

  return truncated + "\n\n*[Response truncated]*";
}
