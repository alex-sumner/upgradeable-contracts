package main

import (
	"context"
	"encoding/json"
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
	"github.com/gagliardetto/solana-go/rpc/ws"
)

const (
	PROGRAM_ID = "CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W"
	// PROGRAM_ID         = "BEFhXGhAD2iqvwK8kQ5ubdzhWqwN5cqKA8XRgAN4C2Mj"
	// DEFAULT_RPC        = "https://solana-devnet.g.alchemy.com/v2/8xgHgvv1JXGWJhS3ErUmZI5QN0VT2HPD"
	DEFAULT_RPC        = "wss://api.mainnet-beta.solana.com"
	POLL_INTERVAL      = 10 * time.Second
	RATE_LIMIT_BACKOFF = 30 * time.Second
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
	rpcEndpoint := flag.String("rpc", DEFAULT_RPC, "Solana RPC endpoint (WebSocket URL)")
	programID := flag.String("program", PROGRAM_ID, "Program ID to monitor")
	pollInterval := flag.Duration("interval", POLL_INTERVAL, "Polling interval (fallback)")
	flag.Parse()

	config := Config{
		RPCEndpoint:  *rpcEndpoint,
		ProgramID:    *programID,
		PollInterval: *pollInterval,
	}

	log.Printf("Starting event listener with WebSocket endpoint: %s", config.RPCEndpoint)
	log.Printf("Monitoring program: %s", config.ProgramID)
	log.Printf("Press Ctrl+C to stop")

	// Create a context that can be cancelled
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create a channel to handle program termination
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start the event listener in a goroutine
	errChan := make(chan error, 1)
	go func() {
		errChan <- runEventListener(ctx, config, sigChan)
	}()

	// Wait for either a signal or an error
	select {
	case sig := <-sigChan:
		log.Printf("Received signal %v, shutting down...", sig)
		cancel()
	case err := <-errChan:
		if err != nil {
			log.Fatalf("Event listener failed: %v", err)
		}
	}
}

func runEventListener(ctx context.Context, config Config, sigChan chan os.Signal) error {
	// Create a new WebSocket client
	client, err := ws.Connect(ctx, config.RPCEndpoint)
	if err != nil {
		return fmt.Errorf("failed to connect to WebSocket: %v", err)
	}
	defer client.Close()

	// Subscribe to program logs
	programID := solana.MustPublicKeyFromBase58(config.ProgramID)
	sub, err := client.ProgramSubscribe(
		programID,
		rpc.CommitmentConfirmed,
	)
	if err != nil {
		return fmt.Errorf("failed to subscribe to program: %v", err)
	}
	defer sub.Unsubscribe()

	log.Printf("Successfully subscribed to program logs")

	// Process events
	for {
		select {
		case <-ctx.Done():
			log.Printf("Context cancelled, shutting down...")
			return ctx.Err()
		case <-sigChan:
			log.Printf("Received signal, shutting down...")
			return fmt.Errorf("received termination signal")
		default:
			result, err := sub.Recv(ctx)
			if err != nil {
				log.Printf("Error receiving from subscription: %v", err)
				continue
			}

			// Convert to JSON and extract logs through JSON parsing
			if result != nil {
				// Convert the entire result to JSON
				resultJSON, err := json.Marshal(result)
				if err != nil {
					log.Printf("Error marshaling result: %v", err)
					continue
				}

				// Parse as a generic map to navigate the structure
				var resultMap map[string]interface{}
				if err := json.Unmarshal(resultJSON, &resultMap); err != nil {
					log.Printf("Error parsing result JSON: %v", err)
					continue
				}

				// Try to extract logs from the JSON structure
				var logs []string

				// Try to navigate the JSON structure to find logs
				if valueObj, ok := resultMap["Value"].(map[string]interface{}); ok {
					// Try different paths where logs might be found
					if logsArray, ok := valueObj["Logs"].([]interface{}); ok {
						for _, logEntry := range logsArray {
							if logStr, ok := logEntry.(string); ok {
								logs = append(logs, logStr)
							}
						}
					}
				}

				// Process any logs we found
				for _, logLine := range logs {
					// Check for DepositEvent
					if strings.Contains(logLine, "DepositEvent") {
						var event DepositEvent
						if err := parseEvent(logLine, &event); err != nil {
							log.Printf("Failed to parse DepositEvent: %v", err)
							continue
						}
						handleDepositEvent(event)
					}

					// Check for WithdrawalEvent
					if strings.Contains(logLine, "WithdrawalEvent") {
						var event WithdrawalEvent
						if err := parseEvent(logLine, &event); err != nil {
							log.Printf("Failed to parse WithdrawalEvent: %v", err)
							continue
						}
						handleWithdrawalEvent(event)
					}
				}
			}
		}
	}
}

func parseEvent(log string, event interface{}) error {
	// Extract the JSON part from the log
	start := strings.Index(log, "{")
	end := strings.LastIndex(log, "}") + 1
	if start == -1 || end == 0 {
		return fmt.Errorf("invalid log format")
	}

	jsonStr := log[start:end]
	return json.Unmarshal([]byte(jsonStr), event)
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
