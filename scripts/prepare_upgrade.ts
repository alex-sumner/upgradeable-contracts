import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { TimelockController } from "../typechain-types";

export async function prepareUpgrade(contract: string, proxyAddress: string, timelockAddress: string, useEtherscan: boolean) {
  console.log("Preparing upgrade for", contract, "with proxy address:", proxyAddress);
  const [deployer] = await ethers.getSigners();
  console.log("Preparing upgrade with the account:", deployer.address);

  // Connect to the deployed timelock contract
  const TimelockControllerFactory = await ethers.getContractFactory("TimelockController");
  const timelockController = TimelockControllerFactory.attach(timelockAddress) as TimelockController;

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

  const salt = ethers.id(`UPGRADE_ROLE-${Date.now()}`);
  console.log("Salt:", salt);

    if (useEtherscan) {
        console.log("\n=== Etherscan Instructions for Timelock Upgrade ===");
        console.log("1. Go to the Timelock contract on Etherscan:", timelockAddress);
        console.log("2. Connect MetaMask with your Ledger");
        console.log("3. Use 'Write Contract' -> 'schedule' with these parameters:");
        console.log("   - target:", proxyAddress);
        console.log("   - value:", 0);
        console.log("   - data:", upgradeCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt);
        console.log("   - delay:", minDelay.toString());
        
        console.log("\nWait for", minDelay.toString(), "seconds then");
        console.log("\n4. Use 'Write Contract' -> 'execute' with these parameters:");
        console.log("   - execute:", 0);
        console.log("   - target:", proxyAddress);
        console.log("   - value:", 0);
        console.log("   - payload:", upgradeCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt, "\n");
        
        return;
    }
  try {
    // Schedule the upgrade transaction
    const scheduleTx = await timelockController.schedule(
      proxyAddress,
      0, // value
      upgradeCall,
      ethers.ZeroHash, // predecessor
      salt,
      minDelay
    );

    console.log("Upgrade scheduled. Transaction hash:", scheduleTx.hash);

    // Wait for the transaction to be mined
    await scheduleTx.wait();

    console.log("Upgrade scheduled successfully. You can execute the upgrade after the timelock period.");
  } catch (error: any) {
    console.error("Full error object:", JSON.stringify(error, null, 2));
    return;
  }

  // Add a 60-second delay before verification
  console.log("Waiting 60 seconds before verification...");
  await new Promise(resolve => setTimeout(resolve, 60000));

  // Verify the new implementation contract on Etherscan
  console.log("Verifying new implementation...");
  await verify(newImplementationAddress as string, []);

  console.log("Upgrade preparation complete!");
  console.log("To execute the upgrade after the timelock period, call the 'execute' function on the TimelockController.");
}