import { Connection, PublicKey } from "@solana/web3.js";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { BN } from "bn.js";
import * as crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Interface for a simplified State account data structure
 */
interface SimplifiedStateAccount {
  owner: PublicKey | null;
  withdrawalSigner: string;
  nextDepositNum: string;
  nextStakeNum: string;
  tokenAccountBump: number;
  solAccountBump: number;
}

/**
 * Checks if the account data begins with the expected discriminator
 */
function computeDiscriminator(name: string): Buffer {
  // Compute the discriminator by hashing "account:State"
  const preimage = `account:${name}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.subarray(0, 8);
}

function checkStateDiscriminator(data: Buffer): boolean {
  // Compute the expected discriminator for the State account
  const expectedDiscriminator = computeDiscriminator('State');
  
  // Get the discriminator from the data
  const actualDiscriminator = data.subarray(0, 8);

  // Check if they match
  for (let i = 0; i < 8; i++) {
    if (expectedDiscriminator[i] !== actualDiscriminator[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Extract basic state information
 */
function extractBasicStateInfo(data: Buffer): SimplifiedStateAccount {
  try {
    // Try to extract owner (first 32 bytes after discriminator)
    let owner: PublicKey | null = null;
    try {
      owner = new PublicKey(data.subarray(8, 40));
    } catch (e) {
      console.warn("Could not parse owner pubkey");
    }

    // Try to find the withdrawal signer data (next 20 bytes after owner)
    const withdrawalSigner = data.subarray(40, 60).toString("hex");

    // Try to extract next_deposit_num (next 8 bytes)
    const nextDepositNum = new BN(data.subarray(60, 68), 'le').toString();

    // Try to extract next_stake_num (next 8 bytes)
    const nextStakeNum = new BN(data.subarray(68, 76), 'le').toString();

    // Try to extract bump values
    const tokenAccountBump = data[69];
    const solAccountBump = data[70];

    return {
      owner,
      withdrawalSigner: "0x" + withdrawalSigner,
      nextDepositNum,
      nextStakeNum,
      tokenAccountBump,
      solAccountBump
    };
  } catch (e) {
    console.warn("Error extracting basic state info");
    return {
      owner: null,
      withdrawalSigner: "unknown",
      nextDepositNum: "unknown",
      nextStakeNum: "unknown",
      tokenAccountBump: 0,
      solAccountBump: 0
    };
  }
}

/**
 * Main function to check the state of the RBX contract on devnet
 */
async function main() {
  // Load environment variables
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });

  // Set required environment variables if not already set
  if (!process.env.ANCHOR_PROVIDER_URL) {
    process.env.ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com";
  }

  console.log("=== RBX Solana Contract State Check ===");

  // Create a connection to the Solana network
  const connection = new Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const clusterName = process.env.ANCHOR_PROVIDER_URL?.includes("devnet") ? "Devnet" :
    process.env.ANCHOR_PROVIDER_URL?.includes("mainnet") ? "Mainnet" :
      "Custom RPC";

  // Program ID 
  const programId = new PublicKey("CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W");

  // Derive the state PDA address
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state")],
    programId
  );

  console.log(`Checking ${clusterName} program state for:`);
  console.log(`Program: ${programId.toString()}`);
  console.log(`State PDA: ${statePda.toString()}`);

  try {
    // Fetch the account data directly from the Solana network
    console.log("\nFetching account data...");
    const accountInfo = await connection.getAccountInfo(statePda);

    if (!accountInfo) {
      console.log("❌ State account not found. It may not have been initialized yet.");
      return;
    }

    console.log("✅ State account found!");

    // Check if this is actually a State account
    const expectedDiscriminator = computeDiscriminator('State');
    const actualDiscriminator = accountInfo.data.subarray(0, 8);

    const isStateAccount = checkStateDiscriminator(accountInfo.data);
    if (!isStateAccount) {
      console.log("⚠️  Note: Account discriminator doesn't match expected pattern.");
      console.log("   This might be due to a program upgrade or a different account structure.");
      console.log(`   Expected: [${Array.from(expectedDiscriminator)}] (${expectedDiscriminator.toString('hex')})`);
      console.log(`   Actual: [${Array.from(actualDiscriminator)}] (${actualDiscriminator.toString('hex')})`);
    }

    // Even if discriminator doesn't match, try to extract basic info
    const basicInfo = extractBasicStateInfo(accountInfo.data);

    // Display the extracted information in a user-friendly format
    console.log("\n=== State Account Information ===");
    console.log(`Owner: ${basicInfo.owner?.toString() || "Could not parse"}`);
    console.log(`Withdrawal signer (ETH address): ${basicInfo.withdrawalSigner}`);
    console.log(`Next deposit number: ${basicInfo.nextDepositNum}`);
    console.log(`Next stake number: ${basicInfo.nextStakeNum}`);
    console.log(`Token account bump: ${basicInfo.tokenAccountBump}`);
    console.log(`SOL account bump: ${basicInfo.solAccountBump}`);

    // Print account metadata
    console.log("\n=== Account Metadata ===");
    console.log(`Account size: ${accountInfo.data.length} bytes`);
    console.log(`Rent exempt balance: ${accountInfo.lamports / 10 ** 9} SOL`);
    console.log(`Is executable: ${accountInfo.executable ? "Yes" : "No"}`);

  } catch (error) {
    console.error("❌ Error processing state account:", error);
  }
}

// Execute the main function
main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});