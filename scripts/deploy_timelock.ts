import { ethers } from "hardhat";
import { verify } from "./verify";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying timelock contract with the account:", deployer.address);
    let timelockAdmin = deployer.address;

    const minDelay = 120;
    const proposers = [deployer.address];
    const executors = [deployer.address];
    const TLController = await ethers.getContractFactory("TLController");
    const timelockController = await TLController.deploy(minDelay, proposers, executors, timelockAdmin);
    await timelockController.waitForDeployment();
    console.log("TLController deployed to:", await timelockController.getAddress());

    console.log("Verifying contract...");
    await verify(await timelockController.getAddress(), [minDelay, proposers, executors]);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });