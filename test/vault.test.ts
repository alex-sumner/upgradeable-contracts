import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  VaultU, 
  RabbitU, 
  USDR,
  VaultU__factory,
  RabbitU__factory,
  USDR__factory
} from "../typechain-types";
import { parseEther } from "ethers";

describe("VaultU", function () {
  let vault: VaultU;
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
  
  const oneEth = ethers.parseEther("1");
  const minStake = ethers.parseEther("0.05");

  beforeEach(async function () {
    [owner, trader, signer, timelock, user1, user2, user3] = await ethers.getSigners();

    // Deploy token
    const TokenFactory = await ethers.getContractFactory("USDR") as USDR__factory;
    token = await TokenFactory.deploy();
    defaultToken = await token.getAddress();

    // Deploy RabbitU
    const RabbitFactory = await ethers.getContractFactory("RabbitU") as RabbitU__factory;
    const _otherTokens: string[] = [];
    const _minDeposits: bigint[] = [];

    rabbit = await upgrades.deployProxy(
      RabbitFactory,
      [
        await timelock.getAddress(),
        await owner.getAddress(),
        await signer.getAddress(),
        defaultToken,
        minStake,
        _otherTokens,
        _minDeposits
      ],
      { initializer: 'initialize' }
    ) as unknown as RabbitU;

    // Deploy VaultU with explicit parameters
    const VaultFactory = await ethers.getContractFactory("VaultU") as VaultU__factory;
    const vaultParams = [
      await timelock.getAddress(),    // _timelock
      await owner.getAddress(),       // _owner
      await rabbit.getAddress(), // _rabbitx
      defaultToken,        // _defaultToken
      minStake,           // _minStake
      _otherTokens,       // _otherTokens
      _minDeposits        // _minDeposits
    ];

    vault = await upgrades.deployProxy(
      VaultFactory,
      vaultParams,
      { 
        initializer: 'initialize',
        kind: 'uups'
      }
    ) as unknown as VaultU;

    // Mint tokens to user1
    await token.mint(await user1.getAddress(), oneEth);

    // Support the token right after deployment
    await vault.connect(owner).supportToken(defaultToken, minStake);
  });

  describe("Staking", function () {
    it("should allow user to stake default token", async function () {
      const amount = ethers.parseEther("0.1");
      await token.connect(user1).approve(await vault.getAddress(), amount);
      
      await expect(vault.connect(user1).stake(amount))
        .to.emit(vault, "Stake")
        .withArgs(`s_1_rbxv_s`, await user1.getAddress(), amount, defaultToken);

      expect(await token.balanceOf(await rabbit.getAddress())).to.equal(amount);
    });

    it("should allow user to stake specific token", async function () {
      const amount = ethers.parseEther("0.1");
      await token.connect(user1).approve(await vault.getAddress(), amount);
      
      await expect(vault.connect(user1).stakeToken(amount, defaultToken))
        .to.emit(vault, "Stake")
        .withArgs(`s_1_rbxv_s`, await user1.getAddress(), amount, defaultToken);

      expect(await token.balanceOf(await rabbit.getAddress())).to.equal(amount);
    });

    it("should revert when staking unsupported token", async function () {
      const amount = ethers.parseEther("0.1");
      await expect(
        vault.connect(user1).stakeToken(amount, await user2.getAddress())
      ).to.be.revertedWith("UNSUPPORTED_TOKEN");
    });

    it("should revert when staking amount is too small", async function () {
      const smallAmount = ethers.parseEther("0.01");
      await expect(
        vault.connect(user1).stake(smallAmount)
      ).to.be.revertedWith("AMOUNT_TOO_SMALL");
    });

  //   it("should allow native token staking", async function () {
  //     const amount = ethers.parseEther("0.1");
  //     await vault.connect(owner).supportToken(ethers.ZeroAddress, minStake);
      
  //     await expect(
  //       vault.connect(user1).stakeNative({ value: amount })
  //     ).to.emit(vault, "Stake")
  //      .withArgs(`s_1_rbxv`, await user1.getAddress(), amount, ethers.ZeroAddress);
  //   });

  //   it("should handle native token via receive function", async function () {
  //     const amount = ethers.parseEther("0.1");
  //     await vault.connect(owner).supportToken(ethers.ZeroAddress, minStake);
      
  //     await expect(
  //       user1.sendTransaction({
  //         to: await vault.getAddress(),
  //         value: amount
  //       })
  //     ).to.emit(vault, "Stake")
  //      .withArgs(`s_1_rbxv`, await user1.getAddress(), amount, ethers.ZeroAddress);
  //   });
  });

  describe("Token Management", function () {
    it("should allow owner to support token", async function () {
      const newToken = await user1.getAddress();
      await expect(vault.connect(owner).supportToken(newToken, minStake))
        .to.emit(vault, "SupportToken")
        .withArgs(newToken, minStake);
      
      expect(await vault.supportedTokens(newToken)).to.be.true;
      expect(await vault.minStakes(newToken)).to.equal(minStake);
    });

    it("should allow owner to unsupport token", async function () {
      const tokenToUnsupport = defaultToken;
      await expect(vault.connect(owner).unsupportToken(tokenToUnsupport))
        .to.emit(vault, "UnsupportToken")
        .withArgs(tokenToUnsupport);
      
      expect(await vault.supportedTokens(tokenToUnsupport)).to.be.false;
    });

    it("should revert when non-owner tries to support token", async function () {
      await expect(
        vault.connect(user1).supportToken(await user2.getAddress(), minStake)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
      .withArgs(await user1.getAddress());
    });

    it("should revert when non-owner tries to unsupport token", async function () {
      await expect(
        vault.connect(user1).unsupportToken(defaultToken)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
      .withArgs(await user1.getAddress());
    });
  });

  describe("Role Management", function () {
    describe("Admin Role", function () {
      it("should allow owner to add admin", async function () {
        await vault.connect(owner).addAdmin(user1.getAddress());
        expect(await vault.isAdmin(user1.getAddress())).to.be.true;
      });

      it("should allow owner to remove admin", async function () {
        await vault.connect(owner).addAdmin(user1.getAddress());
        await vault.connect(owner).removeAdmin(user1.getAddress());
        expect(await vault.isAdmin(user1.getAddress())).to.be.false;
      });

      it("should revert when non-admin tries to add admin", async function () {
        await expect(vault.connect(user1).addAdmin(user2.getAddress()))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });

      it("should revert when non-admin tries to remove admin", async function () {
        await expect(vault.connect(user1).removeAdmin(user2.getAddress()))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });
    });

    describe("Trader Role", function () {
      it("should allow admin to add trader", async function () {
        await vault.connect(owner).addTrader(user1.getAddress());
        expect(await vault.isTrader(user1.getAddress())).to.be.true;
      });

      it("should allow admin to remove trader", async function () {
        await vault.connect(owner).addTrader(user1.getAddress());
        await vault.connect(owner).removeTrader(user1.getAddress());
        expect(await vault.isTrader(user1.getAddress())).to.be.false;
      });

      it("should revert when non-admin tries to add trader", async function () {
        await expect(vault.connect(user1).addTrader(user2.getAddress()))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });

      it("should revert when non-admin tries to remove trader", async function () {
        await expect(vault.connect(user1).removeTrader(user2.getAddress()))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });
    });

    describe("Treasurer Role", function () {
      it("should allow admin to add treasurer", async function () {
        await vault.connect(owner).addTreasurer(user1.getAddress());
        expect(await vault.isTreasurer(user1.getAddress())).to.be.true;
      });

      it("should allow admin to remove treasurer", async function () {
        await vault.connect(owner).addTreasurer(user1.getAddress());
        await vault.connect(owner).removeTreasurer(user1.getAddress());
        expect(await vault.isTreasurer(user1.getAddress())).to.be.false;
      });

      it("should revert when non-admin tries to add treasurer", async function () {
        await expect(vault.connect(user1).addTreasurer(user2.getAddress()))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });

      it("should revert when non-admin tries to remove treasurer", async function () {
        await expect(vault.connect(user1).removeTreasurer(user2.getAddress()))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });
    });

    describe("Generic Role Management", function () {
      const ROLE_ID = 1;

      it("should allow admin to add role", async function () {
        await vault.connect(owner).addRole(user1.getAddress(), ROLE_ID);
        expect(await vault.isValidSigner(user1.getAddress(), ROLE_ID)).to.be.true;
      });

      it("should allow admin to remove role", async function () {
        await vault.connect(owner).addRole(user1.getAddress(), ROLE_ID);
        await vault.connect(owner).removeRole(user1.getAddress(), ROLE_ID);
        expect(await vault.isValidSigner(user1.getAddress(), ROLE_ID)).to.be.false;
      });

      it("should allow admin to manage roles", async function () {
        await vault.connect(owner).addAdmin(user1.getAddress());
        await vault.connect(user1).addRole(user2.getAddress(), ROLE_ID);
        expect(await vault.isValidSigner(user2.getAddress(), ROLE_ID)).to.be.true;
        
        await vault.connect(user1).removeRole(user2.getAddress(), ROLE_ID);
        expect(await vault.isValidSigner(user2.getAddress(), ROLE_ID)).to.be.false;
      });

      it("should revert when non-admin tries to add role", async function () {
        await expect(vault.connect(user1).addRole(user2.getAddress(), ROLE_ID))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });

      it("should revert when non-admin tries to remove role", async function () {
        await expect(vault.connect(user1).removeRole(user2.getAddress(), ROLE_ID))
          .to.be.revertedWith("NOT_AN_ADMIN");
      });
    });
  });

  describe("Owner Functions", function () {
    it("should allow timelock to set rabbit contract", async function () {
      const newRabbit = await user1.getAddress();
      await expect(vault.connect(timelock).setRabbit(newRabbit))
        .to.emit(vault, "SetRabbitX")
        .withArgs(newRabbit);
      expect(await vault.rabbitx()).to.equal(newRabbit);
    });

    it("should allow owner to withdraw tokens", async function () {
      const amount = ethers.parseEther("0.1");
      await token.connect(user1).transfer(await vault.getAddress(), amount);
      
      await expect(vault.connect(owner).withdrawTokensTo(user2.getAddress(), amount, defaultToken))
        .to.emit(vault, "Withdrawal")
        .withArgs(user2.getAddress(), amount, defaultToken);

      expect(await token.balanceOf(user2.getAddress())).to.equal(amount);
    });

    // it("should allow owner to withdraw native tokens", async function () {
    //   const amount = ethers.parseEther("0.1");
    //   await user1.sendTransaction({
    //     to: await vault.getAddress(),
    //     value: amount
    //   });

    //   const initialBalance = await ethers.provider.getBalance(user2.getAddress());
      
    //   await expect(vault.connect(owner).withdrawNativeTo(user2.getAddress(), amount))
    //     .to.emit(vault, "Withdrawal")
    //     .withArgs(user2.getAddress(), amount, ethers.ZeroAddress);

    //   expect(await ethers.provider.getBalance(user2.getAddress()))
    //     .to.equal(initialBalance + amount);
    // });
  });
}); 