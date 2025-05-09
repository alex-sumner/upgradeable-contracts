package main

import (
	"context"
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
	PROGRAM_ID         = "9yWT9i8kJxY6JFdud9eeWkqtiMTUcDgbSCgF5RD4ihTE"
	DEFAULT_RPC        = "https://solana-devnet.g.alchemy.com/v2/8xgHgvv1JXGWJhS3ErUmZI5QN0VT2HPD"
	POLL_INTERVAL      = 30 * time.Second
	RATE_LIMIT_BACKOFF = 30 * time.Second
	DEFAULT_LIMIT      = 20
)

type Config struct {
	RPCEndpoint  string
	ProgramID    string
	PollInterval time.Duration
	Limit        int
	ShowOnce     bool
}

func main() {
	// Parse command line flags
	rpcEndpoint := flag.String("rpc", DEFAULT_RPC, "Solana RPC endpoint (HTTP URL)")
	programID := flag.String("program", PROGRAM_ID, "Program ID to monitor")
	pollInterval := flag.Duration("interval", POLL_INTERVAL, "Polling interval (for continuous mode)")
	limit := flag.Int("limit", DEFAULT_LIMIT, "Maximum number of transactions to show")
	showOnce := flag.Bool("once", false, "Show transactions once and exit (don't poll)")
	flag.Parse()

	config := Config{
		RPCEndpoint:  *rpcEndpoint,
		ProgramID:    *programID,
		PollInterval: *pollInterval,
		Limit:        *limit,
		ShowOnce:     *showOnce,
	}

	log.Printf("Starting transaction lister with HTTP endpoint: %s", config.RPCEndpoint)
	log.Printf("Monitoring program: %s", config.ProgramID)
	if !config.ShowOnce {
		log.Printf("Poll interval: %s", config.PollInterval)
		log.Printf("Press Ctrl+C to stop")
	}

	// Create a context that can be cancelled
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Create a channel to handle program termination
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start the transaction lister in a goroutine
	errChan := make(chan error, 1)
	go func() {
		if config.ShowOnce {
			// Run once and exit
			err := listTransactions(ctx, config)
			if err != nil {
				errChan <- err
			}
			cancel() // Signal completion
		} else {
			// Run in a polling loop
			errChan <- runTransactionLister(ctx, config)
		}
	}()

	// Wait for either a signal or an error
	select {
	case sig := <-sigChan:
		log.Printf("Received signal %v, shutting down...", sig)
		cancel()
	case err := <-errChan:
		if err != nil {
			log.Fatalf("Transaction lister failed: %v", err)
		}
	case <-ctx.Done():
		// Normal exit for showOnce mode
	}
}

func runTransactionLister(ctx context.Context, config Config) error {
	// Create a new HTTP client
	client := rpc.New(config.RPCEndpoint)

	// Keep track of the most recent signature we've seen
	var lastSignature string

	// Poll for transactions in a loop
	ticker := time.NewTicker(config.PollInterval)
	defer ticker.Stop()

	log.Printf("Starting polling loop...")

	for {
		select {
		case <-ctx.Done():
			log.Printf("Context cancelled, shutting down...")
			return ctx.Err()
		case <-ticker.C:
			// Show transactions and update lastSignature
			var err error
			lastSignature, err = showTransactions(ctx, client, config, lastSignature)
			if err != nil {
				log.Printf("Error getting transactions: %v", err)

				// Check for rate limiting and back off if needed
				if strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "rate limit") {
					log.Printf("Rate limited. Backing off for %s", RATE_LIMIT_BACKOFF)
					time.Sleep(RATE_LIMIT_BACKOFF)
				}
			}
		}
	}
}

func listTransactions(ctx context.Context, config Config) error {
	client := rpc.New(config.RPCEndpoint)
	_, err := showTransactions(ctx, client, config, "")
	return err
}

func showTransactions(ctx context.Context, client *rpc.Client, config Config, lastSignature string) (string, error) {
	// Get signatures for the program
	programID := solana.MustPublicKeyFromBase58(config.ProgramID)
	
	// Set up options
	opts := &rpc.GetSignaturesForAddressOpts{
		Limit: uint64(config.Limit),
	}
	
	// If we have a last signature, start after it
	if lastSignature != "" {
		opts.Until = solana.MustSignatureFromBase58(lastSignature)
	}
	
	sigs, err := client.GetSignaturesForAddress(ctx, programID, opts)
	if err != nil {
		return lastSignature, err
	}
	
	if len(sigs) == 0 {
		log.Printf("No transactions found")
		return lastSignature, nil
	}
	
	// Keep track of the most recent signature for next poll
	newLastSignature := lastSignature
	if len(sigs) > 0 && (newLastSignature == "" || sigs[0].Signature.String() != newLastSignature) {
		newLastSignature = sigs[0].Signature.String()
	}
	
	// Print header
	fmt.Println("\n=== Recent Transactions ===")
	fmt.Printf("%-65s | %-30s | %-10s | %s\n", "Signature", "Block Time", "Status", "Memo")
	fmt.Println(strings.Repeat("-", 120))
	
	// Print transactions
	for _, sig := range sigs {
		// Format block time
		var timeStr string
		if sig.BlockTime != nil {
			t := time.Unix(*sig.BlockTime, 0)
			timeStr = t.Format("2006-01-02 15:04:05")
		} else {
			timeStr = "Unknown"
		}
		
		// Get status string
		status := "Success"
		if sig.Err != nil {
			status = fmt.Sprintf("Failed: %v", sig.Err)
		}
		
		// Get transaction details for memo or additional info
		memo := ""
		if sig.Memo != nil {
			memo = *sig.Memo
		} else {
			// For transactions without a memo, try to extract the instruction type
			tx, err := client.GetTransaction(ctx, sig.Signature, &rpc.GetTransactionOpts{
				Commitment: rpc.CommitmentConfirmed,
			})
			if err == nil && tx != nil && tx.Meta != nil && tx.Meta.LogMessages != nil {
				for _, logLine := range tx.Meta.LogMessages {
					if strings.Contains(logLine, "Instruction:") {
						parts := strings.Split(logLine, "Instruction:")
						if len(parts) == 2 {
							memo = "Instruction:" + parts[1]
							break
						}
					}
				}
			}
		}
		
		// Print the transaction info
		fmt.Printf("%-65s | %-30s | %-10s | %s\n", 
			sig.Signature.String(), 
			timeStr, 
			status,
			memo,
		)
	}
	
	fmt.Println(strings.Repeat("-", 120))
	fmt.Printf("Total: %d transactions\n\n", len(sigs))
	
	return newLastSignature, nil
}