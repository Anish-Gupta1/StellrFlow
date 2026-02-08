/**
 * StellrFlow - Anchor Service (Orchestration + Re-exports)
 *
 * Single import point for telegram-bot.ts.
 * Re-exports from onramp, offramp, stellarService, mockAnchor.
 *
 * @module anchor/anchorService
 */

// On-ramp
export {
  createDeposit,
  confirmDeposit,
  quickDeposit,
  getDeposit,
  getUserDeposits,
  getDepositEstimate,
  cancelDeposit,
  type DepositRecord,
  type DepositResult,
  type DepositStatus,
} from './onramp.js';

// Off-ramp
export {
  createWithdrawal,
  confirmWithdrawal,
  quickWithdrawal,
  getWithdrawal,
  getUserWithdrawals,
  getWithdrawalEstimate,
  cancelWithdrawal,
  type WithdrawalRecord,
  type WithdrawalResult,
  type WithdrawalStatus,
} from './offramp.js';

// Stellar utilities
export {
  getBalance,
  sendXLM,
  fundWithFriendbot,
  getTransactionLog,
  getLogForAddress,
  getNetworkName,
  type BalanceInfo,
  type TransferResult,
  type TxLogEntry,
} from './stellarService.js';

// Mock anchor helpers
export {
  getExchangeRate,
  getSupportedCurrencies,
  isAnchorAvailable,
} from './mockAnchor.js';
