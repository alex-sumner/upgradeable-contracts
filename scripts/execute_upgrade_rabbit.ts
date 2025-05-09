import { ensureEnvVar } from "../test/util";
import { executeUpgrade } from "./execute_upgrade";

async function main() {
    const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    const proxyAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_PROXY_ADDRESS");
    const newImplementationAddress = ensureEnvVar("BLAST_SEPOLIA_RABBIT_IMPL_NEW_ADDRESS");
    const salt = ensureEnvVar("BLAST_SEPOLIA_RABBIT_UPGRADE_SALT");
    const contract = "BfxU";
    // const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    // const proxyAddress = ensureEnvVar("SEPOLIA_RABBIT_PROXY_ADDRESS");
    // const newImplementationAddress = ensureEnvVar("SEPOLIA_RABBIT_IMPL_NEW_ADDRESS");
    // const salt = ensureEnvVar("SEPOLIA_RABBIT_UPGRADE_SALT");
    // const contract = "RabbitU";
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