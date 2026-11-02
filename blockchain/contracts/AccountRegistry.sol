// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISlabVaultCustody {
    function vaultedCount(address owner) external view returns (uint256);
}

interface ITradeEscrowOffers {
    function openOffers(address maker) external view returns (uint256);
}

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
    address public tradeEscrow;
    address public slabMarket;
    address public lostSlabRecovery;

    mapping(address => Account) private _accounts;
    mapping(bytes32 => address) public handleOwner;
    mapping(address => uint256) public balanceOf;
    uint256 public totalCustody;

    event AccountOpened(address indexed account, string handle, uint64 at);
    event Deposited(address indexed account, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed account, uint256 amount, uint256 newBalance);
    event AccountClosed(address indexed account, uint256 refunded, uint64 at);
    event SlabVaultSet(address slabVault);
    event TradeEscrowSet(address tradeEscrow);
    event SlabMarketSet(address slabMarket);
    event LostSlabRecoverySet(address lostSlabRecovery);
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
    error LostSlabRecoveryAlreadySet();
    error OnlyBalanceMover();
    error OffersStillOpen(uint256 count);

    constructor(IERC20 usdc_) Ownable(msg.sender) {
        usdc = usdc_;
    }

    function setSlabVault(ISlabVaultCustody vault) external onlyOwner {
        if (address(slabVault) != address(0)) revert SlabVaultAlreadySet();
        slabVault = vault;
        emit SlabVaultSet(address(vault));
    }

    function setTradeEscrow(address escrow) external onlyOwner {
        if (tradeEscrow != address(0)) revert TradeEscrowAlreadySet();
        tradeEscrow = escrow;
        emit TradeEscrowSet(escrow);
    }

    function setSlabMarket(address market) external onlyOwner {
        if (slabMarket != address(0)) revert SlabMarketAlreadySet();
        slabMarket = market;
        emit SlabMarketSet(market);
    }

    function setLostSlabRecovery(address lostSlabRecovery_) external onlyOwner {
        if (lostSlabRecovery != address(0)) revert LostSlabRecoveryAlreadySet();
        lostSlabRecovery = lostSlabRecovery_;
        emit LostSlabRecoverySet(lostSlabRecovery_);
    }

    function moveBalance(address from, address to, uint256 amount) external {
        if (
            (msg.sender != tradeEscrow || tradeEscrow == address(0))
                && (msg.sender != slabMarket || slabMarket == address(0))
                && (msg.sender != lostSlabRecovery || lostSlabRecovery == address(0))
        ) {
            revert OnlyBalanceMover();
        }
        uint256 available = balanceOf[from];
        if (amount > available) revert InsufficientBalance(amount, available);
        balanceOf[from] = available - amount;
        balanceOf[to] += amount;
        emit BalanceMoved(from, to, amount);
    }

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

    function deposit(uint256 amount) external nonReentrant {
        _deposit(msg.sender, amount);
    }

    function depositWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        // A front-runner can spend the permit first; the allowance is then already in place, so carry on.
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _deposit(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(amount, available);
        _payOut(msg.sender, amount);
    }

    function closeAccount() external nonReentrant {
        Account storage a = _accounts[msg.sender];
        if (a.status != Status.Active) revert NotActive();
        uint256 vaulted = address(slabVault) == address(0) ? 0 : slabVault.vaultedCount(msg.sender);
        if (vaulted > 0) revert SlabsStillVaulted(vaulted);
        uint256 open = tradeEscrow == address(0) ? 0 : ITradeEscrowOffers(tradeEscrow).openOffers(msg.sender);
        if (open > 0) revert OffersStillOpen(open);

        a.status = Status.Closed;
        a.closedAt = uint64(block.timestamp);
        uint256 refund = balanceOf[msg.sender];
        if (refund > 0) _payOut(msg.sender, refund);
        emit AccountClosed(msg.sender, refund, a.closedAt);
    }

    function accountOf(address owner) external view returns (Account memory) {
        return _accounts[owner];
    }

    function isActive(address owner) external view returns (bool) {
        return _accounts[owner].status == Status.Active;
    }

    function _deposit(address from, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (_accounts[from].status != Status.Active) revert NotActive();
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
