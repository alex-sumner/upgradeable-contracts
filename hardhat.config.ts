import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "@nomicfoundation/hardhat-verify";

import "@typechain/hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const fiftyEth: string = "50000000000000000000"
const l1MmAccount1PrivateKey: string = process.env.L1_MM_ACCOUNT_1_PRIVATE_KEY as string;
const l1MmAccount2PrivateKey: string = process.env.L1_MM_ACCOUNT_2_PRIVATE_KEY as string;
const l1RbxDeployerPrivateKey: string = process.env.RBX_DEPLOYER_PRIVATE_KEY as string;
const l1OwnerPrivateKey: string = process.env.L1_OWNER_PRIVATE_KEY as string;
const l1TraderPrivateKey: string = process.env.L1_TRADER_PRIVATE_KEY as string;
const l1SignerPrivateKey: string = process.env.L1_SIGNER_PRIVATE_KEY as string;
const l1TimelockPrivateKey: string = process.env.L1_TIMELOCK_PRIVATE_KEY as string;
const l1User1PrivateKey: string = process.env.L1_USER1_PRIVATE_KEY as string;
const l1User2PrivateKey: string = process.env.L1_USER2_PRIVATE_KEY as string;
const l1User3PrivateKey: string = process.env.L1_USER3_PRIVATE_KEY as string;
const tokenOwnerPrivateKey: string = process.env.DUMMY_TOKEN_OWNER_PK as string;
const etherscanApiKey: string = process.env.ETHERSCAN_API_KEY as string;
const blastscanApiKey: string = process.env.BLASTSCAN_API_KEY as string;
const basescanApiKey: string = process.env.BASESCAN_API_KEY as string;
const sonicscanApiKey: string = process.env.SONICSCAN_API_KEY as string;
const sonicscanBlazeApiKey: string = process.env.SONICSCAN_BLAZE_API_KEY as string;
const arbiscanApiKey: string = process.env.ARBISCAN_API_KEY as string;
const sonicscanApiUrl: string = process.env.SONICSCAN_API_URL as string;
const sonicscanBlazeApiUrl: string = process.env.SONICSCAN_BLAZE_API_URL as string;
const arbitrumOneApiUrl: string = process.env.ARBISCAN_API_URL as string;
const arbitrumSepoliaApiUrl: string = process.env.ARBISCAN_SEPOLIA_API_URL as string;

