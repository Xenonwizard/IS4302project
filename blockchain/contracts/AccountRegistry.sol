// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The slice of SlabVault this contract needs, to stop an account closing while it still has slabs in custody.
interface ISlabVaultCustody {
    function vaultedCount(address owner) external view returns (uint256);
}

/// @dev The slice of TradeEscrow this contract needs: an account with open offers holds escrowed assets.
interface ITradeEscrowOffers {
    function openOffers(address maker) external view returns (uint256);
}

interface ILoanEscrowCommitments {
    function commitments(address participant) external view returns (uint256);
}

/**
 * @title AccountRegistry
 * @notice Account onboarding and offboarding for Pokechain.
 *
 *  Onboarding
 *   1. `register(handle)`     the wallet claims a unique handle and becomes an Active account.
 *   2. `deposit(amount)`      USDC moves from the wallet into Pokechain custody (needs `approve`),
 *      `depositWithPermit`    or the same thing with an EIP-2612 signature, in one transaction.
 *
 *  Offboarding
 *   3. `withdraw(amount)`     USDC moves from custody back to the wallet.
 *   4. `closeAccount()`       refunds the whole custody balance and marks the account Closed.
 *                             Refused while the account still has slabs Vaulted in SlabVault:
 *                             they must be redeemed (shipped out) or transferred first.
 *                             Also refused while it has trade offers open (assets in escrow).
 *
 *  Trading and marketplace purchases
 *      `moveBalance`         TradeEscrow and SlabMarket move custody balances: it locks the cash
 *                            in an offer or pays a seller without taking USDC out of custody.
 *
 *  Nothing is deleted. A closed account keeps its record and its handle stays reserved to that
 *  address, so the history of who owned what stays traceable on-chain.
 */
