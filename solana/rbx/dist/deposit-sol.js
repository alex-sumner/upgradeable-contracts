import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';
import fs from 'fs';
import BN from 'bn.js';
// Program ID on devnet
const PROGRAM_ID = new PublicKey('9yWT9i8kJxY6JFdud9eeWkqtiMTUcDgbSCgF5RD4ihTE');
// Wrapped SOL mint address
const WRAPPED_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
async function main() {
    // Initialize Solana connection to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    // Load wallet from keypair file or generate a new one
    let keypair;
    try {
        // Attempt to load keypair from file
        const secretKeyString = fs.readFileSync('wallet-keypair.json', 'utf-8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
        keypair = Keypair.fromSecretKey(secretKey);
        console.log('Loaded existing keypair from wallet-keypair.json');
    }
    catch (error) {
        // Generate a new keypair if file doesn't exist
        keypair = Keypair.generate();
        fs.writeFileSync('wallet-keypair.json', JSON.stringify(Array.from(keypair.secretKey)));
        console.log('Generated new keypair and saved to wallet-keypair.json');
    }
    console.log('Wallet public key:', keypair.publicKey.toString());
    // Check if the wallet has enough SOL
    const balance = await connection.getBalance(keypair.publicKey);
    console.log('Current wallet balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    if (balance < 0.1 * LAMPORTS_PER_SOL) {
        console.log('Requesting airdrop of 1 SOL...');
        try {
            const signature = await connection.requestAirdrop(keypair.publicKey, 1 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(signature);
            const newBalance = await connection.getBalance(keypair.publicKey);
            console.log('New wallet balance:', newBalance / LAMPORTS_PER_SOL, 'SOL');
        }
        catch (error) {
            console.error('Failed to request airdrop:', error);
            return;
        }
    }
    // Set up Anchor provider and program
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' });
    // Load the IDL (Interface Definition Language) for the program
    const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
    if (!idl) {
        console.error('Failed to fetch program IDL');
        return;
    }
    // Create program interface
    const program = new anchor.Program(idl, PROGRAM_ID, provider);
    // Amount to deposit (0.1 SOL)
    const depositAmount = new BN(0.1 * LAMPORTS_PER_SOL);
    console.log(`Preparing to deposit ${depositAmount.toNumber() / LAMPORTS_PER_SOL} SOL...`);
    // Derive the state PDA
    const [statePda] = PublicKey.findProgramAddressSync([Buffer.from('state')], PROGRAM_ID);
    console.log('State account PDA:', statePda.toString());
    // Derive the program SOL account
    const [programSolAccount] = PublicKey.findProgramAddressSync([Buffer.from('sol_account')], PROGRAM_ID);
    console.log('Program SOL account:', programSolAccount.toString());
    try {
        console.log('Sending deposit transaction...');
        // Create and send the transaction
        const tx = await program.methods
            .depositNative(depositAmount)
            .accounts({
            state: statePda,
            wrappedSolMint: WRAPPED_SOL_MINT,
            programSolAccount: programSolAccount,
            user: keypair.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
            .signers([keypair])
            .rpc();
        console.log('✅ Deposit transaction successful!');
        console.log('Transaction signature:', tx);
        console.log(`Deposited ${depositAmount.toNumber() / LAMPORTS_PER_SOL} SOL`);
        // Check program SOL account balance
        const programBalance = await connection.getBalance(programSolAccount);
        console.log('Program SOL account balance:', programBalance / LAMPORTS_PER_SOL, 'SOL');
    }
    catch (error) {
        console.error('❌ Deposit failed:', error);
        if ('logs' in error) {
            console.log('Error logs:', error.logs);
        }
    }
}
main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
