pragma solidity ^0.8.0;

// SPDX-License-Identifier: BUSL-1.1

interface IVault2 {
    event Stake(
        string id,
        address indexed trader,
        uint256 amount,
        address indexed token
    );

    function isValidSigner(
        address signer,
        uint256 role
    ) external view returns (bool);
}