const sepoliaUrl: string = process.env.ALCHEMY_SEPOLIA_URL as string;
const mainnetUrl: string = process.env.ALCHEMY_MAINNET_URL as string;
const blastSepoliaUrl: string = process.env.BLAST_SEPOLIA_URL as string;
const blastUrl: string = process.env.BLAST_URL as string;
const baseUrl: string = process.env.ALCHEMY_BASE_URL as string;
const baseSepoliaUrl: string = process.env.ALCHEMY_BASE_SEPOLIA_URL as string;
const sonicUrl = process.env.SONIC_URL as string;
const sonicBlazeUrl = process.env.SONIC_BLAZE_URL as string;
const arbitrumOneUrl: string = process.env.ARBITRUM_ONE_URL as string;
const arbitrumSepoliaUrl: string = process.env.ARBITRUM_SEPOLIA_URL as string;
const bscUrl: string = process.env.BSC_URL as string;
const bscTestnetUrl: string = process.env.BSC_TESTNET_URL as string;
const bscscanApiKey: string = process.env.BSCSCAN_API_KEY as string;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        details: {
          yulDetails: {
            optimizerSteps: "u",
          },
        },
      },
    },
  },
  // solidity: "0.8.24",
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  // starknet: {
  etherscan: {
    // apiKey: etherscanApiKey,
    apiKey: {
      mainnet: etherscanApiKey,
      sepolia: etherscanApiKey,
      "blast-sepolia": blastscanApiKey,
      "blast-mainnet": blastscanApiKey,
      "base-sepolia": basescanApiKey,
      "base-mainnet": basescanApiKey,
      sonic: sonicscanApiKey,
      sonicTestnet: sonicscanBlazeApiKey,
      arbitrumOne: arbiscanApiKey,
      arbitrumSepolia: arbiscanApiKey,
      bsc: bscscanApiKey,
      bscTestnet: bscscanApiKey
    },
    customChains: [
      {
        network: "blast-sepolia",
        chainId: 168587773,
        urls: {
          apiURL: "https://api-sepolia.blastscan.io/api",
          browserURL: "https://sepolia.blastscan.io"
          // apiURL: "https://api.routescan.io/v2/network/testnet/evm/168587773/etherscan",
          // browserURL: "https://sepolia.blastscan.io"
        }
      },
      {
        network: "blast-mainnet",
        chainId: 81457,
        urls: {
          apiURL: "https://api.blastscan.io/api",
          // apiURL: "https://api.routescan.io/v2/network/mainnet/evm/81457/etherscan",
          browserURL: "https://blastscan.io"
        }
      },
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base-mainnet",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "sonic",
        chainId: 146,
        urls: {
          apiURL: sonicscanApiUrl,
          browserURL: "https://sonicscan.org/",
        },
      },
      {
        network: "sonicTestnet",
        chainId: 57054,
        urls: {
          apiURL: sonicscanBlazeApiUrl,
          browserURL: "https://sonicscan.org/",
        },
      },
      {
        network: "arbitrumOne",
        chainId: 42161,
        urls: {
          apiURL: arbitrumOneApiUrl,
          browserURL: "https://arbiscan.io/",
        },
      },
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: arbitrumSepoliaApiUrl,
          browserURL: "https://sepolia.arbiscan.io/",
        },
      },
      {
        network: "bsc",
        chainId: 56,
        urls: {
          apiURL: "https://api.bscscan.com/api",
          browserURL: "https://bscscan.com"
        }
      },
      {
        network: "bscTestnet",
        chainId: 97,
        urls: {
          apiURL: "https://api-testnet.bscscan.com/api",
          browserURL: "https://testnet.bscscan.com"
        }
      }
    ],
  },

  networks: {
    hardhat: {
      forking: {
        url: mainnetUrl,
        enabled: false
      },
      accounts: [
        {
          privateKey: l1RbxDeployerPrivateKey,
          balance: fiftyEth
        },
        {
          privateKey: l1TraderPrivateKey,
          balance: fiftyEth
        },
        {
          privateKey: l1SignerPrivateKey,
          balance: fiftyEth
        },
        {
          privateKey: l1TimelockPrivateKey,
          balance: fiftyEth
        },
        {
          privateKey: l1User1PrivateKey,
          balance: fiftyEth
        },
        {
          privateKey: l1User2PrivateKey,
          balance: fiftyEth
        },
        {
          privateKey: l1User3PrivateKey,
          balance: fiftyEth
        }
      ]
    },
    devnet: {
      url: "http://127.0.0.1:5050",
      accounts: [l1RbxDeployerPrivateKey, l1TraderPrivateKey, l1MmAccount1PrivateKey, l1MmAccount2PrivateKey]
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      accounts: [l1RbxDeployerPrivateKey, l1TraderPrivateKey, l1MmAccount1PrivateKey, l1MmAccount2PrivateKey]
    },
    sepolia: {
      url: sepoliaUrl as string,
      accounts: [l1RbxDeployerPrivateKey, l1TraderPrivateKey, tokenOwnerPrivateKey],
    },
    mainnet: {
      url: mainnetUrl,
      // accounts: [l1MmAccount1PrivateKey, l1MmAccount2PrivateKey]
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey]
    },
    "blast-sepolia": {
      url: blastSepoliaUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      gasPrice: 1000000000,
    },
    "blast-mainnet": {
      url: blastUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      gasPrice: 1000000000,
    },
    "base-sepolia": {
      url: baseSepoliaUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      gasPrice: "auto",
      chainId: 84532,
    },
    "base-mainnet": {
      url: baseUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      gasPrice: "auto",
      chainId: 8453,
    },
    sonic: {
      url: sonicUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      chainId: 146,
    },
    sonicTestnet: {
      url: sonicBlazeUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      chainId: 57054,
    },
    arbitrumOne: {
      url: arbitrumOneUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      chainId: 42161,
    },
    arbitrumSepolia: {
      url: arbitrumSepoliaUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      chainId: 421614,
    },
    bsc: {
      url: bscUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      chainId: 56,
      gasPrice: "auto",
    },
    "bsc-testnet": {
      url: bscTestnetUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      chainId: 97,
      gasPrice: "auto",
    }
  },
  sourcify: {
    enabled: false
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

//console.log("Etherscan config:", config.etherscan);

export default config;
