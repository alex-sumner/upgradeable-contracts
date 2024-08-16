pragma solidity ^0.8.0;
// SPDX-License-Identifier: MIT

import "./IVault2.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract VaultU is IVault2, UUPSUpgradeable, OwnableUpgradeable {
    uint256 public constant ADMIN_ROLE = 0;
    uint256 public constant TRADER_ROLE = 1;
    uint256 public constant TREASURER_ROLE = 2;
    string constant STAKE_PREFIX = "s_";
    string constant CONTRACT_SUFFIX = "_rbxv";
    address public timelock;
    address public owner;

    address public rabbitx;
    address public defaultToken;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public minStakes;
    bool public ownerIsSoleAdmin;


    mapping(address => mapping(uint256 => bool)) public signers;

    string nextStakeNum;

    event AddRole(address indexed user, uint256 indexed role, address indexed caller);
    event RemoveRole(address indexed user, uint256 indexed role, address indexed caller);
    event Withdrawal(address indexed to, uint256 amount, address indexed token);
    event SetRabbitX(address indexed rabbitx);
    event SupportToken(address token, uint256 minStake);
    event UnsupportToken(address token);

    modifier onlyTimelock() {
        require(msg.sender == timelock, "ONLY_TIMELOCK");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    event SetOwner(address indexed owner);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _timelock,
        address _owner,
        address _rabbitx,
        address _defaultToken,
        uint256 _minStake,
        address[] memory _otherTokens,
        uint256[] memory _minStakes
    )public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        nextStakeNum = 1;
        timelock = _timelock;
        transferOwnership(_owner);
        signers[_owner][ADMIN_ROLE] = true;
        signers[_owner][TREASURER_ROLE] = true;
        rabbitx = _rabbitx;
        defaultToken = _defaultToken;
        supportedTokens[_defaultToken] = true;
        minStakes[_defaultToken] = _minStake;
        for (address i = 0; i < _otherTokens.length; i++) {
            address token = _otherTokens[i];
            supportedTokens[token] = true;
            minStakes[token] = _minStakes[i];
        }
    }
    
    modifier onlyAdmin() {
        if (ownerIsSoleAdmin) {
            require(msg.sender == owner, "NOT_OWNER");
        } else {
            require(signers[msg.sender][ADMIN_ROLE], "NOT_AN_ADMIN");
        }
        _;
    }

    function supportToken(address _token, uint256 _minStake) external onlyOwner {
        supportedTokens[_token] = true;
        minStakes[_token] = _minStake;
        emit SupportToken(_token, _minStake);
    }

    function unsupportToken(address _token) external onlyOwner {
        supportedTokens[_token] = false;
        emit UnsupportToken(_token);
    }

    function allocateStakeId() private returns (string) {
        uint256 stakeNum = nextStakeNum;
        nextStakeNum++;
        return string(
            abi.encodePacked(
                STAKE_PREFIX,
                Strings.toString(stakeNum),
                CONTRACT_SUFFIX
            )
        );
    }

    function stake(uint256 amount) external {
        stakeToken(amount, defaultToken);
    }

    function stakeToken(uint256 amount, address token) external {
        require(supportedTokens[token], "UNSUPPORTED_TOKEN");
        uint256 minStake = minStakes[token];
        require(amount >= minDeposit, "AMOUNT_TOO_SMALL");
        string stakeId = allocateStakeId();
        emit Stake(stakeId, msg.sender, amount);
        require(
            makeTransferFrom(msg.sender, bfx, amount, token),
            "TRANSFER_FAILED"
        );
    }

    /**
     * @notice does the user have the ADMIN_ROLE - which gives
     * the ability to add and remove roles for other users
     *
     * @param user the address to check
     * @return true if the user has the ADMIN_ROLE
     */
    function isAdmin(address user) external view returns (bool) {
        if (ownerIsSoleAdmin) {
            return user == owner;
        } else {
            return signers[user][ADMIN_ROLE];
        }
    }

    receive() external payable {
        handleReceivedNative();
    }

    function stakeNative() external payable {
        handleReceivedNative();
    }

    function handleReceivedNative() internal {
        address native = address(0);
        require(supportedTokens[native], "UNSUPPORTED_TOKEN");
        uint256 minStake = minStakes[native];
        require(msg.value >= minStake, "AMOUNT_TOO_SMALL");
        uint256 stakeId = allocateStakeId();
        emit Stake(stakeId, msg.sender, msg.value, native);
    }

    /**
     * @notice give the user the ADMIN_ROLE - which gives
     * the ability to add and remove roles for other users
     *
     * @dev the caller must themselves have the ADMIN_ROLE
     *
     * @param user the address to give the ADMIN_ROLE to
     */
    function addAdmin(address user) external {
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
    function removeAdmin(address user) external {
        removeRole(user, ADMIN_ROLE);
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
     * @notice give the user the TRADER_ROLE - which gives
     * the ability to trade on the rabbit exchange with the vault's funds
     *
     * @dev the caller must have the ADMIN_ROLE
     *
     * @param user the address to give the TRADER_ROLE to
     */
    function addTrader(address user) external {
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
    function removeTrader(address user) external {
        removeRole(user, TRADER_ROLE);
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
     * @notice give the user the TREASURER_ROLE - which gives
     * the ability to deposit the vault's funds into the rabbit exchange
     *
     * @dev the caller must have the ADMIN_ROLE
     *
     * @param user the address to give the TREASURER_ROLE to
     */
    function addTreasurer(address user) external {
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
    function removeTreasurer(address user) external {
        removeRole(user, TREASURER_ROLE);
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
    function isValidSigner(address signer, uint256 role) external view returns (bool) {
        return signers[signer][role];
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
        signers[owner][ADMIN_ROLE] = true;
    }

    function setOwnerIsSoleAdmin(bool value) external onlyOwner {
        ownerIsSoleAdmin = value;
    }

    function setOwner(address _owner) external onlyTimelock {
        owner = _owner;
        emit SetOwner(_owner);
    }


    /**
     * @notice sets the address of the rabbit exchange contract
     *
     * @dev WARNING incorrect setting could lead to loss of funds when
     * calling makeDeposit, normally set during deployment
     * @dev only the vault owner can call this function
     *
     * @param _rabbitx the address of the rabbit exchange contract
     */
    function setRabbit(address _rabbitx) external onlyOwner {
        rabbitx = _rabbitx;
        emit SetRabbitX(_rabbitx);
    }

    /**
     * @notice withdraws funds from the vault, not normally used
     * as no funds are held on the vault - staking sends them directly
     * to the rabbitx exchange
     *
     * @dev the vault must already have a sufficient token balance,
     * calling this function does not withdraw funds from the rabbit
     * exchange to the vault
     * @dev only the vault owner can call this function
     *
     * @param amount the amount of tokens to withdraw
     * @param to the address to which to send the tokens
     */
    function withdrawTokensTo(
        address to,
        uint256 amount,
        address token
    ) external onlyOwner {
        require(supportedTokens[token], "UNSUPPORTED_TOKEN");
        require(amount > 0, "WRONG_AMOUNT");
        require(to != address(0), "ZERO_TO_ADDRESS");
        bool success = makeTransfer(to, amount, token);
        require(success, "TRANSFER_FAILED");
        emit Withdrawal(to, amount, token);
    }

    function withdrawNativeTo(address to, uint256 amount) external onlyOwner {
        require(amount > 0, "WRONG_AMOUNT");
        require(to != address(0), "ZERO_TO_ADDRESS");
        (bool success, ) = to.call{value: amount}("");
        require(success, "TRANSFER_FAILED");
        emit Withdrawal(to, amount, address(0));
    }

    function makeTransfer(
        address to,
        uint256 amount,
        address token
    ) private returns (bool success) {
        return
            tokenCall(
                token,
                abi.encodeWithSelector(
                    IERC20(token).transfer.selector,
                    to,
                    amount
                )
            );
    }

    function makeTransferFrom(
        address from,
        address to,
        uint256 amount,
        address token
    ) private returns (bool success) {
        return
            tokenCall(
                token,
                abi.encodeWithSelector(
                    IERC20(token).transferFrom.selector,
                    from,
                    to,
                    amount
                )
            );
    }

    function tokenCall(address token, bytes memory data) private returns (bool) {
        (bool success, bytes memory returndata) = token.call(
		data
	);
        if (success) {
            if (returndata.length > 0) {
                success = abi.decode(returndata, (bool));
            } else {
                success = token.code.length > 0;
            }
        }
        return success;
    }

    function getVersion() public pure returns (uint256) {
        return 1;
    }
}
