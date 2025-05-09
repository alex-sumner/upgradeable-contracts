import * as anchor from "@coral-xyz/anchor";
import {
    PublicKey,
    Keypair,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { BN } from "bn.js";
import * as dotenv from "dotenv";
import path from "path";
import * as fs from "fs";
import type { Rbx } from "../target/types/rbx";
import { fetchStateAccount } from "../tests/utils.ts";

// Convert a hex string to a Uint8Array/Buffer
function hexToBytes(hex: string): Uint8Array {
    // Remove '0x' prefix if present
    hex = hex.startsWith('0x') ? hex.substring(2) : hex;

    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

async function main() {
    // Load environment variables from .env file
    dotenv.config({ path: path.resolve(process.cwd(), ".env") });

    // Set required environment variables if not already set
    if (!process.env.ANCHOR_PROVIDER_URL) {
        process.env.ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com";
    }

    if (!process.env.ANCHOR_WALLET) {
        process.env.ANCHOR_WALLET = path.resolve(process.cwd(), "wallet-keypair.json");
    }

    // Setup provider from environment
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Get program from chain
    const programId = new PublicKey("CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W");
    console.log("Loading program from chain...");
    const program = await anchor.Program.at(programId, provider);

    if (!program || !program.methods) {
        throw new Error("Program failed to load from chain. Make sure the program is deployed.");
    }

    console.log("Program loaded successfully:", program.programId.toString());

    // Get PDAs
    const [statePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );

    console.log("State PDA:", statePda.toString());

    // Load timelock authority keypair
    let timelockAuthority: Keypair;
    try {
        // First try to load from deploy-keypair.json
        const withdrawalSignerKeypairData = fs.readFileSync(
            path.resolve(process.cwd(), "admin-keypair.json"),
            'utf-8'
        );
        const withdrawalSignerKeypairSecret = Uint8Array.from(JSON.parse(
            withdrawalSignerKeypairData));
        timelockAuthority = Keypair.fromSecretKey(withdrawalSignerKeypairSecret);
        console.log("Using timelock authority:", timelockAuthority.publicKey.toString());
    } catch (e) {
        console.log("No admin-keypair.json found");
        return;
    }

    // First, check current state to see if this authority is valid
    try {
        const state = await fetchStateAccount(program, statePda);
        console.log("Current state data:");
        console.log("Owner:", state.owner.toString());
        console.log("Current withdrawal signer:", Buffer.from(state.withdrawalSigner).toString("hex"));

        // Check if our authority is in the list
        const isAuthorized = state.timelockAuthorities.some(
            auth => auth.equals(timelockAuthority.publicKey)
        );

        console.log("Timelock authorities:", state.timelockAuthorities.map(a => a.toString()));
        console.log("Is our authority authorized?", isAuthorized);

        if (!isAuthorized) {
            console.error("The provided authority is not authorized to queue operations");
            console.log("You may need to use one of the authorized keys or update the authorized keys list first");
            return;
        }

        console.log("Timelock delay:", state.timelockDelay.toString(), "seconds");
    } catch (error) {
        console.error("Error fetching state account:", error);
        return;
    }

    // The new withdrawal signer address in bytes (Ethereum address)
    // Convert the hex string to bytes
    const newSignerHex = "0xBde13eE1C2FB2c5730aF531461CB02c34fD991F0";
    const newSignerBytes = hexToBytes(newSignerHex);

    if (newSignerBytes.length !== 20) {
        console.error("Invalid Ethereum address length. Must be 20 bytes.");
        return;
    }

    console.log("New withdrawal signer to set:", newSignerHex);

    try {
        // Queue the operation to change the withdrawal signer
        console.log("Queueing operation to change withdrawal signer...");

        const tx = await program.methods
            .queueOperation(
                new BN(2), // 2 = Change signer operation type
                Buffer.from(newSignerBytes)
            )
            .accounts({
                state: statePda,
                authority: timelockAuthority.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId
            })
            .signers([timelockAuthority])
            .rpc();

        console.log("✅ Operation queued successfully!");
        console.log("Transaction signature:", tx);

        // Fetch the updated state to see our queued operation
        const stateAfterQueue = await fetchStateAccount(program, statePda);

        // Find our operation
        console.log("Pending operations:", stateAfterQueue.pendingOperations.length);
        const operationIndex = stateAfterQueue.pendingOperations.findIndex(op => op.operationType === 2);

        if (operationIndex === -1) {
            console.error("Could not find the queued operation in pending operations");
            return;
        }

        console.log("Operation queued at index:", operationIndex);

        const operation = stateAfterQueue.pendingOperations[operationIndex];
        console.log("Operation queued at:", new Date(operation.queuedAt * 1000).toISOString());
        console.log("Operation can be executed at:", new Date(operation.canExecuteAt * 1000).toISOString());

        // Calculate time to wait
        const secondsToWait = Math.max(0, operation.canExecuteAt - Math.floor(Date.now() / 1000));
        console.log(`Waiting ${secondsToWait} seconds for timelock to expire...`);

        if (secondsToWait > 0) {
            // Wait for the timelock to expire
            await new Promise(resolve => setTimeout(resolve, secondsToWait * 1000 + 2000)); // Add 2 seconds buffer
        }

        // Execute the operation
        console.log("Executing the operation...");
        const executeTx = await program.methods
            .executeOperation(new BN(operationIndex))
            .accounts({
                state: statePda,
                authority: timelockAuthority.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId
            })
            .signers([timelockAuthority])
            .rpc();

        console.log("✅ Operation executed successfully!");
        console.log("Transaction signature:", executeTx);

        // Verify that the withdrawal signer was updated
        const stateAfterExecution = await fetchStateAccount(program, statePda);
        const newSigner = Buffer.from(stateAfterExecution.withdrawalSigner).toString("hex");
        console.log("Updated withdrawal signer:", "0x" + newSigner);

        // Verify it matches what we set
        const expectedSigner = Buffer.from(newSignerBytes).toString("hex");
        console.log("Expected signer:", "0x" + expectedSigner);
        console.log("Signer updated correctly:", newSigner === expectedSigner);

    } catch (error) {
        console.error("❌ Error:", error);
        if (error && typeof error === 'object' && 'logs' in error) {
            console.log("Transaction logs:", error.logs);
        }
    }
}

main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
});