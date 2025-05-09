import { ethers } from "hardhat";
import { ensureEnvVar } from "../test/util";
import { TimelockController } from "../typechain-types";

/*
 * can be used to execute a prepared proposal to add or remove proposer, executor
 * or canceller roles on the timelock contract for a given user address
 */

async function main() {

    const USE_ETHERSCAN = true;
    const USER = ensureEnvVar("TEST_SAFE_ADDRESS")
    // const USER = ensureEnvVar("LEDGER_A_ADDRESS")
    // const USER = "0x31d53232d9D4a14fE977061F1e3945906d262DAF";
    const SALT = "0x25ea5dee380bebc761154e1072d6b2ecaeec2372b521f05f2e4243761fa48e8d";
    const timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");

    // const ROLE = "PROPOSER";
    // var ROLE = "EXECUTOR";
    let ROLE = "CANCELLER";

    // const ACTION = "revokeRole" as any;
    const ACTION = "grantRole" as any;

    const [executor] = await ethers.getSigners();
    console.log("Executing Timelock update with the account:", executor.address);

    const TimelockControllerFactory = await ethers.getContractFactory("TimelockController");
    const timelockController = TimelockControllerFactory.attach(timelockAddress) as TimelockController;

    console.log("Timelock address:", timelockAddress);
    console.log("User address:", USER);

    let ROLE_HASH: any;
    if (ROLE == "PROPOSER") {
        ROLE_HASH = await timelockController.PROPOSER_ROLE();
    } else if (ROLE == "EXECUTOR") {
        ROLE_HASH = await timelockController.EXECUTOR_ROLE();
    } else if (ROLE == "CANCELLER") {
        ROLE_HASH = await timelockController.CANCELLER_ROLE();
    }

    // Encode the grantRole function call
    const roleCall = timelockController.interface.encodeFunctionData(ACTION, [ROLE_HASH, USER]);

    if (USE_ETHERSCAN) {
        console.log("\n=== Etherscan Instructions for Execute ===");
        console.log("1. Go to the Timelock contract on Etherscan:", timelockAddress);
        console.log("2. Connect MetaMask with your Ledger");
        console.log("3. Use 'Write Contract' -> 'execute' with these parameters:");
        console.log("   - execute:", 0);
        console.log("   - target:", timelockAddress);
        console.log("   - value:", 0);
        console.log("   - payload:", roleCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", SALT);
        return;
    }

    try {
        const executeTx = await timelockController.execute(
            timelockAddress,
            0, // value
            roleCall,
            ethers.ZeroHash, // predecessor
            SALT
        );

        console.log("Executing, transaction hash:", executeTx.hash);
        // Wait for the transaction to be mined
        await executeTx.wait();
        console.log("Timelock update executed successfully.");
    } catch (error: any) {
        console.error("Error executing Timelock update:", JSON.stringify(error, null, 2));
        return;
    }

    const hasRole = await timelockController.hasRole(ROLE_HASH, USER);
    console.log("User has role:", hasRole);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });