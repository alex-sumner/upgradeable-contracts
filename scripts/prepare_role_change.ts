import { ethers } from "hardhat";
import { TimelockController } from "../typechain-types";
import { ensureEnvVar } from "../test/util";

const VALID_ROLES = ["PROPOSER", "EXECUTOR", "CANCELLER", "DEFAULT_ADMIN"] as const;
const VALID_ACTIONS = ["grantRole", "revokeRole"] as const;

async function main() {
    const USE_ETHERSCAN = true;
    // const timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("SONIC_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("BASE_TIMELOCK_ADDRESS");
    // const timelockAddress = ensureEnvVar("ARBITRUM_ONE_TIMELOCK_ADDRESS");
    const timelockAddress = ensureEnvVar("BSC_TIMELOCK_ADDRESS");
    // const USER = "0x31d53232d9D4a14fE977061F1e3945906d262DAF"; //Test
    // const USER = ensureEnvVar("TEST_SAFE_ADDRESS")
    const USER = ensureEnvVar("RBX_DEPLOYER_ADDRESS")
    // const USER = ensureEnvVar("LEDGER_A_ADDRESS")
    // const USER = ensureEnvVar("L1_OWNER_ADDRESS")

    // const ROLE = "DEFAULT_ADMIN";
    // const ROLE = "CANCELLER";
    // const ROLE = "PROPOSER";
    var ROLE = "EXECUTOR";

    const ACTION = "revokeRole" as any;
    // const ACTION = "grantRole";

    await prepareRoleChange(USER, ROLE, ACTION, timelockAddress, USE_ETHERSCAN);
}

async function prepareRoleChange(
    user: string,
    role: string,
    action: string,
    timelockAddress: string,
    useEtherscan: boolean = true
) {
    // Validate address
    if (!ethers.isAddress(user)) {
        throw new Error("Invalid user address");
    }

    // Validate role
    if (!VALID_ROLES.includes(role as any)) {
        throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    }

    // Validate action
    if (!VALID_ACTIONS.includes(action as any)) {
        throw new Error(`Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`);
    }

    // Connect to the deployed timelock contract
    const TimelockControllerFactory = await ethers.getContractFactory("TimelockController");
    const timelockController = TimelockControllerFactory.attach(timelockAddress) as TimelockController;

    console.log(`Preparing ${action} for Timelock at ${timelockAddress}`);

    // Get role hash
    let ROLE_HASH;
    switch (role) {
        case "PROPOSER":
            ROLE_HASH = await timelockController.PROPOSER_ROLE();
            break;
        case "EXECUTOR":
            ROLE_HASH = await timelockController.EXECUTOR_ROLE();
            break;
        case "CANCELLER":
            ROLE_HASH = await timelockController.CANCELLER_ROLE();
            break;
        case "DEFAULT_ADMIN":
            ROLE_HASH = await timelockController.DEFAULT_ADMIN_ROLE();
            break;
        default:
            throw new Error("Invalid role");
    }

    // Check current role status
    const hasRole = await timelockController.hasRole(ROLE_HASH, user);
    if (action === "grantRole" && hasRole) {
        throw new Error(`User already has ${role} role`);
    }
    if (action === "revokeRole" && !hasRole) {
        throw new Error(`User doesn't have ${role} role`);
    }

    // Encode the role function call
    const functionName = action === "grantRole" ? "grantRole" : "revokeRole";
    const roleCall = (timelockController.interface.encodeFunctionData as any)(
        functionName,
        [ROLE_HASH, user]
    );

    // Get the current minDelay
    const currentMinDelay = await timelockController.getMinDelay();
    console.log("Current minDelay:", currentMinDelay.toString());

    const salt = ethers.id(`CHANGE_ROLE-${Date.now()}`);
    console.log("Salt:", salt);
    console.log("User:", user);
    console.log("Role:", role);
    console.log("Action:", action);

    if (useEtherscan) {
        console.log("\n=== Etherscan Instructions for Schedule ===");
        console.log("1. Go to the Timelock contract on Etherscan:", timelockAddress);
        console.log("2. Connect MetaMask with your Ledger");
        console.log("3. Use 'Write Contract' -> 'schedule' with these parameters:");
        console.log("   - target:", timelockAddress);
        console.log("   - value:", 0);
        console.log("   - data:", roleCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt);
        console.log("   - delay:", currentMinDelay.toString());

        console.log("\nWait for", currentMinDelay.toString(), "seconds then");
        console.log("\n4. Use 'Write Contract' -> 'execute' with these parameters:");
        console.log("   - execute:", 0);
        console.log("   - target:", timelockAddress);
        console.log("   - value:", 0);
        console.log("   - payload:", roleCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt, "\n");

        return;
    }

    try {
        const timelockAddr = await timelockController.getAddress();

        const scheduleTx = await timelockController.schedule(
            timelockAddr,  // Use the timelock address here
            0, // value
            roleCall,
            ethers.ZeroHash, // predecessor
            salt,
            currentMinDelay
        );

        console.log("Update scheduled. Transaction hash:", scheduleTx.hash);

        // Wait for the transaction to be mined
        await scheduleTx.wait();

        console.log("Update scheduled successfully. You can execute the update after the timelock period.");

        const operationId = await timelockController.hashOperation(
            timelockAddr,  // Use the same timelock address here
            0,
            roleCall,
            ethers.ZeroHash,
            salt
        );
        console.log(`Operation ID: ${operationId}`);
    } catch (error: any) {
        if (error.message) {
            console.error("Error:", error.message);
        } else {
            console.error("Schedule error:", JSON.stringify(error, null, 2));
        }
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
