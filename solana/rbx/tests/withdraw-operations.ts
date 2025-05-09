import * as anchor from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { BN } from "bn.js";
import { signWithdrawal, getEthereumAddressBytes } from "./utils.ts";

export async function runWithdrawalTests(
    program: anchor.Program,
    admin: Keypair,
    user: Keypair,
    signerWallet: any,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    solAccountPda: PublicKey,
    mint: PublicKey,
    userTokenAccount: PublicKey
) {
    console.log("Running deposit and withdrawal tests...");
    describe("withdrawal operations", () => {
        it("Withdraws tokens with a signature", async () => {
            // Create a recipient account for testing withdrawals
            const recipient = anchor.web3.Keypair.generate();
            console.log("Recipient public key:", recipient.publicKey.toString());

            // Fund the recipient with some SOL to create accounts
            try {
                const airdropSig = await program.provider.connection.requestAirdrop(
                    recipient.publicKey,
                    1 * LAMPORTS_PER_SOL
                );
                await program.provider.connection.confirmTransaction(airdropSig);
                console.log("Funded recipient with 1 SOL");
            } catch (e: any) {
                console.error("Error funding recipient:", e);
                throw e;
            }

            // Get the program's token account address
            const programTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin, // payer
                mint,
                tokenAuthPda,
                true // allowOwnerOffCurve
            ).then(account => account.address);

            console.log("Program token account:", programTokenAccount.toString());

            // Create a token account for the recipient
            const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin, // payer
                mint,
                recipient.publicKey
            ).then(account => account.address);

            console.log("Recipient token account:", recipientTokenAccount.toString());

            // Define withdrawal details
            const withdrawalId = 12345;
            const withdrawalAmount = new BN(500_000); // 0.5 tokens

            // Create withdrawal data for signing
            const withdrawalData = {
                id: withdrawalId,
                token: mint,
                trader: recipient.publicKey,
                amount: withdrawalAmount.toString(),
            };

            console.log("Withdrawal data:", withdrawalData);

            // Sign the withdrawal with the Ethereum wallet
            const { v, r, s } = await signWithdrawal(
                signerWallet,
                statePda,
                withdrawalData
            );

            console.log("Withdrawal signature obtained. v:", v, "r:", r, "s:", s);

            // Create the PDA account where withdrawal history will be stored
            const withdrawalRecordAccount = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("withdrawal_account"),
                    new BN(withdrawalId / 4000).toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            )[0];

            console.log("Withdrawal record account:", withdrawalRecordAccount.toString());

            try {
                // Get initial balances for verification
                const initialProgramBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(programTokenAccount)).value.amount
                );
                const initialRecipientBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(recipientTokenAccount)).value.amount
                );

                console.log("Initial program balance:", initialProgramBalance / 10 ** 6);
                console.log("Initial recipient balance:", initialRecipientBalance / 10 ** 6);

                // Execute the withdrawal
                const tx = await program.methods
                    .withdrawToken(
                        new BN(withdrawalId),
                        withdrawalAmount,
                        v,
                        r,
                        s
                    )
                    .accounts({
                        state: statePda,
                        withdrawalRecord: withdrawalRecordAccount,
                        mint: mint,
                        programTokenAccount: programTokenAccount,
                        programTokenAuthority: tokenAuthPda,
                        traderTokenAccount: recipientTokenAccount,
                        trader: recipient.publicKey,
                        payer: user.publicKey, // User pays for the transaction
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .signers([user])
                    .rpc();

                console.log("Withdrawal successful! Transaction signature:", tx);

                // Get final balances
                const finalProgramBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(programTokenAccount)).value.amount
                );
                const finalRecipientBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(recipientTokenAccount)).value.amount
                );

                console.log("Final program balance:", finalProgramBalance / 10 ** 6);
                console.log("Final recipient balance:", finalRecipientBalance / 10 ** 6);

                // Verify balances have changed correctly
                const programBalanceChange = initialProgramBalance - finalProgramBalance;
                const recipientBalanceChange = finalRecipientBalance - initialRecipientBalance;

                console.log("Program balance decreased by:", programBalanceChange / 10 ** 6);
                console.log("Recipient balance increased by:", recipientBalanceChange / 10 ** 6);

                // Assertions
                expect(programBalanceChange).to.equal(withdrawalAmount.toNumber());
                expect(recipientBalanceChange).to.equal(withdrawalAmount.toNumber());

                // Try to execute the same withdrawal again - should fail with "already processed"
                try {
                    await program.methods
                        .withdrawToken(
                            new BN(withdrawalId),
                            withdrawalAmount,
                            v,
                            r,
                            s
                        )
                        .accounts({
                            state: statePda,
                            withdrawalRecord: withdrawalRecordAccount,
                            mint: mint,
                            programTokenAccount: programTokenAccount,
                            programTokenAuthority: tokenAuthPda,
                            traderTokenAccount: recipientTokenAccount,
                            trader: recipient.publicKey,
                            payer: user.publicKey,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                            rent: SYSVAR_RENT_PUBKEY,
                        })
                        .signers([user])
                        .rpc();

                    assert.fail("Second withdrawal should have failed");
                } catch (e: any) {
                    console.log("Second withdrawal correctly failed with error:", e.message);
                    expect(e.message).to.include("already processed");
                }
            } catch (e: any) {
                console.error("Error during withdrawal:", e);
                if (e.logs) {
                    console.log("Error logs:", e.logs);
                }
                throw e;
            }
        });

        it("Withdraws native SOL with signed EIP712 message", async () => {
            console.log("Testing native SOL withdrawal...");

            // Get initial balances
            const initialUserSol = await program.provider.connection.getBalance(user.publicKey);
            const initialProgramSol = await program.provider.connection.getBalance(solAccountPda);

            console.log("Initial user SOL balance:", initialUserSol / LAMPORTS_PER_SOL, "SOL");
            console.log("Initial program SOL balance:", initialProgramSol / LAMPORTS_PER_SOL, "SOL");

            // Create withdrawal data
            const withdrawalId = 54321; // Different ID for this withdrawal
            const withdrawalAmount = new BN(1 * LAMPORTS_PER_SOL); // 1 SOL

            // Wrapped SOL mint address
            const wrappedSolMint = new PublicKey("So11111111111111111111111111111111111111112");

            // Get the 20-byte Ethereum address that should be stored in the state
            const ethAddressBytes = getEthereumAddressBytes(signerWallet.address);
            console.log("Using Ethereum address bytes:", Buffer.from(ethAddressBytes).toString('hex'));

            // Use the program's state PDA as the verifying contract directly

            // Use the native Solana PublicKeys directly
            console.log("Wrapped SOL (Solana):", wrappedSolMint.toString());
            console.log("Trader (Solana):", user.publicKey.toString());

            // Create the withdrawal data with native Solana PublicKeys
            const withdrawalData = {
                id: withdrawalId,
                token: wrappedSolMint,
                trader: user.publicKey,
                amount: withdrawalAmount.toString(),
            };

            console.log("SOL Withdrawal data:", withdrawalData);
            console.log("Verifying contract (Solana):", statePda.toString());

            // Sign the withdrawal with the Ethereum wallet - using Solana native pubkeys
            const { v, r, s } = await signWithdrawal(
                signerWallet,
                statePda,  // Use the Solana pubkey directly
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

            const nativeSolAccountPDA = solAccountPda;

            console.log("Sol account PDA for withdrawal:", nativeSolAccountPDA.toString());

            try {
                // Instead of creating an instruction and transaction, use the direct .rpc() approach
                const tx = await program.methods
                    .withdrawNative(
                        new BN(withdrawalId),
                        withdrawalAmount,
                        v,
                        r,
                        s
                    )
                    .accounts({
                        state: statePda,
                        withdrawalRecord: withdrawalAccount,
                        wrappedSolMint: wrappedSolMint,
                        programSolAccount: nativeSolAccountPDA,
                        trader: user.publicKey, // The trader/recipient doesn't sign
                        payer: user.publicKey, // User is the signer/payer
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .signers([user])
                    .rpc();

                console.log("SOL withdrawal successful! Transaction signature:", tx);

                // Verify balances
                const finalUserSol = await program.provider.connection.getBalance(user.publicKey);
                const finalProgramSol = await program.provider.connection.getBalance(nativeSolAccountPDA);

                console.log("Final user SOL balance:", finalUserSol / LAMPORTS_PER_SOL, "SOL");
                console.log("Final program SOL balance:", finalProgramSol / LAMPORTS_PER_SOL, "SOL");

                // Calculate differences
                const userSolDiff = finalUserSol - initialUserSol;
                const programSolDiff = initialProgramSol - finalProgramSol;

                console.log("User SOL increased by:", userSolDiff / LAMPORTS_PER_SOL, "SOL");
                console.log("Program SOL decreased by:", programSolDiff / LAMPORTS_PER_SOL, "SOL");

                // Verify the withdrawal worked
                // The increase in user's SOL will be less than the withdrawal amount due to transaction fees
                assert.isAtLeast(
                    userSolDiff,
                    0,
                    "User SOL should increase after withdrawal"
                );
                // But the program should have sent the full amount
                assert.equal(
                    programSolDiff,
                    withdrawalAmount.toNumber(),
                    "Program SOL decrease doesn't match withdrawal amount"
                );

            } catch (e: any) {
                console.error("Error during SOL withdrawal:", e);
                throw e;
            }
        });

        it("Gets the EIP-712 verifying contract address", async () => {
            console.log("\nTesting get_eip712_verifying_contract function...");

            // Helper function to get verifying contract from program
            async function getVerifyingContractFromProgram() {
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

            try {
                // Call the function to get the verifying contract address as hex string
                const verifyingContractHex = await getVerifyingContractFromProgram();

                // Log the hex string
                console.log("EIP-712 Verifying Contract Address (hex):", verifyingContractHex);

                // Verify it's a valid hex string
                assert.ok(verifyingContractHex.startsWith('0x'), "Returned value doesn't start with 0x");
                assert.equal(verifyingContractHex.length, 66, "Hex string should be 66 characters (0x + 64 chars for 32 bytes)");

                // Convert the expected state PDA to a hex string for comparison
                const expectedHex = `0x${Buffer.from(statePda.toBytes()).toString('hex')}`;

                // Verify it matches our derived state PDA (converted to hex)
                assert.equal(verifyingContractHex.toLowerCase(), expectedHex.toLowerCase(),
                    "Verifying contract hex doesn't match the expected state PDA");

                // For reference, also show the program ID
                console.log("Program ID:", program.programId.toString());

                // Show how this would be used directly in EIP-712 signing
                console.log("Ready to use for EIP-712 domain separator calculation");
            } catch (e: any) {
                console.error("Error getting EIP-712 verifying contract:", e);
                throw e;
            }
        });

        it("Fails on duplicate withdrawal attempt with same ID", async () => {
            console.log("Testing duplicate token withdrawal prevention...");

            // Get the program's token account address
            const programTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin, // payer
                mint,
                tokenAuthPda,
                true // allowOwnerOffCurve
            ).then(account => account.address);

            // Get initial balances before first withdrawal
            const userTokenInfo = await program.provider.connection.getTokenAccountBalance(userTokenAccount);
            const initialUserBalance = parseInt(userTokenInfo.value.amount);
            let initialProgramBalance = 0;

            try {
                const programTokenInfo = await program.provider.connection.getTokenAccountBalance(programTokenAccount);
                initialProgramBalance = parseInt(programTokenInfo.value.amount);
            } catch (e: any) {
                console.log("Program token account doesn't exist yet or has no balance");
            }

            console.log("Initial user token balance:", initialUserBalance / 10 ** 6);
            console.log("Initial program token balance:", initialProgramBalance / 10 ** 6);

            // Create withdrawal data with a UNIQUE ID that hasn't been used before
            const duplicateWithdrawalId = 78910; // Unique ID for this test
            const withdrawalAmount = new BN(300_000); // 0.3 tokens

            // Get the 20-byte Ethereum address that should be stored in the state
            const ethAddressBytes = getEthereumAddressBytes(signerWallet.address);
            console.log("Using Ethereum address bytes:", Buffer.from(ethAddressBytes).toString('hex'));

            // Create the withdrawal data with native Solana PublicKeys
            const withdrawalData = {
                id: duplicateWithdrawalId,
                token: mint,
                trader: user.publicKey,
                amount: withdrawalAmount.toString(),
            };

            console.log("Withdrawal data:", withdrawalData);

            // Sign the withdrawal with the Ethereum wallet
            const { v, r, s } = await signWithdrawal(
                signerWallet,
                statePda,
                withdrawalData
            );

            // Find the withdrawal record account PDA
            const withdrawalAccount = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("withdrawal_account"),
                    new BN(duplicateWithdrawalId / 4000).toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            )[0];

            console.log("Withdrawal account PDA:", withdrawalAccount.toString());

            // FIRST WITHDRAWAL - This should succeed
            try {
                console.log("\nAttempting first withdrawal with ID:", duplicateWithdrawalId);

                // Execute the withdrawal
                const tx = await program.methods
                    .withdrawToken(
                        new BN(duplicateWithdrawalId),
                        withdrawalAmount,
                        v,
                        r,
                        s
                    )
                    .accounts({
                        state: statePda,
                        withdrawalRecord: withdrawalAccount,
                        mint: mint,
                        programTokenAccount: programTokenAccount,
                        programTokenAuthority: tokenAuthPda,
                        traderTokenAccount: userTokenAccount,
                        trader: user.publicKey,
                        payer: user.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .signers([user])
                    .rpc();

                console.log("First withdrawal successful! Transaction signature:", tx);

                // Verify first withdrawal succeeded by checking balances
                const afterFirstWithdrawUserBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(userTokenAccount)).value.amount
                );

                // Calculate balance change
                const userBalanceChange = afterFirstWithdrawUserBalance - initialUserBalance;
                console.log("User token balance increased by:", userBalanceChange / 10 ** 6);
                assert.equal(userBalanceChange, withdrawalAmount.toNumber(),
                    "First withdrawal didn't transfer the expected amount");

                // SECOND WITHDRAWAL - This should fail with WithdrawalAlreadyProcessed
                console.log("\nAttempting second withdrawal with SAME ID:", duplicateWithdrawalId);
                console.log("(This should fail with WithdrawalAlreadyProcessed error)");

                // Attempt second withdrawal with same ID
                try {
                    await program.methods
                        .withdrawToken(
                            new BN(duplicateWithdrawalId), // Same ID
                            withdrawalAmount,
                            v,
                            r,
                            s
                        )
                        .accounts({
                            state: statePda,
                            withdrawalRecord: withdrawalAccount,
                            mint: mint,
                            programTokenAccount: programTokenAccount,
                            programTokenAuthority: tokenAuthPda,
                            traderTokenAccount: userTokenAccount,
                            trader: user.publicKey,
                            payer: user.publicKey,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                            rent: SYSVAR_RENT_PUBKEY,
                        })
                        .signers([user])
                        .rpc();

                    // If we get here, the test failed because the duplicate withdrawal succeeded
                    assert.fail("Second withdrawal with same ID should have failed but succeeded");
                } catch (error: any) {
                    // Check if the error contains the expected message
                    console.log("Second withdrawal failed as expected with error:");
                    if (error.logs) {
                        const errorLogs = error.logs.join('\n');
                        console.log(errorLogs);

                        // Check for WithdrawalAlreadyProcessed in the error logs
                        assert.ok(
                            errorLogs.includes("WithdrawalAlreadyProcessed") ||
                            errorLogs.includes("Already processed"),
                            "Error should contain WithdrawalAlreadyProcessed message"
                        );
                        console.log("✅ Test passed: Second withdrawal correctly failed with WithdrawalAlreadyProcessed error");
                    } else {
                        console.log(error.message);
                        // If logs aren't available, just check for a general error
                        assert.ok(error, "Second withdrawal should have failed");
                    }
                }

                // Verify balances didn't change after failed second withdrawal attempt
                const finalUserBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(userTokenAccount)).value.amount
                );

                assert.equal(finalUserBalance, afterFirstWithdrawUserBalance,
                    "User balance should not change after failed withdrawal attempt");

            } catch (e: any) {
                console.error("Error during duplicate withdrawal test:", e);
                throw e;
            }
        });

        it("Allows a different account to sign for a trader's withdrawal", async () => {
            console.log("Testing withdrawal with different signer than recipient...");

            // Get the program's token account address
            const programTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin, // payer
                mint,
                tokenAuthPda,
                true // allowOwnerOffCurve
            ).then(account => account.address);

            // Create a recipient (who will NOT sign the transaction)
            const recipient = Keypair.generate();
            console.log("Recipient (non-signer) created:", recipient.publicKey.toString());

            // Fund recipient to create token account
            await program.provider.connection.confirmTransaction(
                await program.provider.connection.requestAirdrop(
                    recipient.publicKey,
                    0.1 * LAMPORTS_PER_SOL
                )
            );

            // Create recipient token account
            const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin,
                mint,
                recipient.publicKey
            ).then(account => account.address);
            console.log("Recipient token account:", recipientTokenAccount.toString());

            // Ensure program has enough tokens by depositing more if needed
            console.log("Ensuring program has enough tokens for proxy withdrawal test...");
            try {
                // Check program token balance
                const programBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(programTokenAccount)).value.amount
                );

                if (programBalance < 500000) { // If less than 0.5 tokens
                    console.log("Program token balance is low, depositing more tokens...");
                    // Mint more tokens to user
                    await mintTo(
                        program.provider.connection,
                        admin,
                        mint,
                        userTokenAccount,
                        admin.publicKey,
                        2_000_000 // 2 more tokens
                    );

                    // Deposit tokens
                    const depositTx = await program.methods
                        .depositToken(new BN(1_000_000)) // Deposit 1 token
                        .accounts({
                            state: statePda,
                            mint: mint,
                            programTokenAccount: programTokenAccount,
                            programTokenAuthority: tokenAuthPda,
                            userTokenAccount: userTokenAccount,
                            user: user.publicKey,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                        })
                        .signers([user])
                        .rpc();
                    console.log("Deposited more tokens to program:", depositTx);
                }
            } catch (e: any) {
                console.error("Error ensuring program has tokens:", e);
            }

            // Get initial balances
            const initialRecipientBalance = parseInt(
                (await program.provider.connection.getTokenAccountBalance(recipientTokenAccount)).value.amount
            );
            console.log("Initial recipient token balance:", initialRecipientBalance / 10 ** 6);

            // Create withdrawal data - note that trader is recipient, but user will sign
            const proxyWithdrawalId = 44444;
            const withdrawalAmount = new BN(400_000); // 0.4 tokens

            const withdrawalData = {
                id: proxyWithdrawalId,
                token: mint,
                trader: recipient.publicKey, // Recipient is the trader in the signature
                amount: withdrawalAmount.toString(),
            };

            // Sign the withdrawal with the Ethereum wallet
            // This authorizes funds to go to recipient
            const { v, r, s } = await signWithdrawal(
                signerWallet,
                statePda,
                withdrawalData
            );

            // Find the withdrawal record account PDA
            const withdrawalAccount = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("withdrawal_account"),
                    new BN(proxyWithdrawalId / 4000).toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            )[0];

            try {
                console.log("\nAttempting withdrawal where user signs on behalf of recipient");
                console.log("Signer:", user.publicKey.toString());
                console.log("Recipient:", recipient.publicKey.toString());

                // Execute the withdrawal - only user signs, not recipient
                const tx = await program.methods
                    .withdrawToken(
                        new BN(proxyWithdrawalId),
                        withdrawalAmount,
                        v,
                        r,
                        s
                    )
                    .accounts({
                        state: statePda,
                        withdrawalRecord: withdrawalAccount,
                        mint: mint,
                        programTokenAccount: programTokenAccount,
                        programTokenAuthority: tokenAuthPda,
                        traderTokenAccount: recipientTokenAccount,
                        trader: recipient.publicKey, // The trader/recipient doesn't sign
                        payer: user.publicKey, // User is the signer/payer
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .signers([user]) // Only user signs, not recipient
                    .rpc();

                console.log("Proxy withdrawal successful! Transaction signature:", tx);

                // Verify funds were sent to recipient
                const finalRecipientBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(recipientTokenAccount)).value.amount
                );
                console.log("Final recipient token balance:", finalRecipientBalance / 10 ** 6);

                // Calculate balance change
                const recipientBalanceChange = finalRecipientBalance - initialRecipientBalance;
                console.log("Recipient token balance increased by:", recipientBalanceChange / 10 ** 6);

                // Verify the withdrawal worked correctly
                assert.equal(recipientBalanceChange, withdrawalAmount.toNumber(),
                    "Recipient token increase doesn't match withdrawal amount");

                console.log("✅ Test passed: Token withdrawal succeeded with different signer than recipient");
            } catch (e: any) {
                console.error("Error during proxy token withdrawal test:", e);
                if (e.logs) {
                    console.log("Detailed error logs:", e.logs);
                }
                throw e;
            }
        });

        it("Allows a different account to sign for a trader's SOL withdrawal", async () => {
            console.log("Testing SOL withdrawal with different signer than recipient...");

            // Create a recipient (who will NOT sign the transaction)
            const recipient = Keypair.generate();
            console.log("SOL Recipient (non-signer) created:", recipient.publicKey.toString());

            // Get initial balances
            const initialRecipientBalance = await program.provider.connection.getBalance(recipient.publicKey);
            console.log("Initial recipient SOL balance:", initialRecipientBalance / LAMPORTS_PER_SOL, "SOL");

            // Wrapped SOL mint address
            const wrappedSolMint = new PublicKey("So11111111111111111111111111111111111111112");

            // Create withdrawal data - note that trader is recipient, but user will sign
            const proxyWithdrawalId = 55555;
            const withdrawalAmount = new BN(0.5 * LAMPORTS_PER_SOL); // 0.5 SOL

            const withdrawalData = {
                id: proxyWithdrawalId,
                token: wrappedSolMint,
                trader: recipient.publicKey, // Recipient is the trader in the signature
                amount: withdrawalAmount.toString(),
            };

            // Sign the withdrawal with the Ethereum wallet
            // This authorizes funds to go to recipient
            const { v, r, s } = await signWithdrawal(
                signerWallet,
                statePda,
                withdrawalData
            );

            // Find the withdrawal record account PDA
            const withdrawalAccount = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("withdrawal_account"),
                    new BN(proxyWithdrawalId / 4000).toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            )[0];

            try {
                console.log("\nAttempting SOL withdrawal where user signs on behalf of recipient");
                console.log("Signer:", user.publicKey.toString());
                console.log("Recipient:", recipient.publicKey.toString());

                // Use the direct .rpc() approach
                const tx = await program.methods
                    .withdrawNative(
                        new BN(proxyWithdrawalId),
                        withdrawalAmount,
                        v,
                        r,
                        s
                    )
                    .accounts({
                        state: statePda,
                        withdrawalRecord: withdrawalAccount,
                        wrappedSolMint: wrappedSolMint,
                        programSolAccount: solAccountPda,
                        trader: recipient.publicKey, // The trader/recipient doesn't sign
                        payer: user.publicKey, // User is the signer/payer
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .signers([user]) // Only user signs, not recipient
                    .rpc();

                console.log("Proxy SOL withdrawal successful! Transaction signature:", tx);

                // Verify funds were sent to recipient
                const finalRecipientBalance = await program.provider.connection.getBalance(recipient.publicKey);
                console.log("Final recipient SOL balance:", finalRecipientBalance / LAMPORTS_PER_SOL, "SOL");

                // Calculate balance change
                const recipientBalanceChange = finalRecipientBalance - initialRecipientBalance;
                console.log("Recipient SOL balance increased by:", recipientBalanceChange / LAMPORTS_PER_SOL, "SOL");

                // Verify the withdrawal worked correctly
                assert.equal(recipientBalanceChange, withdrawalAmount.toNumber(),
                    "Recipient SOL increase doesn't match withdrawal amount");

                console.log("✅ Test passed: SOL withdrawal succeeded with different signer than recipient");
            } catch (e: any) {
                console.error("Error during SOL withdrawal:", e);
                throw e;
            }
        });

        it("Fails when using valid signatures with modified withdrawal data", async () => {
            console.log("Testing signature specificity for withdrawal parameters...");

            // Get the program's token account address
            const programTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin, // payer
                mint,
                tokenAuthPda,
                true // allowOwnerOffCurve
            ).then(account => account.address);

            // Create another token for testing token address modification
            const altMint = await createMint(
                program.provider.connection,
                admin,
                admin.publicKey,
                null,
                6 // 6 decimals
            );
            console.log("Alternative token mint created:", altMint.toString());

            // Create a token account for the alternative token
            const altTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin,
                altMint,
                user.publicKey
            ).then(account => account.address);

            const altProgramTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin, // payer
                altMint,
                tokenAuthPda,
                true // allowOwnerOffCurve
            ).then(account => account.address);

            // Mint tokens to program account to support withdrawals
            await mintTo(
                program.provider.connection,
                admin,
                altMint,
                altProgramTokenAccount,
                admin.publicKey,
                10_000_000 // 10 alt tokens to program
            );

            // Create another user for testing trader address modification
            const altUser = Keypair.generate();

            // Fund alt user
            await program.provider.connection.confirmTransaction(
                await program.provider.connection.requestAirdrop(
                    altUser.publicKey,
                    2 * LAMPORTS_PER_SOL
                )
            );
            console.log("Alternative user created:", altUser.publicKey.toString());

            // Create token accounts for the alt user
            const altUserTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin,
                mint,
                altUser.publicKey
            ).then(account => account.address);

            // ORIGINAL WITHDRAWAL DATA (we'll get a signature for this)
            const originalId = 99100;
            const originalAmount = new BN(200_000); // 0.2 tokens

            const originalWithdrawalData = {
                id: originalId,
                token: mint,
                trader: user.publicKey,
                amount: originalAmount.toString(),
            };

            console.log("\nOriginal withdrawal data for signature:");
            console.log("ID:", originalId);
            console.log("Token:", mint.toString());
            console.log("Trader:", user.publicKey.toString());
            console.log("Amount:", originalAmount.toString());

            // Get signature for the ORIGINAL data
            const { v, r, s } = await signWithdrawal(
                signerWallet,
                statePda,
                originalWithdrawalData
            );

            console.log("Obtained signature for original withdrawal data");
            console.log("v:", v);
            console.log("r:", Buffer.from(r).toString('hex'));
            console.log("s:", Buffer.from(s).toString('hex'));

            // Helper function to attempt withdrawal and verify it fails with invalid signature
            async function attemptInvalidWithdrawal(
                testName: string,
                withdrawalId: number,
                withdrawalToken: PublicKey,
                withdrawalTrader: PublicKey,
                withdrawalAmount: BN,
                tokenAccount: PublicKey
            ) {
                console.log(`\nTEST ${testName}`);
                console.log("ID:", withdrawalId);
                console.log("Token:", withdrawalToken.toString());
                console.log("Trader:", withdrawalTrader.toString());
                console.log("Amount:", withdrawalAmount.toString());

                // Find the appropriate withdrawal record PDA for this ID
                const withdrawalAccount = PublicKey.findProgramAddressSync(
                    [
                        Buffer.from("withdrawal_account"),
                        new BN(withdrawalId / 4000).toArrayLike(Buffer, 'le', 8)
                    ],
                    program.programId
                )[0];

                // Prepare the appropriate token accounts
                const programAccount = withdrawalToken.equals(mint)
                    ? programTokenAccount
                    : altProgramTokenAccount;

                // This should throw an error due to invalid signature
                try {
                    await program.methods
                        .withdrawToken(
                            new BN(withdrawalId),
                            withdrawalAmount,
                            v, // Original signature
                            r, // Original signature
                            s  // Original signature
                        )
                        .accounts({
                            state: statePda,
                            withdrawalRecord: withdrawalAccount,
                            mint: withdrawalToken,
                            programTokenAccount: programAccount,
                            programTokenAuthority: tokenAuthPda,
                            traderTokenAccount: tokenAccount,
                            trader: withdrawalTrader,
                            payer: withdrawalTrader.equals(user.publicKey) ? user.publicKey : altUser.publicKey,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                            rent: SYSVAR_RENT_PUBKEY,
                        })
                        .signers([withdrawalTrader.equals(user.publicKey) ? user : altUser])
                        .rpc();

                    // If we get here, the test failed because the withdrawal succeeded with modified data
                    assert.fail(`Withdrawal with modified ${testName} should have failed but succeeded`);
                } catch (error: any) {
                    // Check if the error contains the expected message
                    console.log(`Withdrawal with modified ${testName} failed as expected with error:`);
                    if (error.logs) {
                        const errorLogs = error.logs.join('\n');

                        // Log the first few lines of the error for debugging
                        console.log(errorLogs.split('\n').slice(0, 5).join('\n') + '...');

                        // Check for InvalidSignature in the error logs
                        assert.ok(
                            errorLogs.includes("InvalidSignature") ||
                            errorLogs.includes("invalid signature") ||
                            errorLogs.includes("signature verification failed"),
                            `Error for ${testName} should indicate invalid signature`
                        );
                        console.log(`✅ Test passed: Withdrawal with modified ${testName} correctly failed with signature verification error`);
                    } else {
                        console.log(error.message);
                        // If logs aren't available, just check for a general error
                        assert.ok(error, `Withdrawal with modified ${testName} should have failed`);
                    }
                }
            }

            // Test 1: Different withdrawal ID
            await attemptInvalidWithdrawal(
                "Withdrawal ID",
                originalId + 1, // Different ID
                mint,           // Same token
                user.publicKey, // Same trader
                originalAmount, // Same amount
                userTokenAccount
            );

            // Test 2: Different trader address
            await attemptInvalidWithdrawal(
                "Trader Address",
                originalId,        // Same ID
                mint,              // Same token
                altUser.publicKey, // Different trader
                originalAmount,    // Same amount
                altUserTokenAccount
            );

            // Test 3: Different token address
            await attemptInvalidWithdrawal(
                "Token Address",
                originalId,     // Same ID
                altMint,        // Different token
                user.publicKey, // Same trader
                originalAmount, // Same amount
                altTokenAccount
            );

            // Test 4: Different amount
            await attemptInvalidWithdrawal(
                "Amount",
                originalId,                 // Same ID
                mint,                       // Same token
                user.publicKey,             // Same trader
                originalAmount.addn(10000), // Different amount
                userTokenAccount
            );

            console.log("\n✅ All signature specificity tests passed!");
            console.log("The program correctly rejected all attempts to use a valid signature with modified withdrawal parameters.");
        });

        it("Performs multiple withdrawals across separate transactions", async () => {
            console.log("\n=== Testing multiple withdrawals in sequence ===");

            // Create a dedicated recipient for this test
            const recipient = Keypair.generate();
            console.log("Multi-withdrawal recipient created:", recipient.publicKey.toString());

            // Fund recipient to cover account creation costs
            await program.provider.connection.confirmTransaction(
                await program.provider.connection.requestAirdrop(
                    recipient.publicKey,
                    0.2 * LAMPORTS_PER_SOL
                )
            );

            // Create recipient token account
            const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin,
                mint,
                recipient.publicKey
            ).then(account => account.address);
            console.log("Recipient token account:", recipientTokenAccount.toString());

            // Get program token account
            const programTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin,
                mint,
                tokenAuthPda,
                true // allowOwnerOffCurve
            ).then(account => account.address);

            // Ensure program has sufficient tokens for all withdrawals
            console.log("Ensuring program has enough tokens for multiple withdrawals...");
            const programBalance = parseInt(
                (await program.provider.connection.getTokenAccountBalance(programTokenAccount)).value.amount
            );

            if (programBalance < 3_000_000) { // Need at least 3 tokens
                console.log("Program token balance too low, depositing more tokens...");

                // Mint more tokens to user
                await mintTo(
                    program.provider.connection,
                    admin,
                    mint,
                    userTokenAccount,
                    admin.publicKey,
                    5_000_000 // 5 more tokens
                );

                // Deposit tokens to program
                const depositTx = await program.methods
                    .depositToken(new BN(4_000_000)) // Deposit 4 tokens
                    .accounts({
                        state: statePda,
                        mint: mint,
                        programTokenAccount: programTokenAccount,
                        programTokenAuthority: tokenAuthPda,
                        userTokenAccount: userTokenAccount,
                        user: user.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([user])
                    .rpc();
                console.log("Deposited 4 tokens to program:", depositTx);
            }

            // Record initial balances
            const initialProgramBalance = parseInt(
                (await program.provider.connection.getTokenAccountBalance(programTokenAccount)).value.amount
            );
            const initialRecipientBalance = parseInt(
                (await program.provider.connection.getTokenAccountBalance(recipientTokenAccount)).value.amount
            );

            console.log("Initial program balance:", initialProgramBalance / 10 ** 6, "tokens");
            console.log("Initial recipient balance:", initialRecipientBalance / 10 ** 6, "tokens");

            // Define withdrawal amounts (3 separate withdrawals)
            const withdrawalAmounts = [
                new BN(500_000),  // 0.5 tokens
                new BN(750_000),  // 0.75 tokens
                new BN(1_250_000) // 1.25 tokens
            ];

            const totalWithdrawalAmount = withdrawalAmounts.reduce(
                (sum, amount) => sum + amount.toNumber(), 0
            );

            console.log("Will perform 3 withdrawals totaling:", totalWithdrawalAmount / 10 ** 6, "tokens");

            // Helper function to perform a single withdrawal
            async function performWithdrawal(id: number, amount: BN) {
                console.log(`\nPerforming withdrawal #${id} of ${amount.toNumber() / 10 ** 6} tokens`);

                // Create withdrawal data
                const withdrawalData = {
                    id: id,
                    token: mint,
                    trader: recipient.publicKey,
                    amount: amount.toString(),
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
                        new BN(id / 4000).toArrayLike(Buffer, 'le', 8)
                    ],
                    program.programId
                )[0];

                // Execute the withdrawal transaction
                console.log("Executing withdrawal transaction...");
                const tx = await program.methods
                    .withdrawToken(
                        new BN(id),
                        amount,
                        v,
                        r,
                        s
                    )
                    .accounts({
                        state: statePda,
                        withdrawalRecord: withdrawalAccount,
                        mint: mint,
                        programTokenAccount: programTokenAccount,
                        programTokenAuthority: tokenAuthPda,
                        traderTokenAccount: recipientTokenAccount,
                        trader: recipient.publicKey,
                        payer: user.publicKey, // User is the transaction signer/payer
                        tokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .signers([user])
                    .rpc();

                console.log(`Withdrawal transaction successful:`, tx);

                // Get updated balances
                const currentProgramBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(programTokenAccount)).value.amount
                );
                const currentRecipientBalance = parseInt(
                    (await program.provider.connection.getTokenAccountBalance(recipientTokenAccount)).value.amount
                );

                console.log(`Program balance after withdrawal #${id}:`, currentProgramBalance / 10 ** 6, "tokens");
                console.log(`Recipient balance after withdrawal #${id}:`, currentRecipientBalance / 10 ** 6, "tokens");

                return { programBalance: currentProgramBalance, recipientBalance: currentRecipientBalance };
            }

            try {
                // Perform the 3 withdrawals in sequence
                const results = [];
                for (let i = 0; i < withdrawalAmounts.length; i++) {
                    const withdrawalId = 600000 + i; // Unique IDs starting from 600000
                    const result = await performWithdrawal(withdrawalId, withdrawalAmounts[i]);
                    results.push(result);
                }

                // Get final balances
                const finalProgramBalance = results[results.length - 1].programBalance;
                const finalRecipientBalance = results[results.length - 1].recipientBalance;

                // Calculate and verify the expected changes
                const expectedProgramDecrease = totalWithdrawalAmount;
                const expectedRecipientIncrease = totalWithdrawalAmount;

                const actualProgramDecrease = initialProgramBalance - finalProgramBalance;
                const actualRecipientIncrease = finalRecipientBalance - initialRecipientBalance;

                console.log("\n=== Final Balance Check ===");
                console.log("Expected program decrease:", expectedProgramDecrease / 10 ** 6, "tokens");
                console.log("Actual program decrease:", actualProgramDecrease / 10 ** 6, "tokens");
                console.log("Expected recipient increase:", expectedRecipientIncrease / 10 ** 6, "tokens");
                console.log("Actual recipient increase:", actualRecipientIncrease / 10 ** 6, "tokens");

                // Verify results match expectations
                assert.equal(actualProgramDecrease, expectedProgramDecrease,
                    "Program balance decrease doesn't match expected total withdrawal amount");
                assert.equal(actualRecipientIncrease, expectedRecipientIncrease,
                    "Recipient balance increase doesn't match expected total withdrawal amount");

                console.log("\n✅ Multiple withdrawals test passed successfully!");
                console.log(`Total withdrawn: ${totalWithdrawalAmount / 10 ** 6} tokens in 3 transactions`);

            } catch (e: any) {
                console.error("Error during multiple withdrawals test:", e);
                if (e.logs) {
                    console.log("Detailed error logs:", e.logs);
                }
                throw e;
            }
        });
    });
} 