contract AccountRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Active,
        Closed
    }

    struct Account {
        string handle;
        Status status;
        uint64 openedAt;
        uint64 closedAt;
    }

    IERC20 public immutable usdc;
    ISlabVaultCustody public slabVault;
    /// @notice The TradeEscrow contract, which may move balances for offers.
    address public tradeEscrow;
    /// @notice The SlabMarket contract, which may move balances for marketplace purchases.
    address public slabMarket;
    /// @notice The LoanEscrow contract, which locks principal and settles secured loans.
    address public loanEscrow;

    mapping(address => Account) private _accounts;
    /// @notice keccak256(handle) => the address that claimed it. Handles are never released.
    mapping(bytes32 => address) public handleOwner;
    /// @notice USDC (6 decimals) each account holds in Pokechain custody.
    mapping(address => uint256) public balanceOf;
    /// @notice Sum of every balance, which always equals the USDC this contract holds.
    uint256 public totalCustody;

    event AccountOpened(address indexed account, string handle, uint64 at);
    event Deposited(address indexed account, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed account, uint256 amount, uint256 newBalance);
    event AccountClosed(address indexed account, uint256 refunded, uint64 at);
    event SlabVaultSet(address slabVault);
    event TradeEscrowSet(address tradeEscrow);
    event SlabMarketSet(address slabMarket);
    event LoanEscrowSet(address loanEscrow);
    event BalanceMoved(address indexed from, address indexed to, uint256 amount);

    error InvalidHandle();
    error HandleTaken(string handle);
    error AlreadyActive();
    error NotActive();
    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error SlabsStillVaulted(uint256 count);
    error SlabVaultAlreadySet();
    error TradeEscrowAlreadySet();
    error SlabMarketAlreadySet();
    error LoanEscrowAlreadySet();
    error OnlyBalanceMover();
    error OffersStillOpen(uint256 count);
    error LoansStillOpen(uint256 count);

    constructor(IERC20 usdc_) Ownable(msg.sender) {
        usdc = usdc_;
    }

    /// @notice One-time wiring to SlabVault, which is deployed after this contract.
    function setSlabVault(ISlabVaultCustody vault) external onlyOwner {
        if (address(slabVault) != address(0)) revert SlabVaultAlreadySet();
        slabVault = vault;
        emit SlabVaultSet(address(vault));
    }

    /// @notice One-time wiring to TradeEscrow.
    function setTradeEscrow(address escrow) external onlyOwner {
        if (tradeEscrow != address(0)) revert TradeEscrowAlreadySet();
        tradeEscrow = escrow;
        emit TradeEscrowSet(escrow);
    }

    /// @notice One-time wiring to the fixed-price marketplace.
    function setSlabMarket(address market) external onlyOwner {
        if (slabMarket != address(0)) revert SlabMarketAlreadySet();
        slabMarket = market;
        emit SlabMarketSet(market);
    }

    /// @notice One-time wiring to LoanEscrow.
    function setLoanEscrow(address escrow) external onlyOwner {
        if (loanEscrow != address(0)) revert LoanEscrowAlreadySet();
        loanEscrow = escrow;
        emit LoanEscrowSet(escrow);
    }

    /**
     * @notice Moves custody balance from one holder to another without any USDC leaving this
     *         contract, so `totalCustody` is unchanged. TradeEscrow calls it inside a transaction
     *         the paying side signed, and SlabMarket calls it for fixed-price purchases.
     */
    function moveBalance(address from, address to, uint256 amount) external {
        if (
            (msg.sender != tradeEscrow || tradeEscrow == address(0))
                && (msg.sender != slabMarket || slabMarket == address(0))
                && (msg.sender != loanEscrow || loanEscrow == address(0))
        ) {
            revert OnlyBalanceMover();
        }
        uint256 available = balanceOf[from];
        if (amount > available) revert InsufficientBalance(amount, available);
        balanceOf[from] = available - amount;
        balanceOf[to] += amount;
        emit BalanceMoved(from, to, amount);
    }

    /* ------------------------------ onboarding ------------------------------ */

    /**
     * @notice Opens an account for the calling wallet. A closed account may open again
     *         under a new handle; its old handle stays reserved to it.
     * @param handle 3 to 20 characters of a-z, 0-9 or underscore.
     */
    function register(string calldata handle) external {
        Account storage a = _accounts[msg.sender];
        if (a.status == Status.Active) revert AlreadyActive();
        if (!_validHandle(handle)) revert InvalidHandle();

        bytes32 key = keccak256(bytes(handle));
        address holder = handleOwner[key];
        if (holder != address(0) && holder != msg.sender) revert HandleTaken(handle);

        handleOwner[key] = msg.sender;
        a.handle = handle;
        a.status = Status.Active;
        a.openedAt = uint64(block.timestamp);
        a.closedAt = 0;
        emit AccountOpened(msg.sender, handle, a.openedAt);
    }

    /// @notice Moves USDC from the wallet into custody. The wallet must `approve` this contract first.
    function deposit(uint256 amount) external nonReentrant {
        _deposit(msg.sender, amount);
    }

    /**
     * @notice `deposit` authorised by an EIP-2612 permit signature, so the user signs once
     *         off-chain and sends one transaction instead of approve + deposit.
     */
    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        // A front-runner can spend the permit first; the allowance is then already in place, so carry on.
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _deposit(msg.sender, amount);
    }

    /* ------------------------------ offboarding ------------------------------ */

    /// @notice Moves USDC from custody back to the wallet. Works on closed accounts too, so funds are never stuck.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(amount, available);
        _payOut(msg.sender, amount);
    }

    /**
     * @notice Offboards the account: refunds the full custody balance and marks it Closed.
     *         Every slab must have left the vault first (redeemed or transferred).
     */
    function closeAccount() external nonReentrant {
        Account storage a = _accounts[msg.sender];
        if (a.status != Status.Active) revert NotActive();
        uint256 vaulted = address(slabVault) == address(0) ? 0 : slabVault.vaultedCount(msg.sender);
        if (vaulted > 0) revert SlabsStillVaulted(vaulted);
        uint256 open = tradeEscrow == address(0) ? 0 : ITradeEscrowOffers(tradeEscrow).openOffers(msg.sender);
        if (open > 0) revert OffersStillOpen(open);
        uint256 loans = loanEscrow == address(0) ? 0 : ILoanEscrowCommitments(loanEscrow).commitments(msg.sender);
        if (loans > 0) revert LoansStillOpen(loans);

        a.status = Status.Closed;
        a.closedAt = uint64(block.timestamp);
        uint256 refund = balanceOf[msg.sender];
        if (refund > 0) _payOut(msg.sender, refund);
        emit AccountClosed(msg.sender, refund, a.closedAt);
    }

    /* --------------------------------- views --------------------------------- */

    function accountOf(address owner) external view returns (Account memory) {
        return _accounts[owner];
    }

    function isActive(address owner) external view returns (bool) {
        return _accounts[owner].status == Status.Active;
    }

    /* ------------------------------- internals ------------------------------- */

    function _deposit(address from, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (_accounts[from].status != Status.Active) revert NotActive();
        // Effects before the external call (checks-effects-interactions).
        uint256 newBalance = balanceOf[from] + amount;
        balanceOf[from] = newBalance;
        totalCustody += amount;
        usdc.safeTransferFrom(from, address(this), amount);
        emit Deposited(from, amount, newBalance);
    }

    function _payOut(address to, uint256 amount) private {
        uint256 newBalance = balanceOf[to] - amount;
        balanceOf[to] = newBalance;
        totalCustody -= amount;
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount, newBalance);
    }

    function _validHandle(string calldata handle) private pure returns (bool) {
        bytes calldata b = bytes(handle);
        if (b.length < 3 || b.length > 20) return false;
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "_";
            if (!ok) return false;
        }
        return true;
    }
}
