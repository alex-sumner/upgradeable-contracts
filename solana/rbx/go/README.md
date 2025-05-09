# RBX Event Listener

This is a Go application that listens for events emitted by the RBX Solana program, specifically tracking DepositEvent and WithdrawalEvent.

## Prerequisites

- Go 1.16 or later
- Access to a Solana RPC endpoint (default: mainnet-beta)

## Installation

```bash
# Clone the repository
git clone https://github.com/rabbitx/rbx.git
cd rbx/go

# Install dependencies
go mod download
```

## Usage

Run the event listener:

```bash
go run cmd/event-listener/main.go
```

### Command Line Options

- `-rpc`: Solana RPC WebSocket endpoint (default: "wss://api.mainnet-beta.solana.com")
- `-program`: Program ID to monitor (default: "BEFhXGhAD2iqvwK8kQ5ubdzhWqwN5cqKA8XRgAN4C2Mj")

Example with custom RPC endpoint:
```bash
go run cmd/event-listener/main.go -rpc wss://your-custom-rpc-endpoint
```

## Events

The listener tracks two types of events:

1. `DepositEvent`: Emitted when a user deposits tokens
   - ID: Unique deposit identifier
   - Trader: Public key of the depositing user
   - Amount: Amount deposited
   - Token: Public key of the deposited token

2. `WithdrawalEvent`: Emitted when a withdrawal is processed
   - ID: Unique withdrawal identifier
   - Trader: Public key of the withdrawing user
   - Amount: Amount withdrawn
   - Token: Public key of the withdrawn token

## Chain Reorgs

Unlike Ethereum, Solana's consensus mechanism (Proof of Stake with Proof of History) makes chain reorgs much less common and typically shorter. The event listener uses `CommitmentConfirmed` level, which means the transaction has been confirmed by a supermajority of the cluster. This is typically sufficient for most applications.

For critical applications requiring additional safety:
1. Use a custom RPC endpoint with `CommitmentFinalized` level
2. Implement event persistence to prevent double-processing
3. Add reorg detection by monitoring slot numbers 