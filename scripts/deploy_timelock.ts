import { ethers } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying timelock contract with the account:", deployer.address);
    // let gnosisSafeAddress = ensureEnvVar("TEST_SAFE_ADDRESS");
    let ledgerAAddress = ensureEnvVar("LEDGER_A_ADDRESS")
    let ledgerMAddress = ensureEnvVar("LEDGER_M_ADDRESS")

    let timelockAdmin = ethers.ZeroAddress;

    const minDelay = 10;
    const proposers = [deployer.address, ledgerAAddress, ledgerMAddress];
    const executors = [deployer.address, ledgerAAddress, ledgerMAddress];
    const TimelockController = await ethers.getContractFactory("@openzeppelin/contracts/governance/TimelockController.sol:TimelockController");
    const timelockController = await TimelockController.deploy(minDelay, proposers, executors, timelockAdmin);
    await timelockController.waitForDeployment();
    console.log("TimelockController deployed to:", await timelockController.getAddress());

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log("Verifying contract...");
    await verify(await timelockController.getAddress(), [minDelay, proposers, executors, timelockAdmin]);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });