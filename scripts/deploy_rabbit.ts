import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const RabbitU = await ethers.getContractFactory("RabbitU");

    // let timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("ETHEREUM_USDT_ADDRESS")
    // let timelockAddress = ensureEnvVar("BASE_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("BASE_USDC_ADDRESS")
    // let timelockAddress = ensureEnvVar("SONIC_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("SONIC_USDC_ADDRESS")
    // let timelockAddress = ensureEnvVar("ARBITRUM_ONE_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("ARBITRUM_ONE_USDC_ADDRESS")
    let timelockAddress = ensureEnvVar("BSC_TIMELOCK_ADDRESS");
    let usdrAddress = ensureEnvVar("BSC_USDT_ADDRESS")
    let kmsSignerAddress = ensureEnvVar("KMS_SIGNER_ADDRESS");;

    // let timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("DUMMY_TOKEN_ADDRESS");
    // let timelockAddress = ensureEnvVar("BASE_SEPOLIA_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("BASE_SEPOLIA_USDR_ADDRESS");
    // let timelockAddress = ensureEnvVar("SONIC_BLAZE_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("SONIC_BLAZE_USDR_ADDRESS");
    // let timelockAddress = ensureEnvVar("ARBITRUM_SEPOLIA_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("ARBITRUM_SEPOLIA_USDR_ADDRESS");
    // let timelockAddress = ensureEnvVar("BSC_TESTNET_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("BSC_TESTNET_USDR_ADDRESS")
    // let kmsSignerAddress = ensureEnvVar("TESTNET_KMS_SIGNER_ADDRESS");;
    let rabbitOwner = deployer.address;

    const rabbitU = await upgrades.deployProxy(RabbitU,
        [
            timelockAddress,
            rabbitOwner,
            kmsSignerAddress,
            usdrAddress,
            ethers.parseUnits("0.1", 6), // minDeposit CHECK DECIMALS!
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

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

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
