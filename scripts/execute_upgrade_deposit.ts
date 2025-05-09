import { ensureEnvVar } from "../test/util";
import { executeUpgrade } from "./execute_upgrade";

async function main() {
    const contract = "BfxDepositU";
    const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    const proxyAddress = ensureEnvVar("BLAST_SEPOLIA_DEPOSIT_PROXY_ADDRESS");
    const newImplementationAddress = ensureEnvVar("BLAST_SEPOLIA_DEPOSIT_IMPL_NEW_ADDRESS");
    const salt = ensureEnvVar("BLAST_SEPOLIA_DEPOSIT_UPGRADE_SALT");
    // const contract = "PoolDepositU";
    // const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // const proxyAddress = ensureEnvVar("SEPOLIA_DEPOSIT_PROXY_ADDRESS");
    // const newImplementationAddress = ensureEnvVar("SEPOLIA_DEPOSIT_IMPL_NEW_ADDRESS");
    // const salt = ensureEnvVar("SEPOLIA_DEPOSIT_UPGRADE_SALT");
    await executeUpgrade(
        contract,
        proxyAddress,
        timelockAddress,
        newImplementationAddress,
        salt
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });