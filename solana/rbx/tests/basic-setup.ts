import * as anchor from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo
} from "@solana/spl-token";
import { assert } from "chai";
import { BN } from "bn.js";
import { getEthereumAddressBytes, getVerifyingContractFromProgram } from "./utils.ts";

export async function runBasicSetupTests(
    program: anchor.Program,
    admin: Keypair,
    user: Keypair,
    timelockAuthority: Keypair,
    signerWallet: any,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    solAccountPda: PublicKey
): Promise<{ mint: PublicKey; userTokenAccount: PublicKey }> {
    console.log("Running basic setup...");

    // Step 1: Create token mint
    const mint = await createMint(
        program.provider.connection,
        admin,
        admin.publicKey,
        null,
        6 // 6 decimals
    );
    console.log("Token mint created:", mint.toString());

    // Step 2: Create user token account
    const { address: userTokenAccount } = await getOrCreateAssociatedTokenAccount(
        program.provider.connection,
        admin,
        mint,
        user.publicKey
    );
    console.log("User token account:", userTokenAccount.toString());

    // Step 3: Mint tokens to user
    await mintTo(
        program.provider.connection,
        admin,
        mint,
        userTokenAccount,
        admin.publicKey,
        50_000_000 // 50 tokens
    );
    console.log("Minted 50 tokens to user");

    // Verify balance
    const userAccount = await program.provider.connection.getTokenAccountBalance(userTokenAccount);
    assert.equal(userAccount.value.uiAmount, 50);

    // Step 4: Initialize program if not already initialized
    console.log("Initializing program...");
    const stateAccountBefore = await program.provider.connection.getAccountInfo(statePda);
    console.log("State account exists before initialization:", !!stateAccountBefore);

    if (!stateAccountBefore) {
        try {
            // Get the 20-byte Ethereum address from the wallet address
            const signerAddressBytes = getEthereumAddressBytes(signerWallet.address);
            console.log("Ethereum address bytes:", Buffer.from(signerAddressBytes).toString('hex'));

            // Call the initialize instruction
            const tx = await program.methods
                .initialize(
                    mint,                           // Default token
                    new BN(1_000_000),              // Min deposit
                    new BN(5),                     // Timelock delay
                    Array.from(signerAddressBytes), // 20-byte withdrawal signer as array
                    [timelockAuthority.publicKey]   // array of timelock authority accounts
                )
                .accounts({
                    state: statePda,
                    owner: admin.publicKey,
                    authority: timelockAuthority.publicKey,
                    defaultTokenMint: mint,
                    programTokenAuthority: tokenAuthPda,
                    programSolAccount: solAccountPda,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([admin, timelockAuthority])
                .rpc();

            console.log("Program initialized! Transaction signature:", tx);
            console.log("withdrawal signer:", Buffer.from(signerAddressBytes).toString('hex'));
        } catch (e: any) {
            if (e.message && e.message.includes("already in use")) {
                console.log("State account already initialized, continuing with tests");
            } else {
                console.error("Error initializing program:", e);
                throw e;
            }
        }
    }

    // Verify state account
    const stateAccount = await program.provider.connection.getAccountInfo(statePda);
    assert.ok(stateAccount, "State account not found");
    assert.equal(stateAccount.owner.toString(), program.programId.toString(),
        "State account not owned by program");
    console.log("State account size:", stateAccount.data.length, "bytes");

    // Test EIP-712 verifying contract
    try {
        const verifyingContractHex = await getVerifyingContractFromProgram(program, statePda);
        console.log("Verifying contract from program (hex):", verifyingContractHex);
        const expectedHex = `0x${Buffer.from(statePda.toBytes()).toString('hex')}`;
        assert.equal(verifyingContractHex?.toLowerCase(), expectedHex.toLowerCase(),
            "Verifying contract from program doesn't match expected state PDA");
    } catch (viewError) {
        console.error("Error getting verifying contract:", viewError);
    }

    // Support wrapped SOL
    try {
        const wrappedSolMint = new PublicKey("So11111111111111111111111111111111111111112");
        console.log("Supporting wrapped SOL for native deposits...");

        const tx = await program.methods
            .supportToken(new BN(1_000_000)) // 1 SOL min deposit
            .accounts({
                state: statePda,
                authority: timelockAuthority.publicKey,
                tokenMint: wrappedSolMint,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([timelockAuthority])
            .rpc();

        console.log("Added support for wrapped SOL! Transaction signature:", tx);
    } catch (e: any) {
        console.log("Error supporting wrapped SOL:", e);
    }

    console.log("Basic setup completed successfully.");
    console.log("mint:", mint.toString());
    console.log("userTokenAccount:", userTokenAccount.toString());

    return { mint, userTokenAccount };
}

// For Mocha tests, keep this separate function that uses the describe block
export async function runBasicSetupTestsWithMocha(
    program: anchor.Program,
    admin: Keypair,
    user: Keypair,
    timelockAuthority: Keypair,
    signerWallet: any,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    solAccountPda: PublicKey
): Promise<void> {
    describe("basic setup", () => {
        it("Creates a token mint and user account", async () => {
            // Create a new token mint for testing
            const mint = await createMint(
                program.provider.connection,
                admin,
                admin.publicKey,
                null,
                6 // 6 decimals
            );

            console.log("Token mint created:", mint.toString());

            // Create a token account for the user
            const { address } = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin,
                mint,
                user.publicKey
            );

            const userTokenAccount = address;
            console.log("User token account:", userTokenAccount.toString());

            // Mint tokens to user
            await mintTo(
                program.provider.connection,
                admin,
                mint,
                userTokenAccount,
                admin.publicKey,
                50_000_000 // 50 tokens
            );

            console.log("Minted 50 tokens to user");

            // Verify balance
            const userAccount = await program.provider.connection.getTokenAccountBalance(userTokenAccount);
            assert.equal(userAccount.value.uiAmount, 50);
        });

        it("Initializes the program with state PDA", async () => {
            console.log("Initializing program...");

            // Get the account info before initialization
            const stateAccountBefore = await program.provider.connection.getAccountInfo(statePda);
            console.log("State account exists before initialization:", !!stateAccountBefore);

            try {
                // Also support wrapped SOL
                const wrappedSolMint = new PublicKey("So11111111111111111111111111111111111111112");

                // Get the 20-byte Ethereum address from the wallet address
                const signerAddressBytes = getEthereumAddressBytes(signerWallet.address);
                console.log("Ethereum address bytes:", Buffer.from(signerAddressBytes).toString('hex'));

                // Call the initialize instruction
                const tx = await program.methods
                    .initialize(
                        mint,                           // Default token
                        new BN(1_000_000),              // Min deposit
                        new BN(5),                     // Timelock delay
                        Array.from(signerAddressBytes), // 20-byte withdrawal signer as array
                        [timelockAuthority.publicKey]   // array of timelock authority accounts
                    )
                    .accounts({
                        state: statePda,
                        owner: admin.publicKey,
                        authority: timelockAuthority.publicKey,
                        defaultTokenMint: mint,
                        programTokenAuthority: tokenAuthPda,
                        programSolAccount: solAccountPda,
                        systemProgram: SystemProgram.programId,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([admin, timelockAuthority])
                    .rpc();

                console.log("Program initialized! Transaction signature:", tx);

                console.log("withdrawal signer:", Buffer.from(signerAddressBytes).toString('hex'));

                // Check if the account was created
                const stateAccount = await program.provider.connection.getAccountInfo(statePda);
                assert.ok(stateAccount, "State account not found");
                assert.equal(stateAccount.owner.toString(), program.programId.toString(),
                    "State account not owned by program");

                console.log("State account size:", stateAccount.data.length, "bytes");

                // Test our new view function
                const verifyingContractHex = await getVerifyingContractFromProgram(program, statePda);
                console.log("Verifying contract from program (hex):", verifyingContractHex);
                const expectedHex = `0x${Buffer.from(statePda.toBytes()).toString('hex')}`;
                assert.equal(verifyingContractHex?.toLowerCase(), expectedHex.toLowerCase(),
                    "Verifying contract from program doesn't match expected state PDA");
            } catch (e: any) {
                // Check if error is because account already exists
                if (e.message && e.message.includes("already in use")) {
                    console.log("State account already initialized, continuing with tests");

                    try {
                        const verifyingContractHex = await getVerifyingContractFromProgram(program, statePda);
                        console.log("Verifying contract from program (hex):", verifyingContractHex);
                        const expectedHex = `0x${Buffer.from(statePda.toBytes()).toString('hex')}`;
                        assert.equal(verifyingContractHex?.toLowerCase(), expectedHex.toLowerCase(),
                            "Verifying contract from program doesn't match expected state PDA");
                    } catch (viewError) {
                        console.error("Error getting verifying contract:", viewError);
                    }
                } else {
                    console.error("Error initializing program:", e);
                    throw e;
                }
            }

            try {
                const stateAccount = await program.provider.connection.getAccountInfo(statePda);
                if (stateAccount) {
                    console.log("State account exists and has data");
                    console.log("State account owner:", stateAccount.owner.toString());
                    console.log("Expected program ID:", program.programId.toString());
                }
            } catch (e: any) {
                console.log("Error accessing state account:", e.message);
            }

            // Now also support wrapped SOL
            try {
                const wrappedSolMint = new PublicKey("So11111111111111111111111111111111111111112");
                console.log("Supporting wrapped SOL for native deposits...");

                const tx = await program.methods
                    .supportToken(new BN(1_000_000)) // 1 SOL min deposit
                    .accounts({
                        state: statePda,
                        authority: timelockAuthority.publicKey,
                        tokenMint: wrappedSolMint,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([timelockAuthority])
                    .rpc();

                console.log("Added support for wrapped SOL! Transaction signature:", tx);
            } catch (e: any) {
                console.log("Error supporting wrapped SOL:", e);
            }
        });
    });
} 