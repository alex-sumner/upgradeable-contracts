import { ethers, upgrades } from "hardhat";
import { verify } from "./verify";
import { ensureEnvVar } from "../test/util";

async function main() {

    // const contractAddress = ensureEnvVar("BLAST_RABBIT_IMPL_ADDRESS");
    // const contractAddress= ensureEnvVar("BLAST_SEPOLIA_RABBIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("SEPOLIA_RABBIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BASE_SEPOLIA_RABBIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BASE_SEPOLIA_DEPOSIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("SONIC_BLAZE_DEPOSIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BSC_TESTNET_DEPOSIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("ARBITRUM_SEPOLIA_DEPOSIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("SONIC_BLAZE_RABBIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("ARBITRUM_SEPOLIA_RABBIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("MAINNET_RABBIT_IMPL_ADDRESS");
    const contractAddress = ensureEnvVar("SEPOLIA_RABBIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("SEPOLIA_VAULT_IMPL_ADDRESS");  
    // const contractAddress = ensureEnvVar("SEPOLIA_DEPOSIT_IMPL_ADDRESS");  
    // const contractAddress = ensureEnvVar("ETHEREUM_DEPOSIT_IMPL_ADDRESS");  
    // const contractAddress = ensureEnvVar("BLAST_SEPOLIA_DEPOSIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BLAST_DEPOSIT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BLAST_SEPOLIA_VAULT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BLAST_VAULT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("SONIC_BLAZE_VAULT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("ARBITRUM_SEPOLIA_VAULT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BASE_SEPOLIA_VAULT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("BSC_TESTNET_VAULT_IMPL_ADDRESS");
    // const contractAddress = ensureEnvVar("SONIC_BLAZE_TIMELOCK_ADDRESS");
    // const contractAddress = ensureEnvVar("ARBITRUM_SEPOLIA_TIMELOCK_ADDRESS");
    const [deployer] = await ethers.getSigners();
    console.log("Verifying contract", contractAddress, "from account", deployer.address);
    // await verify(contractAddress, []);
    // let ledgerAAddress = ensureEnvVar("LEDGER_A_ADDRESS")
    // let ledgerMAddress = ensureEnvVar("LEDGER_M_ADDRESS")
    // let timelockAdmin = ethers.ZeroAddress;
    // const minDelay = 10;
    // const proposers = [deployer.address, ledgerAAddress, ledgerMAddress];
    // const executors = [deployer.address, ledgerAAddress, ledgerMAddress];
    // await verify(contractAddress, [minDelay, proposers, executors, timelockAdmin]);
    await verify(contractAddress, []);
    console.log("Deployment and verification complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });