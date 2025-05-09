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

export async function runStakeTests(
    program: anchor.Program,
    admin: Keypair,
    user: Keypair,
    statePda: PublicKey,
    tokenAuthPda: PublicKey,
    solAccountPda: PublicKey,
    mint: PublicKey,
    userTokenAccount: PublicKey
) {
    console.log("Running stake tests...");

    describe("stake operations", () => {
        it("Stakes tokens", async () => {
            console.log("Testing token staking...");

            // Get the program's token account address
            // This needs to follow the ATA derivation path
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

            // Stake amount
            const stakeAmount = new BN(1_500_000); // 1.5 tokens

            try {
                // Call the stake_token instruction
                const tx = await program.methods
                    .stakeToken(stakeAmount)
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

                console.log("Token stake successful! Transaction signature:", tx);

                // Verify balances
                const finalUserTokenInfo = await program.provider.connection.getTokenAccountBalance(userTokenAccount);
                const finalUserBalance = parseInt(finalUserTokenInfo.value.amount);

                // Try to get program token balance
                const finalProgramTokenInfo = await program.provider.connection.getTokenAccountBalance(programTokenAccount);
                const finalProgramBalance = parseInt(finalProgramTokenInfo.value.amount);

                console.log("Final user token balance:", finalUserBalance / 10 ** 6);
                console.log("Final program token balance:", finalProgramBalance / 10 ** 6);

                // Expect the user's balance to have decreased by stakeAmount
                const userBalanceChange = initialUserBalance - finalUserBalance;
                expect(userBalanceChange).to.equal(stakeAmount.toNumber());

                // Expect the program's balance to have increased by stakeAmount
                const programBalanceChange = finalProgramBalance - initialProgramBalance;
                expect(programBalanceChange).to.equal(stakeAmount.toNumber());
            } catch (e: any) {
                console.error("Error staking tokens:", e);
                if (e.logs) {
                    console.log("Error logs:", e.logs);
                }
                throw e;
            }
        });

        it("Stakes native SOL", async () => {
            console.log("Testing native SOL staking...");

            // Get initial balances
            const initialUserSol = await program.provider.connection.getBalance(user.publicKey);
            const initialProgramSol = await program.provider.connection.getBalance(solAccountPda);

            console.log("Initial user SOL balance:", initialUserSol / LAMPORTS_PER_SOL, "SOL");
            console.log("Initial program SOL balance:", initialProgramSol / LAMPORTS_PER_SOL, "SOL");

            // Stake amount
            const solStakeAmount = new BN(1.5 * LAMPORTS_PER_SOL); // 1.5 SOL

            try {
                // Wrapped SOL mint
                const wrappedSolMint = new PublicKey("So11111111111111111111111111111111111111112");

                // Call the stake_native instruction
                const tx = await program.methods
                    .stakeNative(solStakeAmount)
                    .accounts({
                        state: statePda,
                        wrappedSolMint: wrappedSolMint,
                        programSolAccount: solAccountPda,
                        user: user.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([user])
                    .rpc();

                console.log("SOL stake successful! Transaction signature:", tx);

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

                // Verify the stake worked correctly
                // User pays transaction fees so the decrease will be more than the stake amount
                assert.isAtLeast(userSolDiff, solStakeAmount.toNumber(),
                    "User SOL decrease is less than stake amount");
                assert.equal(programSolDiff, solStakeAmount.toNumber(),
                    "Program SOL increase doesn't match stake amount");

            } catch (e: any) {
                console.error("Error during SOL staking:", e);
                throw e;
            }
        });
    });
}