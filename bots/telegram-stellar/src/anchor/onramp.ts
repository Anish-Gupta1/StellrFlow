/**
 * StellrFlow - On-Ramp Service (Fiat to XLM)
 *
 * Lifecycle: created -> pending -> processing -> completed | failed | expired
 *
 * @module anchor/onramp
 */

import { simulateFiatDeposit, getExchangeRate } from './mockAnchor.js';
import { sendXLM, fundWithFriendbot, type TransferResult } from './stellarService.js';

// Types

export type DepositStatus = 'created' | 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

export interface DepositRecord {
  depositId: string;
  userId: string;
  fiatAmount: number;
  currency: string;
  estimatedXLM: number;
  exchangeRate: number;
  walletAddress: string | null;
  status: DepositStatus;
  paymentLink: string;
  stellarTxHash: string | null;
  creditedXLM: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface DepositResult {
  success: boolean;
  depositId: string;
  creditedXLM: number;
  stellarTxHash: string | null;
  message: string;
}

// In-memory store
const deposits = new Map<string, DepositRecord>();
const userDepositIds = new Map<string, string[]>();
let depositCounter = 0;

function nextDepositId(): string {
  depositCounter += 1;
  return `DEP-${Date.now().toString(36).toUpperCase()}-${String(depositCounter).padStart(3, '0')}`;
}

/**
 * Create a deposit request with a mock payment link.
 */
export function createDeposit(
  userId: string,
  fiatAmount: number,
  currency: string = 'USD',
  walletAddress: string | null = null,
): DepositRecord {
  const { rate } = getExchangeRate(currency);
  const estimatedXLM = roundXLM(fiatAmount * rate);
  const depositId = nextDepositId();
  const now = new Date();

  const record: DepositRecord = {
    depositId,
    userId,
    fiatAmount,
    currency: currency.toUpperCase(),
    estimatedXLM,
    exchangeRate: rate,
    walletAddress,
    status: 'created',
    paymentLink: `https://stellrflow-anchor.demo/pay/${depositId}?amt=${fiatAmount}&cur=${currency.toUpperCase()}`,
    stellarTxHash: null,
    creditedXLM: 0,
    createdAt: now,
    completedAt: null,
  };

  deposits.set(depositId, record);
  const list = userDepositIds.get(userId) ?? [];
  list.push(depositId);
  userDepositIds.set(userId, list);

  return record;
}

/**
 * Confirm a deposit: simulate fiat, then credit XLM on-chain.
 */
export async function confirmDeposit(
  depositId: string,
  walletAddress: string,
  sourceSecret?: string,
): Promise<DepositResult> {
  const rec = deposits.get(depositId);
  if (!rec) return fail(depositId, 'Deposit not found');
  if (rec.status === 'completed') return fail(depositId, 'Already completed');
  if (rec.status === 'expired') return fail(depositId, 'Expired');

  rec.status = 'processing';
  rec.walletAddress = walletAddress;

  // 1. Anchor confirms fiat
  const anchor = await simulateFiatDeposit(rec.fiatAmount, rec.currency);
  if (anchor.status !== 'completed') {
    rec.status = 'failed';
    return fail(depositId, 'Anchor did not confirm fiat');
  }

  // 2. Credit XLM on-chain
  let transfer: TransferResult;
  if (sourceSecret) {
    transfer = await sendXLM(sourceSecret, walletAddress, anchor.creditedXLM);
  } else {
    transfer = await fundWithFriendbot(walletAddress);
  }

  if (!transfer.success) {
    rec.status = 'failed';
    return fail(depositId, transfer.error ?? 'Stellar transfer failed');
  }

  rec.status = 'completed';
  rec.creditedXLM = anchor.creditedXLM;
  rec.stellarTxHash = transfer.hash ?? null;
  rec.completedAt = new Date();

  return {
    success: true,
    depositId,
    creditedXLM: anchor.creditedXLM,
    stellarTxHash: transfer.hash ?? null,
    message: `${rec.fiatAmount} ${rec.currency} -> ${anchor.creditedXLM} XLM credited`,
  };
}

/**
 * One-shot deposit: create + auto-confirm.
 */
export async function quickDeposit(
  userId: string,
  fiatAmount: number,
  currency: string,
  walletAddress: string,
  sourceSecret?: string,
): Promise<DepositResult> {
  const rec = createDeposit(userId, fiatAmount, currency, walletAddress);
  return confirmDeposit(rec.depositId, walletAddress, sourceSecret);
}

// Query helpers

export function getDeposit(depositId: string): DepositRecord | null {
  return deposits.get(depositId) ?? null;
}

export function getUserDeposits(userId: string): DepositRecord[] {
  return (userDepositIds.get(userId) ?? [])
    .map(id => deposits.get(id))
    .filter((d): d is DepositRecord => d !== undefined);
}

export function getDepositEstimate(
  fiatAmount: number,
  currency: string = 'USD',
): { fiatAmount: number; currency: string; estimatedXLM: number; rate: number } {
  const { rate } = getExchangeRate(currency);
  return {
    fiatAmount,
    currency: currency.toUpperCase(),
    estimatedXLM: roundXLM(fiatAmount * rate),
    rate,
  };
}

export function cancelDeposit(depositId: string): boolean {
  const rec = deposits.get(depositId);
  if (!rec || rec.status === 'completed') return false;
  rec.status = 'expired';
  return true;
}

// Internal

function roundXLM(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

function fail(depositId: string, message: string): DepositResult {
  return { success: false, depositId, creditedXLM: 0, stellarTxHash: null, message };
}
