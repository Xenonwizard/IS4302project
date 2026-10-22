// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @dev The slice of AccountRegistry this contract needs: only active accounts may hold slabs.
interface IAccountStatus {
    function isActive(address owner) external view returns (bool);
}

/**
 * @title SlabVault
 * @notice One ERC-721 token per physical graded slab. The physical slab is stored by
 *         Collector Crypt (CC), whose own Solana NFT for it is held by Pokechain's escrow
 *         wallet. This token is the Pokechain-side title: trading moves this token only,
 *         while CC's NFT stays locked in the escrow.
 *
 *  Onboarding a slab (inbound trail, no token yet)
 *   1. `requestSubmission`  the collector declares grader + cert and ships the slab to
 *                           Pokechain. Submission: Pending.
 *   2. `markReceived`       Pokechain's warehouse has it. Submission: ReceivedByPokechain.
 *   3. `markForwarded`      Pokechain ships it on to CC (carrier + tracking recorded).
 *                           Submission: AtCustodian.
 *   4. `mintSlab`           CC vaulted it and minted its Solana NFT to Pokechain's escrow; the
 *                           operator checked that NFT (DAS getAsset) and mints this token to the
 *                           collector, storing CC's asset id. Custody: Vaulted.
 *                           (`rejectSubmission` at any open stage.)
 *
 *  Offboarding a slab (the slab leaves the vault, the token stays)
 *   5. `requestRedemption`  the owner asks for the slab. The token is locked: it can no longer
 *                           be transferred or traded. Custody: RedemptionRequested.
 *   6. `markShipped`        Pokechain, as holder of CC's NFT, asked CC to ship to the owner;
 *                           records CC's redemption id, carrier and tracking. Custody: Shipped.
 *   7. `confirmDelivery`    the owner confirms it arrived. Custody: Delivered.
 *      `reportLost`         or reports it lost. Custody: Lost.
 *   8. `resolveLostReport`  the operator closes a lost report: delivered, or back in the vault.
 *
 *  Nothing is burned. Every step is a state change plus an event, so the slab's path from the
 *  collector's hands, through Pokechain and CC, and back out to its final owner can be traced
 *  end to end, on this chain and (through the stored ids) on Solana and with CC.
 */
