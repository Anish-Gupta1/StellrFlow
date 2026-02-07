# StellrFlow Telegram Bot - Stellar Soroban Contract

A minimal Soroban contract for on-chain audit trail (notification/payment counters). **Optional** - the Telegram bot works without deploying this contract.

## When to Deploy

Deploy only if you want on-chain records of notifications/payments (e.g. for compliance, auditing). Otherwise, skip it.

## Build & Deploy

```bash
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/stellrflow_telegram_bot.wasm --source alice --network testnet
```

## Usage

```bash
stellar contract invoke --id <CONTRACT_ID> --source alice --network testnet -- register_notification
stellar contract invoke --id <CONTRACT_ID> --source alice --network testnet -- record_payment 1000000000
```
