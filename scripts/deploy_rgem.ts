import { ethers } from "hardhat";
import { verify } from "./verify";

async function main() {
    const [deployer] = await ethers.getSigners();
    const initialHolder = "0x5A11289c2924cc2B6C117EaA18a58460EFeFd9D0";
    console.log("Deploying RGEM contract with initial holder:", initialHolder);

    const factory = await ethers.getContractFactory("RGEM");
    const usdr = await factory.deploy(initialHolder);
    await usdr.waitForDeployment();
    console.log("RGEM deployed to:", await usdr.getAddress());

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log("Verifying contract...");
    await verify(await usdr.getAddress(), [initialHolder]);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });