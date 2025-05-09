import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const BfxDepositU = await ethers.getContractFactory("BfxDepositU");

    // let timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    // let bfxAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_PROXY_ADDRESS");
    // // let usdbfxAddress = ensureEnvVar("USDBFX_ADDRESS");
    // let usdbAddress = ensureEnvVar("BLAST_SEPOLIA_USDB_ADDRESS");
    // let claimerAddress = ensureEnvVar("BLAST_SEPOLIA_CLAIMER_ADDRESS");
    let timelockAddress = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");
    let bfxAddress = ensureEnvVar("BLAST_RABBIT_PROXY_ADDRESS");
    // let usdbfxAddress = ensureEnvVar("USDBFX_ADDRESS");
    let usdbAddress = ensureEnvVar("BLAST_USDB_ADDRESS");
    let claimerAddress = ensureEnvVar("BLAST_CLAIMER_ADDRESS");

    let pointsAddress = ensureEnvVar("BLAST_POINTS_ADDRESS"); //always pass the mainnet adddress, it isn't used in the testnet
    let poolDepositOwner = deployer.address;

    const bfxDepositU = await upgrades.deployProxy(BfxDepositU,
        [
            timelockAddress,
            poolDepositOwner,
            bfxAddress,
            claimerAddress,
            pointsAddress,
            usdbAddress,
            ethers.parseUnits("0.1", 18), // minDeposit -- CHECK DECIMALS!!!
            [], // otherTokens
            [], // minDeposits for other tokens
        ],
        {
            initializer: 'initialize(address,address,address,address,address,address,uint256,address[],uint256[])',
            kind: 'uups'
        }
    );

    await bfxDepositU.waitForDeployment();
    console.log("BfxDepositU deployed to:", await bfxDepositU.getAddress());

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(await bfxDepositU.getAddress());
    console.log("Implementation address:", implementationAddress);

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Verify contracts on Etherscan
    console.log("Verifying contracts...");
    await verify(await bfxDepositU.getAddress(), []); // Proxy doesn't need constructor args
    await verify(implementationAddress, []);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });