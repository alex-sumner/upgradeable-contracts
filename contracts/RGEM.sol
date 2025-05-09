pragma solidity ^0.8.0;
// SPDX-License-Identifier: MIT

/**
 * ERC20 contract for RabbitX GEM token rGEM
 */
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract RGEM is ERC20 {
    uint256 public constant ONE_HUNDRED_THOUSAND_TOKENS = (10 ** 5) * (10 ** 18);

    constructor(address _initialHolder) ERC20("RabbitX GEM", "rGEM") {
        _mint(_initialHolder, ONE_HUNDRED_THOUSAND_TOKENS);
    }
}