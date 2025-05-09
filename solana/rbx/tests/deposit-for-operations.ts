import * as anchor from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { BN } from "bn.js";

export async function runDepositForTests(
    program: anchor.Program,
    admin: Keypair,
    user: Keypair,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    solAccountPda: PublicKey,
    mint: PublicKey,
    userTokenAccount: PublicKey
) {
    console.log("Running deposit-for tests...");

    describe("deposit-for operations", () => {
        // Create a beneficiary account (the account that will be recorded as the trader)
        const beneficiary = Keypair.generate();
        console.log("Beneficiary public key:", beneficiary.publicKey.toString());

        // Fund the beneficiary (just to make sure it exists on-chain)
        before(async () => {
            await program.provider.connection.confirmTransaction(
                await program.provider.connection.requestAirdrop(
                    beneficiary.publicKey,
                    0.01 * LAMPORTS_PER_SOL
                )
            );
            console.log(`Funded beneficiary with 0.01 SOL`);
        });

        it("Deposits tokens on behalf of beneficiary", async () => {
            console.log("Testing token deposit-for...");

            // Get the program's token account address
            const programTokenAccount = await getOrCreateAssociatedTokenAccount(
                program.provider.connection,
                admin, // payer
                mint,
                tokenAuthPda,
                true // allowOwnerOffCurve
            ).then(account => account.address);

            console.log("Program token account:", programTokenAccount.toString());

            // Get initial balances
            const userTokenInfo = await program.provider.connection.getTokenAccountBalance(userTokenAccount);
            const initialUserBalance = parseInt(userTokenInfo.value.amount);
            console.log("Initial user token balance:", initialUserBalance / 10 ** 6);

            // Check if program token account exists
            let initialProgramBalance = 0;
            try {
                const programTokenInfo = await program.provider.connection.getTokenAccountBalance(programTokenAccount);
                initialProgramBalance = parseInt(programTokenInfo.value.amount);
                console.log("Initial program token balance:", initialProgramBalance / 10 ** 6);
            } catch (e: any) {
                console.log("Program token account doesn't exist yet or has no balance");
            }

            // Deposit amount
            const depositAmount = new BN(1_200_000); // 1.2 tokens (different from regular deposit to distinguish)

            try {
                // Note: Using event listeners in tests can cause hanging issues, so we'll skip event verification
                console.log("Note: Skipping event verification in tests to avoid hanging");

                // Call the deposit_token_for instruction
                const tx = await program.methods
                    .depositTokenFor(depositAmount, beneficiary.publicKey)
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

                console.log("Token deposit-for successful! Transaction signature:", tx);

                // Verify balances
                const finalUserTokenInfo = await program.provider.connection.getTokenAccountBalance(userTokenAccount);
                const finalUserBalance = parseInt(finalUserTokenInfo.value.amount);

                // Try to get program token balance
                const finalProgramTokenInfo = await program.provider.connection.getTokenAccountBalance(programTokenAccount);
                const finalProgramBalance = parseInt(finalProgramTokenInfo.value.amount);

                console.log("Final user token balance:", finalUserBalance / 10 ** 6);
                console.log("Final program token balance:", finalProgramBalance / 10 ** 6);

                // Expect the user's balance to have decreased by depositAmount
                const userBalanceChange = initialUserBalance - finalUserBalance;
                expect(userBalanceChange).to.equal(depositAmount.toNumber());

                // Expect the program's balance to have increased by depositAmount
                const programBalanceChange = finalProgramBalance - initialProgramBalance;
                expect(programBalanceChange).to.equal(depositAmount.toNumber());
            } catch (e: any) {
                console.error("Error depositing tokens:", e);
                if (e.logs) {
                    console.log("Error logs:", e.logs);
                }
                throw e;
            }
        });

        it("Deposits native SOL on behalf of beneficiary", async () => {
            console.log("Testing native SOL deposit-for...");

            // Get initial balances
            const initialUserSol = await program.provider.connection.getBalance(user.publicKey);
            const initialProgramSol = await program.provider.connection.getBalance(solAccountPda);

            console.log("Initial user SOL balance:", initialUserSol / LAMPORTS_PER_SOL, "SOL");
            console.log("Initial program SOL balance:", initialProgramSol / LAMPORTS_PER_SOL, "SOL");

            // Deposit amount (different from regular deposit to distinguish)
            const solDepositAmount = new BN(1.5 * LAMPORTS_PER_SOL); // 1.5 SOL

            try {
                // Note: Using event listeners in tests can cause hanging issues, so we'll skip event verification
                console.log("Note: Skipping event verification in tests to avoid hanging");

                // Wrapped SOL mint
                const wrappedSolMint = new PublicKey("So11111111111111111111111111111111111111112");

                // Call the deposit_native_for instruction
                const tx = await program.methods
                    .depositNativeFor(solDepositAmount, beneficiary.publicKey)
                    .accounts({
                        state: statePda,
                        wrappedSolMint: wrappedSolMint,
                        programSolAccount: solAccountPda,
                        user: user.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([user])
                    .rpc();

                console.log("SOL deposit-for successful! Transaction signature:", tx);

                // Verify balances
                const finalUserSol = await program.provider.connection.getBalance(user.publicKey);
                const finalProgramSol = await program.provider.connection.getBalance(solAccountPda);

                console.log("Final user SOL balance:", finalUserSol / LAMPORTS_PER_SOL, "SOL");
                console.log("Final program SOL balance:", finalProgramSol / LAMPORTS_PER_SOL, "SOL");

                // Calculate differences
                const userSolDiff = initialUserSol - finalUserSol;
                const programSolDiff = finalProgramSol - initialProgramSol;

                console.log("User SOL decreased by:", userSolDiff / LAMPORTS_PER_SOL, "SOL");
                console.log("Program SOL increased by:", programSolDiff / LAMPORTS_PER_SOL, "SOL");

                // Verify the deposit worked correctly
                // User pays transaction fees so the decrease will be more than the deposit amount
                assert.isAtLeast(userSolDiff, solDepositAmount.toNumber(),
                    "User SOL decrease is less than deposit amount");
                assert.equal(programSolDiff, solDepositAmount.toNumber(),
                    "Program SOL increase doesn't match deposit amount");

            } catch (e: any) {
                console.error("Error during SOL deposit-for:", e);
                throw e;
            }
        });
    });
}