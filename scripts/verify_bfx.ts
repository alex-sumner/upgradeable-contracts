import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Verifying contracts with the account:", deployer.address);

    let proxyAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_PROXY_ADDRESS");
    let implAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_IMPL_V1_ADDRESS");
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