import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-gas-reporter";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
dotenv.config();

const fiftyEth: string = "50000000000000000000"
const l1MmAccount1PrivateKey: string = process.env.L1_MM_ACCOUNT_1_PRIVATE_KEY as string;
const l1MmAccount2PrivateKey: string = process.env.L1_MM_ACCOUNT_2_PRIVATE_KEY as string;
const l1RbxDeployerPrivateKey: string = process.env.RBX_DEPLOYER_PRIVATE_KEY as string;
const l1OwnerPrivateKey: string = process.env.L1_OWNER_PRIVATE_KEY as string;
const l1TraderPrivateKey: string = process.env.L1_TRADER_PRIVATE_KEY as string;
const tokenOwnerPrivateKey: string = process.env.DUMMY_TOKEN_OWNER_PK as string;
const etherscanApiKey: string = process.env.ETHERSCAN_API_KEY as string;


const goerliUrl: string = process.env.ALCHEMY_GOERLI_URL as string;
const sepoliaUrl: string = process.env.ALCHEMY_SEPOLIA_URL as string;
const mainnetUrl: string = process.env.ALCHEMY_MAINNET_URL as string;
const blastSepoliaUrl: string = process.env.BLAST_SEPOLIA_URL as string;
const blastUrl: string = process.env.BLAST_URL as string;
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
    apiKey: etherscanApiKey,
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
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/81457/etherscan",
          browserURL: "https://blastscan.io"
        }
      }
    ]

    // apiURL: "https://api.blastscan.io/api",
  },

  networks: {
    devnet: {
      url: "http://127.0.0.1:5050",
      accounts: [l1OwnerPrivateKey, l1TraderPrivateKey, tokenOwnerPrivateKey]
    },
    hardhat: {
      forking: {
        url: mainnetUrl,
      },
      gasPrice: 0,
      initialBaseFeePerGas: 0,
      loggingEnabled: false,
      accounts: [
        { privateKey: l1OwnerPrivateKey, balance: fiftyEth },
        { privateKey: l1TraderPrivateKey, balance: fiftyEth }
      ]
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      accounts: [l1OwnerPrivateKey, l1TraderPrivateKey]
    },
    sepolia: {
      url: sepoliaUrl,
      accounts: [l1OwnerPrivateKey, l1TraderPrivateKey, tokenOwnerPrivateKey]
    },
    mainnet: {
      url: mainnetUrl,
      // accounts: [l1MmAccount1PrivateKey, l1MmAccount2PrivateKey]
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey]
    },
    "blast-sepolia": {
      url: blastSepoliaUrl,
      accounts: [l1OwnerPrivateKey, l1TraderPrivateKey, tokenOwnerPrivateKey],
      gasPrice: 1000000000,
    },
    "blast-mainnet": {
      url: blastUrl,
      accounts: [l1RbxDeployerPrivateKey, l1MmAccount2PrivateKey],
      gasPrice: 1000000000,
    },
  },
};

export default config;
