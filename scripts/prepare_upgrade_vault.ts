import { ensureEnvVar } from "../test/util";
import { prepareUpgrade } from "./prepare_upgrade";

async function main() {
  const USE_ETHERSCAN = true;
  const contract = "VaultU";
  const proxyAddress = ensureEnvVar("SEPOLIA_VAULT_PROXY_ADDRESS");
  const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("SONIC_BLAZE_VAULT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("SONIC_BLAZE_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("ARBITRUM_SEPOLIA_VAULT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("ARBITRUM_SEPOLIA_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("BASE_SEPOLIA_VAULT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BASE_SEPOLIA_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("BSC_TESTNET_VAULT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BSC_TESTNET_TIMELOCK_ADDRESS");
  // const contract = "BfxVaultU";
  // const proxyAddress = ensureEnvVar("BLAST_VAULT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BLAST_TIMELOCK_ADDRESS");
  // const proxyAddress = ensureEnvVar("BLAST_SEPOLIA_VAULT_PROXY_ADDRESS");
  // const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
  await prepareUpgrade(contract, proxyAddress, timelockAddress, USE_ETHERSCAN);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
