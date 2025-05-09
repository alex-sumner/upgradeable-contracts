import { ethers } from "hardhat";
import { verify } from "./verify";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying usdbfx contract with the account:", deployer.address);
    let timelockAdmin = deployer.address;

    const factory = await ethers.getContractFactory("USDR");
    const usdr = await factory.deploy();
    await usdr.waitForDeployment();
    console.log("USDR deployed to:", await usdr.getAddress());

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log("Verifying contract...");
    await verify(await usdr.getAddress(), []);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });