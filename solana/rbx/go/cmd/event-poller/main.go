package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

const (
	PROGRAM_ID         = "CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W"
	DEFAULT_RPC        = "https://solana-devnet.g.alchemy.com/v2/8xgHgvv1JXGWJhS3ErUmZI5QN0VT2HPD"
	POLL_INTERVAL      = 10 * time.Second
	RATE_LIMIT_BACKOFF = 30 * time.Second
	MAX_SIGNATURES     = 100
)

type Config struct {
	RPCEndpoint  string
	ProgramID    string
	PollInterval time.Duration
}

type DepositEvent struct {
	ID     string           `json:"id"`
	Trader solana.PublicKey `json:"trader"`
	Amount uint64           `json:"amount"`
	Token  solana.PublicKey `json:"token"`
}

type WithdrawalEvent struct {
	ID     uint64           `json:"id"`
	Trader solana.PublicKey `json:"trader"`
	Amount uint64           `json:"amount"`
	Token  solana.PublicKey `json:"token"`
}

func main() {
	// Parse command line flags
	rpcEndpoint := flag.String("rpc", DEFAULT_RPC, "Solana RPC endpoint (HTTP URL)")
	programID := flag.String("program", PROGRAM_ID, "Program ID to monitor")
	pollInterval := flag.Duration("interval", POLL_INTERVAL, "Polling interval")
	flag.Parse()

	config := Config{
		RPCEndpoint:  *rpcEndpoint,
		ProgramID:    *programID,
		PollInterval: *pollInterval,
	}

	log.Printf("Starting event poller with HTTP endpoint: %s", config.RPCEndpoint)
	log.Printf("Monitoring program: %s", config.ProgramID)
	log.Printf("Poll interval: %s", config.PollInterval)
	log.Printf("Press Ctrl+C to stop")

	// Create a context that can be cancelled
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create a channel to handle program termination
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start the event poller in a goroutine
	errChan := make(chan error, 1)
	go func() {
		errChan <- runEventPoller(ctx, config)
	}()

	// Wait for either a signal or an error
	select {
	case sig := <-sigChan:
		log.Printf("Received signal %v, shutting down...", sig)
		cancel()
	case err := <-errChan:
		if err != nil {
			log.Fatalf("Event poller failed: %v", err)
		}
	}
}

// Get the current Solana slot
func getCurrentSlot(ctx context.Context, client *rpc.Client) {
	// Get current slot with finalized commitment
	slot, err := client.GetSlot(ctx, rpc.CommitmentFinalized)
	if err != nil {
		log.Printf("Error getting current slot: %v", err)
		return
	}

	// Get epoch info for additional context
	epochInfo, err := client.GetEpochInfo(ctx, rpc.CommitmentFinalized)
	if err != nil {
		log.Printf("Current Solana slot: %d", slot)
	} else {
		log.Printf("Current Solana slot: %d | Epoch: %d | Slots in Epoch: %d/%d",
			slot,
			epochInfo.Epoch,
			epochInfo.SlotIndex,
			epochInfo.SlotsInEpoch)
	}
}

