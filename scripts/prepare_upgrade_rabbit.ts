import { ensureEnvVar } from "../test/util";
import { prepare } from "./prepare_upgrade";

async function main() {
  const contract = "RabbitU";
  const proxyAddress = ensureEnvVar("SEPOLIA_RABBIT_PROXY_ADDRESS");
  const timelockAddress = ensureEnvVar("SEPOLIA_TIMELOCK_ADDRESS");
  prepare(contract, proxyAddress, timelockAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });