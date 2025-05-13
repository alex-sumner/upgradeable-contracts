pragma solidity ^0.8.0;
// SPDX-License-Identifier: MIT

import "./IERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

// Interface for RabbitX Exchange
interface IRabbitX {
    function withdrawToVault(
        address asset,
        uint256 amount,
        address receiver
    ) external;
}

/**
 * @title Vault7540
 * @dev Implementation of an ERC-7540 Asynchronous ERC-4626 Vault
 *      This contract fully implements the ERC-7540 standard for asynchronous deposits and withdrawals
 *      Directly implements the ERC-20 functionality for share tokens
 */
contract Vault7540 is
    UUPSUpgradeable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    IERC4626
{
    using Math for uint256;

    bytes4 private constant ERC7540_INTERFACE_ID = 0xd1be45d1;
    uint256 public constant ADMIN_ROLE = 0;
    uint256 public constant TRADER_ROLE = 1;
    uint256 public constant TREASURER_ROLE = 2;
    uint256 public constant NAV_UPDATER_ROLE = 3;
    uint256 public constant BASIS_POINTS = 10000;
    uint8 private _assetDecimals;

    address public timelock;
    address public rabbitx;
    address private _asset;

    uint256 public entryFeeRate; // in basis points (1% = 100)
    uint256 public exitFeeRate; // in basis points (1% = 100)
    uint256 public nav; // Net Asset Value with asset decimals
    uint256 public globalSupply; // Global supply of vault shares, including those on other chains
    uint256 public redeemDelay; // Minimum time (in seconds) between redeem request and processing

    // Role management
    bool public ownerIsSoleAdmin;
    mapping(address => mapping(uint256 => bool)) public signers;

    // Operator approval for ERC-7540
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // Request tracking
    uint256 public nextRequestId;
    uint256 public lastProcessedRequestId;

    enum RequestStatus {
        Pending,
        Claimable,
        Claimed,
        Cancelled
    }

    enum RequestType {
        Deposit,
        Redeem
    }

    struct RequestForDeposit {
        uint256 id;
        address controller;
        address owner;
        address sender;
        uint256 assets;
        uint256 shares;
        uint256 timestamp;
        RequestStatus status;
    }

    struct RequestForRedeem {
        uint256 id;
        address controller;
        address owner;
        address receiver;
        uint256 shares;
        uint256 assets;
        uint256 timestamp;
        RequestStatus status;
    }

    mapping(uint256 => RequestForDeposit) public depositRequests;
    mapping(uint256 => RequestForRedeem) public redeemRequests;
    mapping(uint256 => RequestType) public requestTypes;
    mapping(address => uint256[]) public controllerDepositRequests;
    mapping(address => uint256[]) public controllerRedeemRequests;

    // ERC-4626 Events (from interface)
    // ERC-7540 Events
    event OperatorSet(
        address indexed controller,
        address indexed operator,
        bool approved
    );
    event DepositRequest(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        address sender,
        uint256 assets
    );
    event RedeemRequest(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        address receiver,
        uint256 shares
    );
    event ClaimDeposit(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        uint256 assets,
        uint256 shares
    );
    event ClaimRedeem(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        address receiver,
        uint256 assets,
        uint256 shares
    );
    event CancelDepositRequest(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        uint256 assets
    );
    event CancelRedeemRequest(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        uint256 shares
    );

    // Additional events
    event FeesUpdated(uint256 entryFeeRate, uint256 exitFeeRate);
    event NavUpdated(
        address indexed updater,
        uint256 oldNav,
        uint256 newNav,
        uint256 oldGlobalSupply,
        uint256 newGlobalSupply
    );
    event AddRole(
        address indexed user,
        uint256 indexed role,
        address indexed caller
    );
    event RemoveRole(
        address indexed user,
        uint256 indexed role,
        address indexed caller
    );
    event Withdrawal(address indexed to, uint256 amount, address indexed token);
    event SetRabbitX(address indexed rabbitx);
    event RequestMadeClaimable(uint256 indexed requestId, bool isDeposit);
    event Stake(address indexed user, uint256 amount, address indexed token);
    event RedeemDelayUpdated(uint256 oldDelay, uint256 newDelay);

    // Modifiers
    modifier onlyTimelock() {
        require(msg.sender == timelock, "ONLY_TIMELOCK");
        _;
    }

    modifier onlyAdmin() {
        if (ownerIsSoleAdmin) {
            address currentOwner = owner();
            require(msg.sender == currentOwner, "NOT_OWNER");
        } else {
            require(signers[msg.sender][ADMIN_ROLE], "NOT_AN_ADMIN");
        }
        _;
    }

    modifier onlyNavUpdater() {
        require(signers[msg.sender][NAV_UPDATER_ROLE], "NOT_NAV_UPDATER");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "ONLY_SELF_CALL");
        _;
    }

    modifier onlyControllerOrOperator(address controller) {
        require(
            msg.sender == controller ||
                _operatorApprovals[controller][msg.sender],
            "NOT_AUTHORIZED"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the vault
     * @param _timelock Timelock controller address
     * @param _owner Initial owner address
     * @param _rabbitx RabbitX exchange address
     * @param assetTokenAddress Underlying asset token address
     * @param _entryFeeRate Entry fee rate in basis points
     * @param _exitFeeRate Exit fee rate in basis points
     * @param name_ Token name
     * @param symbol_ Token symbol
     */
    function initialize(
        address _timelock,
        address _owner,
        address _rabbitx,
        address assetTokenAddress,
        uint256 _entryFeeRate,
        uint256 _exitFeeRate,
        string memory name_,
        string memory symbol_
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ERC20_init(name_, symbol_);

        timelock = _timelock;
        signers[_owner][ADMIN_ROLE] = true;
        signers[_owner][TREASURER_ROLE] = true;
        signers[_owner][NAV_UPDATER_ROLE] = true;
        rabbitx = _rabbitx;
        _asset = assetTokenAddress;

        require(_entryFeeRate <= 1000, "ENTRY_FEE_TOO_HIGH"); // Max 10%
        require(_exitFeeRate <= 1000, "EXIT_FEE_TOO_HIGH"); // Max 10%
        entryFeeRate = _entryFeeRate;
        exitFeeRate = _exitFeeRate;

        // Get the decimals of the asset token
        _assetDecimals = IERC20Metadata(_asset).decimals();

        // Initialize the NAV to 0 - no assets yet
        nav = 0;
        // Initialize the global supply to 0 - no shares yet
        globalSupply = 0;
        // Initialize request ID counter
        nextRequestId = 1;
        // Initialize request ID tracker
        lastProcessedRequestId = 0;
        // Initialize redeemDelay to 24 hours (in seconds)
        redeemDelay = 24 hours;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyTimelock {}

    /**
     * @notice Implementation of ERC-165 for interface detection
     * @param interfaceId The interface identifier to check
     * @return true if this contract implements the interface
     */
    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == ERC7540_INTERFACE_ID;
    }

    // ERC-4626 interface implementation

    /**
     * @notice Returns the address of the underlying asset token
     * @return assetTokenAddress The address of the asset token
     */
    function asset()
        external
        view
        override
        returns (address assetTokenAddress)
    {
        return _asset;
    }

    /**
     * @notice Returns the decimals of the asset token
     * @return The decimals of the asset token
     */
    function assetDecimals() public view returns (uint8) {
        return _assetDecimals;
    }

    /**
     * @notice Returns total assets managed by the vault
     * @return The amount of assets managed by the vault
     */
    function totalAssets() external view override returns (uint256) {
        if (globalSupply == 0) {
            return nav;
        } else {
            return (nav * totalSupply()) / globalSupply;
        }
    }

    /**
     * @notice Get the current share price based on NAV
     * @return The share price with the same decimals as the asset
     */
    function getSharePrice() public view returns (uint256) {
        if (globalSupply == 0) {
            // Return 1.0 with the same number of decimals as the asset
            return 10 ** uint256(_assetDecimals);
        } else {
            // Return NAV divided by global supply
            // NAV has asset decimals, supply has 18 decimals (ERC20 default)
            return (nav * 10 ** 18) / globalSupply;
        }
    }

    /**
     * @notice Convert asset amount to share amount
     * @param assets Amount of assets to convert
     * @return shares Equivalent amount of shares
     */
    function convertToShares(
        uint256 assets
    ) public view override returns (uint256 shares) {
        if (globalSupply == 0) {
            // For first deposit, create 1:1 shares (adjusted for decimals)
            if (_assetDecimals <= 18) {
                uint256 decimalDifference = 18 - uint256(_assetDecimals);
                return assets * (10 ** decimalDifference);
            } else {
                // In the unlikely case asset has more than 18 decimals
                uint256 decimalDifference = uint256(_assetDecimals) - 18;
                return assets / (10 ** decimalDifference);
            }
        }

        // It's an error if NAV is zero but supply isn't
        if (nav == 0) {
            revert("NAV_IS_ZERO");
        }

        return (assets * globalSupply) / nav;
    }

    /**
     * @notice Convert share amount to asset amount
     * @param shares Amount of shares to convert
     * @return assets Equivalent amount of assets
     */
    function convertToAssets(
        uint256 shares
    ) public view override returns (uint256 assets) {
        if (globalSupply == 0) {
            // If no shares exist yet, convert 1:1 (adjusted for decimals)
            if (_assetDecimals <= 18) {
                uint256 decimalDifference = 18 - uint256(_assetDecimals);
                return shares / (10 ** decimalDifference);
            } else {
                // In the unlikely case asset has more than 18 decimals
                uint256 decimalDifference = uint256(_assetDecimals) - 18;
                return shares * (10 ** decimalDifference);
            }
        }

        // It's an error if NAV is zero but supply isn't
        if (nav == 0) {
            revert("NAV_IS_ZERO");
        }

        // For existing supply, calculate based on NAV and total supply
        // assets = shares * nav / totalSupply
        return (shares * nav) / globalSupply;
    }

    /**
     * @notice Calculate fee for a given asset amount
     * @param assets Amount of assets
     * @param feeRate Fee rate in basis points
     * @return Fee amount
     */
    function calculateFee(
        uint256 assets,
        uint256 feeRate
    ) public pure returns (uint256) {
        return (assets * feeRate) / BASIS_POINTS;
    }

    /**
     * @notice Maximum amount of assets that can be deposited for a given address
     * @dev Always reverts to comply with ERC-7540 for async deposits
     * @param user The address to check (unused in implementation)
     */
    function maxDeposit(address user) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async deposits
        revert("ERC7540: use requestDeposit");
    }

    /**
     * @notice Preview the amount of shares that would be minted from a deposit
     * @dev Always reverts to comply with ERC-7540 for async deposits
     * @param assets The amount of assets to deposit (unused in implementation)
     */
    function previewDeposit(
        uint256 assets
    ) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async deposits
        revert("ERC7540: use requestDeposit");
    }

    /**
     * @notice Maximum amount of shares that can be minted for a given address
     * @dev Always reverts to comply with ERC-7540 for async deposits
     * @param user The address to check (unused in implementation)
     */
    function maxMint(address user) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async deposits
        revert("ERC7540: use requestDeposit");
    }

    /**
     * @notice Preview the amount of assets that would be deposited for minting shares
     * @dev Always reverts to comply with ERC-7540 for async deposits
     * @param shares The amount of shares to mint (unused in implementation)
     */
    function previewMint(
        uint256 shares
    ) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async deposits
        revert("ERC7540: use requestDeposit");
    }

    /**
     * @notice Maximum amount of assets that can be withdrawn by an address
     * @dev Always reverts to comply with ERC-7540 for async withdrawals
     * @param user The address to check (unused in implementation)
     */
    function maxWithdraw(
        address user
    ) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async withdrawals
        revert("ERC7540: use requestRedeem");
    }

    /**
     * @notice Preview the amount of shares that would be burned from a withdrawal
     * @dev Always reverts to comply with ERC-7540 for async withdrawals
     * @param assets The amount of assets to withdraw (unused in implementation)
     */
    function previewWithdraw(
        uint256 assets
    ) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async withdrawals
        revert("ERC7540: use requestRedeem");
    }

    /**
     * @notice Maximum amount of shares that can be redeemed by an address
     * @dev Always reverts to comply with ERC-7540 for async withdrawals
     * @param user The address to check (unused in implementation)
     */
    function maxRedeem(address user) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async withdrawals
        revert("ERC7540: use requestRedeem");
    }

    /**
     * @notice Preview the amount of assets that would be received from redeeming shares
     * @dev Always reverts to comply with ERC-7540 for async withdrawals
     * @param shares The amount of shares to redeem (unused in implementation)
     */
    function previewRedeem(
        uint256 shares
    ) external pure override returns (uint256) {
        // Always revert as per ERC-7540 specification for async withdrawals
        revert("ERC7540: use requestRedeem");
    }

    // ERC-7540 implementation: deposit and redeem with controller parameter

    /**
     * @notice Deposit assets into the vault using a controller
     * @param assets Amount of assets to deposit (unused, required for interface)
     * @param receiver Receiver of the shares (unused, required for interface)
     * @param controller The controller of the request
     * @return shares Amount of shares issued
     */
    function deposit(
        uint256 assets,
        address receiver,
        address controller
    ) external returns (uint256 shares) {
        // Find the most recently claimable deposit request for this controller
        uint256[] memory requests = controllerDepositRequests[controller];
        for (uint256 i = requests.length; i > 0; i--) {
            uint256 requestId = requests[i - 1];
            if (depositRequests[requestId].status == RequestStatus.Claimable) {
                return _claimDeposit(requestId);
            }
        }
        revert("NO_CLAIMABLE_DEPOSIT");
    }

    /**
     * @notice Legacy deposit from ERC-4626
     * @dev Reverts to conform with ERC-7540
     */
    function deposit(uint256, address) external override returns (uint256) {
        revert("ERC7540: use requestDeposit");
    }

    /**
     * @notice Mint shares from the vault
     * @param shareAmount Amount of shares to mint (unused, required for interface)
     * @param receiver Receiver of the shares (unused, required for interface)
     * @param controller The controller of the request
     * @return assets Amount of assets used
     */
    function mint(
        uint256 shareAmount,
        address receiver,
        address controller
    ) external returns (uint256 assets) {
        // Find the most recently claimable deposit request for this controller
        uint256[] memory requests = controllerDepositRequests[controller];
        for (uint256 i = requests.length; i > 0; i--) {
            uint256 requestId = requests[i - 1];
            if (depositRequests[requestId].status == RequestStatus.Claimable) {
                _claimDeposit(requestId);
                return depositRequests[requestId].assets;
            }
        }
        revert("NO_CLAIMABLE_DEPOSIT");
    }

    /**
     * @notice Legacy mint from ERC-4626
     * @dev Reverts to conform with ERC-7540
     */
    function mint(uint256, address) external override returns (uint256) {
        revert("ERC7540: use requestDeposit");
    }

    /**
     * @notice Withdraw assets from the vault using a controller
     * @param assetAmount Amount of assets to withdraw (unused, required for interface)
     * @param receiver Receiver of the assets (unused, required for interface)
     * @param shareOwner Owner of the shares (unused, required for interface)
     * @param controller The controller of the request
     * @return shares Amount of shares burned
     */
    function withdraw(
        uint256 assetAmount,
        address receiver,
        address shareOwner,
        address controller
    ) external returns (uint256 shares) {
        // Find the most recently claimable redeem request for this controller
        uint256[] memory requests = controllerRedeemRequests[controller];
        for (uint256 i = requests.length; i > 0; i--) {
            uint256 requestId = requests[i - 1];
            if (redeemRequests[requestId].status == RequestStatus.Claimable) {
                return _claimRedeem(requestId);
            }
        }
        revert("NO_CLAIMABLE_REDEEM");
    }

    /**
     * @notice Legacy withdraw from ERC-4626
     * @dev Reverts to conform with ERC-7540
     */
    function withdraw(
        uint256,
        address,
        address
    ) external override returns (uint256) {
        revert("ERC7540: use requestRedeem");
    }

    /**
     * @notice Redeem shares from the vault using a controller
     * @param shareAmount Amount of shares to redeem (unused, required for interface)
     * @param receiver Receiver of the assets (unused, required for interface)
     * @param shareOwner Owner of the shares (unused, required for interface)
     * @param controller The controller of the request
     * @return assets Amount of assets received
     */
    function redeem(
        uint256 shareAmount,
        address receiver,
        address shareOwner,
        address controller
    ) external returns (uint256 assets) {
        // Find the most recently claimable redeem request for this controller
        uint256[] memory requests = controllerRedeemRequests[controller];
        for (uint256 i = requests.length; i > 0; i--) {
            uint256 requestId = requests[i - 1];
            if (redeemRequests[requestId].status == RequestStatus.Claimable) {
                _claimRedeem(requestId);
                return redeemRequests[requestId].assets;
            }
        }
        revert("NO_CLAIMABLE_REDEEM");
    }

    /**
     * @notice Legacy redeem from ERC-4626
     * @dev Reverts to conform with ERC-7540
     */
    function redeem(
        uint256,
        address,
        address
    ) external override returns (uint256) {
        revert("ERC7540: use requestRedeem");
    }

    // ERC-7540 specific methods

    /**
     * @notice Set or revoke an operator for the controller
     * @param operator The operator to set
     * @param approved True to approve, false to revoke
     */
    function setOperator(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
    }

    /**
     * @notice Check if an address is an operator for a controller
     * @param controller The controller address
     * @param operator The operator address
     * @return True if the operator is approved
     */
    function isOperatorFor(
        address controller,
        address operator
    ) external view returns (bool) {
        return _operatorApprovals[controller][operator];
    }

    /**
     * @notice Request a deposit of assets to receive shares
     * @param assets Amount of assets to deposit
     * @param controller Controller of the deposit request (usually msg.sender)
     * @param owner Owner of the resulting shares
     * @return requestId Unique identifier for the deposit request
     */
    function requestDeposit(
        uint256 assets,
        address controller,
        address owner
    ) external returns (uint256 requestId) {
        require(assets > 0, "ZERO_ASSETS");
        require(controller != address(0), "INVALID_CONTROLLER");
        require(owner != address(0), "INVALID_OWNER");

        // If controller is not msg.sender, check operator approval
        if (controller != msg.sender) {
            require(
                _operatorApprovals[controller][msg.sender],
                "NOT_AUTHORIZED"
            );
        }

        // Transfer assets from caller to vault
        uint256 prevBalance = IERC20(_asset).balanceOf(address(this));
        require(
            _makeTransferFrom(msg.sender, address(this), assets, _asset),
            "TRANSFER_FAILED"
        );
        uint256 newBalance = IERC20(_asset).balanceOf(address(this));
        require(newBalance == assets + prevBalance, "NOT_ENOUGH_TRANSFERRED");

        // Create deposit request
        requestId = nextRequestId++;
        depositRequests[requestId] = RequestForDeposit({
            id: requestId,
            controller: controller,
            owner: owner,
            sender: msg.sender,
            assets: assets,
            shares: 0, // Will be set when processed
            timestamp: block.timestamp,
            status: RequestStatus.Pending
        });
        requestTypes[requestId] = RequestType.Deposit;

        controllerDepositRequests[controller].push(requestId);

        emit DepositRequest(controller, owner, requestId, msg.sender, assets);

        return requestId;
    }

    /**
     * @notice Request a redemption of shares to receive assets
     * @param shares Amount of shares to redeem
     * @param controller Controller of the redemption request (usually msg.sender)
     * @param owner Owner of the shares
     * @param receiver Receiver of the assets
     * @return requestId Unique identifier for the redemption request
     */
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner,
        address receiver
    ) external returns (uint256 requestId) {
        require(shares > 0, "ZERO_SHARES");
        require(controller != address(0), "INVALID_CONTROLLER");
        require(owner != address(0), "INVALID_OWNER");
        require(receiver != address(0), "INVALID_RECEIVER");

        // If controller is not msg.sender, check operator approval
        if (controller != msg.sender) {
            require(
                _operatorApprovals[controller][msg.sender],
                "NOT_AUTHORIZED"
            );
        }

        // If owner is not controller, check allowance
        if (owner != controller) {
            uint256 allowance = allowance(owner, msg.sender);
            require(allowance >= shares, "INSUFFICIENT_ALLOWANCE");

            // Reduce allowance
            if (allowance != type(uint256).max) {
                // Safe because we checked allowance >= shares
                unchecked {
                    _approve(owner, msg.sender, allowance - shares);
                }
            }
        }

        // Check user has enough shares
        uint256 balance = balanceOf(owner);
        require(balance >= shares, "INSUFFICIENT_BALANCE");

        // Lock shares by transferring to vault
        require(
            _transferShares(owner, address(this), shares),
            "SHARE_TRANSFER_FAILED"
        );

        // Create redemption request
        requestId = nextRequestId++;
        redeemRequests[requestId] = RequestForRedeem({
            id: requestId,
            controller: controller,
            owner: owner,
            receiver: receiver,
            shares: shares,
            assets: 0, // Will be set when processed
            timestamp: block.timestamp,
            status: RequestStatus.Pending
        });
        requestTypes[requestId] = RequestType.Redeem;

        controllerRedeemRequests[controller].push(requestId);

        emit RedeemRequest(controller, owner, requestId, receiver, shares);

        return requestId;
    }

    /**
     * @notice Process a deposit request, making it claimable
     * @param request the deposit request to process
     */
    function _processDeposit(RequestForDeposit storage request) private {

        require(request.status == RequestStatus.Pending, "NOT_PENDING");

        // Calculate fee on the assets
        uint256 fee = calculateFee(request.assets, entryFeeRate);
        uint256 assetsAfterFee = request.assets - fee;
        // Calculate shares to mint based on current share price
        uint256 sharesToMint;

        if (globalSupply == 0) {
            // First deposit, create shares 1:1 with assets

            // If asset decimals is 6 (like USDC), we need to multiply by 10^12
            if (_assetDecimals <= 18) {
                uint256 decimalDifference = 18 - uint256(_assetDecimals);
                sharesToMint = assetsAfterFee * (10 ** decimalDifference);
            } else {
                // In the unlikely case asset has more than 18 decimals
                uint256 decimalDifference = uint256(_assetDecimals) - 18;
                sharesToMint = assetsAfterFee / (10 ** decimalDifference);
            }

            // Initialize NAV to match the assets for first deposit
            nav = assetsAfterFee;
            // Initialize globalSupply with the shares to mint
            globalSupply = sharesToMint;
        } else if (nav == 0) {
            // It's an error if NAV is zero but supply isn't
            revert("NAV_IS_ZERO");
        } else {
            // Use convertToShares to calculate share amount based on current share price
            sharesToMint = convertToShares(assetsAfterFee);

            // Increase NAV by the assets added (only for non-first deposits)
            nav += assetsAfterFee;
            globalSupply += sharesToMint;
        }

        // Update request with actual share amount
        request.shares = sharesToMint;
        request.status = RequestStatus.Claimable;

        // Mint shares to vault immediately to maintain share price stability
        _mint(address(this), sharesToMint);

        // Transfer assets to Rabbit exchange
        require(
            _makeTransfer(rabbitx, request.assets, _asset),
            "TRANSFER_TO_EXCHANGE_FAILED"
        );

        emit RequestMadeClaimable(request.id, true);
        // @TODO: Exchange should record this deposit for the vault's account
    }

    /**
     * @notice Process a redemption request, making it claimable
     * @param request the redemption request to process
     */
    function _processRedeem(RequestForRedeem storage request) private {

        require(request.status == RequestStatus.Pending, "NOT_PENDING");

        // Calculate actual assets based on current NAV
        uint256 assets = convertToAssets(request.shares);
        // Sanity check: In theory, assets should never exceed nav due to the
        // calculation formula. This is a safety check to prevent underflows
        // in case of a calculation edge case or rounding error.
        if (assets > nav) {
            assets = nav;
        }

        uint256 fee = calculateFee(assets, exitFeeRate);
        uint256 assetsAfterFee = assets - fee;

        // Update request with actual asset amount
        request.assets = assetsAfterFee;
        request.status = RequestStatus.Claimable;

        // Update NAV to reflect the removal of assets
        // Prevent underflow - if assets > nav, set nav to 0
        nav = assets > nav ? 0 : nav - assets;
        globalSupply -= request.shares;

        // Burn shares
        _burn(address(this), request.shares);

        // Only request assets from RabbitX if we have assets to withdraw
        if (assetsAfterFee > 0) {
            // Request assets from RabbitX to be sent to the vault (not directly to the user)
            requestAssetsFromRabbitX(assetsAfterFee, address(this));
        }

        emit RequestMadeClaimable(request.id, false);
    }

    /**
     * @notice Claim a processed deposit request (internal)
     * @param requestId ID of the deposit request to claim
     * @return shares Amount of shares issued
     */
    function _claimDeposit(
        uint256 requestId
    ) internal returns (uint256 shares) {
        RequestForDeposit storage request = depositRequests[requestId];

        require(request.status == RequestStatus.Claimable, "NOT_CLAIMABLE");

        // Mark as claimed
        request.status = RequestStatus.Claimed;

        // Transfer shares from vault to owner
        require(
            _transferShares(address(this), request.owner, request.shares),
            "SHARE_TRANSFER_FAILED"
        );

        emit ClaimDeposit(
            request.controller,
            request.owner,
            requestId,
            request.assets,
            request.shares
        );

        // Emit ERC4626-style deposit event
        emit Deposit(
            request.controller,
            request.owner,
            request.assets,
            request.shares
        );

        return request.shares;
    }

    /**
     * @notice Claim a processed redemption request (internal)
     * @param requestId ID of the redemption request to claim
     * @return shares Amount of shares burned
     */
    function _claimRedeem(uint256 requestId) internal returns (uint256 shares) {
        RequestForRedeem storage request = redeemRequests[requestId];

        require(request.status == RequestStatus.Claimable, "NOT_CLAIMABLE");

        // Mark as claimed
        request.status = RequestStatus.Claimed;

        // Transfer assets from vault to receiver
        require(
            _makeTransfer(request.receiver, request.assets, _asset),
            "ASSET_TRANSFER_FAILED"
        );

        // Emit ERC7540-style redemption processed event
        emit ClaimRedeem(
            request.controller,
            request.owner,
            requestId,
            request.receiver,
            request.assets,
            request.shares
        );

        // Emit ERC4626-style withdrawal event
        emit Withdraw(
            request.controller,
            request.receiver,
            request.owner,
            request.assets,
            request.shares
        );

        return request.shares;
    }

    /**
     * @notice Cancel a pending deposit request
     * @param requestId ID of the deposit request to cancel
     * @param controller Controller of the request
     * @return assets Amount of assets returned
     */
    function cancelDepositRequest(
        uint256 requestId,
        address controller
    ) external onlyControllerOrOperator(controller) returns (uint256 assets) {
        RequestForDeposit storage request = depositRequests[requestId];

        require(request.controller == controller, "NOT_CONTROLLER");
        require(request.status == RequestStatus.Pending, "NOT_PENDING");

        uint256 assetsToReturn = request.assets;

        // Mark as cancelled
        request.status = RequestStatus.Cancelled;

        // Return assets to controller
        require(
            _makeTransfer(controller, assetsToReturn, _asset),
            "REFUND_FAILED"
        );

        emit CancelDepositRequest(
            controller,
            request.owner,
            requestId,
            assetsToReturn
        );

        return assetsToReturn;
    }

    /**
     * @notice Cancel a pending redemption request
     * @param requestId ID of the redemption request to cancel
     * @param controller Controller of the request
     * @return shares Amount of shares returned
     */
    function cancelRedeemRequest(
        uint256 requestId,
        address controller
    ) external onlyControllerOrOperator(controller) returns (uint256 shares) {
        RequestForRedeem storage request = redeemRequests[requestId];

        require(request.controller == controller, "NOT_CONTROLLER");
        require(request.status == RequestStatus.Pending, "NOT_PENDING");

        uint256 sharesToReturn = request.shares;

        // Mark as cancelled
        request.status = RequestStatus.Cancelled;

        // Return shares to owner
        require(
            _transferShares(address(this), request.owner, sharesToReturn),
            "SHARE_RETURN_FAILED"
        );

        emit CancelRedeemRequest(
            controller,
            request.owner,
            requestId,
            sharesToReturn
        );

        return sharesToReturn;
    }

    // ERC-7540 view functions

    /**
     * @notice Get pending deposit assets for a request
     * @param requestId ID of the deposit request
     * @param controller Controller of the request (for interface compliance)
     * @return Amount of assets in the pending deposit request
     */
    function pendingDepositRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256) {
        RequestForDeposit storage request = depositRequests[requestId];
        if (
            request.controller == controller &&
            request.status == RequestStatus.Pending
        ) {
            return request.assets;
        }
        return 0;
    }

    /**
     * @notice Get claimable deposit assets for a request
     * @param requestId ID of the deposit request
     * @param controller Controller of the request (for interface compliance)
     * @return Amount of assets in the claimable deposit request
     */
    function claimableDepositRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256) {
        RequestForDeposit storage request = depositRequests[requestId];
        if (
            request.controller == controller &&
            request.status == RequestStatus.Claimable
        ) {
            return request.assets;
        }
        return 0;
    }

    /**
     * @notice Get pending redemption shares for a request
     * @param requestId ID of the redemption request
     * @param controller Controller of the request (for interface compliance)
     * @return Amount of shares in the pending redemption request
     */
    function pendingRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256) {
        RequestForRedeem storage request = redeemRequests[requestId];
        if (
            request.controller == controller &&
            request.status == RequestStatus.Pending
        ) {
            return request.shares;
        }
        return 0;
    }

    /**
     * @notice Get claimable redemption shares for a request
     * @param requestId ID of the redemption request
     * @param controller Controller of the request (for interface compliance)
     * @return Amount of shares in the claimable redemption request
     */
    function claimableRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256) {
        RequestForRedeem storage request = redeemRequests[requestId];
        if (
            request.controller == controller &&
            request.status == RequestStatus.Claimable
        ) {
            return request.shares;
        }
        return 0;
    }

    // Query functions

    /**
     * @notice Get all deposit requests for a controller
     * @param controller Address of the controller
     * @return Array of request IDs
     */
    function getControllerDepositRequests(
        address controller
    ) external view returns (uint256[] memory) {
        return controllerDepositRequests[controller];
    }

    /**
     * @notice Get all redemption requests for a controller
     * @param controller Address of the controller
     * @return Array of request IDs
     */
    function getControllerRedeemRequests(
        address controller
    ) external view returns (uint256[] memory) {
        return controllerRedeemRequests[controller];
    }

    /**
     * @notice Get details of a deposit request
     * @param requestId ID of the deposit request
     * @return id ID of the deposit request
     * @return controller Address of the controller
     * @return owner Address of the owner (recipient of shares)
     * @return assets Amount of assets deposited
     * @return shares Amount of shares to be minted (0 if pending)
     * @return timestamp When the request was created
     * @return status Current status of the request
     */
    function getDepositRequest(
        uint256 requestId
    )
        external
        view
        returns (
            uint256 id,
            address controller,
            address owner,
            uint256 assets,
            uint256 shares,
            uint256 timestamp,
            RequestStatus status
        )
    {
        RequestForDeposit storage request = depositRequests[requestId];
        return (
            request.id,
            request.controller,
            request.owner,
            request.assets,
            request.shares,
            request.timestamp,
            request.status
        );
    }

    /**
     * @notice Get details of a redemption request
     * @param requestId ID of the redemption request
     * @return id ID of the redemption request
     * @return controller Address of the controller
     * @return owner Address of the owner (source of shares)
     * @return receiver Address to receive assets
     * @return shares Amount of shares redeemed
     * @return assets Amount of assets to be withdrawn (0 if pending)
     * @return timestamp When the request was created
     * @return status Current status of the request
     */
    function getRedeemRequest(
        uint256 requestId
    )
        external
        view
        returns (
            uint256 id,
            address controller,
            address owner,
            address receiver,
            uint256 shares,
            uint256 assets,
            uint256 timestamp,
            RequestStatus status
        )
    {
        RequestForRedeem storage request = redeemRequests[requestId];
        return (
            request.id,
            request.controller,
            request.owner,
            request.receiver,
            request.shares,
            request.assets,
            request.timestamp,
            request.status
        );
    }

    // NAV & fee management functions

    /**
     * @notice Update the NAV value and process pending requests
     * @param newNav New NAV value with the same decimals as the asset token
     * @param newGlobalSupply New global supply value
     */
    function updateNav(
        uint256 newNav,
        uint256 newGlobalSupply
    ) external onlyNavUpdater {
        require(newGlobalSupply >= totalSupply(), "LOCAL_SUPPLY_EXCEEDS_GLOBAL");
        if (newNav == 0) {
            require(newGlobalSupply == 0, "INVALID_NAV");
        }

        uint256 oldNav = nav;
        uint256 oldGlobalSupply = globalSupply;
        nav = newNav;
        globalSupply = newGlobalSupply;
        emit NavUpdated(
            msg.sender,
            oldNav,
            newNav,
            oldGlobalSupply,
            newGlobalSupply
        );

        // Process pending requests (both deposits and redeems)
        processPendingRequests();
    }

    /**
     * @notice Process a deposit request, making it claimable (admin function)
     * @param requestId ID of the deposit request to process
     */
    function processDeposit(uint256 requestId) external onlyAdmin {
        RequestForDeposit storage request = depositRequests[requestId];
        _processDeposit(request);
    }

    /**
     * @notice Process a redemption request, making it claimable (admin function)
     * @param requestId ID of the redemption request to process
     */
    function processRedeem(uint256 requestId) external onlyAdmin {
        RequestForRedeem storage request = redeemRequests[requestId];
        _processRedeem(request);
    }

    /**
     * @notice Process all pending deposit requests
     * @dev Called automatically after NAV updates
     */
    function processPendingRequests() internal {
        // Start from the last processed ID + 1 to avoid reprocessing
        uint256 highestProcessedId = lastProcessedRequestId;
        uint256 firstDelayedRedeemId;
        bool foundDelayedRedeem = false;

        // Process all pending requests up to the current nextRequestId
        for (uint256 i = lastProcessedRequestId + 1; i < nextRequestId; i++) {
            RequestType requestType = requestTypes[i];
            if (requestType == RequestType.Deposit) {
                RequestForDeposit storage request = depositRequests[i];
                if (request.status == RequestStatus.Pending) {
                    _processDeposit(request);
                }
            } else if (requestType == RequestType.Redeem) {
                RequestForRedeem storage request = redeemRequests[i];
                if (request.status == RequestStatus.Pending) {
                    if (block.timestamp >= request.timestamp + redeemDelay) {
                        _processRedeem(request);
                    } else {
                        if (!foundDelayedRedeem) {
                            firstDelayedRedeemId = i;
                            foundDelayedRedeem = true;
                        }
                    }
                }
            }
        }

        // If we found a delayed redeem request, set lastProcessedRequestId
        // to one before it so we'll try it again on the next run
        if (foundDelayedRedeem && firstDelayedRedeemId != type(uint256).max) {
            lastProcessedRequestId = firstDelayedRedeemId - 1;
        } else {
            // No delayed redeems, so update to the highest ID processed
            lastProcessedRequestId = highestProcessedId;
        }
    }

    /**
     * @notice Add NAV updater role to an address
     * @param user Address to grant NAV updater role
     */
    function addNavUpdater(address user) external onlyAdmin {
        addRole(user, NAV_UPDATER_ROLE);
    }

    /**
     * @notice Remove NAV updater role from an address
     * @param user Address to revoke NAV updater role
     */
    function removeNavUpdater(address user) external onlyAdmin {
        removeRole(user, NAV_UPDATER_ROLE);
    }

    /**
     * @notice Check if an address has NAV updater role
     * @param user Address to check
     * @return True if the address has NAV updater role
     */
    function isNavUpdater(address user) external view returns (bool) {
        return signers[user][NAV_UPDATER_ROLE];
    }

    /**
     * @notice Set the fee rates for the vault
     * @param _entryFeeRate Entry fee rate in basis points
     * @param _exitFeeRate Exit fee rate in basis points
     */
    function setFeeRates(
        uint256 _entryFeeRate,
        uint256 _exitFeeRate
    ) external onlyOwner {
        require(_entryFeeRate <= 1000, "ENTRY_FEE_TOO_HIGH"); // Max 10%
        require(_exitFeeRate <= 1000, "EXIT_FEE_TOO_HIGH"); // Max 10%
        entryFeeRate = _entryFeeRate;
        exitFeeRate = _exitFeeRate;
        emit FeesUpdated(_entryFeeRate, _exitFeeRate);
    }

    /**
     * @notice Internal function to request assets from RabbitX
     * @param amount Amount of assets to request
     * @param receiver Address to receive the assets (should typically be this vault)
     */
    function requestAssetsFromRabbitX(
        uint256 amount,
        address receiver
    ) internal {
        // Call RabbitX's withdrawToVault function
        // This will transfer assets from RabbitX to the vault
        try IRabbitX(rabbitx).withdrawToVault(_asset, amount, receiver) {
            // Successful withdrawal
            emit Withdrawal(receiver, amount, _asset);
        } catch (bytes memory reason) {
            // Handle the error case
            revert(
                string(
                    abi.encodePacked("WITHDRAWAL_FROM_RABBITX_FAILED: ", reason)
                )
            );
        }
    }

    // Role management functions

    /**
     * @notice does the user have the ADMIN_ROLE - which gives
     * the ability to add and remove roles for other users
     *
     * @param user the address to check
     * @return true if the user has the ADMIN_ROLE
     */
    function isAdmin(address user) external view returns (bool) {
        if (ownerIsSoleAdmin) {
            address currentOwner = owner();
            return user == currentOwner;
        } else {
            return signers[user][ADMIN_ROLE];
        }
    }

    /**
     * @notice does the user have the specified role
     *
     * @dev the roles recognised by the vault are
     * ADMIN_ROLE (0), TRADER_ROLE (1) and TREASURER_ROLE (2), other roles can
     * be given and removed, but they have no special meaning for the vault
     *
     * @param signer the address to check
     * @param role the role to check
     * @return true if the user has the specified role
     */
    function isValidSigner(
        address signer,
        uint256 role
    ) external view returns (bool) {
        return signers[signer][role];
    }

    /**
     * @notice does the user have the TRADER_ROLE - which gives
     * the ability to trade on the rabbit exchange with the vault's funds
     *
     * @param user the address to check
     * @return true if the user has the TRADER_ROLE
     */
    function isTrader(address user) external view returns (bool) {
        return signers[user][TRADER_ROLE];
    }

    /**
     * @notice does the user have the TREASURER_ROLE - which gives
     * the ability to deposit the vault's funds into the rabbit exchange
     *
     * @param user the address to check
     * @return true if the user has the TREASURER_ROLE
     */
    function isTreasurer(address user) public view returns (bool) {
        return signers[user][TREASURER_ROLE];
    }

    /**
     * @notice give the user the ADMIN_ROLE - which gives
     * the ability to add and remove roles for other users
     *
     * @dev the caller must themselves have the ADMIN_ROLE
     *
     * @param user the address to give the ADMIN_ROLE to
     */
    function addAdmin(address user) external onlyAdmin {
        addRole(user, ADMIN_ROLE);
    }

    /**
     * @notice take away the ADMIN_ROLE - which removes
     * the ability to add and remove roles for other users
     *
     * @dev the caller must themselves have the ADMIN_ROLE
     *
     * @param user the address from which to remove the ADMIN_ROLE
     */
    function removeAdmin(address user) external onlyAdmin {
        removeRole(user, ADMIN_ROLE);
    }

    /**
     * @notice give the user the TRADER_ROLE - which gives
     * the ability to trade on the rabbit exchange with the vault's funds
     *
     * @dev the caller must have the ADMIN_ROLE
     *
     * @param user the address to give the TRADER_ROLE to
     */
    function addTrader(address user) external onlyAdmin {
        addRole(user, TRADER_ROLE);
    }

    /**
     * @notice take away the TRADER_ROLE - which removes
     * the ability to trade on the rabbit exchange with the vault's funds
     *
     * @dev the caller must have the ADMIN_ROLE
     *
     * @param user the address from which to remove the TRADER_ROLE
     */
    function removeTrader(address user) external onlyAdmin {
        removeRole(user, TRADER_ROLE);
    }

    /**
     * @notice give the user the TREASURER_ROLE - which gives
     * the ability to deposit the vault's funds into the rabbit exchange
     *
     * @dev the caller must have the ADMIN_ROLE
     *
     * @param user the address to give the TREASURER_ROLE to
     */
    function addTreasurer(address user) external onlyAdmin {
        addRole(user, TREASURER_ROLE);
    }

    /**
     * @notice take away the TREASURER_ROLE - which removes
     * the ability to deposit the vault's funds into the rabbit exchange
     *
     * @dev the caller must have the ADMIN_ROLE
     *
     * @param user the address from which to remove the TREASURER_ROLE
     */
    function removeTreasurer(address user) external onlyAdmin {
        removeRole(user, TREASURER_ROLE);
    }

    /**
     * @notice give the user the specified role
     *
     * @dev the caller must have the ADMIN_ROLE
     * @dev the roles recognised by the vault are
     * ADMIN_ROLE (0), TRADER_ROLE (1) and TREASURER_ROLE (2), other roles can
     * be given and removed, but they have no special meaning for the vault
     *
     * @param signer the address to which to give the role
     * @param role the role to give
     */
    function addRole(address signer, uint256 role) public onlyAdmin {
        signers[signer][role] = true;
        emit AddRole(signer, role, msg.sender);
    }

    /**
     * @notice take away the specified role from the user
     *
     * @dev the caller must have the ADMIN_ROLE
     * @dev the roles recognised by the vault are
     * ADMIN_ROLE (0), TRADER_ROLE (1) and TREASURER_ROLE (2), other roles can
     * be given and removed, but they have no special meaning for the vault
     *
     * @param signer the address from which to remove the role
     * @param role the role to remove
     */
    function removeRole(address signer, uint256 role) public onlyAdmin {
        signers[signer][role] = false;
        emit RemoveRole(signer, role, msg.sender);
    }

    function makeOwnerAdmin() external onlyOwner {
        address currentOwner = owner();
        signers[currentOwner][ADMIN_ROLE] = true;
    }

    function setOwnerIsSoleAdmin(bool value) external onlyOwner {
        ownerIsSoleAdmin = value;
    }

    function transferOwnership(
        address newOwner
    ) public virtual override onlyTimelock {
        require(newOwner != address(0), "ZERO_OWNER");
        _transferOwnership(newOwner);
    }

    /**
     * @notice sets the address of the rabbit exchange contract
     *
     * @dev WARNING incorrect setting could lead to loss of funds when
     * calling makeDeposit, normally set during deployment
     * @dev only the timelock can call this function
     *
     * @param _rabbitx the address of the rabbit exchange contract
     */
    function setRabbit(address _rabbitx) external onlyTimelock {
        rabbitx = _rabbitx;
        emit SetRabbitX(_rabbitx);
    }

    /**
     * @notice Update the minimum delay between redeem request and processing
     * @param newRedeemDelay New delay value in seconds
     * @dev Only the timelock can update this value
     */
    function setRedeemDelay(uint256 newRedeemDelay) external onlyTimelock {
        uint256 oldDelay = redeemDelay;
        redeemDelay = newRedeemDelay;
        emit RedeemDelayUpdated(oldDelay, newRedeemDelay);
    }

    /**
     * @notice Helper function to transfer tokens from this contract
     * @param to Recipient address
     * @param amount Amount to transfer
     * @param token Token address
     */
    function _makeTransfer(
        address to,
        uint256 amount,
        address token
    ) private returns (bool success) {
        return
            _tokenCall(
                token,
                abi.encodeWithSelector(
                    IERC20(token).transfer.selector,
                    to,
                    amount
                )
            );
    }

    /**
     * @notice Helper function to transfer tokens from another address
     * @param from Source address
     * @param to Recipient address
     * @param amount Amount to transfer
     * @param token Token address
     */
    function _makeTransferFrom(
        address from,
        address to,
        uint256 amount,
        address token
    ) private returns (bool success) {
        return
            _tokenCall(
                token,
                abi.encodeWithSelector(
                    IERC20(token).transferFrom.selector,
                    from,
                    to,
                    amount
                )
            );
    }

    /**
     * @notice Low-level function to make token contract calls
     * @param token Token address
     * @param data Encoded call data
     */
    function _tokenCall(
        address token,
        bytes memory data
    ) private returns (bool) {
        (bool success, bytes memory returndata) = token.call(data);
        if (success) {
            if (returndata.length > 0) {
                success = abi.decode(returndata, (bool));
            } else {
                success = token.code.length > 0;
            }
        }
        return success;
    }

    // Helper for transferring shares between addresses
    function _transferShares(
        address from,
        address to,
        uint256 amount
    ) private returns (bool) {
        // Use ERC20 _transfer function
        super._transfer(from, to, amount);
        return true;
    }

    /**
     * @notice Returns the version of the contract
     * @return The contract version
     */
    function getVersion() public pure returns (uint256) {
        return 1;
    }

    /**
     * @notice Get the timestamp when a redeem request was created
     * @param requestId ID of the redeem request
     * @return timestamp The timestamp when the request was created (0 if request doesn't exist)
     */
    function getRedeemRequestTimestamp(
        uint256 requestId
    ) external view returns (uint256) {
        RequestForRedeem storage request = redeemRequests[requestId];
        return request.timestamp;
    }

    /**
     * @notice Check if a redeem request has met the minimum delay requirement
     * @param requestId ID of the redeem request
     * @return true if the redeem request has been waiting at least redeemDelay seconds
     */
    function isRedeemRequestDelayMet(
        uint256 requestId
    ) public view returns (bool) {
        RequestForRedeem storage request = redeemRequests[requestId];
        if (request.status != RequestStatus.Pending) {
            return false;
        }
        return (block.timestamp >= request.timestamp + redeemDelay);
    }

    /**
     * @notice Admin function to cancel a deposit request
     * @param requestId ID of the deposit request to cancel
     * @return assets Amount of assets returned
     */
    function adminCancelDepositRequest(
        uint256 requestId
    ) external onlyAdmin returns (uint256 assets) {
        RequestForDeposit storage request = depositRequests[requestId];

        require(request.status == RequestStatus.Pending, "NOT_PENDING");

        uint256 assetsToReturn = request.assets;

        // Mark as cancelled
        request.status = RequestStatus.Cancelled;

        // Return assets to controller
        require(
            _makeTransfer(request.controller, assetsToReturn, _asset),
            "REFUND_FAILED"
        );

        emit CancelDepositRequest(
            request.controller,
            request.owner,
            requestId,
            assetsToReturn
        );

        return assetsToReturn;
    }

    /**
     * @notice Admin function to cancel a redemption request
     * @param requestId ID of the redemption request to cancel
     * @return shares Amount of shares returned
     */
    function adminCancelRedeemRequest(
        uint256 requestId
    ) external onlyAdmin returns (uint256 shares) {
        RequestForRedeem storage request = redeemRequests[requestId];

        require(request.status == RequestStatus.Pending, "NOT_PENDING");

        uint256 sharesToReturn = request.shares;

        // Mark as cancelled
        request.status = RequestStatus.Cancelled;

        // Return shares to owner
        require(
            _transferShares(address(this), request.owner, sharesToReturn),
            "SHARE_RETURN_FAILED"
        );

        emit CancelRedeemRequest(
            request.controller,
            request.owner,
            requestId,
            sharesToReturn
        );

        return sharesToReturn;
    }
}