func runEventPoller(ctx context.Context, config Config) error {
	// Create a new HTTP client
	client := rpc.New(config.RPCEndpoint)

	// Keep track of processed signatures to avoid duplicates
	processedSignatures := make(map[string]struct{})

	// Poll for new transactions in a loop
	ticker := time.NewTicker(config.PollInterval)
	defer ticker.Stop()

	log.Printf("Starting polling loop...")

	programID := solana.MustPublicKeyFromBase58(config.ProgramID)

	for {
		select {
		case <-ctx.Done():
			log.Printf("Context cancelled, shutting down...")
			return ctx.Err()
		case <-ticker.C:
			// Display current Solana slot at each poll interval
			getCurrentSlot(ctx, client)

			// Get recent signatures for the program account
			signatures, err := client.GetSignaturesForAddress(ctx, programID)
			if err != nil {
				log.Printf("Error getting signatures: %v", err)

				// Check for rate limiting and back off if needed
				if strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "rate limit") {
					log.Printf("Rate limited. Backing off for %s", RATE_LIMIT_BACKOFF)
					time.Sleep(RATE_LIMIT_BACKOFF)
				}

				continue
			}

			// If no signatures found, continue to next polling interval
			if len(signatures) == 0 {
				continue
			}

			// First poll, just record signatures without processing
			if len(processedSignatures) == 0 {
				// Record these signatures as processed
				for _, sig := range signatures {
					processedSignatures[sig.Signature.String()] = struct{}{}
				}
				log.Printf("Initialized with %d signatures", len(signatures))
				continue
			}

			// Process new signatures we haven't seen before
			var newSignatures []solana.Signature
			for _, sig := range signatures {
				sigStr := sig.Signature.String()
				if _, processed := processedSignatures[sigStr]; !processed {
					newSignatures = append(newSignatures, sig.Signature)
					processedSignatures[sigStr] = struct{}{}
				}
			}

			// If no new signatures, continue to next polling interval
			if len(newSignatures) == 0 {
				continue
			}

			log.Printf("Found %d new transactions", len(newSignatures))

			// Process transactions (newest to oldest, but often we want oldest to newest)
			// so we'll reverse the order
			for i := len(newSignatures) - 1; i >= 0; i-- {
				sig := newSignatures[i]

				// Get the transaction details
				tx, err := client.GetTransaction(ctx, sig, &rpc.GetTransactionOpts{
					Encoding:   solana.EncodingBase64,
					Commitment: rpc.CommitmentConfirmed,
				})
				if err != nil {
					log.Printf("Error getting transaction %s: %v", sig, err)
					continue
				}

				// Display transaction information
				log.Printf("Transaction: %s, Status: %s, Fee: %d lamports",
					sig.String(),
					getTransactionStatus(tx),
					tx.Meta.Fee)

				// Process the logs to find events
				if tx != nil && tx.Meta != nil && tx.Meta.LogMessages != nil {
					log.Printf("Found %d log messages in transaction %s", len(tx.Meta.LogMessages), sig.String())

					// Identify the transaction type
					var isDeposit, isWithdrawal bool
					for _, logLine := range tx.Meta.LogMessages {
						if strings.Contains(logLine, "Instruction: DepositNative") ||
							strings.Contains(logLine, "Instruction: DepositToken") {
							isDeposit = true
							break
						}
						if strings.Contains(logLine, "Instruction: WithdrawNative") ||
							strings.Contains(logLine, "Instruction: WithdrawToken") {
							isWithdrawal = true
							break
						}
					}

					// Look for Program data logs which contain the serialized event data
					for i, logLine := range tx.Meta.LogMessages {
						log.Printf("Log [%d]: %s", i, logLine)

						if strings.HasPrefix(logLine, "Program data:") {
							// Extract and decode the base64 data
							parts := strings.Split(logLine, "Program data: ")
							if len(parts) < 2 {
								continue
							}

							base64Data := parts[1]
							data, err := base64.StdEncoding.DecodeString(base64Data)
							if err != nil {
								log.Printf("Failed to decode base64 data: %v", err)
								continue
							}

							log.Printf("Decoded program data length: %d bytes", len(data))

							// Process based on transaction type
							if isDeposit {
								event, err := parseDepositEventFromData(data)
								if err != nil {
									log.Printf("Failed to parse deposit event data: %v", err)
									continue
								}
								handleDepositEvent(event)
							} else if isWithdrawal {
								event, err := parseWithdrawalEventFromData(data)
								if err != nil {
									log.Printf("Failed to parse withdrawal event data: %v", err)
									continue
								}
								handleWithdrawalEvent(event)
							}
						}
					}
				}
			}

			// Limit the map size by removing old entries if it gets too large
			if len(processedSignatures) > 1000 {
				// This is a simple approach: just clear and start over
				// In a production system, you'd want a more sophisticated approach like an LRU cache
				log.Printf("Cleaning up signature cache (size: %d)", len(processedSignatures))
				processedSignatures = make(map[string]struct{})
				for _, sig := range signatures {
					processedSignatures[sig.Signature.String()] = struct{}{}
				}
			}
		}
	}
}

