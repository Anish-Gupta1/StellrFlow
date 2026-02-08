//! StellrFlow Telegram Bot - Stellar Soroban Contract
//!
//! Notification and payment counters for audit trail.
//! https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup

#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

const NOTIF_COUNT: Symbol = symbol_short!("NOTIF_CNT");
const PAYMENT_CNT: Symbol = symbol_short!("PAY_CNT");

#[contract]
pub struct StellrflowTelegramBot;

#[contractimpl]
impl StellrflowTelegramBot {
    /// Register a notification - returns record ID for audit
    pub fn register_notification(e: Env) -> u64 {
        let mut count: u64 = e
            .storage()
            .instance()
            .get(&NOTIF_COUNT)
            .unwrap_or(0);

        count += 1;
        e.storage().instance().set(&NOTIF_COUNT, &count);

        count
    }

    /// Record a payment (tip) - returns record ID
    pub fn record_payment(e: Env, amount: i128) -> u64 {
        let mut count: u64 = e
            .storage()
            .instance()
            .get(&PAYMENT_CNT)
            .unwrap_or(0);

        count += 1;
        e.storage().instance().set(&PAYMENT_CNT, &count);

        count
    }

    pub fn get_notification_count(e: Env) -> u64 {
        e.storage()
            .instance()
            .get(&NOTIF_COUNT)
            .unwrap_or(0)
    }

    pub fn get_payment_count(e: Env) -> u64 {
        e.storage()
            .instance()
            .get(&PAYMENT_CNT)
            .unwrap_or(0)
    }
}
