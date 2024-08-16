import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const RabbitU = await ethers.getContractFactory("RabbitU");

    let timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    let usdrAddress = ensureEnvVar("DUMMY_TOKEN_ADDRESS");
    let kmsSignerAddress = ensureEnvVar("TESTNET_KMS_SIGNER_ADDRESS");
    let rabbitOwner = deployer.address;

    const rabbitU = await upgrades.deployProxy(RabbitU,
        [
            timelockAddress,
            rabbitOwner,
            kmsSignerAddress,
            usdrAddress,
            ethers.parseUnits("0.1", 6), // minDeposit
            [], // otherTokens
            [], // minDeposits for other tokens
        ],
        {
            initializer: 'initialize(address,address,address,address,uint256,address[],uint256[])',
            kind: 'uups'
        }
    );

    await rabbitU.waitForDeployment();
    console.log("RabbitU deployed to:", await rabbitU.getAddress());

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(await rabbitU.getAddress());
    console.log("Implementation address:", implementationAddress);

    console.log("Verifying contract...");
    await verify(await rabbitU.getAddress(), []);
    await verify(implementationAddress, []);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });