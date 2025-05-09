import { ethers } from "hardhat";
import { ensureEnvVar } from "../test/util";
import { TimelockController } from "../typechain-types";

async function main() {
    const USE_ETHERSCAN = true

    const NEW_MIN_DELAY = "604800";

    // const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("SONIC_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("BASE_TIMELOCK_ADDRESS");
    const timelockAddress = ensureEnvVar("ARBITRUM_ONE_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
    console.log(`Preparing update for Timelock at ${timelockAddress} with new minDelay: ${NEW_MIN_DELAY}`);

    const [deployer] = await ethers.getSigners();
    console.log("Preparing update with the account:", deployer.address);

    // Connect to the deployed timelock contract
    const TimelockControllerFactory = await ethers.getContractFactory("TimelockController");
    const timelockController = TimelockControllerFactory.attach(timelockAddress) as TimelockController;

    console.log("Preparing update for Timelock minDelay...");

    // Encode the updateDelay function call
    const updateDelayCall = timelockController.interface.encodeFunctionData("updateDelay", [NEW_MIN_DELAY]);

    // Get the current minDelay
    const currentMinDelay = await timelockController.getMinDelay();
    console.log("Current minDelay:", currentMinDelay.toString());

    const salt = ethers.id(`UPDATE_MIN_DELAY-${Date.now()}`);
    console.log("Salt:", salt);
    console.log("New minDelay:", NEW_MIN_DELAY.toString());
    if (USE_ETHERSCAN) {
        console.log("\n=== Etherscan Instructions for Schedule ===");
        console.log("1. Go to the Timelock contract on Etherscan:", timelockAddress);
        console.log("2. Connect MetaMask with your Ledger");
        console.log("3. Use 'Write Contract' -> 'schedule' with these parameters:");
        console.log("   - target:", timelockAddress);
        console.log("   - value:", 0);
        console.log("   - data:", updateDelayCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt);
        console.log("   - delay:", currentMinDelay.toString());

        console.log("\nWait for", currentMinDelay.toString(), "seconds then");
        console.log("\n4. Use 'Write Contract' -> 'execute' with these parameters:");
        console.log("   - execute:", 0);
        console.log("   - target:", timelockAddress);
        console.log("   - value:", 0);
        console.log("   - payload:", updateDelayCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt, "\n");

        return;
    }

    try {
        const scheduleTx = await timelockController.schedule(
            timelockAddress,
            0, // value
            updateDelayCall,
            ethers.ZeroHash, // predecessor
            salt,
            currentMinDelay // use current minDelay for the delay
        );

        console.log("Update scheduled. Transaction hash:", scheduleTx.hash);

        // Wait for the transaction to be mined
        await scheduleTx.wait();

        console.log("Update scheduled successfully. You can execute the update after the timelock period.");

        const operationId = await timelockController.hashOperation(timelockController.target, 0, updateDelayCall, ethers.ZeroHash, salt);
        console.log(`Action proposed: update min delay. Operation ID: ${operationId}`);
    } catch (error: any) {
        console.error("schedule error:", JSON.stringify(error, null, 2));
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });