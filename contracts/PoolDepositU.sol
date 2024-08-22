// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolDeposit2, Contribution} from "./IPoolDeposit2.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract PoolDepositU is IPoolDeposit2, UUPSUpgradeable, OwnableUpgradeable {
    uint256 constant MAX_CONTRIBUTIONS = 100;
    uint256 constant MIN_REFUND = 1e15;
    string constant DEPOSIT_PREFIX = "d_";
    string constant CONTRACT_SUFFIX = "_rbxp";
    address public timelock;
    address public rabbit;
    address public defaultToken;
    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public minDeposits;

    uint256 nextDepositNum;
    uint256 nextPoolId;

    event Withdrawal(address indexed to, uint256 amount, address indexed token);
    event SetRabbit(address indexed rabbit);
    event SupportToken(address token, uint256 minDeposit);
    event UnsupportToken(address token);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _timelock,
        address _owner,
        address _rabbit,
        address _defaultToken,
        uint256 _minDeposit,
        address[] memory _otherTokens,
        uint256[] memory _minDeposits
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();

        timelock = _timelock;
        rabbit = _rabbit;
        defaultToken = _defaultToken;
        supportedTokens[_defaultToken] = true;
        minDeposits[_defaultToken] = _minDeposit;
        for (uint256 i = 0; i < _otherTokens.length; i++) {
            address token = _otherTokens[i];
            supportedTokens[token] = true;
            minDeposits[token] = _minDeposits[i];
        }
        nextDepositNum = 1;
        nextPoolId = 1000;
    }

    modifier onlyTimelock() {
        require(msg.sender == timelock, "ONLY_TIMELOCK");
        _;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyTimelock {
    }

    function supportToken(
        address _token,
        uint256 _minDeposit
    ) external onlyOwner {
        supportedTokens[_token] = true;
        minDeposits[_token] = _minDeposit;
        emit SupportToken(_token, _minDeposit);
    }

    function unsupportToken(address _token) external onlyOwner {
        supportedTokens[_token] = false;
        emit UnsupportToken(_token);
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

    function allocatePoolId() private returns (uint256) {
        uint256 poolId = nextPoolId;
        nextPoolId++;
        return poolId;
    }

    function individualDeposit(address contributor, uint256 amount) external {
        require(amount >= minDeposits[defaultToken], "AMOUNT_TOO_SMALL");
        string memory depositId = allocateDepositId();
        emit Deposit(depositId, contributor, amount, 0, defaultToken);
        bool success = makeTransferFrom(
            msg.sender,
            rabbit,
            amount,
            defaultToken
        );
        require(success, "TRANSFER_FAILED");
    }

    function depositToken(
        address contributor,
        uint256 amount,
        address token
    ) external {
        require(supportedTokens[token], "UNSUPPORTED_TOKEN");
        require(amount >= minDeposits[token], "AMOUNT_TOO_SMALL");
        string memory depositId = allocateDepositId();
        emit Deposit(depositId, contributor, amount, 0, token);
        uint256 prevBalance = IERC20(token).balanceOf(rabbit);
        bool success = makeTransferFrom(
            msg.sender,
            rabbit,
            amount,
            token
        );
        require(success, "TRANSFER_FAILED");
        uint256 newBalance = IERC20(token).balanceOf(rabbit);
        require(newBalance == amount + prevBalance, "NOT_ENOUGH_TRANSFERRED");
    }

    function depositNative(address contributor) external payable {
        address native = address(0);
        require(supportedTokens[native], "UNSUPPORTED_TOKEN");
        uint256 minDeposit = minDeposits[native];
        require(msg.value >= minDeposit, "AMOUNT_TOO_SMALL");
        string memory depositId = allocateDepositId();
        emit Deposit(depositId, contributor, msg.value, 0, native);
        (bool success, ) = rabbit.call{value: msg.value}("");
        require(success, "TRANSFER_FAILED");
    }

    function pooledDeposit(Contribution[] calldata contributions) external {
        uint256 totalAmount = pooledDepositCommon(contributions, defaultToken);
        bool success = makeTransferFrom(
            msg.sender,
            rabbit,
            totalAmount,
            defaultToken
        );
        require(success, "TRANSFER_FAILED");
    }

    function pooledDepositNative(
        Contribution[] calldata contributions
    ) external payable {
        uint256 totalAmount = pooledDepositCommon(contributions, address(0));
        require(msg.value >= totalAmount, "VALUE_TOO_SMALL");
        if (msg.value - totalAmount >= MIN_REFUND) {
            (bool success, ) = msg.sender.call{
                value: msg.value - totalAmount
            }("");
            require(success, "REFUND_FAILED");
        } 
    }

    function pooledDepositToken(
        Contribution[] calldata contributions,
        address token
    ) public {
        uint256 totalAmount = pooledDepositCommon(contributions, token);
        bool success = makeTransferFrom(
            msg.sender,
            rabbit,
            totalAmount,
            token
        );
        require(success, "TRANSFER_FAILED");
    }

    function pooledDepositCommon(
        Contribution[] calldata contributions,
        address token
    ) private returns (uint256 totalAmount) {
        require(supportedTokens[token], "UNSUPPORTED_TOKEN");
        uint256 poolId = allocatePoolId();
        totalAmount = 0;
        if (contributions.length > MAX_CONTRIBUTIONS) {
            revert("TOO_MANY_CONTRIBUTIONS");
        }
        for (uint i = 0; i < contributions.length; i++) {
            Contribution calldata contribution = contributions[i];
            uint256 contribAmount = contribution.amount;
            totalAmount += contribAmount;
            require(contribAmount >= minDeposits[token], "WRONG_AMOUNT");
            require(totalAmount >= contribAmount, "INTEGRITY_OVERFLOW_ERROR");
            string memory depositId = allocateDepositId();
            emit Deposit(
                depositId,
                contribution.contributor,
                contribAmount,
                poolId,
                token
            );
        }
        require(totalAmount > 0, "WRONG_AMOUNT");
        emit PooledDeposit(poolId, totalAmount, token);
        return totalAmount;
    }

    // There is no reason for the contract to hold any tokens as its only
    // purpose is to transfer tokens to the RabbitX contract and have credit
    // for them awarded on the exchange.
    // The following function allows recovery of tokens in the event that
    // any are mistakenly sent to this contract.
    // Without it any tokens transferred to the contract would be effectively
    // burned, as there would be no way to retrieve them.
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

    function setRabbit(address _rabbit) external onlyOwner {
        rabbit = _rabbit;
        emit SetRabbit(_rabbit);
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
