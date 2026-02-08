/**
 * ============================================================
 *  StellrFlow — Mock Anchor Provider
 * ============================================================
 *
 *  PURPOSE
 *  -------
 *  Simulates a Stellar Anchor (SEP-24) for hackathon demos.
 *
 *  In production, an anchor is a regulated entity that:
 *    1. Accepts fiat via bank transfer / card
 *    2. Issues an on-chain Stellar asset (or sends native XLM)
 *    3. Handles KYC, compliance, and settlement
 *
 *  This mock:
 *    • Skips KYC entirely
 *    • Uses hard-coded demo exchange rates
 *    • Simulates processing delays with async sleeps
 *    • Returns realistic anchor-shaped responses
 *
 *  ARCHITECTURE
 *  ------------
 *  mockAnchor.ts   ← you are here (lowest layer)
 *      ↑ consumed by
 *  onramp.ts  /  offramp.ts  (business logic)
 *      ↑ consumed by
 *  anchorService.ts  (orchestration + Stellar SDK calls)
 *      ↑ consumed by
 *  telegram-bot.ts  (Telegram command handlers)
 *
 *  @module anchor/mockAnchor
 */

// ───────────────────────────────────────────
//  Demo exchange rates  (fiat → XLM)
// ───────────────────────────────────────────
//  In production these come from a market feed.
//  Here they are constant for reproducible demos.

const RATES: Record<string, number> = {
  USD: 10,        // 1 USD  →  10    XLM
  EUR: 11,        // 1 EUR  →  11    XLM
  INR: 0.12,      // 1 INR  →   0.12 XLM  (₹100 ≈ 12 XLM)
  GBP: 12.5,      // 1 GBP  →  12.5  XLM
};

// Processing delays — short enough for a live demo,
// long enough to show a "⏳ Processing…" message.
const DEPOSIT_DELAY_MS  = 2_500;
const WITHDRAW_DELAY_MS = 3_000;

// ───────────────────────────────────────────
//  Exported types
// ───────────────────────────────────────────

/** Every anchor transaction walks through these states. */
export type AnchorTxStatus =
  | 'created'
  | 'pending_user_payment'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

/** Response shape for a completed deposit simulation. */
export interface AnchorDepositResponse {
  transactionId: string;
  status: AnchorTxStatus;
  fiatAmount: number;
  fiatCurrency: string;
  creditedXLM: number;
  exchangeRate: number;
  message: string;
  createdAt: Date;
  completedAt: Date | null;
}

/** Response shape for a completed withdrawal simulation. */
export interface AnchorWithdrawResponse {
  transactionId: string;
  status: AnchorTxStatus;
  xlmAmount: number;
  fiatPayout: number;
  fiatCurrency: string;
  exchangeRate: number;
  eta: string;
  message: string;
  createdAt: Date;
  completedAt: Date | null;
}

// ───────────────────────────────────────────
//  Transaction ID generator
// ───────────────────────────────────────────
let txCounter = 0;

function nextTxId(prefix: string): string {
  txCounter += 1;
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${ts}-${String(txCounter).padStart(4, '0')}`;
}

// ───────────────────────────────────────────
//  Rate helpers  (public API)
// ───────────────────────────────────────────

/**
 * Look up the fiat → XLM rate for a given currency.
 * Returns the USD rate as fallback.
 */
export function getRate(currency: string): number {
  return RATES[currency.toUpperCase()] ?? RATES['USD'];
}

/**
 * Structured rate response used by the rest of the module.
 */
export function getExchangeRate(currency: string = 'USD'): {
  rate: number;
  currency: string;
} {
  return { rate: getRate(currency), currency: currency.toUpperCase() };
}

/**
 * All currencies this mock "supports".
 */
export function getSupportedCurrencies(): string[] {
  return Object.keys(RATES);
}

/**
 * Health check — always true for the mock.
 */
export function isAnchorAvailable(): boolean {
  return true;
}

// ───────────────────────────────────────────
//  Deposit simulation  (fiat → XLM)
// ───────────────────────────────────────────

/**
 * Simulate fiat deposit confirmation.
 *
 * In production:
 *   1. User pays via bank / card on anchor's hosted UI
 *   2. Anchor sends webhook: "payment confirmed"
 *   3. Anchor credits XLM on-chain
 *
 * Here we sleep for DEPOSIT_DELAY_MS then return "completed".
 */
export async function simulateFiatDeposit(
  fiatAmount: number,
  currency: string = 'USD',
): Promise<AnchorDepositResponse> {
  await sleep(DEPOSIT_DELAY_MS);

  const rate = getRate(currency);
  const creditedXLM = roundXLM(fiatAmount * rate);
  const txId = nextTxId('DEP');
  const now = new Date();

  return {
    transactionId: txId,
    status: 'completed',
    fiatAmount,
    fiatCurrency: currency.toUpperCase(),
    creditedXLM,
    exchangeRate: rate,
    message: `Anchor confirmed: ${fiatAmount} ${currency.toUpperCase()} → ${creditedXLM} XLM`,
    createdAt: now,
    completedAt: now,
  };
}

// ───────────────────────────────────────────
//  Withdrawal simulation  (XLM → fiat)
// ───────────────────────────────────────────

/**
 * Simulate fiat withdrawal payout.
 *
 * In production:
 *   1. User sends XLM to anchor's Stellar address
 *   2. Anchor confirms receipt
 *   3. Anchor initiates bank wire / mobile money payout
 *
 * Here we sleep for WITHDRAW_DELAY_MS then return "completed".
 */
export async function simulateFiatWithdrawal(
  xlmAmount: number,
  currency: string = 'USD',
): Promise<AnchorWithdrawResponse> {
  await sleep(WITHDRAW_DELAY_MS);

  const rate = getRate(currency);
  const fiatPayout = roundFiat(xlmAmount / rate);
  const txId = nextTxId('WDR');
  const now = new Date();

  return {
    transactionId: txId,
    status: 'completed',
    xlmAmount,
    fiatPayout,
    fiatCurrency: currency.toUpperCase(),
    exchangeRate: roundFiat(1 / rate),  // fiat-per-XLM
    eta: '5–10 min (simulated)',
    message: `Anchor payout: ${xlmAmount} XLM → ${fiatPayout} ${currency.toUpperCase()}`,
    createdAt: now,
    completedAt: now,
  };
}

// ───────────────────────────────────────────
//  Internal utilities
// ───────────────────────────────────────────

function roundXLM(n: number): number {
  return Math.round(n * 1e7) / 1e7;        // Stellar 7-decimal precision
}

function roundFiat(n: number): number {
  return Math.round(n * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
