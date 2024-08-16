import { ensureEnvVar } from "../test/util";
import { execute } from "./execute_upgrade";

async function main() {
    const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
    const proxyAddress = ensureEnvVar("SEPOLIA_VAULT_PROXY_ADDRESS");
    const newImplementationAddress = ensureEnvVar("SEPOLIA_VAULT_IMPL_NEW_ADDRESS");
    execute("VaultU", proxyAddress, timelockAddress, newImplementationAddress);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
