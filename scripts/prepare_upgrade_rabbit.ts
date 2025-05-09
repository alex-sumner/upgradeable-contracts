import { ensureEnvVar } from "../test/util";
import { prepareUpgrade } from "./prepare_upgrade";

async function main() {
  const USE_ETHERSCAN = true;
  // const contract = "BfxU";
  // const proxyAddress = ensureEnvVar("BLAST_RABBIT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
  const contract = "RabbitU";
  // const proxyAddress = ensureEnvVar("ETHEREUM_RABBIT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("ETHEREUM_TIMELOCK_ADDRESS");
  const proxyAddress = ensureEnvVar("SEPOLIA_RABBIT_PROXY_ADDRESS");
  const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("BASE_SEPOLIA_RABBIT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BASE_SEPOLIA_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("SONIC_BLAZE_RABBIT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("SONIC_BLAZE_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("ARBITRUM_SEPOLIA_RABBIT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("ARBITRUM_SEPOLIA_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("BSC_TESTNET_RABBIT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BSC_TESTNET_TIMELOCK_ADDRESS");
  console.log('preparing upgrade of', contract, proxyAddress);
  await prepareUpgrade(contract, proxyAddress, timelockAddress, USE_ETHERSCAN);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });