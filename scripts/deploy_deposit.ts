import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const PoolDepositU = await ethers.getContractFactory("PoolDepositU");

    // let timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
    // let usdrAddress = ensureEnvVar("ETHEREUM_USDT_ADDRESS")
    // let rabbitAddress = ensureEnvVar("ETHEREUM_RABBIT_PROXY_ADDRESS");
    // let timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("SEPOLIA_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("DUMMY_TOKEN_ADDRESS");
    // let timelockAddress = ensureEnvVar("BASE_SEPOLIA_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("BASE_SEPOLIA_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("BASE_SEPOLIA_USDR_ADDRESS");
    // let timelockAddress = ensureEnvVar("SONIC_BLAZE_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("SONIC_BLAZE_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("SONIC_BLAZE_USDR_ADDRESS");
    // let timelockAddress = ensureEnvVar("ARBITRUM_SEPOLIA_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("ARBITRUM_SEPOLIA_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("ARBITRUM_SEPOLIA_USDR_ADDRESS");
    // let timelockAddress = ensureEnvVar("SONIC_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("SONIC_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("SONIC_USDC_ADDRESS");
    let timelockAddress = ensureEnvVar("BSC_TIMELOCK_ADDRESS");
    let rabbitAddress = ensureEnvVar("BSC_RABBIT_PROXY_ADDRESS");
    let usdrAddress = ensureEnvVar("BSC_USDT_ADDRESS");
    // let timelockAddress = ensureEnvVar("BASE_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("BASE_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("BASE_USDC_ADDRESS");
    // let timelockAddress = ensureEnvVar("ARBITRUM_ONE_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("ARBITRUM_ONE_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("ARBITRUM_ONE_USDC_ADDRESS");
    // let timelockAddress = ensureEnvVar("BSC_TESTNET_TIMELOCK_ADDRESS");
    // let rabbitAddress = ensureEnvVar("BSC_TESTNET_RABBIT_PROXY_ADDRESS");
    // let usdrAddress = ensureEnvVar("BSC_TESTNET_USDR_ADDRESS");

    let poolDepositOwner = deployer.address;

    const poolDepositU = await upgrades.deployProxy(PoolDepositU,
        [
            timelockAddress,
            poolDepositOwner,
            rabbitAddress,
            usdrAddress,
            ethers.parseUnits("0.1", 6), // minDeposit -- CHECK DECIMALS!!!
            [], // otherTokens
            [], // minDeposits for other tokens
        ],
        {
            initializer: 'initialize(address,address,address,address,uint256,address[],uint256[])',
            kind: 'uups'
        }
    );

    await poolDepositU.waitForDeployment();
    console.log("PoolDepositU deployed to:", await poolDepositU.getAddress());

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(await poolDepositU.getAddress());
    console.log("Implementation address:", implementationAddress);

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Verify contracts on Etherscan
    console.log("Verifying contracts...");
    await verify(await poolDepositU.getAddress(), []); // Proxy doesn't need constructor args
    await verify(implementationAddress, []);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
