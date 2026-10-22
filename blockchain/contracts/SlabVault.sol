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
 * @notice One ERC-721 token per physical graded slab held in the Pokechain vault.
 *
 *  Onboarding a slab (the vault takes custody, a token is minted)
 *   1. `requestSubmission`  the collector declares grader + cert number. Status: Pending.
 *   2. `mintSlab`           the operator has confirmed the custodian (Grade10) holds the
 *                           slab: it looked the cert up in Grade10's registry and checked
 *                           Grade10's Solana record of it. It mints the token to the collector
 *                           and stores the Solana asset id, linking the two chains.
 *                           Custody: Vaulted.  (or `rejectSubmission`.)
 *
 *  Offboarding a slab (the slab leaves the vault, the token stays)
 *   3. `requestRedemption`  the owner asks for the slab to be shipped. The token is locked:
 *                           it can no longer be transferred or traded. Custody: RedemptionRequested.
 *   4. `markShipped`        the operator records carrier + tracking number. Custody: Shipped.
 *   5. `confirmDelivery`    the owner confirms it arrived. Custody: Delivered.
 *      `reportLost`         or reports it lost in transit. Custody: Lost.
 *   6. `resolveLostReport`  the operator closes a lost report: found and delivered, or returned to the vault.
 *
 *  The token is never burned. A withdrawn slab keeps its token, its owner and its full custody
 *  trail, so a lost-in-transit claim can be checked against the chain and the history of the
 *  physical card stays traceable.
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
        Minted,
        Rejected
    }

    struct Slab {
        string grader;
        string certNumber;
        string title;
        string image;
        /// The custodian's record of the physical slab: Grade10's Solana asset id.
        string custodianRef;
        uint64 mintedAt;
        Custody custody;
        /// keccak256 of the shipping address. The address itself never goes on-chain.
        bytes32 shippingHash;
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

    event SubmissionRequested(uint256 indexed submissionId, address indexed owner, string grader, string certNumber);
    event SubmissionRejected(uint256 indexed submissionId, address indexed owner, string reason);
    event SlabMinted(
        uint256 indexed tokenId, uint256 indexed submissionId, address indexed owner, string certNumber, string custodianRef
    );
    event RedemptionRequested(uint256 indexed tokenId, address indexed owner, bytes32 shippingHash);
    event SlabShipped(uint256 indexed tokenId, address indexed owner, string carrier, string trackingNumber);
    event SlabDelivered(uint256 indexed tokenId, address indexed owner);
    event SlabReportedLost(uint256 indexed tokenId, address indexed owner, string trackingNumber, string details);
    event LostReportResolved(uint256 indexed tokenId, address indexed owner, Custody outcome);

    error AccountNotActive(address account);
    error CertAlreadyTokenised(uint256 tokenId);
    error CertAlreadyPending(uint256 submissionId);
    error SubmissionNotPending(uint256 submissionId);
    error NotSlabOwner(uint256 tokenId);
    error WrongCustody(uint256 tokenId, Custody current);
    error SlabLocked(uint256 tokenId, Custody current);
    error EmptyField();

    constructor(IAccountStatus accounts_, address operator) ERC721("Pokechain Slab", "SLAB") {
        accounts = accounts_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, operator);
    }

    /* ---------------------------- slab onboarding ---------------------------- */

    /// @notice Step 1: the collector declares a slab they are sending in.
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
            requestedAt: uint64(block.timestamp)
        });
        pendingSubmissionOfCert[key] = submissionId;
        emit SubmissionRequested(submissionId, msg.sender, grader, certNumber);
    }

    /**
     * @notice Step 2: the operator attests the custodian holds the slab and the cert checks out,
     *         and mints the token to the collector.
     * @param title display name, e.g. "2021 Evolving Skies Umbreon VMAX #215 PSA 10"
     * @param image URL of the card image
     * @param custodianRef Grade10's Solana asset id for this slab
     */
    function mintSlab(uint256 submissionId, string calldata title, string calldata image, string calldata custodianRef)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 tokenId)
    {
        Submission storage s = _submissions[submissionId];
        if (s.status != SubmissionStatus.Pending) revert SubmissionNotPending(submissionId);
        if (!accounts.isActive(s.owner)) revert AccountNotActive(s.owner);
        if (bytes(custodianRef).length == 0) revert EmptyField();

        bytes32 key = certKey(s.grader, s.certNumber);
        tokenId = nextTokenId++;
        s.status = SubmissionStatus.Minted;
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
        if (s.status != SubmissionStatus.Pending) revert SubmissionNotPending(submissionId);
        s.status = SubmissionStatus.Rejected;
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
        _moveCustody(tokenId, Custody.Vaulted, Custody.RedemptionRequested);
        _slabs[tokenId].shippingHash = shippingHash;
        vaultedCount[msg.sender] -= 1;
        emit RedemptionRequested(tokenId, msg.sender, shippingHash);
    }

    /// @notice Step 4: the operator hands the slab to a carrier.
    function markShipped(uint256 tokenId, string calldata carrier, string calldata trackingNumber)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (bytes(trackingNumber).length == 0) revert EmptyField();
        _moveCustody(tokenId, Custody.RedemptionRequested, Custody.Shipped);
        _slabs[tokenId].carrier = carrier;
        _slabs[tokenId].trackingNumber = trackingNumber;
        emit SlabShipped(tokenId, ownerOf(tokenId), carrier, trackingNumber);
    }

    /// @notice Step 5a: the owner confirms the slab arrived.
    function confirmDelivery(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        _moveCustody(tokenId, Custody.Shipped, Custody.Delivered);
        emit SlabDelivered(tokenId, msg.sender);
    }

    /// @notice Step 5b: the owner reports the slab lost, before or after it was handed to the carrier.
    function reportLost(uint256 tokenId, string calldata details) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        Custody c = _slabs[tokenId].custody;
        if (c != Custody.RedemptionRequested && c != Custody.Shipped) revert WrongCustody(tokenId, c);
        _setCustody(tokenId, Custody.Lost);
        emit SlabReportedLost(tokenId, msg.sender, _slabs[tokenId].trackingNumber, details);
    }

    /**
     * @notice Step 6: the operator closes a lost report. `Delivered` if the carrier found it,
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
            '"},{"trait_type":"Custodian record (Solana)","value":"', s.custodianRef,
            '"},{"trait_type":"Custody","value":"', _custodyName(s.custody),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /* ------------------------------- internals ------------------------------- */

    /**
     * @dev Every mint and transfer passes through here. A slab can only move while it is
     *      Vaulted (once redemption starts the token is locked), only to an active account,
     *      and the per-owner vaulted count follows it.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (to != address(0) && !accounts.isActive(to)) revert AccountNotActive(to);
        if (from != address(0)) {
            Custody c = _slabs[tokenId].custody;
            if (c != Custody.Vaulted) revert SlabLocked(tokenId, c);
            vaultedCount[from] -= 1;
        }
        if (to != address(0)) vaultedCount[to] += 1;
        return super._update(to, tokenId, auth);
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
