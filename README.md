# Drip

USDC payroll streaming on Stellar Soroban.

---

## About Me

Hi, I’m **Akif Aybek**.

I am a software developer focused on blockchain products, practical smart contracts, and clean user experience. I enjoy building tools that solve real payment and workflow problems. In this project, I combined Soroban smart contracts with a React frontend to create a simple payroll streaming prototype. My goal is to keep the product developer-friendly, auditable, and easy to demonstrate in real testnet conditions.

---

## Project Description

**Drip** is a payroll streaming dApp built on Stellar Soroban. It allows an employer to create time-based USDC payment streams for an employee instead of sending one large payment upfront. The contract stores each stream with amount-per-period, interval, total amount, claimed amount, and active status. Employees can claim earned amounts over time, while employers can cancel streams and recover unclaimed funds. The frontend integrates with Freighter for signing and shows transaction lifecycle states from simulation to on-chain confirmation. This approach improves transparency, reduces manual payroll steps, and demonstrates programmable money flows with simple, understandable UX.

---

## Vision

Drip’s vision is to make payroll more fair, transparent, and continuous by turning salary payments into programmable cash flow. Instead of waiting for fixed payout dates, workers should be able to access earned value in a controlled and auditable way. On Stellar, this can become fast, low-cost, and globally accessible for startups, DAOs, and remote teams. Over time, this model can expand beyond salaries into grants, subscriptions, and milestone-based contributor rewards. By combining secure smart contracts with a simple user interface, Drip aims to help both technical and non-technical users adopt blockchain-powered payroll with confidence.

---

## Software Development Plan

1. **Design data model and stream lifecycle**
   - Define stream struct fields (`employer`, `employee`, `token`, `amount_per_period`, `interval`, `total`, `claimed`, `timestamps`, `active`).
   - Define invariants and validation rules.

2. **Implement core Soroban contract methods**
   - `create_stream`
   - `claim`
   - `cancel`
   - read methods such as `get_stream` and `claimable_amount`.

3. **Add safety and correctness checks**
   - Authorization checks.
   - Checked arithmetic for token math.
   - State transition guards and error handling.

4. **Build React + Freighter frontend**
   - Wallet connect, stream creation form, stream card view.
   - Claim/cancel actions and local stream tracking UX.

5. **Integrate transaction lifecycle + testnet deployment**
   - Simulate → sign → submit → confirm flow.
   - Deploy contract, configure environment, and run end-to-end tests.

---

## Personal Story

I built Drip because I wanted to explore a real payment problem instead of a purely technical demo. Payroll is a universal workflow with clear pain points: delays, manual operations, and low transparency. Soroban gave me a solid environment to model these rules directly in a contract. During development, I focused on practical reliability: safer token math, wallet flow clarity, and testnet debugging. This project helped me improve both contract thinking and frontend product sense, and it gave me a stronger foundation for building real blockchain applications.

---

## Tech Stack

- **Smart Contract:** Rust + Soroban SDK
- **Frontend:** React (CRA)
- **Wallet:** Freighter
- **Network:** Stellar Testnet / Public
- **RPC:** Soroban RPC

---

## Smart Contract Features

- Multi-stream architecture (`stream_id` based)
- Time-based claimable calculation
- Partial claim support
- Employer cancellation with remaining-fund logic
- Read-only state query helpers
- Validation and invariant checks

---

## Frontend Features

- Connect wallet with Freighter
- Create, view, refresh, claim, and cancel streams
- BigInt-safe token formatting/parsing
- Transaction lifecycle feedback (`idle`, `simulating`, `signing`, `submitting`, `confirming`, `done`, `error`)
- Explorer-friendly transaction hash flow

---

## Installation

### 1) Clone repository

```bash
git clone https://github.com/akifaybek/drip.git
cd drip
```

### 2) Setup frontend environment

```bash
cd frontend
cp .env.example .env
```

Fill [`frontend/.env`](frontend/.env) values:

```env
REACT_APP_CONTRACT_ID=YOUR_DEPLOYED_CONTRACT_ID
REACT_APP_NETWORK=testnet
REACT_APP_RPC_URL=https://soroban-testnet.stellar.org
REACT_APP_USDC_ADDRESS=YOUR_TOKEN_CONTRACT_ID
REACT_APP_USDC_DECIMALS=7
```

### 3) Install frontend dependencies

```bash
npm install
```

### 4) Run frontend

```bash
npm start
```

### 5) Build frontend

```bash
npm run build
```

### 6) Build/test contract

```bash
cd ../contracts/stellar-flow
cargo test -q
cargo build --target wasm32v1-none --release
```

---

## Configuration Notes

- Frontend contract and token addresses are read from [`frontend/.env`](frontend/.env).
- If you redeploy the contract, update `REACT_APP_CONTRACT_ID`.
- Keep `REACT_APP_NETWORK` and `REACT_APP_RPC_URL` aligned.

---

## Demo / Verification

- Run a create → claim → cancel flow on testnet.
- Verify transaction hashes on Stellar Expert testnet explorer.
- Confirm stream state transitions after each action.
- Live Demo : https://frontend-nine-xi-pc3pghnon6.vercel.app/

---

## Bootcamp Submission Notes

- README includes:
  - About Me
  - Project Description
  - Vision
  - Software Development Plan (5 steps)
  - Personal Story
  - Installation and technical details

---

## License

See [`LICENSE`](LICENSE).
