import * as anchor from "@coral-xyz/anchor";
import {
    Connection,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL,
    SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import { BN } from "bn.js";
import * as dotenv from "dotenv";
import path from "path";
import { ethers } from "ethers";
import { signWithdrawal } from "../tests/utils.ts";

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

    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Connect to devnet (for balance checks)
    const connection = new Connection(process.env.ANCHOR_PROVIDER_URL, "confirmed");

    // Get program from workspace (same way as tests)
    console.log("Loading program from workspace...");
    const program = anchor.workspace.Rbx;
    
    if (!program || !program.methods) {
        throw new Error("Program failed to load from workspace. Make sure to run 'anchor build' first.");
    }
    
    console.log("Program loaded successfully:", program.programId.toString());

    // Get PDAs
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

    // Amount to withdraw
    const withdrawAmount = new BN(0.01 * LAMPORTS_PER_SOL);
    console.log(`Withdrawing ${withdrawAmount.toNumber() / LAMPORTS_PER_SOL} SOL...`);

    // Create an Ethereum wallet for signing
    // Use a fixed private key for the signer in tests or generate a new one
    logSignerAddress(program);
    const signerWallet = new ethers.Wallet("8e4c105ab32271981e99ee36835b45456de0654e13a563ec7d92b3cb92b9a98a");
    console.log("Signer wallet address (Ethereum):", signerWallet.address);

    // Unique withdrawal ID
    const withdrawalId = Math.floor(Date.now() / 1000); // Use timestamp as unique ID
    console.log("Withdrawal ID:", withdrawalId);

    try {
        // Get initial balances for verification
        const initialProgramBalance = await connection.getBalance(programSolAccount);
        const initialUserBalance = await connection.getBalance(provider.wallet.publicKey);

        console.log(`Initial program balance: ${initialProgramBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`Initial user balance: ${initialUserBalance / LAMPORTS_PER_SOL} SOL`);

        // Create withdrawal data
        const withdrawalData = {
            id: withdrawalId,
            token: new PublicKey("So11111111111111111111111111111111111111112"), // Wrapped SOL mint
            trader: provider.wallet.publicKey,
            amount: withdrawAmount.toString(),
        };

        // Sign the withdrawal with the Ethereum wallet
        console.log("Signing withdrawal data...");
        const { v, r, s } = await signWithdrawal(
            signerWallet,
            statePda,
            withdrawalData
        );

        // Find the withdrawal record account PDA
        const withdrawalAccount = PublicKey.findProgramAddressSync(
            [
                Buffer.from("withdrawal_account"),
                new BN(withdrawalId / 4000).toArrayLike(Buffer, 'le', 8)
            ],
            program.programId
        )[0];

        console.log("Withdrawal record account:", withdrawalAccount.toString());

        // Send the withdrawal transaction
        console.log("Sending withdrawal transaction...");
        const tx = await program.methods
            .withdrawNative(
                new BN(withdrawalId),
                withdrawAmount,
                v,
                r,
                s
            )
            .accounts({
                state: statePda,
                withdrawalRecord: withdrawalAccount,
                wrappedSolMint: new PublicKey("So11111111111111111111111111111111111111112"),
                programSolAccount: programSolAccount,
                trader: provider.wallet.publicKey,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
                rent: SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        console.log("✅ Withdrawal successful!");
        console.log("Transaction signature:", tx);

        // Verify final balances
        const finalProgramBalance = await connection.getBalance(programSolAccount);
        const finalUserBalance = await connection.getBalance(provider.wallet.publicKey);

        console.log(`Final program balance: ${finalProgramBalance / LAMPORTS_PER_SOL} SOL`);
        console.log(`Final user balance: ${finalUserBalance / LAMPORTS_PER_SOL} SOL`);

        console.log(`Program balance change: ${(initialProgramBalance - finalProgramBalance) / LAMPORTS_PER_SOL} SOL`);
        console.log(`User balance change: ${(finalUserBalance - initialUserBalance) / LAMPORTS_PER_SOL} SOL`);

    } catch (error) {
        console.error("❌ Error during withdrawal:", error);
        if (error && typeof error === 'object' && 'logs' in error) {
            console.log("Transaction logs:", error.logs);
        }
    }
}
/**
 * Fetches and logs the signer address stored in the on-chain state
 */
async function logSignerAddress(program: anchor.Program<Rbx>) {
    try {
        console.log("Fetching signer address from on-chain state...");

        // Get the state PDA
        const [statePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("state")],
            program.programId
        );

        // Use the getWithdrawalSigner function (note camelCase)
        const withdrawalSignerBytes = await program.methods
            .getWithdrawalSigner()
            .accounts({
                state: statePda,
            })
            .view();

        // Convert to hex string
        const ethAddressHex = "0x" + Buffer.from(withdrawalSignerBytes).toString("hex");
        console.log("On-chain signer Ethereum address:", ethAddressHex);
    } catch (error) {
        console.error("Error fetching signer address:", error);
        if (error && typeof error === 'object' && 'logs' in error) {
            console.log("Error logs:", error.logs);
        }
    }
}

main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
}); 