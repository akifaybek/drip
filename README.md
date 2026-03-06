# Drip

Drip is a USDC-based payroll streaming application built on Soroban.

- **Contract (Rust/Soroban):** Multi-stream payment flows (`stream_id` based)
- **Frontend (React + Freighter):** Create, view, claim, and cancel streams

## Features

- Multi-stream model: `Map<stream_id, Stream>`
- Safe `claim/cancel` flow (auth + checked arithmetic + invariants)
- BigInt-safe frontend token calculations (i128 compatible)
- Tx lifecycle UX: `simulate -> sign -> send -> confirm`
- Global tx statuses: `idle | simulating | signing | submitting | confirming | done | error`

## Project Structure

```text
drip/
  contracts/
    stellar-flow/      # Soroban contract crate name (current folder name)
  frontend/            # CRA frontend
```

## Requirements

- Node.js 18+
- npm
- Rust toolchain
- Soroban CLI (for deployment)
- Freighter Wallet (browser extension)

## Development Setup

### 1) Prepare frontend environment file

```bash
cd frontend
cp .env.example .env
```

Then fill in the values in `.env`.

### 2) Run frontend development server

```bash
cd frontend
npm install
npm start
```

### 3) Build frontend for production

```bash
cd frontend
npm run build
```

## Contract Build/Test

```bash
cd contracts/stellar-flow
cargo test -q
cargo build --target wasm32v1-none --release
```

## Contract Deploy (Summary)

> Choose RPC/passphrase values according to your target network (testnet/mainnet).

1. Build the contract wasm output (`cargo build ... --release`)
2. Deploy via Soroban CLI
3. Get the deployed **Contract ID**
4. Update frontend `.env` with `REACT_APP_CONTRACT_ID`

## Contract ID Update

The frontend reads contract address only from `.env`:

```env
REACT_APP_CONTRACT_ID=YOUR_DEPLOYED_CONTRACT_ID
```

If you redeploy the contract, make sure this value is updated.

## Network Configuration

Frontend uses `REACT_APP_NETWORK`:

- `testnet`
- `public`

Example:

```env
REACT_APP_NETWORK=testnet
REACT_APP_RPC_URL=https://soroban-testnet.stellar.org
```

## Known Issues

- As an MVP approach, frontend stores recently tracked `stream_id` values in `localStorage`.
- Old local storage data may affect stream visibility across different wallet/address combinations.
- If Freighter signature popup is closed by user, transaction fails at `sign` stage (expected behavior).
- Confirmation/poll time can increase under network congestion.

## Production Checklist

Validate all of the following before deployment:

- [ ] `cargo test -q` succeeded
- [ ] `cargo build --target wasm32v1-none --release` succeeded
- [ ] `npm run build` in `frontend` succeeded
- [ ] `REACT_APP_CONTRACT_ID` matches the latest deployed contract ID
- [ ] `REACT_APP_NETWORK` and `REACT_APP_RPC_URL` match target network
- [ ] `REACT_APP_USDC_ADDRESS` is the correct token contract address
- [ ] End-to-end smoke tests for create/claim/cancel done with Freighter
- [ ] Tx lifecycle states display correctly in UI (`simulate/sign/send/confirm`)
- [ ] Tx hash verified on explorer

## License

See project license file: `LICENSE`.
