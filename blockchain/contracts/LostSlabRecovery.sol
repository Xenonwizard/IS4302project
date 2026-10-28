// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccountRegistry} from "./AccountRegistry.sol";
import {SlabVault} from "./SlabVault.sol";

/**
 * @title LostSlabRecovery
 * @notice Finder bounties and recovery for lost slabs, settled on-chain. The lost report itself
 *         lives on SlabVault (reportLost); this contract runs everything after a finder turns up.
 *
 *  The owner's side
 *   1. `setBounty`      the owner of a Lost slab escrows a bounty from their Pokechain balance.
 *                       Lowering it (or 0) refunds the difference. Locked while a claim is open.
 *
 *  A finder's claim (a recovery "submission": the same intake as a new slab, minus vaulting)
 *   2. `fileClaim`      the finder declares the slab with the keccak256 of their evidence and
 *                       the tracking number of the parcel they send to Pokechain. The bounty is
 *                       now locked to this claim, and SlabVault refuses to cancel the lost report.
 *   3. `markReceived`   Pokechain's intake received and authenticated the slab.   operator
 *   4. `chooseReturn`   the owner picks: back into the vault, or delivered to them (with the
 *                       keccak256 of their address; the address itself never goes on-chain).
 *   5. `completeReturn` Pokechain sends it there. This contract closes the lost report on
 *                       SlabVault itself: resolveLostReport to At Pokechain (vault: it is then
 *                       forwarded to Collector Crypt and vaulted like any intake) or
 *                       markRecoveredShipped (delivery, which the owner confirms).  operator
 *   6. `claimBounty`    the finder is paid from escrow. The contract reads SlabVault: it pays
 *                       only once the slab is Vaulted again or the owner confirmed delivery.
 *      `rejectClaim`    Pokechain refuses a claim (wrong slab, fake). The bounty stays posted.
 *
 *  Nobody has to trust the owner to pay: the bounty is escrowed before anyone claims it, and the
 *  payout condition is the slab's custody on SlabVault, not anyone's say-so.
 */
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
        /// keccak256 of the finder's evidence (where it was found, condition, photo names).
        bytes32 evidenceHash;
        /// Finder → Pokechain leg
        string inboundCarrier;
        string inboundTracking;
        Status status;
        ReturnTo returnTo;
        /// keccak256 of the owner's delivery address, when returnTo is Owner.
        bytes32 shippingHash;
        /// What the finder was paid (fixed at payout).
        uint256 paid;
        uint64 filedAt;
        uint64 updatedAt;
    }

    AccountRegistry public immutable accounts;
    SlabVault public immutable vault;

    uint256 public nextClaimId = 1;
    mapping(uint256 => Claim) private _claims;
    /// @notice USDC (6 decimals) escrowed for each lost slab.
    mapping(uint256 => uint256) public bountyOf;
    /// @notice The open claim on a slab, or 0.
    mapping(uint256 => uint256) public activeClaimOf;
    /// @dev Claims each address is part of, as finder or owner.
    mapping(address => uint256[]) private _claimIds;

    /// @notice Security deposit in USDC required from a finder when filing a claim.
    uint256 public claimBond;
    /// @notice claimId => bond locked for this claim
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

    /* ------------------------------ the owner ------------------------------ */

    /// @notice Step 1: escrow (or change) the bounty on a slab the caller owns that is Lost.
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

    /// @notice Step 4: the owner decides where the authenticated slab goes.
    function chooseReturn(uint256 claimId, bool toVault, bytes32 shippingHash) external {
        Claim storage c = _move(claimId, Status.AtPokechain, Status.ReturnChosen);
        if (vault.ownerOf(c.tokenId) != msg.sender) revert NotSlabOwner(c.tokenId);
        if (!toVault && shippingHash == bytes32(0)) revert EmptyField();
        c.returnTo = toVault ? ReturnTo.Vault : ReturnTo.Owner;
        c.shippingHash = toVault ? bytes32(0) : shippingHash;
        emit ReturnChosen(claimId, c.tokenId, c.returnTo, c.shippingHash);
    }

    /* ------------------------------ the finder ----------------------------- */

    /// @notice Step 2: a collector who found a Lost slab opens a claim on it.
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

    /**
     * @notice Step 6: the finder collects the bounty. Paid only when SlabVault shows the slab
     *         back where the owner chose: Vaulted, or Delivered (the owner confirmed receipt).
     */
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

    /* ------------------------------ Pokechain ------------------------------ */

    /// @notice Sets the required claim bond for finders filing a claim.
    function setClaimBond(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        claimBond = amount;
        emit ClaimBondSet(amount);
    }

    /// @notice Step 3: Pokechain's intake received the finder's parcel and authenticated the slab.
    ///         Once authenticated, the finder's anti-griefing stake is returned immediately to prevent deadlock.
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

    /**
     * @notice Step 5: Pokechain sends the slab where the owner chose, and closes the lost report
     *         on SlabVault in the same transaction. Vault: the slab re-enters intake at
     *         At Pokechain and goes through the usual markForwarded + confirmVaulted steps, since
     *         Collector Crypt has to vault it again. Owner: it is shipped to them.
     */
    function completeReturn(uint256 claimId, string calldata carrier, string calldata trackingNumber)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Claim storage c = _move(claimId, Status.ReturnChosen, Status.Returned);
        if (c.returnTo == ReturnTo.Vault) {
            // The slab is physically at Pokechain, so it re-enters intake: markForwarded, then
            // Collector Crypt vaults it again and confirmVaulted makes it Vaulted (and payable).
            vault.resolveLostReport(c.tokenId, SlabVault.Custody.AtPokechain);
        } else {
            vault.markRecoveredShipped(c.tokenId, carrier, trackingNumber);
        }
        emit ReturnCompleted(claimId, c.tokenId, c.returnTo);
    }

    /// @notice Pokechain refuses a claim before the return. The slab stays Lost and the bounty posted.
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

    /* ------------------------------- SlabVault ----------------------------- */

    /**
     * @notice SlabVault calls this when a lost report closes outside a claim (the owner cancels,
     *         or the carrier finds it). Refuses while a finder's claim is open; otherwise refunds.
     */
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

    /* --------------------------------- views ------------------------------- */

    function claimOf(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    function claimIdsOf(address who) external view returns (uint256[] memory) {
        return _claimIds[who];
    }

    /* ------------------------------- internals ----------------------------- */

    function _move(uint256 claimId, Status expected, Status next) private returns (Claim storage c) {
        c = _claims[claimId];
        if (c.status != expected) revert WrongClaimStatus(claimId, c.status);
        c.status = next;
        c.updatedAt = uint64(block.timestamp);
    }
}
