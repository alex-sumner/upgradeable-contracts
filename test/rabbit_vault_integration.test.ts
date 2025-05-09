import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { Vault7540, RabbitU, USDR } from "../typechain-types";

describe("RabbitX and Vault Integration Tests", function () {
  let vault: Vault7540;
  let rabbitExchange: RabbitU;
  let usdc: USDR;
  let assetToken: string;

  let owner: SignerWithAddress;
  let trader: SignerWithAddress;
  let navUpdater: SignerWithAddress;
  let timelock: SignerWithAddress;
  let user1: SignerWithAddress;
  let signer: SignerWithAddress;

  const ONE_USDC = ethers.parseUnits("1", 6);
  const TEN_USDC = ethers.parseUnits("10", 6);
  const HUNDRED_USDC = ethers.parseUnits("100", 6);
  const INITIAL_SHARE_PRICE = ONE_USDC;

  // Fee rates in basis points (1% = 100)
  const ENTRY_FEE_RATE = 50; // 0.5%
  const EXIT_FEE_RATE = 30;  // 0.3%

  // Request status enum values (must match the contract enum)
  enum RequestStatus { Pending, Claimable, Claimed, Cancelled }

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    owner = signers[0];
    trader = signers[1];
    navUpdater = signers[2];
    timelock = signers[3];
    user1 = signers[4];
    signer = signers[5];

    // Deploy USDC token
    const USDRc = await ethers.getContractFactory("USDR");
    usdc = await USDRc.deploy();
    assetToken = await usdc.getAddress();

    // Deploy RabbitX Exchange
    const RabbitUc = await ethers.getContractFactory("RabbitU");
    rabbitExchange = await upgrades.deployProxy(
      RabbitUc,
      [
        await timelock.getAddress(),
        await owner.getAddress(),
        await signer.getAddress(),
        assetToken,
        ONE_USDC, // Min deposit
        [], // Other tokens
        [] // Min deposits for other tokens
      ],
      {
        initializer: 'initialize',
        kind: 'uups'
      }
    ) as RabbitU;

    // Deploy Vault
    const Vault7540c = await ethers.getContractFactory("Vault7540");
    vault = await upgrades.deployProxy(
      Vault7540c,
      [
        await timelock.getAddress(),
        await owner.getAddress(),
        await rabbitExchange.getAddress(), // rabbitx address
        assetToken,
        ENTRY_FEE_RATE,
        EXIT_FEE_RATE,
        "Rabbit Vault Token",
        "RVT"
      ],
      {
        initializer: 'initialize',
        kind: 'uups'
      }
    ) as Vault7540;

    // Set up roles
    await vault.connect(owner).addNavUpdater(await navUpdater.getAddress());
    await vault.connect(owner).addTrader(await trader.getAddress());

    // Authorize vault in RabbitX
    await rabbitExchange.connect(timelock).authorizeVault(await vault.getAddress());

    // Mint USDC to users and RabbitX for testing
    await usdc.mint(await user1.getAddress(), HUNDRED_USDC);
    await usdc.mint(await rabbitExchange.getAddress(), ethers.parseUnits("1000", 6));
  });

  it("should verify vault is authorized in RabbitX", async function () {
    expect(await rabbitExchange.authorizedVaults(await vault.getAddress())).to.be.true;
  });

  it("should allow timelock to authorize and revoke vaults", async function () {
    const randomAddress = ethers.Wallet.createRandom().address;
    
    // Initially not authorized
    expect(await rabbitExchange.authorizedVaults(randomAddress)).to.be.false;
    
    // Authorize
    await expect(rabbitExchange.connect(timelock).authorizeVault(randomAddress))
      .to.emit(rabbitExchange, "AuthorizeVault")
      .withArgs(randomAddress);
    
    // Verify authorization
    expect(await rabbitExchange.authorizedVaults(randomAddress)).to.be.true;
    
    // Revoke
    await expect(rabbitExchange.connect(timelock).revokeVault(randomAddress))
      .to.emit(rabbitExchange, "RevokeVault")
      .withArgs(randomAddress);
    
    // Verify revocation
    expect(await rabbitExchange.authorizedVaults(randomAddress)).to.be.false;
  });

  it("should not allow non-timelock to authorize vaults", async function () {
    const randomAddress = ethers.Wallet.createRandom().address;
    
    await expect(
      rabbitExchange.connect(owner).authorizeVault(randomAddress)
    ).to.be.revertedWith("ONLY_TIMELOCK");
  });

  it("should complete the full withdrawal process between vault and RabbitX", async function () {
    // 1. First, create and process a deposit to get shares
    await usdc.connect(user1).approve(await vault.getAddress(), TEN_USDC);
    await vault.connect(user1).requestDeposit(TEN_USDC, await user1.getAddress(), await user1.getAddress());
    
    // Get deposit request ID
    const depositRequests = await vault.getControllerDepositRequests(await user1.getAddress());
    const depositRequestId = depositRequests[0];
    
    // 2. Process the deposit - assets will move to RabbitX
    await vault.connect(owner).processDeposit(depositRequestId);
    
    // 3. Claim the deposit
    await vault.connect(user1)["deposit(uint256,address,address)"](
      TEN_USDC, 
      await user1.getAddress(), 
      await user1.getAddress()
    );
    
    // 4. Get user's shares
    const userShares = await vault.balanceOf(await user1.getAddress());
    expect(userShares).to.be.gt(0);
    
    // 5. Request redemption
    await vault.connect(user1).requestRedeem(
      userShares, 
      await user1.getAddress(), 
      await user1.getAddress(), 
      await user1.getAddress()
    );
    
    // 6. Get redeem request ID
    const redeemRequests = await vault.getControllerRedeemRequests(await user1.getAddress());
    const redeemRequestId = redeemRequests[0];
    
    // 7. Check vault and RabbitX balances before processing redeem
    const vaultBalanceBefore = await usdc.balanceOf(await vault.getAddress());
    const rabbitXBalanceBefore = await usdc.balanceOf(await rabbitExchange.getAddress());
    
    // 8. Process the redemption - this should call requestAssetsFromRabbitX internally
    await vault.connect(owner).processRedeem(redeemRequestId);
    
    // 9. Check that assets were transferred from RabbitX to vault
    const vaultBalanceAfter = await usdc.balanceOf(await vault.getAddress());
    const rabbitXBalanceAfter = await usdc.balanceOf(await rabbitExchange.getAddress());
    
    // Balance changes should reflect the withdrawal
    expect(vaultBalanceAfter).to.be.gt(vaultBalanceBefore);
    expect(rabbitXBalanceAfter).to.be.lt(rabbitXBalanceBefore);
    
    // 10. Claim the withdrawal
    await vault.connect(user1)["withdraw(uint256,address,address,address)"](
      0n, 
      await user1.getAddress(), 
      await user1.getAddress(),
      await user1.getAddress()
    );
    
    // 11. User should have received assets back and have no shares
    expect(await vault.balanceOf(await user1.getAddress())).to.equal(0);
    // User should have received slightly less than their original deposit (after fees)
    expect(await usdc.balanceOf(await user1.getAddress())).to.be.lt(HUNDRED_USDC);
    expect(await usdc.balanceOf(await user1.getAddress())).to.be.gt(HUNDRED_USDC - TEN_USDC * 15n / 1000n); // Less than 1.5% fees total
  });

  it("should not allow unauthorized vaults to withdraw from RabbitX", async function () {
    // Create a new vault that isn't authorized
    const Vault7540c = await ethers.getContractFactory("Vault7540");
    const unauthorizedVault = await upgrades.deployProxy(
      Vault7540c,
      [
        await timelock.getAddress(),
        await owner.getAddress(),
        await rabbitExchange.getAddress(),
        assetToken,
        ENTRY_FEE_RATE,
        EXIT_FEE_RATE,
        "Unauthorized Vault",
        "UVT"
      ],
      {
        initializer: 'initialize',
        kind: 'uups'
      }
    );

    // Try to call withdrawToVault directly - should fail
    await expect(
      rabbitExchange.connect(unauthorizedVault.runner).withdrawToVault(
        assetToken,
        TEN_USDC,
        await unauthorizedVault.getAddress()
      )
    ).to.be.revertedWith("NOT_AUTHORIZED_VAULT");
  });
});