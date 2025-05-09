// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDR is ERC20 {
    uint256 public constant INITIAL_SUPPLY = (10 ** 9) * (10 ** 18);
    address public immutable owner;

    constructor() ERC20("RabbitDollar", "USDR") {
        owner = msg.sender;
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    function mint(address account, uint256 amount) external virtual {
        require(msg.sender == owner, "ONLY_OWNER");
        _mint(account, amount);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

}
