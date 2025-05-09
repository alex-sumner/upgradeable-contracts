import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Verifying contracts with the account:", deployer.address);

    // let proxyAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_PROXY_ADDRESS");
    // let implAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_IMPL_V1_ADDRESS");
    let proxyAddress = "0x0781E37495c8b2a2B1E8d2cB8Fa1A191f5424557"
    let implAddress = "0x19688514eB107D3f686dE62b24e7B46964cB2aDc"
    console.log("Verifying impl...", implAddress);
    await verify(implAddress, []);
    console.log("Verifying proxy...", proxyAddress);
    await verify(proxyAddress, []);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });