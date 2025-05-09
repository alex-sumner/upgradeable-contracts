import { ethers } from "hardhat";
import { TimelockController } from "../typechain-types";

export async function executeUpgrade(contract: string, proxyAddress: string, timelockAddress: string, newImplementationAddress: string, salt: string) {
    const [executor] = await ethers.getSigners();
    console.log("Executing upgrade with the account:", executor.address);

    const TimelockControllerFactory = await ethers.getContractFactory("TimelockController");
    const timelockController = TimelockControllerFactory.attach(timelockAddress) as TimelockController;

    // Use the correct UUPSUpgradeable interface
    const UUPSUpgradeableInterface = new ethers.Interface([
        "function upgradeToAndCall(address newImplementation, bytes memory data) public payable"
    ]);

    console.log("timelock", timelockAddress);
    console.log("proxy", proxyAddress);
    console.log("new impl", newImplementationAddress);

    // Encode the upgrade call (with empty bytes for data parameter)
    const upgradeCall = UUPSUpgradeableInterface.encodeFunctionData("upgradeToAndCall", [newImplementationAddress, "0x"]);

    try {
        const executeTx = await timelockController.execute(
            proxyAddress,
            0, // value
            upgradeCall,
            ethers.ZeroHash, // predecessor
            salt
        );

        console.log("Executing upgrade. Transaction hash:", executeTx.hash);

        // Wait for the transaction to be mined
        await executeTx.wait();

        console.log("Upgrade executed successfully.");
    } catch (error: any) {
        console.error("error executing upgrade:", JSON.stringify(error, null, 2));
        return;
    }

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Verify the new version
    const factory = await ethers.getContractFactory(contract);
    const upgradedContract = factory.attach(proxyAddress) as any;
    const version = await upgradedContract.getVersion();
    console.log("New contract version:", version.toString());
}
