import { ethers } from "hardhat";
import { ensureEnvVar } from "../test/util";
import { TimelockController } from "../typechain-types";

async function main() {

    const NEW_MIN_DELAY = "10";
    const SALT = "0x52389d731f265b804752785e98bc79b0dd31889c2e7d1ea6d9270eea963e99d9"

    const timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
    const [executor] = await ethers.getSigners();
    console.log("Executing Timelock update with the account:", executor.address);
    console.log("salt:", SALT);

    const TimelockControllerFactory = await ethers.getContractFactory("TimelockController");
    const timelockController = TimelockControllerFactory.attach(timelockAddress) as TimelockController;

    console.log("Timelock address:", timelockAddress);
    console.log("New minDelay:", NEW_MIN_DELAY);

    // Encode the updateDelay function call
    const updateDelayCall = timelockController.interface.encodeFunctionData("updateDelay", [NEW_MIN_DELAY]);

    try {
        const executeTx = await timelockController.execute(
            timelockAddress,
            0, // value
            updateDelayCall,
            ethers.ZeroHash, // predecessor
            SALT
        );

        console.log("Executing Timelock update. Transaction hash:", executeTx.hash);
        // Wait for the transaction to be mined
        await executeTx.wait();
        console.log("Timelock update executed successfully.");
    } catch (error: any) {
        console.error("Error executing Timelock update:", JSON.stringify(error, null, 2));
        return;
    }

    const newDelay = await timelockController.getMinDelay();
    console.log("New Timelock minDelay:", newDelay.toString());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });