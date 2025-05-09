import { ethers } from "hardhat";
import { ensureEnvVar } from "../test/util";
import { TimelockController, RabbitU } from "../typechain-types";

async function main() {
    const USE_ETHERSCAN = true;
    const NEW_OWNER = ensureEnvVar("LEDGER_A_ADDRESS");

    // const OWNED_ADDRESS = ensureEnvVar("SEPOLIA_RABBIT_PROXY_ADDRESS");
    // const OWNED_ADDRESS = ensureEnvVar("ETHEREUM_RABBIT_PROXY_ADDRESS");
    // const OWNED_ADDRESS = ensureEnvVar("ETHEREUM_DEPOSIT_PROXY_ADDRESS");
    // const OWNED_ADDRESS = ensureEnvVar("BLAST_VAULT_PROXY_ADDRESS");
    const OWNED_ADDRESS = ensureEnvVar("BLAST_SEPOLIA_VAULT_PROXY_ADDRESS");

    const TIMELOCK_ADDRESS = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    // const TIMELOCK_ADDRESS = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // const TIMELOCK_ADDRESS = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
    // const TIMELOCK_ADDRESS = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");

    await prepareTransferOwnership(
        NEW_OWNER,
        OWNED_ADDRESS,
        TIMELOCK_ADDRESS,
        USE_ETHERSCAN
    );
}
async function prepareTransferOwnership(
    newOwner: string,
    ownedAddress: string,
    timelockAddress: string,
    useEtherscan: boolean = true
) {
    // Validate address
    if (!ethers.isAddress(newOwner)) {
        throw new Error("Invalid new owner address");
    }

    // Connect to the deployed contracts
    const TimelockControllerFactory = await ethers.getContractFactory("TimelockController");
    const timelockController = TimelockControllerFactory.attach(timelockAddress) as TimelockController;

    const RabbitFactory = await ethers.getContractFactory("RabbitU");
    const rabbitContract = RabbitFactory.attach(ownedAddress) as RabbitU;

    console.log(`Preparing ownership transfer for ${ownedAddress}`);

    // Encode the transferOwnership function call
    const transferCall = rabbitContract.interface.encodeFunctionData(
        "transferOwnership",
        [newOwner]
    );

    // Get the current minDelay
    const currentMinDelay = await timelockController.getMinDelay();
    console.log("Current minDelay:", currentMinDelay.toString());

    const salt = ethers.id(`TRANSFER_OWNERSHIP-${Date.now()}`);
    console.log("Salt:", salt);
    console.log("New owner:", newOwner);

    if (useEtherscan) {
        console.log("\n=== Etherscan Instructions for Timelock Update ===");
        console.log("1. Go to the Timelock contract on Etherscan:", timelockAddress);
        console.log("2. Connect MetaMask with your Ledger");
        console.log("3. Use 'Write Contract' -> 'schedule' with these parameters:");
        console.log("   - target:", ownedAddress);
        console.log("   - value:", 0);
        console.log("   - data:", transferCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt);
        console.log("   - delay:", currentMinDelay.toString());

        console.log("\nWait for", currentMinDelay.toString(), "seconds then");
        console.log("\n4. Use 'Write Contract' -> 'execute' with these parameters:");
        console.log("   - execute:", 0);
        console.log("   - target:", ownedAddress);
        console.log("   - value:", 0);
        console.log("   - payload:", transferCall);
        console.log("   - predecessor:", ethers.ZeroHash);
        console.log("   - salt:", salt, "\n");

        return;
    }

    try {
        const scheduleTx = await timelockController.schedule(
            ownedAddress,
            0, // value
            transferCall,
            ethers.ZeroHash, // predecessor
            salt,
            currentMinDelay
        );

        console.log("Transfer scheduled. Transaction hash:", scheduleTx.hash);
        await scheduleTx.wait();
        console.log("Transfer scheduled successfully. You can execute after the timelock period.");
    } catch (error: any) {
        console.error("Error scheduling transfer:", error);
        return;
    }
}


main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 