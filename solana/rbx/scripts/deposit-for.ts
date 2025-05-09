import * as anchor from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
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

    // Get command line arguments
    const args = process.argv.slice(2);
    const depositType = args[0] || "native"; // Default to native if not specified
    let forTraderAddress = args[1];

    if (!forTraderAddress) {
        // If no trader address is provided, create a random one for demonstration
        const randomTrader = Keypair.generate();
        forTraderAddress = randomTrader.publicKey.toString();
        console.log("💡 No trader address provided. Using a random address for demonstration:", forTraderAddress);
    }

    console.log(`Starting Solana ${depositType} deposit FOR another account...`);

    // Setup provider from environment
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // Connect to devnet (for balance checks)
    const connection = new Connection(process.env.ANCHOR_PROVIDER_URL, "confirmed");

    // Parse the for_trader public key
    const forTrader = new PublicKey(forTraderAddress);
    console.log(`Depositing on behalf of: ${forTrader.toString()}`);

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

    // Amount to deposit (0.01 SOL or 1 token)
    const depositAmount = new BN(depositType === "native" ? 0.01 * LAMPORTS_PER_SOL : 1_000_000);

    try {
        if (depositType === "native") {
            await depositNativeFor(program, connection, provider, statePda, programSolAccount, depositAmount, forTrader);
        } else if (depositType === "token") {
            const tokenAddress = args[2];
            if (!tokenAddress) {
                throw new Error("Token address is required for token deposits. Usage: ts-node deposit-for.ts token <FOR_TRADER_ADDRESS> <TOKEN_MINT_ADDRESS>");
            }
            const mint = new PublicKey(tokenAddress);
            await depositTokenFor(program, connection, provider, statePda, tokenAuthPda, mint, depositAmount, forTrader);
        } else {
            throw new Error("Invalid deposit type. Use 'native' or 'token'");
        }
    } catch (error) {
        console.error("❌ Error during deposit:", error);
        if (error && typeof error === 'object' && 'logs' in error) {
            console.log("Transaction logs:", error.logs);
        }
    }
}

async function depositNativeFor(
    program: anchor.Program,
    connection: Connection,
    provider: anchor.AnchorProvider,
    statePda: PublicKey,
    programSolAccount: PublicKey,
    depositAmount: BN,
    forTrader: PublicKey
) {
    console.log(`Depositing ${depositAmount.toNumber() / LAMPORTS_PER_SOL} SOL on behalf of ${forTrader.toString()}...`);
    console.log("Program SOL account:", programSolAccount.toString());

    // Get initial balances for verification
    const initialUserBalance = await connection.getBalance(provider.wallet.publicKey);
    const initialProgramBalance = await connection.getBalance(programSolAccount);

    console.log(`Initial depositor balance: ${initialUserBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Initial program balance: ${initialProgramBalance / LAMPORTS_PER_SOL} SOL`);

    // Send the deposit_native_for transaction
    console.log("Sending deposit transaction...");
    const tx = await program.methods
        .depositNativeFor(depositAmount, forTrader)
        .accounts({
            state: statePda,
            wrappedSolMint: new PublicKey("So11111111111111111111111111111111111111112"),
            programSolAccount,
            user: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId
        })
        .rpc();

    console.log("✅ Deposit FOR successful!");
    console.log("Transaction signature:", tx);

    // Verify final balances
    const finalUserBalance = await connection.getBalance(provider.wallet.publicKey);
    const finalProgramBalance = await connection.getBalance(programSolAccount);

    console.log(`Final depositor balance: ${finalUserBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`Final program balance: ${finalProgramBalance / LAMPORTS_PER_SOL} SOL`);

    console.log(`Depositor balance change: ${(initialUserBalance - finalUserBalance) / LAMPORTS_PER_SOL} SOL`);
    console.log(`Program balance change: ${(finalProgramBalance - initialProgramBalance) / LAMPORTS_PER_SOL} SOL`);
}

async function depositTokenFor(
    program: anchor.Program,
    connection: Connection,
    provider: anchor.AnchorProvider,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    mint: PublicKey,
    depositAmount: BN,
    forTrader: PublicKey
) {
    console.log(`Depositing ${depositAmount.toNumber() / 1_000_000} tokens of mint ${mint.toString()} on behalf of ${forTrader.toString()}...`);
    console.log("Token authority PDA:", tokenAuthPda.toString());

    // Get the user's token account
    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        provider.wallet.payer,
        mint,
        provider.wallet.publicKey
    );
    console.log("Depositor token account:", userTokenAccount.address.toString());

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

    console.log(`Initial depositor token balance: ${initialUserBalance / 1_000_000}`);
    console.log(`Initial program token balance: ${initialProgramBalance / 1_000_000}`);

    // Send the deposit_token_for transaction
    console.log("Sending token deposit transaction...");
    const tx = await program.methods
        .depositTokenFor(depositAmount, forTrader)
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

    console.log("✅ Token deposit FOR successful!");
    console.log("Transaction signature:", tx);

    // Verify final balances
    const finalUserInfo = await connection.getTokenAccountBalance(userTokenAccount.address);
    const finalUserBalance = parseInt(finalUserInfo.value.amount);

    const finalProgramInfo = await connection.getTokenAccountBalance(programTokenAccount.address);
    const finalProgramBalance = parseInt(finalProgramInfo.value.amount);

    console.log(`Final depositor token balance: ${finalUserBalance / 1_000_000}`);
    console.log(`Final program token balance: ${finalProgramBalance / 1_000_000}`);

    console.log(`Depositor balance change: ${(initialUserBalance - finalUserBalance) / 1_000_000} tokens`);
    console.log(`Program balance change: ${(finalProgramBalance - initialProgramBalance) / 1_000_000} tokens`);
}

main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
});