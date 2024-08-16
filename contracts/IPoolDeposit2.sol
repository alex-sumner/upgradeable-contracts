// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

struct Contribution {
    address contributor;
    uint256 amount;
} 

interface IPoolDeposit2 {

    event Deposit(string id, address indexed trader, uint256 amount, uint256 indexed poolId, address token);
    event PooledDeposit(uint256 indexed id, uint256 amount, address token);
    
    function individualDeposit(address contributor, uint256 amount) external;
    function pooledDeposit(Contribution[] calldata contributions) external;
    function depositToken(
        address contributor,
        address token,
        uint256 amount
    ) external;
    function pooledDepositToken(
        Contribution[] calldata contributions,
        address token
    ) external;
    function depositNative(address contributor, uint256 amount) external;
    function pooledDepositNative(Contribution[] calldata contributions) external;
}
