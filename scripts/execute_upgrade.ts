import { ethers } from "hardhat";

export async function execute(contract: string, proxyAddress: string, timelockAddress: string, newImplementationAddress: string) {
    const [executor] = await ethers.getSigners();
    console.log("Executing upgrade with the account:", executor.address);

    const TLController = await ethers.getContractFactory("TLController");
    const timelockController = TLController.attach(timelockAddress);

    // Use the correct UUPSUpgradeable interface
    const UUPSUpgradeableInterface = new ethers.Interface([
        "function upgradeToAndCall(address newImplementation, bytes memory data) public payable"
    ]);

    // Encode the upgrade call (with empty bytes for data parameter)
    const upgradeCall = UUPSUpgradeableInterface.encodeFunctionData("upgradeToAndCall", [newImplementationAddress, "0x"]);

    const executeTx = await timelockController.execute(
        proxyAddress,
        0, // value
        upgradeCall,
        ethers.ZeroHash, // predecessor
        ethers.id("UPGRADE_ROLE") // salt
    );

    console.log("Executing upgrade. Transaction hash:", executeTx.hash);

    // Wait for the transaction to be mined
    await executeTx.wait();

    console.log("Upgrade executed successfully.");

    // Verify the new version
    const factory = await ethers.getContractFactory(contract);
    const upgradedContract = factory.attach(proxyAddress);
    const version = await upgradedContract.getVersion();
    console.log("New contract version:", version.toString());
}
