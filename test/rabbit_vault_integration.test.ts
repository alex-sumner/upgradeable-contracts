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

  const ZERO = ethers.parseUnits("0", 6);
  const ONE_USDC = ethers.parseUnits("1", 6);
  const FIVE_USDC = ethers.parseUnits("5", 6);
  const TEN_USDC = ethers.parseUnits("10", 6);
  const TEN_SHARES = ethers.parseUnits("10", 18);
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

  it("should process deposits and redeems with sufficient age via updateNav", async function () {

    const initialTokenBalance = await usdc.balanceOf(await user1.getAddress());
    // Step 1: Create a deposit request that will be processed via updateNav
    await usdc.connect(user1).approve(await vault.getAddress(), TEN_USDC);
    await vault.connect(user1).requestDeposit(
      TEN_USDC,
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get deposit request ID
    const depositRequests = await vault.getControllerDepositRequests(await user1.getAddress());
    const depositRequestId = depositRequests[0];

    // Verify deposit is in pending status
    const depositRequest = await vault.getDepositRequest(depositRequestId);
    expect(depositRequest.status).to.equal(0); // Status is Pending

    // Step 2: Process the deposit by calling updateNav which should process pending deposits
    await vault.connect(navUpdater).updateNav(ZERO, ZERO);


    // Check that the deposit was processed and is now claimable
    const depositRequestAfter = await vault.getDepositRequest(depositRequestId);
    expect(depositRequestAfter.status).to.equal(1); // Status is Claimable

    const preClaimTokenBalance = await usdc.balanceOf(await user1.getAddress());
    expect(preClaimTokenBalance).to.equal(initialTokenBalance - ethers.parseUnits("10", 6)); // initial balance minus 10 USDC staked

    // Step 3: Claim the deposit
    await vault.connect(user1)["deposit(uint256,address,address)"](
      0n, // Not used in the contract but required for the interface
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get user's shares
    const userShares = await vault.balanceOf(await user1.getAddress());
    expect(userShares).to.be.closeTo(ethers.parseUnits("9.95", 18), ethers.parseUnits("0.01", 18));

    // First, get current redemption delay
    const redeemDelay = await vault.redeemDelay();

    // Step 5: Request redemption
    await vault.connect(user1).requestRedeem(
      userShares,
      await user1.getAddress(),
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get redeem request ID
    const redeemRequests = await vault.getControllerRedeemRequests(await user1.getAddress());
    const redeemRequestId = redeemRequests[0];

    // Advance time to meet the redeem delay requirement
    await ethers.provider.send("evm_increaseTime", [Number(redeemDelay) + 1]);
    await ethers.provider.send("evm_mine");

    // Verify redeem delay is now met
    const isDelayMet = await vault.isRedeemRequestDelayMet(redeemRequestId);
    expect(isDelayMet).to.be.true;

    // Check redeem is in pending status
    const redeemRequest = await vault.getRedeemRequest(redeemRequestId);
    expect(redeemRequest.status).to.equal(0); // Status is Pending

    const nav = await vault.nav();
    const globalSupply = await vault.globalSupply();
    // Step 6: Process the redeem by calling updateNav
    await vault.connect(navUpdater).updateNav(
      nav + FIVE_USDC, // increase nav by 5 usdc as if we made a profit
      globalSupply // Keep global supply constant as it only changes when deposits/redeems are processed
    );

    // Check that the redeem was processed and is now claimable
    const redeemRequestAfter = await vault.getRedeemRequest(redeemRequestId);
    expect(redeemRequestAfter.status).to.equal(1); // Status is Claimable


    // Step 7: Claim the withdrawal
    await vault.connect(user1)["withdraw(uint256,address,address,address)"](
      0n, // Not used in the contract but required for the interface
      await user1.getAddress(),
      await user1.getAddress(),
      await user1.getAddress()
    );

    // User should have no shares left
    const finalShareBalance = await vault.balanceOf(await user1.getAddress());
    expect(finalShareBalance).to.equal(0);

    // User should have received assets back (minus fees)
    const userFinalTokenBalance = await usdc.balanceOf(await user1.getAddress());
    expect(userFinalTokenBalance).to.be.closeTo(preClaimTokenBalance + ethers.parseUnits("14.9", 6), ethers.parseUnits("0.1", 6)); // what they already had plus 15 USDC minus 0.5% fee
  });

  it("should not process redeems with insufficient age via updateNav", async function () {
    // Initial NAV update to set baseline values
    await vault.connect(navUpdater).updateNav(ZERO, ZERO);

    // Step 1: Create a deposit request and process it via updateNav
    await usdc.connect(user1).approve(await vault.getAddress(), TEN_USDC);
    await vault.connect(user1).requestDeposit(
      TEN_USDC,
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Process the deposit and claim it
    await vault.connect(navUpdater).updateNav(ZERO, ZERO);

    // Claim the deposit
    const depositRequests = await vault.getControllerDepositRequests(await user1.getAddress());
    await vault.connect(user1)["deposit(uint256,address,address)"](
      0n, // Not used in the actual contract
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get user's shares
    const userShares = await vault.balanceOf(await user1.getAddress());

    // Step 2: Request redemption (without enough time passing to meet delay)
    await vault.connect(user1).requestRedeem(
      userShares,
      await user1.getAddress(),
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get redeem request ID
    const redeemRequests = await vault.getControllerRedeemRequests(await user1.getAddress());
    const redeemRequestId = redeemRequests[0];

    // Verify redeem delay is NOT met (no time advancement)
    expect(await vault.isRedeemRequestDelayMet(redeemRequestId)).to.be.false;

    // Step 3: Call updateNav - the redeem should NOT be processed as it's too young
    await vault.connect(navUpdater).updateNav(TEN_USDC, userShares);

    // Check that the redeem is still pending
    const redeemRequestAfter = await vault.getRedeemRequest(redeemRequestId);
    expect(redeemRequestAfter.status).to.equal(0); // Status is still Pending

    // Step 4: Advance time to meet the redeem delay
    const redeemDelay = await vault.redeemDelay();
    await ethers.provider.send("evm_increaseTime", [Number(redeemDelay) + 1]);
    await ethers.provider.send("evm_mine");

    // Verify redeem delay is now met
    expect(await vault.isRedeemRequestDelayMet(redeemRequestId)).to.be.true;

    // Step 5: Call updateNav again - now the redeem should be processed
    await vault.connect(navUpdater).updateNav(TEN_USDC, userShares);

    // Check that the redeem was now processed and is claimable
    const redeemRequestFinal = await vault.getRedeemRequest(redeemRequestId);
    expect(redeemRequestFinal.status).to.equal(1); // Status is now Claimable
  });

  it("should process deposits made before updateNav and after previous updateNav", async function () {
    // Initial NAV update to set baseline values
    await vault.connect(navUpdater).updateNav(ZERO, ZERO);

    // Step 1: Create first deposit request
    await usdc.connect(user1).approve(await vault.getAddress(), TEN_USDC * 2n);
    await vault.connect(user1).requestDeposit(
      TEN_USDC,
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get first deposit request ID
    const depositRequests1 = await vault.getControllerDepositRequests(await user1.getAddress());
    const depositRequestId1 = depositRequests1[0];

    // Step 2: Call updateNav - this should process the first deposit
    await vault.connect(navUpdater).updateNav(ZERO, ZERO);

    // Verify first deposit is now claimable
    const depositRequest1After = await vault.getDepositRequest(depositRequestId1);
    expect(depositRequest1After.status).to.equal(1); // Status is Claimable

    const userPreRedeemTokenBalance = await usdc.balanceOf(await user1.getAddress());
    // Step 3: Create second deposit request
    await vault.connect(user1).requestDeposit(
      TEN_USDC,
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get second deposit request ID
    const depositRequests2 = await vault.getControllerDepositRequests(await user1.getAddress());
    const depositRequestId2 = depositRequests2[1]; // Second request

    // Step 4: Call updateNav again - this should process the second deposit
    await vault.connect(navUpdater).updateNav(TEN_USDC, TEN_SHARES);

    // Verify second deposit is now claimable
    const depositRequest2After = await vault.getDepositRequest(depositRequestId2);
    expect(depositRequest2After.status).to.equal(1); // Status is Claimable

    // Step 5: Claim both deposits
    await vault.connect(user1)["deposit(uint256,address,address)"](
      0n, // Not used in the actual implementation
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Claim second deposit
    await vault.connect(user1)["deposit(uint256,address,address)"](
      0n, // Not used in the actual implementation
      await user1.getAddress(),
      await user1.getAddress()
    );

    // User should have appropriate shares
    expect(await vault.balanceOf(await user1.getAddress())).to.be.gt(0);
  });

  it("should process deposits made after updateNav in subsequent updateNav call", async function () {
    // Initial NAV update
    await vault.connect(navUpdater).updateNav(ZERO, ZERO);

    // Step 1: Create a redeem request that won't be ready yet
    // First need to deposit and claim to get shares
    await usdc.connect(user1).approve(await vault.getAddress(), TEN_USDC * 3n);
    await vault.connect(user1).requestDeposit(
      TEN_USDC,
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Process and claim first deposit
    await vault.connect(navUpdater).updateNav(ZERO, ZERO);
    await vault.connect(user1)["deposit(uint256,address,address)"](
      0n, // Not used in the actual implementation
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get user shares
    const userShares = await vault.balanceOf(await user1.getAddress());
    const halfShares = userShares / 2n;

    // Create redeem request for half the shares
    await vault.connect(user1).requestRedeem(
      halfShares,
      await user1.getAddress(),
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Note: redeem request is too young to process
    const redeemRequests = await vault.getControllerRedeemRequests(await user1.getAddress());
    const redeemRequestId = redeemRequests[0];
    expect(await vault.isRedeemRequestDelayMet(redeemRequestId)).to.be.false;

    // Step 2: Call updateNav - redeem won't be processed because it's too young
    await vault.connect(navUpdater).updateNav(TEN_USDC, TEN_SHARES);

    // Verify redeem is still pending
    const redeemRequestAfter = await vault.getRedeemRequest(redeemRequestId);
    expect(redeemRequestAfter.status).to.equal(0); // Status is Pending

    // Step 3: Create a new deposit request
    await vault.connect(user1).requestDeposit(
      TEN_USDC,
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Get second deposit request ID
    const depositRequests = await vault.getControllerDepositRequests(await user1.getAddress());
    const depositRequestId = depositRequests[1]; // Second deposit

    // Step 4: Advance time to meet redeem delay
    const redeemDelay = await vault.redeemDelay();
    await ethers.provider.send("evm_increaseTime", [Number(redeemDelay) + 1]);
    await ethers.provider.send("evm_mine");

    // Verify redeem delay is now met
    expect(await vault.isRedeemRequestDelayMet(redeemRequestId)).to.be.true;

    // Step 5: Call updateNav again - this should process both the redeem and the deposit
    await vault.connect(navUpdater).updateNav(TEN_USDC, TEN_SHARES);

    // Verify both requests are now claimable
    const redeemRequestFinal = await vault.getRedeemRequest(redeemRequestId);
    expect(redeemRequestFinal.status).to.equal(1); // Status is Claimable

    const depositRequestFinal = await vault.getDepositRequest(depositRequestId);
    expect(depositRequestFinal.status).to.equal(1); // Status is Claimable

    // Step 6: Claim both transactions
    await vault.connect(user1)["withdraw(uint256,address,address,address)"](
      0n, // Not used in the actual implementation
      await user1.getAddress(),
      await user1.getAddress(),
      await user1.getAddress()
    );

    await vault.connect(user1)["deposit(uint256,address,address)"](
      0n, // Not used in the actual implementation
      await user1.getAddress(),
      await user1.getAddress()
    );

    // Verify final balances
    expect(await vault.balanceOf(await user1.getAddress())).to.be.gt(halfShares);
  });
});