contract SlabVault is ERC721, AccessControl {
    using Strings for uint256;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    enum Custody {
        None,
        Vaulted,
        RedemptionRequested,
        Shipped,
        Delivered,
        Lost
    }

    enum SubmissionStatus {
        None,
        Pending,
        ReceivedByPokechain,
        AtCustodian,
        Minted,
        Rejected
    }

    struct Slab {
        string grader;
        string certNumber;
        string title;
        string image;
        /// Collector Crypt's Solana NFT (asset id) for this slab, held by Pokechain's escrow.
        string custodianRef;
        uint64 mintedAt;
        Custody custody;
        /// keccak256 of the shipping address. The address itself never goes on-chain.
        bytes32 shippingHash;
        /// Collector Crypt's redemption id for the outbound shipment.
        string redemptionRef;
        string carrier;
        string trackingNumber;
        uint64 custodyUpdatedAt;
    }

    struct Submission {
        address owner;
        string grader;
        string certNumber;
        SubmissionStatus status;
        uint256 tokenId;
        uint64 requestedAt;
        /// Pokechain → Collector Crypt leg
        string forwardCarrier;
        string forwardTracking;
        uint64 updatedAt;
    }

    IAccountStatus public immutable accounts;

    uint256 public nextTokenId = 1;
    uint256 public nextSubmissionId = 1;

    mapping(uint256 => Slab) private _slabs;
    mapping(uint256 => Submission) private _submissions;
    /// @notice keccak256(grader, cert) => token id (or pending submission id), so one physical slab is tokenised once.
    mapping(bytes32 => uint256) public tokenOfCert;
    mapping(bytes32 => uint256) public pendingSubmissionOfCert;
    /// @notice Slabs each address holds that are still physically in the vault.
    mapping(address => uint256) public vaultedCount;

    /// @notice The approved marketplace contract allowed to settle card sales.
    address public marketplace;
    /// @notice Whether a slab is currently listed on the marketplace (Rule 5 sale restriction).
    mapping(uint256 => bool) public isListed;

    event SubmissionRequested(uint256 indexed submissionId, address indexed owner, string grader, string certNumber);
    event SubmissionReceived(uint256 indexed submissionId, address indexed owner);
    event SubmissionForwarded(uint256 indexed submissionId, address indexed owner, string carrier, string trackingNumber);
    event SubmissionRejected(uint256 indexed submissionId, address indexed owner, string reason);
    event SlabMinted(
        uint256 indexed tokenId, uint256 indexed submissionId, address indexed owner, string certNumber, string custodianRef
    );
    event RedemptionRequested(uint256 indexed tokenId, address indexed owner, bytes32 shippingHash);
    event SlabShipped(
        uint256 indexed tokenId, address indexed owner, string redemptionRef, string carrier, string trackingNumber
    );
    event SlabDelivered(uint256 indexed tokenId, address indexed owner);
    event SlabReportedLost(uint256 indexed tokenId, address indexed owner, string trackingNumber, string details);
    event LostReportResolved(uint256 indexed tokenId, address indexed owner, Custody outcome);
    event MarketplaceSet(address indexed marketplace);
    event ListingRestrictionUpdated(uint256 indexed tokenId, bool restricted);

    error AccountNotActive(address account);
    error CertAlreadyTokenised(uint256 tokenId);
    error CertAlreadyPending(uint256 submissionId);
    error SubmissionNotPending(uint256 submissionId);
    error WrongSubmissionStatus(uint256 submissionId, SubmissionStatus current);
    error NotSlabOwner(uint256 tokenId);
    error WrongCustody(uint256 tokenId, Custody current);
    error SlabLocked(uint256 tokenId, Custody current);
    error SlabIsListed(uint256 tokenId);
    error OnlyMarketplace();
    error SelfTransfer(uint256 tokenId);
    error EmptyField();

    constructor(IAccountStatus accounts_, address operator) ERC721("Pokechain Slab", "SLAB") {
        accounts = accounts_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, operator);
    }

    /* ---------------------------- slab onboarding ---------------------------- */

    /// @notice Step 1: the collector declares a slab they are sending to Pokechain.
    function requestSubmission(string calldata grader, string calldata certNumber) external returns (uint256 submissionId) {
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);
        if (bytes(grader).length == 0 || bytes(certNumber).length == 0) revert EmptyField();
        bytes32 key = certKey(grader, certNumber);
        if (tokenOfCert[key] != 0) revert CertAlreadyTokenised(tokenOfCert[key]);
        if (pendingSubmissionOfCert[key] != 0) revert CertAlreadyPending(pendingSubmissionOfCert[key]);

        submissionId = nextSubmissionId++;
        _submissions[submissionId] = Submission({
            owner: msg.sender,
            grader: grader,
            certNumber: certNumber,
            status: SubmissionStatus.Pending,
            tokenId: 0,
            requestedAt: uint64(block.timestamp),
            forwardCarrier: "",
            forwardTracking: "",
            updatedAt: uint64(block.timestamp)
        });
        pendingSubmissionOfCert[key] = submissionId;
        emit SubmissionRequested(submissionId, msg.sender, grader, certNumber);
    }

    /// @notice Step 2: Pokechain's warehouse has received the slab from the collector.
    function markReceived(uint256 submissionId) external onlyRole(OPERATOR_ROLE) {
        Submission storage s = _moveSubmission(submissionId, SubmissionStatus.Pending, SubmissionStatus.ReceivedByPokechain);
        emit SubmissionReceived(submissionId, s.owner);
    }

    /// @notice Step 3: Pokechain ships the slab on to Collector Crypt's vault.
    function markForwarded(uint256 submissionId, string calldata carrier, string calldata trackingNumber)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (bytes(trackingNumber).length == 0) revert EmptyField();
        Submission storage s =
            _moveSubmission(submissionId, SubmissionStatus.ReceivedByPokechain, SubmissionStatus.AtCustodian);
        s.forwardCarrier = carrier;
        s.forwardTracking = trackingNumber;
        emit SubmissionForwarded(submissionId, s.owner, carrier, trackingNumber);
    }

    /**
     * @notice Step 4: Collector Crypt has vaulted the slab and its Solana NFT sits in Pokechain's
     *         escrow (the operator checked this off-chain). Mints the token to the collector.
     * @param title display name, e.g. "2021 Evolving Skies Umbreon VMAX #215 PSA 10"
     * @param image URL of the card image
     * @param custodianRef Collector Crypt's Solana asset id for this slab
     */
    function mintSlab(uint256 submissionId, string calldata title, string calldata image, string calldata custodianRef)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 tokenId)
    {
        Submission storage s = _moveSubmission(submissionId, SubmissionStatus.AtCustodian, SubmissionStatus.Minted);
        if (!accounts.isActive(s.owner)) revert AccountNotActive(s.owner);
        if (bytes(custodianRef).length == 0) revert EmptyField();

        bytes32 key = certKey(s.grader, s.certNumber);
        tokenId = nextTokenId++;
        s.tokenId = tokenId;
        delete pendingSubmissionOfCert[key];
        tokenOfCert[key] = tokenId;

        Slab storage slab = _slabs[tokenId];
        slab.grader = s.grader;
        slab.certNumber = s.certNumber;
        slab.title = title;
        slab.image = image;
        slab.custodianRef = custodianRef;
        slab.mintedAt = uint64(block.timestamp);
        slab.custody = Custody.Vaulted;
        slab.custodyUpdatedAt = uint64(block.timestamp);

        // _update below counts it into vaultedCount.
        _safeMint(s.owner, tokenId);
        emit SlabMinted(tokenId, submissionId, s.owner, s.certNumber, custodianRef);
    }

    function rejectSubmission(uint256 submissionId, string calldata reason) external onlyRole(OPERATOR_ROLE) {
        Submission storage s = _submissions[submissionId];
        if (!_isOpen(s.status)) revert SubmissionNotPending(submissionId);
        s.status = SubmissionStatus.Rejected;
        s.updatedAt = uint64(block.timestamp);
        delete pendingSubmissionOfCert[certKey(s.grader, s.certNumber)];
        emit SubmissionRejected(submissionId, s.owner, reason);
    }

    /* --------------------------- slab offboarding ---------------------------- */

    /**
     * @notice Step 3: the owner asks for the physical slab. The token stays with them but is
     *         locked from here on.
     * @param shippingHash keccak256 of the shipping address, computed in the browser. It lets
     *        the operator prove later which address they shipped to without publishing it.
     */
    function requestRedemption(uint256 tokenId, bytes32 shippingHash) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        if (isListed[tokenId]) revert SlabIsListed(tokenId);
        _moveCustody(tokenId, Custody.Vaulted, Custody.RedemptionRequested);
        _slabs[tokenId].shippingHash = shippingHash;
        vaultedCount[msg.sender] -= 1;
        emit RedemptionRequested(tokenId, msg.sender, shippingHash);
    }

    /**
     * @notice Step 6: Pokechain (holder of CC's NFT) asked Collector Crypt to ship the slab to the
     *         owner. Records CC's redemption id and the carrier's tracking number.
     */
    function markShipped(
        uint256 tokenId,
        string calldata redemptionRef,
        string calldata carrier,
        string calldata trackingNumber
    ) external onlyRole(OPERATOR_ROLE) {
        if (bytes(trackingNumber).length == 0 || bytes(redemptionRef).length == 0) revert EmptyField();
        _moveCustody(tokenId, Custody.RedemptionRequested, Custody.Shipped);
        Slab storage slab = _slabs[tokenId];
        slab.redemptionRef = redemptionRef;
        slab.carrier = carrier;
        slab.trackingNumber = trackingNumber;
        emit SlabShipped(tokenId, ownerOf(tokenId), redemptionRef, carrier, trackingNumber);
    }

    /// @notice Step 7a: the owner confirms the slab arrived.
    function confirmDelivery(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        _moveCustody(tokenId, Custody.Shipped, Custody.Delivered);
        emit SlabDelivered(tokenId, msg.sender);
    }

    /// @notice Step 7b: the owner reports the slab lost, before or after it was handed to the carrier.
    function reportLost(uint256 tokenId, string calldata details) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        Custody c = _slabs[tokenId].custody;
        if (c != Custody.RedemptionRequested && c != Custody.Shipped) revert WrongCustody(tokenId, c);
        _setCustody(tokenId, Custody.Lost);
        emit SlabReportedLost(tokenId, msg.sender, _slabs[tokenId].trackingNumber, details);
    }

    /**
     * @notice Step 8: the operator closes a lost report. `Delivered` if the carrier found it,
     *         `Vaulted` if it came back to the vault (it can then be traded again).
     */
    function resolveLostReport(uint256 tokenId, Custody outcome) external onlyRole(OPERATOR_ROLE) {
        if (outcome != Custody.Delivered && outcome != Custody.Vaulted) revert WrongCustody(tokenId, outcome);
        _moveCustody(tokenId, Custody.Lost, outcome);
        address owner = ownerOf(tokenId);
        if (outcome == Custody.Vaulted) vaultedCount[owner] += 1;
        emit LostReportResolved(tokenId, owner, outcome);
    }

    /* --------------------------------- views --------------------------------- */

    function certKey(string memory grader, string memory certNumber) public pure returns (bytes32) {
        return keccak256(abi.encode(grader, certNumber));
    }

    function slabOf(uint256 tokenId) external view returns (Slab memory) {
        _requireOwned(tokenId);
        return _slabs[tokenId];
    }

    function submissionOf(uint256 submissionId) external view returns (Submission memory) {
        return _submissions[submissionId];
    }

    /// @notice Fully on-chain ERC-721 metadata: a base64 JSON document, no server or IPFS needed.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Slab storage s = _slabs[tokenId];
        bytes memory json = abi.encodePacked(
            '{"name":"', s.title,
            '","description":"Graded slab held by the Pokechain vault. The token is never burned, so the custody trail stays on-chain.",',
            '"image":"', s.image,
            '","attributes":[{"trait_type":"Grader","value":"', s.grader,
            '"},{"trait_type":"Cert number","value":"', s.certNumber,
            '"},{"trait_type":"Collector Crypt NFT (Solana)","value":"', s.custodianRef,
            '"},{"trait_type":"Custody","value":"', _custodyName(s.custody),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /* ----------------------------- marketplace ------------------------------ */

    function setMarketplace(address marketplace_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        marketplace = marketplace_;
        emit MarketplaceSet(marketplace_);
    }

    function setListingRestriction(uint256 tokenId, bool restricted) external {
        if (msg.sender != marketplace) revert OnlyMarketplace();
        _requireOwned(tokenId);
        isListed[tokenId] = restricted;
        emit ListingRestrictionUpdated(tokenId, restricted);
    }

    function isRestricted(uint256 tokenId) external view returns (bool) {
        return isListed[tokenId];
    }

    function settleMarketTransfer(address from, address to, uint256 tokenId) external {
        if (msg.sender != marketplace) revert OnlyMarketplace();
        _transfer(from, to, tokenId);
    }

    /* ------------------------------- internals ------------------------------- */

    /**
     * @dev Every mint and transfer passes through here. A slab can only move while it is
     *      Vaulted (once redemption starts the token is locked), only to an active account
     *      other than its current owner, and the per-owner vaulted count follows it.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (to != address(0) && !accounts.isActive(to)) revert AccountNotActive(to);
        if (from != address(0)) {
            if (to == from) revert SelfTransfer(tokenId);
            if (isListed[tokenId] && msg.sender != marketplace) revert SlabIsListed(tokenId);
            Custody c = _slabs[tokenId].custody;
            if (c != Custody.Vaulted) revert SlabLocked(tokenId, c);
            vaultedCount[from] -= 1;
        }
        if (to != address(0)) vaultedCount[to] += 1;
        return super._update(to, tokenId, auth);
    }

    function _isOpen(SubmissionStatus st) private pure returns (bool) {
        return st == SubmissionStatus.Pending || st == SubmissionStatus.ReceivedByPokechain
            || st == SubmissionStatus.AtCustodian;
    }

    function _moveSubmission(uint256 submissionId, SubmissionStatus expected, SubmissionStatus next)
        private
        returns (Submission storage s)
    {
        s = _submissions[submissionId];
        if (s.status != expected) revert WrongSubmissionStatus(submissionId, s.status);
        s.status = next;
        s.updatedAt = uint64(block.timestamp);
    }

    function _moveCustody(uint256 tokenId, Custody expected, Custody next) private {
        Custody c = _slabs[tokenId].custody;
        if (c != expected) revert WrongCustody(tokenId, c);
        _setCustody(tokenId, next);
    }

    function _setCustody(uint256 tokenId, Custody next) private {
        _slabs[tokenId].custody = next;
        _slabs[tokenId].custodyUpdatedAt = uint64(block.timestamp);
    }

    function _custodyName(Custody c) private pure returns (string memory) {
        if (c == Custody.Vaulted) return "Vaulted";
        if (c == Custody.RedemptionRequested) return "Redemption requested";
        if (c == Custody.Shipped) return "Shipped";
        if (c == Custody.Delivered) return "Delivered";
        if (c == Custody.Lost) return "Lost";
        return "None";
    }
}
