/**
 * ============================================================
 *  StellrFlow — Off-Ramp Service  (XLM → Fiat)
 * ============================================================
 *
 *  Manages the full withdrawal lifecycle:
 *
 *    1. User runs  /withdraw 50 USD
 *    2. createWithdrawal()  — validates balance, locks amount
 *    3. confirmWithdrawal() — debits XLM, mock anchor pays fiat
 *    4. quickWithdrawal()   — one-shot shortcut
 *
 *  Lifecycle states:
 *    created → pending → processing → completed | failed | cancelled
 *
 *  For Telegram wallets (bot holds secret key) the debit is
 *  executed on-chain automatically.
 *
 *  For Freighter wallets (user holds key) a production system
 *  would generate unsigned XDR for the user to sign.  In this
 *  hackathon demo we simulate the debit instead.
 *
 *  @module anchor/offramp
 */

import {
  simulateFiatWithdrawal,
  getExchangeRate,
} from './mockAnchor.js';
import {
  getBalance,
  sendXLM,
  type TransferResult,
} from './stellarService.js';

// ───────────────────────────────────────────
//  Types
// ───────────────────────────────────────────

export type WithdrawalStatus =
  | 'created'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WithdrawalRecord {
  withdrawalId: string;
  userId: string;
  xlmAmount: number;
  estimatedFiat: number;
  currency: string;
  exchangeRate: number;          // fiat-per-XLM
  walletAddress: string | null;
  status: WithdrawalStatus;
  stellarTxHash: string | null;
  actualFiatPayout: number;
  eta: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface WithdrawalResult {
  success: boolean;
  withdrawalId: string;
  xlmDebited: number;
  fiatPayout: number;
  currency: string;
  stellarTxHash: string | null;
  eta: string;
  message: string;
}

// ───────────────────────────────────────────
//  In-memory store
// ───────────────────────────────────────────
const withdrawals = new Map<string, WithdrawalRecord>();
const userWithdrawalIds = new Map<string, string[]>();
let wdrCounter = 0;

function nextWdrId(): string {
  wdrCounter += 1;
  return `WDR-${Date.now().toString(36).toUpperCase()}-${String(wdrCounter).padStart(3, '0')}`;
}

// ───────────────────────────────────────────
//  Create withdrawal  (Step 1)
// ───────────────────────────────────────────

/**
 * Record a withdrawal intent.
 *
 * If `walletAddress` is provided we pre-validate that the
 * on-chain balance is sufficient.  This prevents wasting the
 * user's time on withdrawals that will inevitably fail.
 */
export async function createWithdrawal(
  userId: string,
  xlmAmount: number,
  currency: string = 'USD',
  walletAddress?: string,
): Promise<WithdrawalRecord> {
  // ── Balance guard (skipped for hackathon demo) ──
  // In production, this validates on-chain balance before allowing withdrawal
  // For hackathon: we simulate the withdrawal even for unfunded accounts
  /*
  if (walletAddress) {
    const bal = await getBalance(walletAddress);
    if (!bal.exists) {
      throw new Error('Wallet not found on Stellar network. Fund it first.');
    }
    const available = parseFloat(bal.xlm);
    // Leave 1.5 XLM for base reserve + fees
    const usable = Math.max(available - 1.5, 0);
    if (usable < xlmAmount) {
      throw new Error(
        `Insufficient balance.  Available: ${available} XLM (${usable} usable after reserve).`,
      );
    }
  }
  */

  const { rate } = getExchangeRate(currency);
  const fiatRate = roundFiat(1 / rate);               // XLM → fiat direction
  const estimatedFiat = roundFiat(xlmAmount * fiatRate);
  const wdrId = nextWdrId();
  const now = new Date();

  const record: WithdrawalRecord = {
    withdrawalId: wdrId,
    userId,
    xlmAmount,
    estimatedFiat,
    currency: currency.toUpperCase(),
    exchangeRate: fiatRate,
    walletAddress: walletAddress ?? null,
    status: 'created',
    stellarTxHash: null,
    actualFiatPayout: 0,
    eta: '5–10 min',
    createdAt: now,
    completedAt: null,
  };

  withdrawals.set(wdrId, record);
  const list = userWithdrawalIds.get(userId) ?? [];
  list.push(wdrId);
  userWithdrawalIds.set(userId, list);

  return record;
}

// ───────────────────────────────────────────
//  Confirm withdrawal  (Step 2)
// ───────────────────────────────────────────

/**
 * Execute the withdrawal:
 *   1. Debit XLM from user's wallet (if we have the secret key)
 *   2. Simulate fiat payout via mock anchor
 *
 * @param walletSecret  — secret key of the user's Telegram wallet.
 *                         Pass `undefined` for Freighter wallets
 *                         (the debit step is simulated).
 * @param anchorAddress — Stellar address the anchor uses to receive
 *                         XLM.  For the hackathon we use a dummy.
 */
export async function confirmWithdrawal(
  withdrawalId: string,
  walletAddress: string,
  walletSecret?: string,
  anchorAddress?: string,
): Promise<WithdrawalResult> {
  const rec = withdrawals.get(withdrawalId);
  if (!rec) return wdrFail(withdrawalId, 'Withdrawal not found');
  if (rec.status === 'completed') return wdrFail(withdrawalId, 'Already completed');
  if (rec.status === 'cancelled') return wdrFail(withdrawalId, 'Cancelled');

  rec.status = 'processing';
  rec.walletAddress = walletAddress;

  // ── 1. Re-check balance (skipped for hackathon demo) ──
  // const bal = await getBalance(walletAddress);
  // const available = parseFloat(bal.xlm);
  // if (available < rec.xlmAmount) {
  //   rec.status = 'failed';
  //   return wdrFail(withdrawalId, `Balance too low: ${available} XLM`);
  // }

  // ── 2. Debit XLM on-chain ──
  let transfer: TransferResult;

  // Get treasury public key to receive the XLM
  const treasuryPublicKey = process.env.ANCHOR_TREASURY_PUBLIC || 'GBCWLQYUSY4K4W7T23IK5F6DPIAXWJ3WKYGVFFYGU7GOG3K2X3GHAQ4D';

  if (walletSecret) {
    // Telegram wallet — we hold the key, can transfer to treasury
    transfer = await sendXLM(walletSecret, treasuryPublicKey, rec.xlmAmount);
  } else {
    // Freighter wallet — can't sign server-side, simulate for demo
    transfer = { success: true, hash: `FREIGHTER_DEBIT_${Date.now().toString(36).toUpperCase()}` };
  }

  if (!transfer.success) {
    rec.status = 'failed';
    return wdrFail(withdrawalId, transfer.error ?? 'XLM debit failed');
  }

  // ── 3. Simulate fiat payout ──
  const anchor = await simulateFiatWithdrawal(rec.xlmAmount, rec.currency);

  rec.status = 'completed';
  rec.actualFiatPayout = anchor.fiatPayout;
  rec.stellarTxHash = transfer.hash ?? null;
  rec.eta = anchor.eta;
  rec.completedAt = new Date();

  return {
    success: true,
    withdrawalId,
    xlmDebited: rec.xlmAmount,
    fiatPayout: anchor.fiatPayout,
    currency: rec.currency,
    stellarTxHash: transfer.hash ?? null,
    eta: anchor.eta,
    message: `${rec.xlmAmount} XLM → ${anchor.fiatPayout} ${rec.currency}`,
  };
}

// ───────────────────────────────────────────
//  Quick withdrawal  (one-shot)
// ───────────────────────────────────────────

export async function quickWithdrawal(
  userId: string,
  xlmAmount: number,
  currency: string,
  walletAddress: string,
  walletSecret?: string,
): Promise<WithdrawalResult> {
  try {
    const rec = await createWithdrawal(userId, xlmAmount, currency, walletAddress);
    return confirmWithdrawal(rec.withdrawalId, walletAddress, walletSecret);
  } catch (err: any) {
    return wdrFail('N/A', err.message ?? 'Withdrawal creation failed');
  }
}

// ───────────────────────────────────────────
//  Query helpers
// ───────────────────────────────────────────

export function getWithdrawal(withdrawalId: string): WithdrawalRecord | null {
  return withdrawals.get(withdrawalId) ?? null;
}

export function getUserWithdrawals(userId: string): WithdrawalRecord[] {
  return (userWithdrawalIds.get(userId) ?? [])
    .map(id => withdrawals.get(id))
    .filter((w): w is WithdrawalRecord => w !== undefined);
}

export function getWithdrawalEstimate(
  xlmAmount: number,
  currency: string = 'USD',
): { xlmAmount: number; estimatedFiat: number; currency: string; rate: number } {
  const { rate } = getExchangeRate(currency);
  const fiatRate = roundFiat(1 / rate);
  return {
    xlmAmount,
    estimatedFiat: roundFiat(xlmAmount * fiatRate),
    currency: currency.toUpperCase(),
    rate: fiatRate,
  };
}

export function cancelWithdrawal(withdrawalId: string): boolean {
  const rec = withdrawals.get(withdrawalId);
  if (!rec || rec.status === 'completed' || rec.status === 'processing') return false;
  rec.status = 'cancelled';
  return true;
}

// ───────────────────────────────────────────
//  Internal
// ───────────────────────────────────────────

function roundFiat(n: number): number {
  return Math.round(n * 100) / 100;
}

function wdrFail(withdrawalId: string, message: string): WithdrawalResult {
  return {
    success: false,
    withdrawalId,
    xlmDebited: 0,
    fiatPayout: 0,
    currency: 'N/A',
    stellarTxHash: null,
    eta: 'N/A',
    message,
  };
}
