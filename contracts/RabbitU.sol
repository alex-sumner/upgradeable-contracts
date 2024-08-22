// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./EIP712VerifierU.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract RabbitU is EIP712VerifierU, UUPSUpgradeable, OwnableUpgradeable {
    uint256 constant UNLOCKED = 1;
    uint256 constant LOCKED = 2;
    string constant DEPOSIT_PREFIX = "d_";
    string constant CONTRACT_SUFFIX = "_rbx";

    address public timelock;
    address public defaultToken;

    mapping(uint256 => bool) public processedWithdrawals;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public minDeposits;

    uint256 nextDepositNum;
    uint256 reentryLockStatus;

    event Deposit(
        string id,
        address indexed trader,
        uint256 amount,
        address indexed token);
    event Withdrawal(
        uint256 indexed id,
        address indexed trader,
        uint256 amount,
        address token
    );
    event SetOwner(address indexed owner);
    event SetSigner(address indexed signer);
    event SupportToken(address token, uint256 minDeposit);
    event UnsupportToken(address token);

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _timelock,
        address _owner,
        address _signer,
        address _defaultToken,
        uint256 _minDeposit,
        address[] memory _otherTokens,
        uint256[] memory _minDeposits
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        EIP712VerifierU.__EIP712VerifierU_init("RabbitXWithdrawal", "1", _signer);
        timelock = _timelock;
        defaultToken = _defaultToken;
        supportedTokens[_defaultToken] = true;
        minDeposits[_defaultToken] = _minDeposit;
        for (uint256 i = 0; i < _otherTokens.length; i++) {
            address token = _otherTokens[i];
            supportedTokens[token] = true;
            minDeposits[token] = _minDeposits[i];
        }
        nextDepositNum = 1;
        reentryLockStatus = UNLOCKED;
    }

    function withdraw(
        uint256 id,
        address trader,
        uint256 amount,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        require(amount > 0, "WRONG_AMOUNT");
        require(processedWithdrawals[id] == false, "ALREADY_PROCESSED");
        processedWithdrawals[id] = true;

        bytes32 digest = getDigest(id, trader, amount, defaultToken, false);
        bool valid = verify(digest, v, r, s);
        require(valid, "INVALID_SIGNATURE");

        emit Withdrawal(id, trader, amount, defaultToken);
        bool success = makeTransfer(trader, amount, defaultToken);
        require(success, "TRANSFER_FAILED");
    }

    function withdrawToken(
        uint256 id,
        address trader,
        uint256 amount,
        address token,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        require(amount > 0, "WRONG_AMOUNT");
        require(processedWithdrawals[id] == false, "ALREADY_PROCESSED");
        processedWithdrawals[id] = true;

        bytes32 digest = getDigest(id, trader, amount, token, true);
        bool valid = verify(digest, v, r, s);
        require(valid, "INVALID_SIGNATURE");

        emit Withdrawal(id, trader, amount, token);
        bool success = makeTransfer(trader, amount, token);
        require(success, "TRANSFER_FAILED");
    }

    function withdrawNative(
        uint256 id,
        address trader,
        uint256 amount,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        require(amount > 0, "WRONG_AMOUNT");
        require(processedWithdrawals[id] == false, "ALREADY_PROCESSED");
        processedWithdrawals[id] = true;

        address native = address(0);
        bytes32 digest = getDigest(id, trader, amount, native, true);
        bool valid = verify(digest, v, r, s);
        require(valid, "INVALID_SIGNATURE");

        emit Withdrawal(id, trader, amount, native);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "TRANSFER_FAILED");
    }

    function getDigest(
        uint256 id,
        address trader,
        uint256 amount,
        address token,
        bool includeToken
    ) private view returns (bytes32 digest) {
        bytes memory encoded;
        if (includeToken) {
            encoded = abi.encode(
                keccak256(
                    "Withdrawal(uint256 id,address token,address trader,uint256 amount)"
                ),
                id,
                token,
                trader,
                amount
            );
        } else {
            encoded = abi.encode(
                keccak256(
                    "withdrawal(uint256 id,address trader,uint256 amount)"
                ),
                id,
                trader,
                amount
            );
        }
        digest = _hashTypedDataV4(keccak256(encoded));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyTimelock {
    }

    function supportToken(address token, uint256 minDeposit) external onlyOwner {
        supportedTokens[token] = true;
        minDeposits[token] = minDeposit;
        emit SupportToken(token, minDeposit);
    }

    function unsupportToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        emit UnsupportToken(token);
    }

    function allocateDepositId() private returns (string memory depositId) {
        uint256 depositNum = nextDepositNum;
        nextDepositNum++;
        return string(
            abi.encodePacked(
                DEPOSIT_PREFIX,
                Strings.toString(depositNum),
                CONTRACT_SUFFIX
            )
        );
    }

    function deposit(uint256 amount) external nonReentrant{
        handleDeposit(amount, defaultToken);
    }

    function depositToken(uint256 amount, address token) external nonReentrant {
        handleDeposit(amount, token);
    }

    function handleDeposit(uint256 amount, address token) internal {
        require(supportedTokens[token], "UNSUPPORTED_TOKEN");
        require(amount >= minDeposits[token], "AMOUNT_TOO_SMALL");
        string memory depositId = allocateDepositId();
        emit Deposit(depositId, msg.sender, amount, token);
        uint256 prevBalance = IERC20(token).balanceOf(address(this));
        bool success = makeTransferFrom(msg.sender, address(this), amount, token);
        require(success, "TRANSFER_FAILED");
        uint256 newBalance = IERC20(token).balanceOf(address(this));
        require(newBalance == amount + prevBalance, "NOT_ENOUGH_TRANSFERRED");
    }

    receive() external payable {
        handleReceivedNative();
    }

    function depositNative() external payable {
        handleReceivedNative();
    }

    function handleReceivedNative() internal {
        address native = address(0);
        require(supportedTokens[native], "UNSUPPORTED_TOKEN");
        uint256 minDeposit = minDeposits[native];
        require(msg.value >= minDeposit, "AMOUNT_TOO_SMALL");
        string memory depositId = allocateDepositId();
        emit Deposit(depositId, msg.sender, msg.value, native);
    }

    function transferOwnership(address newOwner) public virtual override onlyTimelock {
        require(newOwner != address(0), "ZERO_OWNER");
        _transferOwnership(newOwner);
    }

    function changeSigner(address new_signer) external onlyOwner {
        require(new_signer != address(0), "ZERO_SIGNER");
        external_signer = new_signer;
        emit SetSigner(new_signer);
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
        return 2;
    }
}
