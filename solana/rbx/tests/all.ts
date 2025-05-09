import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  Transaction
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { BN } from "bn.js";
import * as crypto from "crypto";

import * as ethers from 'ethers';

// Import the test functions from the separate files
import { runBasicSetupTests } from "./basic-setup.ts";
import { runDepositTests } from "./deposit-operations.ts";
import { runDepositForTests } from "./deposit-for-operations.ts";
import { runStakeTests } from "./stake-operations.ts";
import { runWithdrawalTests } from "./withdraw-operations.ts";
import { runTimelockTests } from "./timelock-operations.ts";

/**
 * Interface for a TimelockOperation
 */
interface TimelockOperation {
  operationType: number;
  data: Buffer;
  queuedAt: number;
  canExecuteAt: number;
}

/**
 * Interface for State account data structure
 */
interface StateAccount {
  owner: PublicKey;
  withdrawalSigner: Buffer;
  nextDepositNum: any; // BN instance
  nextStakeNum: any; // BN instance
  reentryLockStatus: number;
  tokenAccountBump: number;
  solAccountBump: number;
  supportedTokens: PublicKey[];
  minDeposits: Array<{ token: PublicKey, amount: any }>; // BN instance
  timelockAuthorities: PublicKey[];
  timelockDelay: any; // BN instance
  pendingOperations: TimelockOperation[];
  domainSeparator: Buffer | null;
}

// The program ID comes from the IDL
const programId = new PublicKey("CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W");

// Configure the client to use the local cluster.
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the program
const program = anchor.workspace.Rbx;

// Test accounts
const admin = Keypair.generate();
const timelockAuthority = Keypair.generate();
const user = Keypair.generate();

// Use a fixed private key for the signer in tests
// We'll use account #0 from Hardhat's default accounts
const signerWallet = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
console.log("Signer wallet address (Ethereum):", signerWallet.address);

// PDAs
const statePda = PublicKey.findProgramAddressSync(
  [Buffer.from("state")],
  program.programId
)[0];

const tokenAuthPda = PublicKey.findProgramAddressSync(
  [Buffer.from("token_authority")],
  program.programId
)[0];

const solAccountPda = PublicKey.findProgramAddressSync(
  [Buffer.from("sol_account")],
  program.programId
)[0];

// Before all tests, fund accounts
before(async () => {
  // Fund admin
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(
      admin.publicKey,
      10 * LAMPORTS_PER_SOL
    )
  );

  // Fund user
  await provider.connection.confirmTransaction(
    await provider.connection.requestAirdrop(
      user.publicKey,
      10 * LAMPORTS_PER_SOL
    )
  );

  console.log("Admin public key:", admin.publicKey.toString());
  console.log("User public key:", user.publicKey.toString());
  console.log("Timelock authority:", timelockAuthority.publicKey.toString());
  console.log("State PDA:", statePda.toString());
});

describe("RBX Protocol Tests", () => {
  let mint: PublicKey;
  let userTokenAccount: PublicKey;

  it("Run basic setup tests", async () => {
    const result = await runBasicSetupTests(
      program,
      admin,
      user,
      timelockAuthority,
      signerWallet,
      statePda,
      tokenAuthPda,
      solAccountPda
    );

    // Store the returned values and verify they exist
    mint = result.mint;
    userTokenAccount = result.userTokenAccount;

    // Check that values were properly returned before using toString()
    if (!mint || !userTokenAccount) {
      throw new Error("Basic setup failed to return mint or userTokenAccount");
    }

    console.log("Basic setup completed. Mint:", mint.toString());
    console.log("User token account:", userTokenAccount.toString());
  });

  it("Run deposit tests", async () => {
    await runDepositTests(
      program,
      admin,
      user,
      statePda,
      tokenAuthPda,
      solAccountPda,
      mint,
      userTokenAccount
    );
  });

  it("Run deposit-for tests", async () => {
    await runDepositForTests(
      program,
      admin,
      user,
      statePda,
      tokenAuthPda,
      solAccountPda,
      mint,
      userTokenAccount
    );
  });

  it("Run stake tests", async () => {
    await runStakeTests(
      program,
      admin,
      user,
      statePda,
      tokenAuthPda,
      solAccountPda,
      mint,
      userTokenAccount
    );
  });

  it("Run withdrawal tests", async () => {
    await runWithdrawalTests(
      program,
      admin,
      user,
      signerWallet,
      statePda,
      tokenAuthPda,
      solAccountPda,
      mint,
      userTokenAccount
    );
  });

  it("Run timelock operation tests", async () => {
    await runTimelockTests(
      program,
      admin,
      user,
      timelockAuthority,
      statePda,
      tokenAuthPda,
      mint,
      userTokenAccount
    );
  });
});
