// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title MockUSDC
 * @notice Test stand-in for Circle's USDC: 6 decimals, plus EIP-2612 `permit` so a deposit
 *         can be authorised with one off-chain signature instead of a separate `approve` tx.
 *         Anyone can call `faucet` to mint test dollars. On a real network you would point
 *         AccountRegistry at Circle's USDC instead and drop this contract.
 */
contract MockUSDC is ERC20, ERC20Permit {
    /// @notice Most a single faucet call can mint: 100,000 USDC.
    uint256 public constant FAUCET_LIMIT = 100_000 * 1e6;

    error FaucetLimit(uint256 requested, uint256 limit);

    constructor() ERC20("Pokechain Test USD Coin", "USDC") ERC20Permit("Pokechain Test USD Coin") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints test USDC to the caller.
    function faucet(uint256 amount) external {
        if (amount > FAUCET_LIMIT) revert FaucetLimit(amount, FAUCET_LIMIT);
        _mint(msg.sender, amount);
    }
}
