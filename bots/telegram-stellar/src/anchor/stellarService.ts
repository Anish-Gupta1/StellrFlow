/**
 * ============================================================
 *  StellrFlow — Stellar Service Layer
 * ============================================================
 *
 *  PURPOSE
 *  -------
 *  Encapsulates every direct Stellar SDK call the anchor module
 *  needs.  Nothing in this file knows about Telegram, anchors,
 *  or fiat — it only speaks "Stellar".
 *
 *  RESPONSIBILITIES
 *  ----------------
 *  • Check account balance
 *  • Send XLM payment  (payment / createAccount)
 *  • Fund via Friendbot (testnet)
 *  • Build unsigned XDR for Freighter signing
 *  • Log transactions to an in-memory ledger
 *
 *  ARCHITECTURE
 *  ------------
 *  telegram-bot.ts
 *      ↓
 *  anchorService.ts  (orchestrates)
 *      ↓
 *  stellarService.ts  ← you are here
 *      ↓
 *  Stellar Horizon / Testnet
 *
 *  @module anchor/stellarService
 */

import {
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';

// ───────────────────────────────────────────
//  Configuration
// ───────────────────────────────────────────

const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const HORIZON_URL =
  process.env.HORIZON_URL ||
  (STELLAR_NETWORK === 'testnet'
    ? 'https://horizon-testnet.stellar.org'
    : 'https://horizon.stellar.org');

const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

const horizon = new Horizon.Server(HORIZON_URL);

// ───────────────────────────────────────────
//  Exported types
// ───────────────────────────────────────────

export interface BalanceInfo {
  exists: boolean;
  xlm: string;            // e.g. "9999.9999900"
  otherAssets: { code: string; balance: string; issuer: string }[];
}

export interface TransferResult {
  success: boolean;
  hash?: string;
  ledger?: number;
  error?: string;
}

export interface TxLogEntry {
  id: string;
  type: 'credit' | 'debit' | 'friendbot';
  from: string;
  to: string;
  xlmAmount: number;
  hash: string | null;
  status: 'ok' | 'failed';
  timestamp: Date;
  note: string;
}

// ───────────────────────────────────────────
//  Transaction log  (in-memory, demo only)
// ───────────────────────────────────────────
const txLog: TxLogEntry[] = [];
let logCounter = 0;

function log(entry: Omit<TxLogEntry, 'id' | 'timestamp'>): void {
  logCounter += 1;
  txLog.push({
    ...entry,
    id: `LOG-${logCounter}`,
    timestamp: new Date(),
  });
}

/** Return the last N logged transactions (newest first). */
export function getTransactionLog(limit: number = 20): TxLogEntry[] {
  return txLog.slice(-limit).reverse();
}

/** Return transaction log entries for a specific address. */
export function getLogForAddress(address: string, limit: number = 20): TxLogEntry[] {
  return txLog
    .filter(e => e.from === address || e.to === address)
    .slice(-limit)
    .reverse();
}

// ───────────────────────────────────────────
//  Balance
// ───────────────────────────────────────────

/**
 * Load account from Horizon and return balance info.
 * Returns { exists: false } if the account has never been funded.
 */
export async function getBalance(address: string): Promise<BalanceInfo> {
  try {
    const acct = await horizon.loadAccount(address);
    const native = acct.balances.find((b: any) => b.asset_type === 'native');
    const xlm = native && 'balance' in native ? (native as any).balance : '0';

    const otherAssets = acct.balances
      .filter((b: any) => b.asset_type !== 'native' && 'asset_code' in b)
      .map((b: any) => ({
        code: b.asset_code as string,
        balance: b.balance as string,
        issuer: b.asset_issuer as string,
      }));

    return { exists: true, xlm, otherAssets };
  } catch {
    return { exists: false, xlm: '0', otherAssets: [] };
  }
}

// ───────────────────────────────────────────
//  Send XLM  (payment or createAccount)
// ───────────────────────────────────────────

/**
 * Send `amount` XLM from a source keypair to a destination address.
 *
 * • If destination exists → uses `Operation.payment`
 * • If destination does NOT exist → uses `Operation.createAccount`
 *   (requires amount ≥ 1 XLM for the base reserve)
 */
export async function sendXLM(
  sourceSecret: string,
  destination: string,
  amount: number,
): Promise<TransferResult> {
  try {
    const kp = Keypair.fromSecret(sourceSecret);
    const source = await horizon.loadAccount(kp.publicKey());

    const destExists = await accountExists(destination);

    let tx;
    if (destExists) {
      tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(Operation.payment({
          destination,
          asset: Asset.native(),
          amount: amount.toFixed(7),
        }))
        .setTimeout(60)
        .build();
    } else {
      // createAccount needs at least 1 XLM on testnet
      const startBal = Math.max(amount, 1);
      tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(Operation.createAccount({
          destination,
          startingBalance: startBal.toFixed(7),
        }))
        .setTimeout(60)
        .build();
    }

    tx.sign(kp);
    const res = await horizon.submitTransaction(tx);

    log({
      type: 'credit',
      from: kp.publicKey(),
      to: destination,
      xlmAmount: amount,
      hash: res.hash,
      status: 'ok',
      note: destExists ? 'payment' : 'createAccount',
    });

    return { success: true, hash: res.hash, ledger: (res as any).ledger };
  } catch (err: any) {
    const msg =
      err?.response?.data?.extras?.result_codes
        ? JSON.stringify(err.response.data.extras.result_codes)
        : err.message || 'sendXLM failed';

    log({
      type: 'credit',
      from: '(source)',
      to: destination,
      xlmAmount: amount,
      hash: null,
      status: 'failed',
      note: msg,
    });

    return { success: false, error: msg };
  }
}

// ───────────────────────────────────────────
//  Friendbot  (testnet only)
// ───────────────────────────────────────────

/**
 * Fund an address via Stellar Friendbot.
 * Only works on testnet.  Credits 10 000 XLM.
 */
export async function fundWithFriendbot(address: string): Promise<TransferResult> {
  if (STELLAR_NETWORK !== 'testnet') {
    return { success: false, error: 'Friendbot is testnet-only' };
  }

  try {
    const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
    if (!res.ok) {
      const body = await res.text();
      // "createAccountAlreadyExist" means it was already funded — not a real error
      if (body.includes('createAccountAlreadyExist')) {
        return { success: true, hash: 'already-funded' };
      }
      return { success: false, error: `Friendbot HTTP ${res.status}` };
    }

    const json = await res.json() as any;
    const hash = json?.hash ?? 'friendbot-ok';

    log({
      type: 'friendbot',
      from: 'friendbot',
      to: address,
      xlmAmount: 10_000,
      hash,
      status: 'ok',
      note: 'testnet funding',
    });

    return { success: true, hash };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ───────────────────────────────────────────
//  Helpers
// ───────────────────────────────────────────

async function accountExists(address: string): Promise<boolean> {
  try {
    await horizon.loadAccount(address);
    return true;
  } catch {
    return false;
  }
}

/** Expose the network name for display purposes. */
export function getNetworkName(): string {
  return STELLAR_NETWORK;
}
