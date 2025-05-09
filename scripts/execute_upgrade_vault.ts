import { ensureEnvVar } from "../test/util";
import { executeUpgrade } from "./execute_upgrade";

async function main() {
    const timelockAddress = ensureEnvVar("BLAST_SEPOLIA_TIMELOCK_ADDRESS");
    const proxyAddress = ensureEnvVar("BLAST_SEPOLIA_VAULT_PROXY_ADDRESS");
    const newImplementationAddress = ensureEnvVar("BLAST_SEPOLIA_VAULT_IMPL_NEW_ADDRESS");
    const salt = ensureEnvVar("BLAST_SEPOLIA_VAULT_UPGRADE_SALT");
    await executeUpgrade(
        "BfxVaultU",
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
