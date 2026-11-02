// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccountRegistry} from "./AccountRegistry.sol";
import {SlabVault} from "./SlabVault.sol";

contract LostSlabRecovery is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    enum Status {
        None,
        Filed,
        AtPokechain,
        ReturnChosen,
        Returned,
        Paid,
        Rejected
    }

    enum ReturnTo {
        Unset,
        Vault,
        Owner
    }

    struct Claim {
        uint256 tokenId;
        address finder;
        address owner;
        bytes32 evidenceHash;
        string inboundCarrier;
        string inboundTracking;
        Status status;
        ReturnTo returnTo;
        bytes32 shippingHash;
        uint256 paid;
        uint64 filedAt;
        uint64 updatedAt;
    }

    AccountRegistry public immutable accounts;
    SlabVault public immutable vault;

    uint256 public nextClaimId = 1;
    mapping(uint256 => Claim) private _claims;
    mapping(uint256 => uint256) public bountyOf;
    mapping(uint256 => uint256) public activeClaimOf;
    mapping(address => uint256[]) private _claimIds;

    uint256 public claimBond;
    mapping(uint256 => uint256) public bondOf;

    event BountySet(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event BountyRefunded(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event ClaimBondSet(uint256 amount);
    event ClaimBondRefunded(uint256 indexed claimId, address indexed finder, uint256 amount);
    event ClaimBondSlashed(uint256 indexed claimId, address indexed finder, address indexed owner, uint256 amount);
    event ClaimFiled(
        uint256 indexed claimId,
        uint256 indexed tokenId,
        address indexed finder,
        address owner,
        bytes32 evidenceHash,
        string inboundCarrier,
        string inboundTracking
    );
    event ClaimReceived(uint256 indexed claimId, uint256 indexed tokenId);
    event ReturnChosen(uint256 indexed claimId, uint256 indexed tokenId, ReturnTo returnTo, bytes32 shippingHash);
    event ReturnCompleted(uint256 indexed claimId, uint256 indexed tokenId, ReturnTo returnTo);
    event BountyPaid(uint256 indexed claimId, uint256 indexed tokenId, address indexed finder, uint256 amount);
    event ClaimRejected(uint256 indexed claimId, uint256 indexed tokenId, string reason);

    error AccountNotActive(address account);
    error NotSlabOwner(uint256 tokenId);
    error SlabNotLost(uint256 tokenId);
    error OwnSlab();
    error ClaimInProgress(uint256 claimId);
    error WrongClaimStatus(uint256 claimId, Status current);
    error NotFinder();
    error NotReturnedYet(uint256 tokenId);
    error EmptyField();
    error OnlyVault();

    constructor(AccountRegistry accounts_, SlabVault vault_, address operator) {
        accounts = accounts_;
        vault = vault_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, operator);
    }

    function setBounty(uint256 tokenId, uint256 amount) external nonReentrant {
        if (vault.ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        if (activeClaimOf[tokenId] != 0) revert ClaimInProgress(activeClaimOf[tokenId]);
        uint256 current = bountyOf[tokenId];
        if (amount > current) {
            if (vault.custodyOf(tokenId) != SlabVault.Custody.Lost) revert SlabNotLost(tokenId);
            accounts.moveBalance(msg.sender, address(this), amount - current);
        } else if (amount < current) {
            accounts.moveBalance(address(this), msg.sender, current - amount);
        }
        bountyOf[tokenId] = amount;
        emit BountySet(tokenId, msg.sender, amount);
    }

    function chooseReturn(uint256 claimId, bool toVault, bytes32 shippingHash) external {
        Claim storage c = _move(claimId, Status.AtPokechain, Status.ReturnChosen);
        if (vault.ownerOf(c.tokenId) != msg.sender) revert NotSlabOwner(c.tokenId);
        if (!toVault && shippingHash == bytes32(0)) revert EmptyField();
        c.returnTo = toVault ? ReturnTo.Vault : ReturnTo.Owner;
        c.shippingHash = toVault ? bytes32(0) : shippingHash;
        emit ReturnChosen(claimId, c.tokenId, c.returnTo, c.shippingHash);
    }

    function fileClaim(
        uint256 tokenId,
        bytes32 evidenceHash,
        string calldata inboundCarrier,
        string calldata inboundTracking
    ) external returns (uint256 claimId) {
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);
        if (vault.custodyOf(tokenId) != SlabVault.Custody.Lost) revert SlabNotLost(tokenId);
        address owner = vault.ownerOf(tokenId);
        if (owner == msg.sender) revert OwnSlab();
        if (activeClaimOf[tokenId] != 0) revert ClaimInProgress(activeClaimOf[tokenId]);
        if (evidenceHash == bytes32(0) || bytes(inboundTracking).length == 0) revert EmptyField();

        claimId = nextClaimId++;
        Claim storage c = _claims[claimId];
        c.tokenId = tokenId;
        c.finder = msg.sender;
        c.owner = owner;
        c.evidenceHash = evidenceHash;
        c.inboundCarrier = inboundCarrier;
        c.inboundTracking = inboundTracking;
        c.status = Status.Filed;
        c.filedAt = uint64(block.timestamp);
        c.updatedAt = uint64(block.timestamp);
        activeClaimOf[tokenId] = claimId;
        _claimIds[msg.sender].push(claimId);
        _claimIds[owner].push(claimId);

        if (claimBond > 0) {
            accounts.moveBalance(msg.sender, address(this), claimBond);
            bondOf[claimId] = claimBond;
        }

        emit ClaimFiled(claimId, tokenId, msg.sender, owner, evidenceHash, inboundCarrier, inboundTracking);
    }

    function claimBounty(uint256 claimId) external nonReentrant {
        Claim storage c = _claims[claimId];
        if (c.finder != msg.sender) revert NotFinder();
        if (c.status != Status.Returned) revert WrongClaimStatus(claimId, c.status);
        SlabVault.Custody custody = vault.custodyOf(c.tokenId);
        SlabVault.Custody needed = c.returnTo == ReturnTo.Vault ? SlabVault.Custody.Vaulted : SlabVault.Custody.Delivered;
        if (custody != needed) revert NotReturnedYet(c.tokenId);

        uint256 amount = bountyOf[c.tokenId];
        uint256 bond = bondOf[claimId];
        bondOf[claimId] = 0;
        c.status = Status.Paid;
        c.paid = amount;
        c.updatedAt = uint64(block.timestamp);
        bountyOf[c.tokenId] = 0;
        activeClaimOf[c.tokenId] = 0;
        if (amount + bond > 0) accounts.moveBalance(address(this), msg.sender, amount + bond);
        if (bond > 0) emit ClaimBondRefunded(claimId, msg.sender, bond);
        emit BountyPaid(claimId, c.tokenId, msg.sender, amount);
    }

    function setClaimBond(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimBond = amount;
        emit ClaimBondSet(amount);
    }

    function markReceived(uint256 claimId) external onlyRole(OPERATOR_ROLE) {
        Claim storage c = _move(claimId, Status.Filed, Status.AtPokechain);
        uint256 bond = bondOf[claimId];
        if (bond > 0) {
            bondOf[claimId] = 0;
            accounts.moveBalance(address(this), c.finder, bond);
            emit ClaimBondRefunded(claimId, c.finder, bond);
        }
        emit ClaimReceived(claimId, c.tokenId);
    }

    function completeReturn(uint256 claimId, string calldata carrier, string calldata trackingNumber)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Claim storage c = _move(claimId, Status.ReturnChosen, Status.Returned);
        if (c.returnTo == ReturnTo.Vault) {
            vault.resolveLostReport(c.tokenId, SlabVault.Custody.AtPokechain);
        } else {
            vault.markRecoveredShipped(c.tokenId, carrier, trackingNumber);
        }
        emit ReturnCompleted(claimId, c.tokenId, c.returnTo);
    }

    function rejectClaim(uint256 claimId, string calldata reason) external onlyRole(OPERATOR_ROLE) {
        Claim storage c = _claims[claimId];
        if (c.status != Status.Filed && c.status != Status.AtPokechain) revert WrongClaimStatus(claimId, c.status);
        c.status = Status.Rejected;
        c.updatedAt = uint64(block.timestamp);
        activeClaimOf[c.tokenId] = 0;

        uint256 bond = bondOf[claimId];
        bondOf[claimId] = 0;
        if (bond > 0) {
            accounts.moveBalance(address(this), c.owner, bond);
            emit ClaimBondSlashed(claimId, c.finder, c.owner, bond);
        }

        emit ClaimRejected(claimId, c.tokenId, reason);
    }

    function onLostReportClosed(uint256 tokenId) external nonReentrant {
        if (msg.sender != address(vault)) revert OnlyVault();
        if (activeClaimOf[tokenId] != 0) revert ClaimInProgress(activeClaimOf[tokenId]);
        uint256 amount = bountyOf[tokenId];
        if (amount == 0) return;
        address owner = vault.ownerOf(tokenId);
        bountyOf[tokenId] = 0;
        accounts.moveBalance(address(this), owner, amount);
        emit BountyRefunded(tokenId, owner, amount);
    }

    function claimOf(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    function claimIdsOf(address who) external view returns (uint256[] memory) {
        return _claimIds[who];
    }

    function _move(uint256 claimId, Status expected, Status next) private returns (Claim storage c) {
        c = _claims[claimId];
        if (c.status != expected) revert WrongClaimStatus(claimId, c.status);
        c.status = next;
        c.updatedAt = uint64(block.timestamp);
    }
}
