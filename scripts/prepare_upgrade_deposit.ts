import { ensureEnvVar } from "../test/util";
import { prepareUpgrade } from "./prepare_upgrade";

async function main() {
    const USE_ETHERSCAN = true;
    // const contract = "BfxDepositU";
    // const proxyAddress = ensureEnvVar("BLAST_DEPOSIT_PROXY_ADDRESS");
    // const timelockAddress = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");
    // const proxyAddress = ensureEnvVar("BLAST_SEPOLIA_DEPOSIT_PROXY_ADDRESS");
    // const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");

    const contract = "PoolDepositU";
    // const proxyAddress = ensureEnvVar("ETHEREUM_DEPOSIT_PROXY_ADDRESS");
    // const timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
    const proxyAddress = ensureEnvVar("SEPOLIA_DEPOSIT_PROXY_ADDRESS");
    const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // const proxyAddress = ensureEnvVar("BASE_SEPOLIA_DEPOSIT_PROXY_ADDRESS");
    // const timelockAddress = ensureEnvVar("BASE_SEPOLIA_TIMELOCK_ADDRESS");
    // const proxyAddress = ensureEnvVar("SONIC_BLAZE_DEPOSIT_PROXY_ADDRESS");
    // const timelockAddress = ensureEnvVar("SONIC_BLAZE_TIMELOCK_ADDRESS");
    // const proxyAddress = ensureEnvVar("ARBITRUM_SEPOLIA_DEPOSIT_PROXY_ADDRESS");
    // const timelockAddress = ensureEnvVar("ARBITRUM_SEPOLIA_TIMELOCK_ADDRESS");
    // const proxyAddress = ensureEnvVar("BSC_TESTNET_DEPOSIT_PROXY_ADDRESS");
    // const timelockAddress = ensureEnvVar("BSC_TESTNET_TIMELOCK_ADDRESS");
    console.log('Preparing upgrade of', contract, proxyAddress);
    await prepareUpgrade(contract, proxyAddress, timelockAddress, USE_ETHERSCAN);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });