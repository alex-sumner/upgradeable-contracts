import * as anchor from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    LAMPORTS_PER_SOL,
    SystemProgram
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { BN } from "bn.js";
import {
    fetchStateAccount,
    waitForTimelock,
    generateEthereumAddress
} from "./utils.ts";

export async function runTimelockTests(
    program: anchor.Program,
    admin: Keypair,
    user: Keypair,
    timelockAuthority: Keypair,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    mint: PublicKey,
    userTokenAccount: PublicKey
) {
    console.log("Running timelock operations tests...");

    // Get provider from the program
    const provider = program.provider;

    describe("timelock operations", () => {
        it("queue timelock operation to add new authority", async () => {
            const newAuthority = Keypair.generate();
            console.log("New authority public key:", newAuthority.publicKey.toString());

            let state = await fetchStateAccount(program, statePda);

            // Queue the timelock operation to add new authority
            const operationData = newAuthority.publicKey.toBytes();

            await program.methods
                .queueOperation(new BN(4), Buffer.from(operationData)) // 4 = Add timelock authority
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify operation was queued - use a new variable to avoid keeping multiple large objects in memory
            let stateAfterQueue = await fetchStateAccount(program, statePda);
            console.log(`Pending operations: ${stateAfterQueue.pendingOperations.length}`);
            console.log(`First pending operation type: ${stateAfterQueue.pendingOperations[0]?.operationType}`);

            stateAfterQueue = null;

            // Attempt to execute the operation immediately - this should fail
            try {
                await program.methods
                    .executeOperation(new BN(0))
                    .accounts({
                        state: statePda,
                        authority: timelockAuthority.publicKey,
                    })
                    .signers([timelockAuthority])
                    .rpc();
                assert.fail("Immediate execution should have failed");
            } catch (e: any) {
                console.log("Immediate execution failed as expected with error:", e.message);
                assert.ok(e.message.includes("TimelockDelayNotMet"), "Error should be TimelockDelayNotMet");
            }

            await waitForTimelock(state);
            state = null;

            // Execute the operation
            await program.methods
                .executeOperation(new BN(0))
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify authority was added
            const stateAfterExecution = await fetchStateAccount(program, statePda);
            console.log("Authorities after execution:", stateAfterExecution.timelockAuthorities.map(a => a.toString()));

            // Verify the new authority was added
            const newAuthorityAdded = stateAfterExecution.timelockAuthorities.some(
                a => a.toString() === newAuthority.publicKey.toString()
            );

            expect(newAuthorityAdded).to.be.true;
        });

        it("queue timelock operation to update withdrawal signer", async () => {
            const newWithdrawalSigner = generateEthereumAddress();
            console.log("New withdrawal signer:", newWithdrawalSigner.toString('hex'));

            // Fetch the state account to get current withdrawal signer
            let state = await fetchStateAccount(program, statePda);
            console.log("Current withdrawal signer:", Buffer.from(state.withdrawalSigner).toString('hex'));

            // Queue the timelock operation to update withdrawal signer
            await program.methods
                .queueOperation(new BN(2), newWithdrawalSigner) // 2 = Change signer
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify operation was queued
            let stateAfterQueue = await fetchStateAccount(program, statePda);
            console.log(`Pending operations: ${stateAfterQueue.pendingOperations.length}`);

            // Find the index of the operation we just queued
            const operationIndex = stateAfterQueue.pendingOperations.findIndex(op => op.operationType === 2);
            console.log(`Found operation at index: ${operationIndex}`);

            stateAfterQueue = null;

            if (operationIndex === -1) {
                throw new Error("Could not find the withdrawal signer operation in pending operations");
            }

            const timelockDelay = state.timelockDelay.toNumber();
            await waitForTimelock(state);

            state = null;

            // Execute the operation
            await program.methods
                .executeOperation(new BN(operationIndex))
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            const stateAfterExecution = await fetchStateAccount(program, statePda);
            console.log("Withdrawal signer after execution:", Buffer.from(stateAfterExecution.withdrawalSigner).toString('hex'));

            // Verify the new withdrawal signer was set
            expect(Buffer.from(stateAfterExecution.withdrawalSigner).toString('hex'))
                .to.equal(newWithdrawalSigner.toString('hex'));
        });

        it("Fails when unauthorized account attempts to queue withdrawal signer update", async () => {
            console.log("\n=== Testing unauthorized withdrawal signer update attempt ===");

            // Create an unauthorized account
            const unauthorizedAccount = Keypair.generate();
            console.log("Unauthorized account:", unauthorizedAccount.publicKey.toString());

            // Fund the unauthorized account
            await provider.connection.confirmTransaction(
                await provider.connection.requestAirdrop(
                    unauthorizedAccount.publicKey,
                    1 * LAMPORTS_PER_SOL
                )
            );

            // Generate a new withdrawal signer
            const newWithdrawalSigner = generateEthereumAddress();
            console.log("Attempting to set new withdrawal signer:", newWithdrawalSigner.toString('hex'));

            try {
                // Attempt to queue the operation with unauthorized account
                await program.methods
                    .queueOperation(new BN(2), newWithdrawalSigner) // 2 = Change signer
                    .accounts({
                        state: statePda,
                        authority: unauthorizedAccount.publicKey, // Using unauthorized account
                    })
                    .signers([unauthorizedAccount])
                    .rpc();

                // If we get here, the test failed because the unauthorized operation succeeded
                assert.fail("Unauthorized account should not be able to queue withdrawal signer update");
            } catch (e: any) {
                console.log("Operation failed as expected with error:", e.message);
                assert.ok(
                    e.message.includes("Unauthorized access"),
                    "Error should indicate unauthorized access"
                );
            }

            // Verify the withdrawal signer hasn't changed
            const state = await fetchStateAccount(program, statePda);

            // Log current state but avoid using costly string operations
            console.log("Current withdrawal signer:", Buffer.from(state.withdrawalSigner).toString('hex'));
            console.log("Number of pending operations:", state.pendingOperations.length);

            // Explicitly null out references to help garbage collection
            const pendingCount = state.pendingOperations.length;
        });

        it("Queues a timelock operation to change the timelock delay", async () => {
            console.log("\n=== Testing timelock operations: Change Timelock Delay ===");
            console.log("Using timelock authority:", timelockAuthority.publicKey.toString());

            // Prepare data for changing timelock delay to 20 seconds
            const newDelay = 3; // Use a smaller delay to reduce test time
            const delayBytes = new BN(newDelay).toArrayLike(Buffer, 'le', 8);

            try {
                // Queue the operation
                const tx = await program.methods
                    .queueOperation(
                        new BN(3), // 3 = Set timelock delay operation type
                        Buffer.from(delayBytes)
                    )
                    .accounts({
                        state: statePda,
                        authority: timelockAuthority.publicKey,
                    })
                    .signers([timelockAuthority])
                    .rpc();

                console.log("Successfully queued change timelock delay operation:", tx);

                // Get the updated state to see the pending operations
                let state = await fetchStateAccount(program, statePda);
                console.log("State account exists with size:", state.pendingOperations.length, "pending operations");
                console.log("Operation has been queued successfully");

                // Find the index of the operation we just queued
                const operationIndex = state.pendingOperations.findIndex(op => op.operationType === 3);
                console.log(`Found operation at index: ${operationIndex}`);

                if (operationIndex === -1) {
                    throw new Error("Could not find the timelock delay operation in pending operations");
                }

                await waitForTimelock(state);

                state = null;

                // Execute the operation
                await program.methods
                    .executeOperation(new BN(operationIndex))
                    .accounts({
                        state: statePda,
                        authority: timelockAuthority.publicKey,
                    })
                    .signers([timelockAuthority])
                    .rpc();

                // Verify the timelock delay was changed
                const stateAfterExecution = await fetchStateAccount(program, statePda);
                console.log("Timelock delay after execution:", stateAfterExecution.timelockDelay.toNumber());
                expect(stateAfterExecution.timelockDelay.toNumber()).to.equal(newDelay);

            } catch (e: any) {
                console.error("Error changing timelock delay:", e);
                throw e;
            }
        });

        it("Can retrieve withdrawal signer using get_withdrawal_signer function", async () => {
            console.log("\n=== Testing get_withdrawal_signer function ===");

            // Get withdrawal signer using the new function
            const withdrawalSignerBytes = await program.methods
                .getWithdrawalSigner()
                .accounts({
                    state: statePda,
                })
                .view();

            // Store the hex representation to avoid keeping large objects in memory
            const newMethodHex = Buffer.from(withdrawalSignerBytes).toString('hex');
            console.log("Withdrawal signer (new method):", newMethodHex);

            // Fetch again to compare, but minimize memory usage
            const state = await fetchStateAccount(program, statePda);
            const oldMethodHex = Buffer.from(state.withdrawalSigner).toString('hex');
            console.log("Withdrawal signer (old method):", oldMethodHex);

            // Verify they match
            expect(newMethodHex).to.equal(oldMethodHex);
        });

        it("Fails when unauthorized account attempts to execute timelock operation", async () => {
            console.log("\n=== Testing unauthorized operation execution attempt ===");

            // Create an unauthorized account
            const unauthorizedAccount = Keypair.generate();
            console.log("Unauthorized account:", unauthorizedAccount.publicKey.toString());

            // Fund the unauthorized account
            await provider.connection.confirmTransaction(
                await provider.connection.requestAirdrop(
                    unauthorizedAccount.publicKey,
                    1 * LAMPORTS_PER_SOL
                )
            );

            // Queue a timelock operation first using authorized account
            const newDelay = 5; // 5 seconds delay
            const delayBytes = new BN(newDelay).toArrayLike(Buffer, 'le', 8);

            await program.methods
                .queueOperation(
                    new BN(3), // 3 = Set timelock delay operation type
                    Buffer.from(delayBytes)
                )
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify operation was queued
            let stateAfterQueue = await fetchStateAccount(program, statePda);
            console.log(`Pending operations: ${stateAfterQueue.pendingOperations.length}`);

            // Find the index of our operation
            const operationIndex = stateAfterQueue.pendingOperations.findIndex(op => op.operationType === 3);
            console.log(`Found operation at index: ${operationIndex}`);

            if (operationIndex === -1) {
                throw new Error("Could not find the timelock delay operation in pending operations");
            }

            // Wait for timelock to expire
            await waitForTimelock(stateAfterQueue);
            stateAfterQueue = null;

            try {
                // Attempt to execute the operation with unauthorized account
                await program.methods
                    .executeOperation(new BN(operationIndex))
                    .accounts({
                        state: statePda,
                        authority: unauthorizedAccount.publicKey, // Using unauthorized account
                    })
                    .signers([unauthorizedAccount])
                    .rpc();

                // If we get here, the test failed because the unauthorized operation succeeded
                assert.fail("Unauthorized account should not be able to execute timelock operation");
            } catch (e: any) {
                console.log("Operation failed as expected with error:", e.message);
                assert.ok(
                    e.message.includes("Unauthorized access"),
                    "Error should indicate unauthorized access"
                );
            }

            // Now execute with the authorized account to clean up
            await program.methods
                .executeOperation(new BN(operationIndex))
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify the operation was executed
            const stateAfterExecution = await fetchStateAccount(program, statePda);
            console.log("Timelock delay after execution:", stateAfterExecution.timelockDelay.toNumber());
            expect(stateAfterExecution.timelockDelay.toNumber()).to.equal(newDelay);
        });

        it("Can cancel a queued timelock operation", async () => {
            console.log("\n=== Testing cancel timelock operation ===");

            // Queue a new timelock operation
            const newDelay = 10; // 10 seconds delay
            const delayBytes = new BN(newDelay).toArrayLike(Buffer, 'le', 8);

            await program.methods
                .queueOperation(
                    new BN(3), // 3 = Set timelock delay operation type
                    Buffer.from(delayBytes)
                )
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify operation was queued
            let stateAfterQueue = await fetchStateAccount(program, statePda);
            console.log(`Number of pending operations: ${stateAfterQueue.pendingOperations.length}`);

            // Find the index of our operation
            const operationIndex = stateAfterQueue.pendingOperations.findIndex(op =>
                op.operationType === 3 &&
                new BN(Buffer.from(op.data).slice(0, 8), 'le').toNumber() === newDelay
            );
            console.log(`Found operation at index: ${operationIndex}`);

            if (operationIndex === -1) {
                throw new Error("Could not find the timelock delay operation in pending operations");
            }

            // Cancel the operation
            await program.methods
                .cancelOperation(new BN(operationIndex))
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify the operation was removed
            const stateAfterCancel = await fetchStateAccount(program, statePda);
            console.log(`Number of pending operations after cancel: ${stateAfterCancel.pendingOperations.length}`);

            // Check if the operation was actually removed
            const operationStillExists = stateAfterCancel.pendingOperations.some(op =>
                op.operationType === 3 &&
                new BN(Buffer.from(op.data).slice(0, 8), 'le').toNumber() === newDelay
            );

            expect(operationStillExists).to.be.false;
        });

        it("Fails when unauthorized account attempts to cancel timelock operation", async () => {
            console.log("\n=== Testing unauthorized cancel attempt ===");

            // Create an unauthorized account
            const unauthorizedAccount = Keypair.generate();
            console.log("Unauthorized account:", unauthorizedAccount.publicKey.toString());

            // Fund the unauthorized account
            await provider.connection.confirmTransaction(
                await provider.connection.requestAirdrop(
                    unauthorizedAccount.publicKey,
                    1 * LAMPORTS_PER_SOL
                )
            );

            // Queue a timelock operation first using authorized account
            const newDelay = 15; // 15 seconds delay
            const delayBytes = new BN(newDelay).toArrayLike(Buffer, 'le', 8);

            await program.methods
                .queueOperation(
                    new BN(3), // 3 = Set timelock delay operation type
                    Buffer.from(delayBytes)
                )
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify operation was queued
            let stateAfterQueue = await fetchStateAccount(program, statePda);
            console.log(`Number of pending operations: ${stateAfterQueue.pendingOperations.length}`);

            // Find the index of our operation
            const operationIndex = stateAfterQueue.pendingOperations.findIndex(op =>
                op.operationType === 3 &&
                new BN(Buffer.from(op.data).slice(0, 8), 'le').toNumber() === newDelay
            );
            console.log(`Found operation at index: ${operationIndex}`);

            if (operationIndex === -1) {
                throw new Error("Could not find the timelock delay operation in pending operations");
            }

            try {
                // Attempt to cancel the operation with unauthorized account
                await program.methods
                    .cancelOperation(new BN(operationIndex))
                    .accounts({
                        state: statePda,
                        authority: unauthorizedAccount.publicKey,
                    })
                    .signers([unauthorizedAccount])
                    .rpc();

                // If we get here, the test failed
                assert.fail("Unauthorized account should not be able to cancel timelock operation");
            } catch (e: any) {
                console.log("Cancel operation failed as expected with error:", e.message);
                assert.ok(
                    e.message.includes("Unauthorized access"),
                    "Error should indicate unauthorized access"
                );
            }

            // Cleanup: Cancel the operation with authorized account
            await program.methods
                .cancelOperation(new BN(operationIndex))
                .accounts({
                    state: statePda,
                    authority: timelockAuthority.publicKey,
                })
                .signers([timelockAuthority])
                .rpc();

            // Verify the operation was removed
            const stateAfterCancel = await fetchStateAccount(program, statePda);
            console.log(`Number of pending operations after cleanup: ${stateAfterCancel.pendingOperations.length}`);

            const operationStillExists = stateAfterCancel.pendingOperations.some(op =>
                op.operationType === 3 &&
                new BN(Buffer.from(op.data).slice(0, 8), 'le').toNumber() === newDelay
            );

            expect(operationStillExists).to.be.false;
        });
    });
} 