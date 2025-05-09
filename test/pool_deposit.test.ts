import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  PoolDepositU, 
  RabbitU, 
  USDR,
  PoolDepositU__factory,
  RabbitU__factory,
  USDR__factory
} from "../typechain-types";
import { parseEther } from "ethers";

describe("PoolDepositU", function () {
  let pool: PoolDepositU;
  let rabbit: RabbitU;
  let token: USDR;
  let defaultToken: string;
  
  let owner: SignerWithAddress;
  let trader: SignerWithAddress;
  let signer: SignerWithAddress;
  let timelock: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;
  
  const twoEth = ethers.parseEther("2");

  beforeEach(async function () {
    [owner, trader, signer, timelock, user1, user2, user3] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("USDR") as USDR__factory;
    token = await TokenFactory.deploy();
    const _timelock = await timelock.getAddress(); // Use the actual timelock signer
    const _owner = await owner.getAddress();
    const _signer = await signer.getAddress();
    defaultToken = await token.getAddress();
    const _minDeposit = parseEther("0.05"); // Example minimum deposit
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
        defaultToken,
        _minDeposit,
        _otherTokens,
        _minDeposits
      ],
      { initializer: 'initialize' }
    )) as unknown as RabbitU;

    const PoolFactory = await ethers.getContractFactory("PoolDepositU") as PoolDepositU__factory;
    pool = await upgrades.deployProxy(
      PoolFactory,
      [
        _timelock,
        _owner,
        await rabbit.getAddress(),
        defaultToken,
        _minDeposit,
        _otherTokens,
        _minDeposits
      ],
      { initializer: 'initialize' }
    ) as unknown as PoolDepositU;

    // Mint tokens to user1
    await token.mint(await user1.getAddress(), twoEth);
  });

  describe("Individual Deposits", function () {
    it("should allow individual deposits", async function () {
      const amount = ethers.parseEther("0.4");
      
      // Transfer tokens to a test user
      await token.connect(user1).approve(await pool.getAddress(), amount * 2n);
      
      const user2Address = await user2.getAddress();
      
      // First deposit
      await expect(pool.connect(user1).individualDeposit(user2Address, amount))
        .to.emit(pool, "Deposit")
        .withArgs("d_1_rbxp_s", user2Address, amount, defaultToken, 0);
      
      expect(await token.balanceOf(await rabbit.getAddress())).to.equal(amount);

      // Second deposit
      await expect(pool.connect(user1).individualDeposit(user2Address, amount))
        .to.emit(pool, "Deposit")
        .withArgs("d_2_rbxp_s", user2Address, amount, defaultToken, 0);
      
      expect(await token.balanceOf(await rabbit.getAddress())).to.equal(amount * 2n);
    });

    it("should revert on zero amount deposit", async function () {
      const user2Address = await user2.getAddress();
      await expect(
        pool.individualDeposit(user2Address, 0)
      ).to.be.revertedWith("AMOUNT_TOO_SMALL");
    });

    it("should revert when user has insufficient funds", async function () {
      const amount = ethers.parseEther("10");
      const user1Address = await user1.getAddress();
      await expect(
        pool.connect(user2).individualDeposit(user1Address, amount)
      ).to.be.revertedWith("TRANSFER_FAILED");
    });
  });

  describe("Pooled Deposits", function () {
    it("should allow pooled deposits", async function () {
      const amount1 = ethers.parseEther("0.1");
      const amount2 = ethers.parseEther("0.2");
      const amount3 = ethers.parseEther("0.3");
      const totalAmount = amount1 + amount2 + amount3;

      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      const user3Address = await user3.getAddress();
      
      const contributions = [
        { contributor: user1Address, amount: amount1 },
        { contributor: user2Address, amount: amount2 },
        { contributor: user3Address, amount: amount3 }
      ];

      await token.connect(user1).approve(await pool.getAddress(), totalAmount * 2n);
      // First pooled deposit
      await expect(pool.connect(user1).pooledDeposit(contributions))
        .to.emit(pool, "PooledDeposit")
        .withArgs(10000, totalAmount, defaultToken);

      expect(await token.balanceOf(await rabbit.getAddress())).to.equal(totalAmount);

      // Second pooled deposit
      await expect(pool.connect(user1).pooledDeposit(contributions))
        .to.emit(pool, "PooledDeposit")
        .withArgs(10001, totalAmount, defaultToken);

      expect(await token.balanceOf(await rabbit.getAddress())).to.equal(totalAmount * 2n);
    });

    it("should revert on zero amount pooled deposit", async function () {
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      const user3Address = await user3.getAddress();
      
      const contributions = [
        { contributor: user1Address, amount: 0n },
        { contributor: user2Address, amount: 0n },
        { contributor: user3Address, amount: 0n }
      ];

      await expect(
        pool.pooledDeposit(contributions)
      ).to.be.revertedWith("WRONG_AMOUNT");
    });
  });

  describe("Admin Functions", function () {
    it("should allow timelock to set rabbit contract", async function () {
      const newRabbit = await user1.getAddress();
      await expect(pool.connect(timelock).setRabbit(newRabbit))
        .to.not.be.reverted;
      expect(await pool.rabbit()).to.equal(newRabbit);
    });

    it("should revert when non-timelock tries to set rabbit contract", async function () {
      const newRabbit = await user1.getAddress();
      const user1Address = await user1.getAddress();
      await expect(
        pool.connect(user1).setRabbit(newRabbit)
      ).to.be.revertedWith("ONLY_TIMELOCK");
    });

    it("should allow owner to withdraw tokens", async function () {
      const amount = ethers.parseEther("0.1");
      const receiver = await user2.getAddress();

      // Transfer tokens to pool
      await token.connect(user1).transfer(await pool.getAddress(), amount);
      
      expect(await token.balanceOf(await pool.getAddress())).to.equal(amount);
      expect(await token.balanceOf(receiver)).to.equal(0);

      await pool.connect(owner).withdrawTokensTo(receiver, amount, await token.getAddress());

      expect(await token.balanceOf(await pool.getAddress())).to.equal(0);
      expect(await token.balanceOf(receiver)).to.equal(amount);
    });

    it("should revert when non-owner tries to withdraw tokens", async function () {
      const amount = ethers.parseEther("0.1");
      const user1Address = await user1.getAddress();
      const user2Address = await user2.getAddress();
      
      await expect(
        pool.connect(user1).withdrawTokensTo(user2Address, amount, await token.getAddress())
      ).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount")
      .withArgs(user1Address);
    });
  });
}); 