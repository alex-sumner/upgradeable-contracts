import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { RabbitU, USDR } from "../typechain-types";
import { parseEther } from "ethers";

describe("RabbitU Deposits", function () {
    let rabbit: RabbitU;
    let token: USDR;
    let owner: SignerWithAddress;
    let timelock: SignerWithAddress;
    let signer: SignerWithAddress;
    let trader: SignerWithAddress;
    let user1: SignerWithAddress;
    let defaultToken: string;

    beforeEach(async function () {
        [owner, trader, signer, timelock, user1] = await ethers.getSigners();

        // Deploy mock token
        const USDRc = await ethers.getContractFactory("USDR");
        token = (await USDRc.deploy()) as USDR;
        defaultToken = await token.getAddress();

        // Deploy upgradeable RabbitU
        const RabbitUc = await ethers.getContractFactory("RabbitU");
        const _minDeposit = parseEther("0.05");
        const _otherTokens: string[] = [];
        const _minDeposits: bigint[] = [];

        rabbit = (await upgrades.deployProxy(
            RabbitUc,
            [
                await timelock.getAddress(),
                await owner.getAddress(),
                await signer.getAddress(),
                defaultToken,
                _minDeposit,
                _otherTokens,
                _minDeposits
            ],
            { initializer: 'initialize', kind: 'uups' }
        )) as unknown as RabbitU;

        // Mint tokens to trader for testing
        await token.mint(await trader.getAddress(), parseEther("10"));
    });

    describe("Deposits", function () {
        it("should allow deposits with default token", async function () {
            const amount = parseEther("0.1");
            await token.connect(trader).approve(await rabbit.getAddress(), amount);

            const traderAddress = await trader.getAddress();
            
            // The event ID format is prefix + deposit number + suffix
            // The actual contract uses CONTRACT_SUFFIX = "_rbx_s"
            await expect(rabbit.connect(trader).deposit(amount))
                .to.emit(rabbit, "Deposit")
                .withArgs("d_1000_rbx_s", traderAddress, amount, defaultToken);

            expect(await token.balanceOf(await rabbit.getAddress())).to.equal(amount);
        });

        it("should allow deposits with specific token", async function () {
            const amount = parseEther("0.1");
            await token.connect(trader).approve(await rabbit.getAddress(), amount);

            const traderAddress = await trader.getAddress();
            
            await expect(rabbit.connect(trader).depositToken(amount, defaultToken))
                .to.emit(rabbit, "Deposit")
                .withArgs("d_1000_rbx_s", traderAddress, amount, defaultToken);

            expect(await token.balanceOf(await rabbit.getAddress())).to.equal(amount);
        });

        it("should revert when depositing unsupported token", async function () {
            const amount = parseEther("0.1");
            const user1Address = await user1.getAddress();
            
            await expect(
                rabbit.connect(trader).depositToken(amount, user1Address)
            ).to.be.revertedWith("UNSUPPORTED_TOKEN");
        });

        it("should revert when deposit amount is too small", async function () {
            const smallAmount = parseEther("0.01");
            await token.connect(trader).approve(await rabbit.getAddress(), smallAmount);

            await expect(
                rabbit.connect(trader).deposit(smallAmount)
            ).to.be.revertedWith("AMOUNT_TOO_SMALL");
        });

        it("should handle native token deposits", async function () {
            const amount = parseEther("0.1");
            await rabbit.connect(owner).supportToken(ethers.ZeroAddress, parseEther("0.05"));

            const traderAddress = await trader.getAddress();
            
            await expect(
                rabbit.connect(trader).depositNative({ value: amount })
            ).to.emit(rabbit, "Deposit")
                .withArgs("d_1000_rbx_s", traderAddress, amount, ethers.ZeroAddress);

            expect(await ethers.provider.getBalance(await rabbit.getAddress()))
                .to.equal(amount);
        });

        it("should handle native token via receive function", async function () {
            const amount = parseEther("0.1");
            await rabbit.connect(owner).supportToken(ethers.ZeroAddress, parseEther("0.05"));

            const traderAddress = await trader.getAddress();
            const rabbitAddress = await rabbit.getAddress();
            
            await expect(
                trader.sendTransaction({
                    to: rabbitAddress,
                    value: amount
                })
            ).to.emit(rabbit, "Deposit")
                .withArgs("d_1000_rbx_s", traderAddress, amount, ethers.ZeroAddress);
        });
    });

    describe("Token Management", function () {
        it("should allow owner to support token", async function () {
            const newToken = await user1.getAddress();
            const minDeposit = parseEther("0.1");

            await expect(rabbit.connect(owner).supportToken(newToken, minDeposit))
                .to.emit(rabbit, "SupportToken")
                .withArgs(newToken, minDeposit);

            expect(await rabbit.supportedTokens(newToken)).to.be.true;
            expect(await rabbit.minDeposits(newToken)).to.equal(minDeposit);
        });

        it("should allow owner to unsupport token", async function () {
            await expect(rabbit.connect(owner).unsupportToken(defaultToken))
                .to.emit(rabbit, "UnsupportToken")
                .withArgs(defaultToken);

            expect(await rabbit.supportedTokens(defaultToken)).to.be.false;
        });

        it("should revert when non-owner tries to support token", async function () {
            const user1Address = await user1.getAddress();
            const traderAddress = await trader.getAddress();
            
            await expect(
                rabbit.connect(trader).supportToken(user1Address, parseEther("0.1"))
            ).to.be.revertedWithCustomError(rabbit, "OwnableUnauthorizedAccount")
                .withArgs(traderAddress);
        });

        it("should revert when non-owner tries to unsupport token", async function () {
            const traderAddress = await trader.getAddress();
            
            await expect(
                rabbit.connect(trader).unsupportToken(defaultToken)
            ).to.be.revertedWithCustomError(rabbit, "OwnableUnauthorizedAccount")
                .withArgs(traderAddress);
        });
    });

    describe("Ownership and Access Control", function () {
        it("should allow timelock to transfer ownership", async function () {
            const newOwner = await user1.getAddress();
            const ownerAddress = await owner.getAddress();
            
            await expect(rabbit.connect(timelock).transferOwnership(newOwner))
                .to.emit(rabbit, "OwnershipTransferred")
                .withArgs(ownerAddress, newOwner);

            expect(await rabbit.owner()).to.equal(newOwner);
        });

        it("should revert when non-timelock tries to transfer ownership", async function () {
            const user1Address = await user1.getAddress();
            
            await expect(
                rabbit.connect(owner).transferOwnership(user1Address)
            ).to.be.revertedWith("ONLY_TIMELOCK");
        });

        it("should revert when transferring ownership to zero address", async function () {
            await expect(
                rabbit.connect(timelock).transferOwnership(ethers.ZeroAddress)
            ).to.be.revertedWith("ZERO_OWNER");
        });
    });
}); 