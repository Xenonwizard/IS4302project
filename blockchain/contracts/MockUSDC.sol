// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract MockUSDC is ERC20, ERC20Permit {
    uint256 public constant FAUCET_LIMIT = 100_000 * 1e6;

    error FaucetLimit(uint256 requested, uint256 limit);

    constructor() ERC20("Pokechain Test USD Coin", "USDC") ERC20Permit("Pokechain Test USD Coin") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(uint256 amount) external {
        if (amount > FAUCET_LIMIT) revert FaucetLimit(amount, FAUCET_LIMIT);
        _mint(msg.sender, amount);
    }
}
