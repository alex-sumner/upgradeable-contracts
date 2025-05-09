import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";

async function main() {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Program ID - This is the ID in your Anchor.toml file
  const programId = new PublicKey("CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W");
  
  // Get anchor workspace to access the program
  const workspace = anchor.workspace;
  
  // Create the program interface directly from the workspace
  // This accesses programs defined in the Anchor.toml file
  const program = workspace.Rbx;

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

  // Parameters
  const wrappedSol = new PublicKey("So11111111111111111111111111111111111111112");
  const minDeposit = new BN(1000000); // 0.001 SOL in lamports
  const timelockDelay = new BN(60); // 60 seconds
  
  // Withdrawal signer from previous deployment
  const withdrawalSigner = [
    189, 225, 62, 225, 194, 251, 44, 87, 
    48, 175, 83, 20, 97, 203, 2, 195, 
    79, 217, 145, 240
  ];
  
  // Initial authorities - use the current wallet
  const initialAuthorities = [provider.wallet.publicKey];

  console.log("Initializing with parameters:");
  console.log("- Default Token:", wrappedSol.toString());
  console.log("- Min Deposit:", minDeposit.toString());
  console.log("- Timelock Delay:", timelockDelay.toString());
  console.log("- Withdrawal Signer:", `0x${Buffer.from(withdrawalSigner).toString('hex')}`);
  console.log("- Initial Authorities:", initialAuthorities.map(a => a.toString()));

  try {
    // Call the initialize function
    const tx = await program.methods
      .initialize(
        wrappedSol,
        minDeposit,
        timelockDelay,
        withdrawalSigner,
        initialAuthorities
      )
      .accounts({
        state: statePda,
        owner: provider.wallet.publicKey,
        authority: provider.wallet.publicKey,
        defaultTokenMint: wrappedSol,
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