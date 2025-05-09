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
import {
    TOKEN_PROGRAM_ID,
    getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";

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

    // Get command line arguments to determine stake type (native or token)
    const args = process.argv.slice(2);
    const stakeType = args[0] || "native"; // Default to native if not specified
    const tokenAddress = args[1]; // Optional token address for token staking

    console.log(`Starting Solana ${stakeType} stake...`);

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

    const [tokenAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_authority")],
        program.programId
    );

    const [programSolAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("sol_account")],
        program.programId
    );

    console.log("State PDA:", statePda.toString());

    // Amount to stake (0.02 SOL or 2 tokens - slightly different from deposit to distinguish them)
    const stakeAmount = new BN(stakeType === "native" ? 0.02 * LAMPORTS_PER_SOL : 2_000_000);

    try {
        if (stakeType === "native") {
            await stakeNative(program, connection, provider, statePda, programSolAccount, stakeAmount);
        } else if (stakeType === "token") {
            if (!tokenAddress) {
                throw new Error("Token address is required for token staking");
            }
            const mint = new PublicKey(tokenAddress);
            await stakeToken(program, connection, provider, statePda, tokenAuthPda, mint, stakeAmount);
        } else {
            throw new Error("Invalid stake type. Use 'native' or 'token'");
        }
    } catch (error) {
        console.error("❌ Error during stake:", error);
        if (error && typeof error === 'object' && 'logs' in error) {
            console.log("Transaction logs:", error.logs);
        }
    }
}

async function stakeNative(
    program: anchor.Program,
    connection: Connection,
    provider: anchor.AnchorProvider,
    statePda: PublicKey,
    programSolAccount: PublicKey,
    stakeAmount: BN
) {
    console.log(`Staking ${stakeAmount.toNumber() / LAMPORTS_PER_SOL} SOL...`);
    console.log("Program SOL account:", programSolAccount.toString());

    // Get initial balances for verification
    const initialUserBalance = await connection.getBalance(provider.wallet.publicKey);
    const initialProgramBalance = await connection.getBalance(programSolAccount);

    console.log(`Initial user balance: ${initialUserBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Initial program balance: ${initialProgramBalance / LAMPORTS_PER_SOL} SOL`);

    // Send the stake_native transaction
    console.log("Sending native stake transaction...");
    const tx = await program.methods
        .stakeNative(stakeAmount)
        .accounts({
            state: statePda,
            wrappedSolMint: new PublicKey("So11111111111111111111111111111111111111112"),
            programSolAccount,
            user: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId
        })
        .rpc();

    console.log("✅ Native stake successful!");
    console.log("Transaction signature:", tx);

    // Verify final balances
    const finalUserBalance = await connection.getBalance(provider.wallet.publicKey);
    const finalProgramBalance = await connection.getBalance(programSolAccount);

    console.log(`Final user balance: ${finalUserBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Final program balance: ${finalProgramBalance / LAMPORTS_PER_SOL} SOL`);

    console.log(`User balance change: ${(initialUserBalance - finalUserBalance) / LAMPORTS_PER_SOL} SOL`);
    console.log(`Program balance change: ${(finalProgramBalance - initialProgramBalance) / LAMPORTS_PER_SOL} SOL`);
}

async function stakeToken(
    program: anchor.Program,
    connection: Connection,
    provider: anchor.AnchorProvider,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    mint: PublicKey,
    stakeAmount: BN
) {
    console.log(`Staking ${stakeAmount.toNumber() / 1_000_000} tokens of mint ${mint.toString()}...`);
    console.log("Token authority PDA:", tokenAuthPda.toString());

    // Get the user's token account
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        mint,
        provider.wallet.publicKey
    );
    console.log("User token account:", userTokenAccount.address.toString());

    // Get the program's token account for this mint
    const programTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        mint,
        tokenAuthPda,
        true // allowOwnerOffCurve
    );
    console.log("Program token account:", programTokenAccount.address.toString());

    // Get initial balances
    const initialUserInfo = await connection.getTokenAccountBalance(userTokenAccount.address);
    const initialUserBalance = parseInt(initialUserInfo.value.amount);

    // Program account may not exist yet or have no balance
    let initialProgramBalance = 0;
    try {
        const programAccountInfo = await connection.getTokenAccountBalance(programTokenAccount.address);
        initialProgramBalance = parseInt(programAccountInfo.value.amount);
    } catch (e) {
        console.log("Program token account doesn't exist yet or has no balance");
    }

    console.log(`Initial user token balance: ${initialUserBalance / 1_000_000}`);
    console.log(`Initial program token balance: ${initialProgramBalance / 1_000_000}`);

    // Send the stake_token transaction
    console.log("Sending token stake transaction...");
    const tx = await program.methods
        .stakeToken(stakeAmount)
        .accounts({
            state: statePda,
            mint: mint,
            programTokenAccount: programTokenAccount.address,
            programTokenAuthority: tokenAuthPda,
            userTokenAccount: userTokenAccount.address,
            user: provider.wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    console.log("✅ Token stake successful!");
    console.log("Transaction signature:", tx);

    // Verify final balances
    const finalUserInfo = await connection.getTokenAccountBalance(userTokenAccount.address);
    const finalUserBalance = parseInt(finalUserInfo.value.amount);

    const finalProgramInfo = await connection.getTokenAccountBalance(programTokenAccount.address);
    const finalProgramBalance = parseInt(finalProgramInfo.value.amount);

    console.log(`Final user token balance: ${finalUserBalance / 1_000_000}`);
    console.log(`Final program token balance: ${finalProgramBalance / 1_000_000}`);

    console.log(`User balance change: ${(initialUserBalance - finalUserBalance) / 1_000_000} tokens`);
    console.log(`Program balance change: ${(finalProgramBalance - initialProgramBalance) / 1_000_000} tokens`);
}

main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
});