// Parse deposit event data from binary format
// Based on observed binary data format
func parseDepositEventFromData(data []byte) (DepositEvent, error) {
	// Print debugging info
	log.Printf("Data bytes (first 20): %v", data[:min(20, len(data))])
	log.Printf("Hex dump: %x", data)

	var event DepositEvent

	if len(data) < 88 {
		return event, fmt.Errorf("data too short for deposit event, expected at least 88 bytes, got %d", len(data))
	}

	// Based on observed data structure:
	// - First 8 bytes seem to be a header/discriminator
	// - Bytes 8-16 contain the deposit number (used for ID)
	// - Bytes 16-48 contain the trader public key
	// - Bytes 48-56 contain the amount
	// - Bytes 56-88 contain the token public key

	// Extract deposit number for ID (bytes 8-16)
	depositNum := binary.LittleEndian.Uint64(data[8:16])
	event.ID = fmt.Sprintf("d_%d_rbx_sol", depositNum)

	// Extract trader public key (bytes 16-48)
	var traderPubkey solana.PublicKey
	copy(traderPubkey[:], data[16:48])
	event.Trader = traderPubkey

	// Extract amount (bytes 48-56)
	event.Amount = binary.LittleEndian.Uint64(data[48:56])

	// Extract token public key (bytes 56-88)
	var tokenPubkey solana.PublicKey
	copy(tokenPubkey[:], data[56:88])
	event.Token = tokenPubkey

	log.Printf("Parsed deposit event: ID=%s, Trader=%s, Amount=%d, Token=%s",
		event.ID, event.Trader.String(), event.Amount, event.Token.String())

	return event, nil
}

// Parse withdrawal event data from binary format
func parseWithdrawalEventFromData(data []byte) (WithdrawalEvent, error) {
	// Print debugging info
	log.Printf("Data bytes (first 20): %v", data[:min(20, len(data))])
	log.Printf("Hex dump: %x", data)

	var event WithdrawalEvent

	if len(data) < 88 {
		return event, fmt.Errorf("data too short for withdrawal event, expected at least 88 bytes, got %d", len(data))
	}

	// Based on observed data structure:
	// - First 8 bytes seem to be a header/discriminator
	// - Bytes 8-16 contain the withdrawal ID
	// - Bytes 16-48 contain the trader public key
	// - Bytes 48-56 contain the amount
	// - Bytes 56-88 contain the token public key

	// Extract withdrawal ID (bytes 8-16)
	event.ID = binary.LittleEndian.Uint64(data[8:16])

	// Extract trader public key (bytes 16-48)
	var traderPubkey solana.PublicKey
	copy(traderPubkey[:], data[16:48])
	event.Trader = traderPubkey

	// Extract amount (bytes 48-56)
	event.Amount = binary.LittleEndian.Uint64(data[48:56])

	// Extract token public key (bytes 56-88)
	var tokenPubkey solana.PublicKey
	copy(tokenPubkey[:], data[56:88])
	event.Token = tokenPubkey

	log.Printf("Parsed withdrawal event: ID=%d, Trader=%s, Amount=%d, Token=%s",
		event.ID, event.Trader.String(), event.Amount, event.Token.String())

	return event, nil
}

func handleDepositEvent(event DepositEvent) {
	log.Printf("Deposit Event: ID=%s, Trader=%s, Amount=%d, Token=%s",
		event.ID,
		event.Trader.String(),
		event.Amount,
		event.Token.String(),
	)
}

func handleWithdrawalEvent(event WithdrawalEvent) {
	log.Printf("Withdrawal Event: ID=%d, Trader=%s, Amount=%d, Token=%s",
		event.ID,
		event.Trader.String(),
		event.Amount,
		event.Token.String(),
	)
}

// Helper function to get transaction status
func getTransactionStatus(tx *rpc.GetTransactionResult) string {
	if tx == nil || tx.Meta == nil {
		return "Unknown"
	}
	if tx.Meta.Err != nil {
		return fmt.Sprintf("Failed: %v", tx.Meta.Err)
	}
	return "Success"
}

// Helper function for min
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
