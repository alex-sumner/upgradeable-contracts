import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";

export async function prepare(contract: string, proxyAddress: string, timelockAddress: string) {
  const [deployer] = await ethers.getSigners();
  console.log("Preparing upgrade with the account:", deployer.address);

  // Connect to the deployed timelock contract
  const TLController = await ethers.getContractFactory("TLController");
  const timelockController = TLController.attach(timelockAddress);

  console.log("Preparing upgrade for VaultU...");

  // Get the contract factory for the new implementation
  const factory = await ethers.getContractFactory(contract);

  // Prepare the upgrade
  const newImplementationAddress = await upgrades.prepareUpgrade(proxyAddress, factory);
  console.log("New implementation address:", newImplementationAddress);

  // Get the UUPSUpgradeable interface
  const UUPSUpgradeableInterface = new ethers.Interface([
    "function upgradeToAndCall(address newImplementation, bytes memory data) public payable"
  ]);

  // Encode the upgrade call (with empty bytes for data parameter)
  const upgradeCall = UUPSUpgradeableInterface.encodeFunctionData("upgradeToAndCall", [newImplementationAddress, "0x"]);

  // Calculate the execution time
  const minDelay = await timelockController.getMinDelay();

  // Schedule the upgrade transaction
  const scheduleTx = await timelockController.schedule(
    proxyAddress,
    0, // value
    upgradeCall,
    ethers.ZeroHash, // predecessor
    ethers.id("UPGRADE_ROLE"), // salt
    minDelay // delay
  );

  console.log("Upgrade scheduled. Transaction hash:", scheduleTx.hash);

  // Wait for the transaction to be mined
  await scheduleTx.wait();

  console.log("Upgrade scheduled successfully. You can execute the upgrade after the timelock period.");

  // Verify the new implementation contract on Etherscan
  console.log("Verifying new implementation...");
  await verify(newImplementationAddress as string, []);

  console.log("Upgrade preparation complete!");
  console.log("To execute the upgrade after the timelock period, call the 'execute' function on the TimelockController.");
}