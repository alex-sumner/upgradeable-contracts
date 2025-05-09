import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { RabbitU, USDR } from "../typechain-types";
import { parseEther } from "ethers";

describe("WithdrawSigning", function () {
    let rabbit: RabbitU;
    let token: USDR;
    let owner: SignerWithAddress;
    let timelock: SignerWithAddress;
    let signer: SignerWithAddress;
    let trader: SignerWithAddress;


    beforeEach(async function () {
        // Get signers
        [owner, trader, signer, timelock] = await ethers.getSigners();

        // Deploy mock token
        const USDRc = await ethers.getContractFactory("USDR");
        token = (await USDRc.deploy()) as USDR;

        // Define initialization parameters
        const _timelock = await owner.getAddress(); // Assign a timelock address (can be another signer)
        const _owner = await owner.getAddress();
        const _signer = await signer.getAddress();
        const _defaultToken = await token.getAddress();
        const _minDeposit = parseEther("10"); // Example minimum deposit
        const _otherTokens: string[] = []; // Add other token addresses if needed
        const _minDeposits: bigint[] = []; // Corresponding minimum deposits for other tokens

        // Deploy upgradeable RabbitU with all required arguments
        const RabbitUc = await ethers.getContractFactory("RabbitU");
        rabbit = (await upgrades.deployProxy(
            RabbitUc,
            [
                _timelock,
                _owner,
                _signer,
                _defaultToken,
                _minDeposit,
                _otherTokens,
                _minDeposits
            ],
            { initializer: 'initialize' }
        )) as unknown as RabbitU;

        // Fund contract with tokens
        const rabbitAddress = await rabbit.getAddress();
        await token.mint(rabbitAddress, parseEther("1000"));
    });

    it("should allow withdrawal with valid signature", async function () {
        const id = 1;
        const amount = parseEther("100");

        // Create signature
        const domain = {
            name: "RabbitXWithdrawal",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await rabbit.getAddress()
        };

        const types = {
            withdrawal: [
                { name: "id", type: "uint256" },
                { name: "trader", type: "address" },
                { name: "amount", type: "uint256" }
            ]
        };

        const value = {
            id: id,
            trader: await trader.getAddress(),
            amount: amount
        };

        // Sign with authorized signer
        const signature = await signer.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);

        // Check initial balances
        const initialBalance = await token.balanceOf(await trader.getAddress());

        // Execute withdrawal
        await rabbit.withdraw(
            id,
            await trader.getAddress(),
            amount,
            v,
            r,
            s
        );

        // Verify balance changes
        expect(await token.balanceOf(await trader.getAddress()))
            .to.equal(initialBalance + amount);
    });

    it("should revert with invalid signature", async function () {
        const id = 1;
        const amount = parseEther("100");

        // Create signature with wrong signer
        const domain = {
            name: "RabbitXWithdrawal",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await rabbit.getAddress()
        };

        const types = {
            withdrawal: [
                { name: "id", type: "uint256" },
                { name: "trader", type: "address" },
                { name: "amount", type: "uint256" }
            ]
        };

        const value = {
            id: id,
            trader: await trader.getAddress(),
            amount: amount
        };

        // Sign with unauthorized signer (owner)
        const signature = await owner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);

        // Attempt withdrawal with invalid signature
        await expect(
            rabbit.withdraw(
                id,
                await trader.getAddress(),
                amount,
                v,
                r,
                s
            )
        ).to.be.revertedWith("INVALID_SIGNATURE");
    });

    it("should revert with used withdrawal id", async function () {
        const id = 1;
        const amount = parseEther("100");

        const domain = {
            name: "RabbitXWithdrawal",
            version: "1",
            chainId: (await ethers.provider.getNetwork()).chainId,
            verifyingContract: await rabbit.getAddress()
        };

        const types = {
            withdrawal: [
                { name: "id", type: "uint256" },
                { name: "trader", type: "address" },
                { name: "amount", type: "uint256" }
            ]
        };

        const value = {
            id: id,
            trader: await trader.getAddress(),
            amount: amount
        };

        const signature = await signer.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);

        // First withdrawal should succeed
        await rabbit.withdraw(
            id,
            await trader.getAddress(),
            amount,
            v,
            r,
            s
        );

        // Second withdrawal with same id should fail
        await expect(
            rabbit.withdraw(
                id,
                await trader.getAddress(),
                amount,
                v,
                r,
                s
            )
        ).to.be.revertedWith("ALREADY_PROCESSED");
    });

    it("should allow owner to change signer", async function () {
        const newSigner = trader; // Using trader as new signer for this test

        await rabbit.connect(owner).changeSigner(await newSigner.getAddress());

        expect(await rabbit.external_signer()).to.equal(await newSigner.getAddress());
    });

    it("should revert when non-owner tries to change signer", async function () {
        await expect(
            rabbit.connect(trader).changeSigner(await trader.getAddress())
        ).to.be.revertedWith("ONLY_TIMELOCK");
    });
});