import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    const BfxU = await ethers.getContractFactory("BfxU");

    // let timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    // // let usdbfxAddress = ensureEnvVar("USDBFX_ADDRESS");
    // let usdbAddress = ensureEnvVar("BLAST_SEPOLIA_USDB_ADDRESS");
    // let claimerAddress = ensureEnvVar("BLAST_SEPOLIA_CLAIMER_ADDRESS");
    // let pointsAddress = ensureEnvVar("BLAST_POINTS_ADDRESS"); //pass the mainnet adddress, it isn't used in the testnet
    
    // let kmsSignerAddress = ensureEnvVar("TESTNET_KMS_SIGNER_ADDRESS");

    let timelockAddress = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");
    let usdbAddress = ensureEnvVar("BLAST_USDB_ADDRESS");
    let claimerAddress = ensureEnvVar("BLAST_CLAIMER_ADDRESS");
    // let timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    // let usdbAddress = ensureEnvVar("BLAST_SEPOLIA_USDB_ADDRESS");
    // let claimerAddress = ensureEnvVar("BLAST_SEPOLIA_CLAIMER_ADDRESS");
    let pointsAddress = ensureEnvVar("BLAST_POINTS_ADDRESS"); //always pass the mainnet adddress, it isn't used in the testnet
    
    let kmsSignerAddress = ensureEnvVar("BLAST_KMS_SIGNER_ADDRESS");
    let bfxOwner = deployer.address;

    const bfxU = await upgrades.deployProxy(BfxU,
        [
            timelockAddress,
            bfxOwner,
            kmsSignerAddress,
            claimerAddress,
            pointsAddress,
            usdbAddress,
            ethers.parseUnits("0.1", 18), // minDeposit CHECK DECIMALS!
            true, // rebasing
            [], // otherTokens
            [], // minDeposits for other tokens
            [], // rebasing for ither tokens
        ],
        {
            initializer: 'initialize(address,address,address,address,address,address,uint256,bool,address[],uint256[],bool[])',
            kind: 'uups'
        }
    );

    await bfxU.waitForDeployment();
    console.log("BfxU deployed to:", await bfxU.getAddress());

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(await bfxU.getAddress());
    console.log("Implementation address:", implementationAddress);

    // Add a 30-second delay before verification
    console.log("Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log("Verifying contract...");
    await verify(await bfxU.getAddress(), []);
    await verify(implementationAddress, []);

    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });