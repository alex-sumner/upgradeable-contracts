# RabbitX Solana Program

A Solana program that handles cross-chain withdrawals using Ethereum signatures. The program supports proxy withdrawals where one account can sign on behalf of another, allowing for enhanced flexibility in withdrawal operations.

## Features

- Proxy withdrawals: Separate transaction signers from withdrawal recipients
- Support for both token and native SOL withdrawals
- EIP-712 signature verification for secure cross-chain operations
- Duplicate withdrawal prevention

## Prerequisites

- Solana CLI tools
- Node.js and npm/yarn
- Anchor framework
- Rust

## Getting Started

### Local Development

```bash
# Install dependencies
yarn install

# Build the program
yarn build

# Run tests
yarn test

# Deploy locally and run a full setup
yarn setup:all

# Show logs
yarn show:logs
```

### Devnet Deployment

```bash
# Create a keypair for deployment
solana-keygen new -o deploy-keypair.json

# Fund the keypair
solana airdrop 2 $(solana-keygen pubkey deploy-keypair.json) --url https://api.devnet.solana.com

# Deploy to devnet
yarn deploy:devnet

# Initialize the program on devnet
yarn init:devnet

# Test withdrawals on devnet
yarn test:withdrawal:devnet
```

## Scripts

The project includes several scripts to help with deployment and testing:

- `deploy-testnet.ts`: Deploys the program to Solana devnet
- `init-testnet.ts`: Initializes the program state on devnet
- `test-withdrawal-testnet.ts`: Tests proxy withdrawals on devnet

## Program Structure

The main program logic is in `/programs/rbx/src/lib.rs` and includes:

- `initialize`: Sets up the program state with admin account and configuration
- `withdraw_token`: Processes token withdrawals
- `withdraw_native`: Processes native SOL withdrawals
- Supporting accounts and verification logic

## Testing

Comprehensive tests are available in the `/tests` directory, including:

- Proxy withdrawal tests (both token and SOL)
- Signature verification tests
- Multiple withdrawal tests
- Duplicate withdrawal prevention tests

## License

ISC License

# RBX Solana Deposit Script

This script allows you to deposit SOL to the RBX Solana program deployed on Devnet at address `9yWT9i8kJxY6JFdud9eeWkqtiMTUcDgbSCgF5RD4ihTE`.

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn package manager

## Installation

1. Clone this repository or download the files
2. Install dependencies:

```bash
npm install
```

or 

```bash
yarn install
```

## Usage

To build and run the deposit script:

```bash
npm run deposit
```

or

```bash
yarn deposit
```

### What the script does:

1. Connects to Solana Devnet
2. Loads or creates a keypair in `wallet-keypair.json`
3. Requests an airdrop of SOL if the balance is too low
4. Deposits 0.1 SOL to the RBX program on Devnet
5. Shows the result and transaction signature

## Customization

You can modify the amount to deposit by changing the `depositAmount` in the `deposit-sol.ts` file.

## Note

This is for demonstration purposes only. The script deposits SOL to the program and that SOL cannot be withdrawn without proper authorization.