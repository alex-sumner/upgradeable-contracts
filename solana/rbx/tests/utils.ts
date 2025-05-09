import { PublicKey } from '@solana/web3.js';
import { ethers } from 'ethers';
import * as crypto from 'crypto';
import { BN } from 'bn.js';
import * as anchor from "@coral-xyz/anchor";

/**
 * Interface for a TimelockOperation
 */
export interface TimelockOperation {
    operationType: number;
    data: Buffer;
    queuedAt: number;
    canExecuteAt: number;
}

/**
 * Interface for State account data structure
 */
export interface StateAccount {
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

/**
 * Helper to fetch and parse the State account directly
 */
export async function fetchStateAccount(
    program: anchor.Program,
    statePda: PublicKey
): Promise<StateAccount> {
    const accountInfo = await program.provider.connection.getAccountInfo(statePda);
    if (!accountInfo) {
        throw new Error("State account not found");
    }

    return deserializeStateAccount(accountInfo.data);
}

/**
 * Deserialize the State account from its raw data
 */
export function deserializeStateAccount(data: Buffer): StateAccount {
    // Skip the 8 byte discriminator
    const buffer = data.subarray(8);

    // Deserialize fields manually following the Rust struct definition
    let offset = 0;

    // owner: Pubkey (32 bytes)
    const owner = new PublicKey(buffer.subarray(offset, offset + 32));
    offset += 32;

    // withdrawal_signer: [u8; 20] (20 bytes)
    const withdrawalSigner = buffer.subarray(offset, offset + 20);
    offset += 20;

    // next_deposit_num: u64 (8 bytes)
    const nextDepositNum = new BN(buffer.subarray(offset, offset + 8), 'le');
    offset += 8;

    // next_stake_num: u64 (8 bytes)
    const nextStakeNum = new BN(buffer.subarray(offset, offset + 8), 'le');
    offset += 8;

    // reentry_lock_status: u8 (1 byte)
    const reentryLockStatus = buffer[offset];
    offset += 1;

    // token_account_bump: u8 (1 byte)
    const tokenAccountBump = buffer[offset];
    offset += 1;

    // sol_account_bump: u8 (1 byte)
    const solAccountBump = buffer[offset];
    offset += 1;

    // supportedTokens: Vec<Pubkey>
    const supportedTokensCount = buffer.readUInt32LE(offset);
    offset += 4;

    const supportedTokens: PublicKey[] = [];
    for (let i = 0; i < supportedTokensCount; i++) {
        supportedTokens.push(new PublicKey(buffer.subarray(offset, offset + 32)));
        offset += 32;
    }

    // min_deposits: Vec<(Pubkey, u64)>
    const minDepositsCount = buffer.readUInt32LE(offset);
    offset += 4;

    const minDeposits: Array<{ token: PublicKey, amount: any }> = [];
    for (let i = 0; i < minDepositsCount; i++) {
        const token = new PublicKey(buffer.subarray(offset, offset + 32));
        offset += 32;

        const amount = new BN(buffer.subarray(offset, offset + 8), 'le');
        offset += 8;

        minDeposits.push({ token, amount });
    }

    // timelock_authorities: Vec<Pubkey>
    const timelockAuthoritiesCount = buffer.readUInt32LE(offset);
    offset += 4;

    const timelockAuthorities: PublicKey[] = [];
    for (let i = 0; i < timelockAuthoritiesCount; i++) {
        timelockAuthorities.push(new PublicKey(buffer.subarray(offset, offset + 32)));
        offset += 32;
    }

    // timelock_delay: i64 (8 bytes)
    const timelockDelay = new BN(buffer.subarray(offset, offset + 8), 'le');
    offset += 8;

    // pending_operations: Vec<TimelockOperation>
    const pendingOperationsCount = buffer.readUInt32LE(offset);
    offset += 4;

    const pendingOperations: TimelockOperation[] = [];
    for (let i = 0; i < pendingOperationsCount; i++) {
        // operation_type: u8 (1 byte)
        const operationType = buffer[offset];
        offset += 1;

        // data: Vec<u8>
        const dataLength = buffer.readUInt32LE(offset);
        offset += 4;

        const data = buffer.subarray(offset, offset + dataLength);
        offset += dataLength;

        // queued_at: i64 (8 bytes)
        const queuedAt = new BN(buffer.subarray(offset, offset + 8), 'le').toNumber();
        offset += 8;

        // can_execute_at: i64 (8 bytes)
        const canExecuteAt = new BN(buffer.subarray(offset, offset + 8), 'le').toNumber();
        offset += 8;

        pendingOperations.push({
            operationType,
            data: Buffer.from(data),
            queuedAt,
            canExecuteAt
        });
    }

    // domain_separator: Option<[u8; 32]> (1 byte tag + 32 bytes if Some)
    const hasDomainSeparator = buffer[offset] === 1;
    offset += 1;

    let domainSeparator = null;
    if (hasDomainSeparator) {
        domainSeparator = buffer.subarray(offset, offset + 32);
        offset += 32;
    }

    return {
        owner,
        withdrawalSigner,
        nextDepositNum,
        nextStakeNum,
        reentryLockStatus,
        tokenAccountBump,
        solAccountBump,
        supportedTokens,
        minDeposits,
        timelockAuthorities,
        timelockDelay,
        pendingOperations,
        domainSeparator
    };
}

/**
 * Get the verifying contract address in hex format
 */
export async function getVerifyingContractFromProgram(program: anchor.Program, statePda: PublicKey) {
    try {
        const hexString = await program.methods
            .getEip712VerifyingContract()
            .accounts({
                state: statePda,
            })
            .view();
        return hexString;
    } catch (e) {
        console.error("Error getting verifying contract:", e);
        return null;
    }
}

/**
 * Sign a withdrawal using EIP-712 format
 * @param wallet Ethereum wallet to sign with
 * @param verifyingContractPubkey Solana program address
 * @param withdrawal The withdrawal data
 * @returns Object containing signature components
 */
export async function signWithdrawal(
    wallet: ethers.Wallet,
    verifyingContractPubkey: PublicKey,
    withdrawal: {
        id: number,
        token: PublicKey,
        trader: PublicKey,
        amount: string,
    }
) {
    console.log("Signing withdrawal with following parameters:");
    console.log("Signing Wallet:", wallet.address);
    console.log("Contract (Solana):", verifyingContractPubkey.toString());
    console.log("Withdrawal ID:", withdrawal.id);
    console.log("Token:", withdrawal.token.toString());
    console.log("Trader:", withdrawal.trader.toString());
    console.log("Amount:", withdrawal.amount);

    // Use the full 32-byte contract address
    const contractBytes = verifyingContractPubkey.toBytes();
    console.log("Contract bytes:", Buffer.from(contractBytes).toString('hex'));

    // Calculate the domain separator
    const domainTypeHash = ethers.keccak256(ethers.toUtf8Bytes(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    ));

    // Get the hashed domain name and version
    const domainName = ethers.keccak256(ethers.toUtf8Bytes("RabbitXWithdrawal"));
    const domainVersion = ethers.keccak256(ethers.toUtf8Bytes("1"));

    // Create chain ID bytes (padded to 32 bytes)
    const chainId = 0x534f4c414e41n; // "SOLANA" in ASCII
    const chainIdBytes = ethers.zeroPadValue("0x" + chainId.toString(16), 32);

    const domainData = ethers.concat([
        ethers.getBytes(domainTypeHash),
        ethers.getBytes(domainName),
        ethers.getBytes(domainVersion),
        ethers.getBytes(chainIdBytes),
        contractBytes // Use the full 32-byte Solana address
    ]);

    const domainSeparator = ethers.keccak256(domainData);

    // Now create the withdrawal hash that matches the Rust implementation
    const withdrawalTypeHash = ethers.keccak256(ethers.toUtf8Bytes(
        "Withdrawal(uint256 id,address token,address trader,uint256 amount)"
    ));
    console.log("Withdrawal type hash:", withdrawalTypeHash);

    // Use the native Solana pubkeys for token and trader
    console.log("Token bytes:", Buffer.from(withdrawal.token.toBytes()).toString('hex'));
    console.log("Trader bytes:", Buffer.from(withdrawal.trader.toBytes()).toString('hex'));

    // Create the withdrawal hash - matching exactly what the Rust code does
    const withdrawalData = ethers.concat([
        ethers.getBytes(withdrawalTypeHash),
        // id as big-endian 8 bytes (u64), matching Rust's to_be_bytes()
        Buffer.from([
            0, 0, 0, 0,  // Upper 32 bits are zeros for normal IDs
            (withdrawal.id >> 24) & 0xFF,
            (withdrawal.id >> 16) & 0xFF,
            (withdrawal.id >> 8) & 0xFF,
            withdrawal.id & 0xFF
        ]),
        // Use the full 32-byte Solana pubkeys
        withdrawal.token.toBytes(),
        withdrawal.trader.toBytes(),
        // amount as big-endian 8 bytes (u64), matching Rust's to_be_bytes()
        Buffer.from([
            0, 0, 0, 0,  // Upper 32 bits are zeros for normal amounts
            (parseInt(withdrawal.amount) >> 24) & 0xFF,
            (parseInt(withdrawal.amount) >> 16) & 0xFF,
            (parseInt(withdrawal.amount) >> 8) & 0xFF,
            parseInt(withdrawal.amount) & 0xFF,
        ])
    ]);

    // Hash the data to get the withdrawal hash
    const withdrawalHash = ethers.keccak256(withdrawalData);
    console.log("Withdrawal hash:", withdrawalHash);

    // Create the final message
    const message = ethers.concat([
        ethers.toUtf8Bytes('\x19\x01'),
        ethers.getBytes(domainSeparator),
        ethers.getBytes(withdrawalHash)
    ]);

    // Hash the message to get the digest (matching Rust's logic)
    const digest = ethers.keccak256(message);
    console.log("Final digest to sign:", digest);
    console.log("Full message bytes:", ethers.hexlify(message));

    // Use the wallet's private key to sign the digest directly without Ethereum's message prefix
    // Convert the private key to a SigningKey instance
    const privateKey = wallet.privateKey;
    const signingKey = new ethers.SigningKey(privateKey);

    // Sign the digest directly
    const signature = signingKey.sign(ethers.getBytes(digest));
    const sig = signature;

    console.log("Signature v:", sig.v);
    console.log("Signature r:", ethers.hexlify(sig.r));
    console.log("Signature s:", ethers.hexlify(sig.s));

    return {
        v: sig.v,
        r: ethers.getBytes(sig.r),
        s: ethers.getBytes(sig.s),
    };
}

/**
 * Helper function to get Ethereum address bytes from an Ethereum address string
 */
export function getEthereumAddressBytes(ethAddress: string): Uint8Array {
    // Get the Ethereum address bytes (without 0x prefix)
    const addressHex = ethAddress.slice(2).toLowerCase();

    // Convert to Uint8Array - this will be the 20-byte Ethereum address
    return Buffer.from(addressHex, 'hex');
}

/**
 * Generate a random Ethereum address for testing
 */
export function generateEthereumAddress(): Buffer {
    // Generate a random 20-byte Ethereum address
    const bytes = crypto.randomBytes(20);
    return Buffer.from(bytes);
}

/**
 * Wait for the timelock delay to pass
 * @param state The state account containing timelock information
 */
export async function waitForTimelock(state: StateAccount) {
    const waitTime = 1000 + state.timelockDelay.toNumber() * 1000;
    console.log(`Waiting for ${waitTime / 1000} seconds`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
} 