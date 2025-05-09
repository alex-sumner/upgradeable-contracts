// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./EIP712VerifierU.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

enum YieldMode {
    AUTOMATIC,
    VOID,
    CLAIMABLE
}

interface IERC20Rebasing is IERC20 {
    function configure(YieldMode) external returns (uint256);

    function claim(
        address recipient,
        uint256 amount
    ) external returns (uint256);

    function getClaimableAmount(
        address account
    ) external view returns (uint256);
}

interface IBlast {
    function configureAutomaticYield() external;
    function configureClaimableGas() external;
    function claimMaxGas(
        address contractAddress,
        address recipientOfGas
    ) external returns (uint256);
}

interface IBlastPoints {
    function configurePointsOperator(address operator) external;
}

contract BfxU is EIP712VerifierU, UUPSUpgradeable, OwnableUpgradeable {
    uint256 constant UNLOCKED = 1;
    uint256 constant LOCKED = 2;
    string constant DEPOSIT_PREFIX = "d_";
    string constant CONTRACT_SUFFIX = "_bfx";
    uint256 constant HUNDRED_DOLLARS = 1e20;
    IBlast public constant BLAST =
        IBlast(0x4300000000000000000000000000000000000002);

    address public timelock;
    address public defaultToken;
    address points;
    address public claimer;

    mapping(uint256 => bool) public processedWithdrawals;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public minDeposits;
    mapping(address => bool) public rebasingTokens;

    uint256 nextDepositNum;
    uint256 reentryLockStatus;

    event Deposit(
        string id,
        address indexed trader,
        uint256 amount,
        address indexed token
    );
    event WithdrawalReceipt(
        uint256 indexed id,
        address indexed trader,
        uint256 amount,
        address indexed token
    );
    event SetOwner(address indexed owner);
    event SetClaimer(address indexed claimer);
    event SetSigner(address indexed signer);
    event SupportToken(address indexed token, uint256 minDeposit, bool rebasing);
    event UnsupportToken(address indexed token);
    event ClaimedYield(uint256 amount);

    modifier onlyTimelock() {
        require(msg.sender == timelock, "ONLY_TIMELOCK");
        _;
    }

    modifier onlyClaimer() {
        require(msg.sender == claimer, "ONLY_CLAIMER");
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
        address _claimer,
        address _points,
        address _defaultToken,
        uint256 _minDeposit,
        bool _rebasing,
        address[] memory _otherTokens,
        uint256[] memory _minDeposits,
        bool[] memory _rebasingTokens
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        EIP712VerifierU.__EIP712VerifierU_init(
            "BfxWithdrawal",
            "1",
            _signer
        );
        timelock = _timelock;
        claimer = _claimer;
        points = _points;
        defaultToken = _defaultToken;
        supportedTokens[_defaultToken] = true;
        rebasingTokens[_defaultToken] = _rebasing;
        if (_rebasing) {
            IERC20Rebasing(_defaultToken).configure(YieldMode.CLAIMABLE);
        }
        minDeposits[_defaultToken] = _minDeposit;
        for (uint256 i = 0; i < _otherTokens.length; i++) {
            address token = _otherTokens[i];
            supportedTokens[token] = true;
            minDeposits[token] = _minDeposits[i];
            rebasingTokens[token] = _rebasingTokens[i];
            if (_rebasingTokens[i]) {
                IERC20Rebasing(token).configure(YieldMode.CLAIMABLE);
            }
        }
        BLAST.configureAutomaticYield();
        BLAST.configureClaimableGas();
        IBlastPoints(_points).configurePointsOperator(_claimer);

        nextDepositNum = 1;
        reentryLockStatus = UNLOCKED;
    }

    function claimYield(address token) external onlyClaimer {
        require(rebasingTokens[token], "NOT_REBASING");
        IERC20Rebasing paymentToken = IERC20Rebasing(token);
        uint256 claimable = paymentToken.getClaimableAmount(address(this));
        if (claimable > HUNDRED_DOLLARS) {
            uint256 balanceBefore = paymentToken.balanceOf(address(this));
            paymentToken.claim(address(this), claimable);
            uint256 balanceAfter = paymentToken.balanceOf(address(this));
            require(balanceAfter > balanceBefore, "CLAIM_DIDNT_INCREASE_BALANCE");
            emit ClaimedYield(balanceAfter - balanceBefore);
        }
    }

    function claimGas() external onlyClaimer {
        BLAST.claimMaxGas(address(this), claimer);
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

        emit WithdrawalReceipt(id, trader, amount, defaultToken);
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

        emit WithdrawalReceipt(id, trader, amount, token);
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

        emit WithdrawalReceipt(id, trader, amount, native);
        (bool success, ) = trader.call{value: amount}("");
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

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyTimelock {}

    function supportToken(
        address token,
        uint256 minDeposit,
        bool rebasing
    ) external onlyOwner {
        supportedTokens[token] = true;
        minDeposits[token] = minDeposit;
        rebasingTokens[token] = rebasing;
        if (rebasing) {
            IERC20Rebasing(token).configure(YieldMode.CLAIMABLE);
        }
        emit SupportToken(token, minDeposit, rebasing);
    }

    function unsupportToken(address token) external onlyOwner {
        supportedTokens[token] = false;
        emit UnsupportToken(token);
    }

    function allocateDepositId() private returns (string memory depositId) {
        uint256 depositNum = nextDepositNum;
        nextDepositNum++;
        return
            string(
                abi.encodePacked(
                    DEPOSIT_PREFIX,
                    Strings.toString(depositNum),
                    CONTRACT_SUFFIX
                )
            );
    }

    function deposit(uint256 amount) external nonReentrant {
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
        bool success = makeTransferFrom(
            msg.sender,
            address(this),
            amount,
            token
        );
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

    function transferOwnership(
        address newOwner
    ) public virtual override onlyTimelock {
        require(newOwner != address(0), "ZERO_OWNER");
        _transferOwnership(newOwner);
    }

    function changeSigner(address new_signer) external onlyTimelock {
        require(new_signer != address(0), "ZERO_SIGNER");
        external_signer = new_signer;
        emit SetSigner(new_signer);
    }

    function changeClaimer(address new_claimer) external onlyTimelock {
        require(new_claimer != address(0), "ZERO_CLAIMER");
        claimer = new_claimer;
        IBlastPoints(points).configurePointsOperator(new_claimer);
        emit SetClaimer(new_claimer);
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

    function tokenCall(
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

    function getVersion() public pure returns (uint256) {
        return 21;
    }
}
