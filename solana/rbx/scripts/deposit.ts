import * as anchor from "@coral-xyz/anchor";
import {
    Connection,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { BN } from "bn.js";
import * as dotenv from "dotenv";
import path from "path";

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

    console.log("Starting SOL deposit using standard Anchor approach...");

    // Setup provider from environment
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Connect to devnet (for balance checks)
    const connection = new Connection(process.env.ANCHOR_PROVIDER_URL, "confirmed");

    // Get program from chain
    const programId = new PublicKey("CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W");
    console.log("Loading program from chain...");
    const program = await anchor.Program.at(programId, provider);

    // Derive PDAs
    const [statePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("state")],
        program.programId
    );

    const [programSolAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("sol_account")],
        program.programId
    );

    console.log("State PDA:", statePda.toString());
    console.log("Program SOL account:", programSolAccount.toString());

    // Amount to deposit (0.1 SOL)
    const depositAmount = new BN(0.01 * LAMPORTS_PER_SOL);
    console.log(`Depositing ${depositAmount.toNumber() / LAMPORTS_PER_SOL} SOL...`);

    try {
        // Get initial balances for verification
        const initialUserBalance = await connection.getBalance(provider.wallet.publicKey);
        const initialProgramBalance = await connection.getBalance(programSolAccount);

        console.log(`Initial user balance: ${initialUserBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`Initial program balance: ${initialProgramBalance / LAMPORTS_PER_SOL} SOL`);

        // Standard Anchor transaction
        console.log("Sending deposit transaction...");
        const tx = await program.methods
            .depositNative(depositAmount)
            .accounts({
                state: statePda,
                wrappedSolMint: new PublicKey("So11111111111111111111111111111111111111112"),
                programSolAccount,
                user: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId
            })
            .rpc();

        console.log("✅ Deposit successful!");
        console.log("Transaction signature:", tx);

        // Verify final balances
        const finalUserBalance = await connection.getBalance(provider.wallet.publicKey);
        const finalProgramBalance = await connection.getBalance(programSolAccount);

        console.log(`Final user balance: ${finalUserBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`Final program balance: ${finalProgramBalance / LAMPORTS_PER_SOL} SOL`);

        console.log(`User balance change: ${(initialUserBalance - finalUserBalance) / LAMPORTS_PER_SOL} SOL`);
        console.log(`Program balance change: ${(finalProgramBalance - initialProgramBalance) / LAMPORTS_PER_SOL} SOL`);

    } catch (error) {
        console.error("❌ Error during deposit:", error);
        if (error && typeof error === 'object' && 'logs' in error) {
            console.log("Transaction logs:", error.logs);
        }
    }
}

main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
});