import { ethers } from "hardhat";
import { ensureEnvVar } from "../test/util"; // Assuming you have this utility function

async function main() {
    // Get the proxy address from environment variable
    const proxyAddress = ensureEnvVar("SEPOLIA_RABBIT_PROXY_ADDRESS");

    // Get the contract factory
    const RabbitU = await ethers.getContractFactory("RabbitU");

    // Attach to the proxy address
    const contract = RabbitU.attach(proxyAddress);

    // Call the getVersion function
    const version = await contract.getVersion();

    console.log("Current contract version:", version.toString());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });