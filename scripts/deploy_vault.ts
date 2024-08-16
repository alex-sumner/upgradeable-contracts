import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const VaultU = await ethers.getContractFactory("VaultU");

    let timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    let rabbitAddress = ensureEnvVar("SEPOLIA_RABBIT_PROXY_ADDRESS");
    let usdrAddress = ensureEnvVar("DUMMY_TOKEN_ADDRESS");
    let vaultOwner = deployer.address;

    const vaultU = await upgrades.deployProxy(VaultU,
        [
            timelockAddress,
            vaultOwner,
            rabbitAddress,
            usdrAddress,
        ],
        {
            initializer: 'initialize(address,address,address,address)',
            kind: 'uups'
        }
    );

    await vaultU.waitForDeployment();
    console.log("VaultU deployed to:", await vaultU.getAddress());

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(await vaultU.getAddress());
    console.log("Implementation address:", implementationAddress);

    // Verify contracts on Etherscan
    console.log("Verifying contracts...");
    await verify(await vaultU.getAddress(), []); // Proxy doesn't need constructor args
    await verify(implementationAddress, []);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });