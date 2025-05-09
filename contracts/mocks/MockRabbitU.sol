// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockRabbitU
 * @dev A simplified mock version of RabbitU for testing purposes
 */
contract MockRabbitU {
    address public timelock;
    address public defaultToken;
    uint256 constant UNLOCKED = 1;
    uint256 constant LOCKED = 2;
    uint256 reentryLockStatus;

    mapping(address => bool) public authorizedVaults;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public minDeposits;

    event VaultAuthorized(address indexed vault);
    event VaultRevoked(address indexed vault);
    event VaultWithdrawal(
        address indexed vault,
        address indexed receiver,
        address indexed asset,
        uint256 amount
    );

    modifier onlyTimelock() {
        require(msg.sender == timelock, "ONLY_TIMELOCK");
        _;
    }

    modifier nonReentrant() {
        require(reentryLockStatus == UNLOCKED, "NO_REENTRY");
        reentryLockStatus = LOCKED;
        _;
        reentryLockStatus = UNLOCKED;
    }

    constructor() {
        reentryLockStatus = UNLOCKED;
    }

    // Function to initialize the mock for testing
    function initialize(
        address _timelock,
        address _defaultToken
    ) external {
        timelock = _timelock;
        defaultToken = _defaultToken;
        supportedTokens[_defaultToken] = true;
    }

    // Function to set a token as supported for testing
    function setSupportedToken(address token, bool isSupported) external {
        supportedTokens[token] = isSupported;
    }

    /**
     * @notice Authorizes a vault to withdraw assets
     * @param vault The address of the vault to authorize
     */
    function authorizeVault(address vault) external onlyTimelock {
        require(vault != address(0), "ZERO_ADDRESS");
        authorizedVaults[vault] = true;
        emit VaultAuthorized(vault);
    }

    /**
     * @notice Revokes a vault's authorization to withdraw assets
     * @param vault The address of the vault to revoke authorization from
     */
    function revokeVault(address vault) external onlyTimelock {
        authorizedVaults[vault] = false;
        emit VaultRevoked(vault);
    }

    /**
     * @notice Allows authorized vaults to withdraw assets
     * @param asset The token address to withdraw
     * @param amount The amount to withdraw
     * @param receiver The address that will receive the assets
     */
    function withdrawToVault(
        address asset,
        uint256 amount,
        address receiver
    ) external nonReentrant {
        // Security checks - same as production contract
        require(authorizedVaults[msg.sender], "NOT_AUTHORIZED_VAULT");
        require(supportedTokens[asset], "UNSUPPORTED_TOKEN");
        require(amount > 0, "AMOUNT_TOO_SMALL");
        require(receiver != address(0), "INVALID_RECEIVER");
        
        // Check if the exchange has enough balance
        uint256 exchangeBalance = IERC20(asset).balanceOf(address(this));
        require(exchangeBalance >= amount, "INSUFFICIENT_BALANCE");
        
        // Transfer the assets from this mock to the receiver
        bool success = IERC20(asset).transfer(receiver, amount);
        require(success, "TRANSFER_FAILED");
        
        // Emit the event
        emit VaultWithdrawal(msg.sender, receiver, asset, amount);
    }
}