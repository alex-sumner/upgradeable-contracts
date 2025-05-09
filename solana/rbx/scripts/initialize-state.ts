import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

// Initialize a new state account for the RBX program

async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Load the deployed program ID from the workspace
  const programId = new PublicKey(process.env.PROGRAM_ID || anchor.workspace.Rbx._programId);
  console.log("Using Program ID:", programId.toString());

  // Program from workspace or from a specified ID
  const program = new anchor.Program(
    anchor.workspace.Rbx.idl, 
    programId,
    provider
  );

  // PDA for state account
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    programId
  );
  console.log("State PDA:", statePda.toString());

  // PDA for token authority
  const [tokenAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_authority")],
    programId
  );
  console.log("Token Authority PDA:", tokenAuthority.toString());

  // PDA for SOL account
  const [solAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_account")],
    programId
  );
  console.log("SOL Account PDA:", solAccount.toString());

  // Use environment variables or default values
  const defaultTokenMint = new PublicKey(process.env.DEFAULT_TOKEN || "So11111111111111111111111111111111111111112"); // Default to wrapped SOL
  const minDeposit = new anchor.BN(process.env.MIN_DEPOSIT || 1000000); // 0.001 SOL in lamports
  const timelockDelay = new anchor.BN(process.env.TIMELOCK_DELAY || 86400); // 24 hours in seconds
  
  // Convert string to byte array
  const withdrawalSignerHex = process.env.WITHDRAWAL_SIGNER || "0000000000000000000000000000000000000001";
  const withdrawalSigner = Buffer.from(withdrawalSignerHex.replace(/^0x/, ''), 'hex');
  
  // Pad or truncate to exactly 20 bytes
  const withdrawalSignerBytes = Buffer.alloc(20);
  withdrawalSigner.copy(withdrawalSignerBytes, 0, 0, Math.min(withdrawalSigner.length, 20));

  // Initial authorities - use the current wallet by default
  const initialAuthorities = [provider.wallet.publicKey];
  if (process.env.ADDITIONAL_AUTHORITY) {
    initialAuthorities.push(new PublicKey(process.env.ADDITIONAL_AUTHORITY));
  }

  console.log("Initializing with parameters:");
  console.log("- Default Token:", defaultTokenMint.toString());
  console.log("- Min Deposit:", minDeposit.toString());
  console.log("- Timelock Delay:", timelockDelay.toString());
  console.log("- Withdrawal Signer:", withdrawalSignerHex);
  console.log("- Initial Authorities:", initialAuthorities.map(a => a.toString()));

  try {
    // Call the initialize function
    const tx = await program.methods
      .initialize(
        defaultTokenMint,
        minDeposit,
        timelockDelay,
        Array.from(withdrawalSignerBytes),
        initialAuthorities
      )
      .accounts({
        state: statePda,
        owner: provider.wallet.publicKey,
        authority: provider.wallet.publicKey,
        defaultTokenMint: defaultTokenMint,
        programTokenAuthority: tokenAuthority,
        programSolAccount: solAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("State initialized successfully!");
    console.log("Transaction signature:", tx);
  } catch (error) {
    console.error("Error initializing state:", error);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);