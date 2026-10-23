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
 *   1. `requestSubmission`  the collector declares grader + cert, a declared value, the hash
 *                           of their intake evidence (photos + condition report) and the
 *                           tracking number of the parcel they ship to Pokechain. Pending.
 *   2. `markReceived`       Pokechain's warehouse has it. Submission: ReceivedByPokechain.
 *   3. `markForwarded`      Pokechain ships it on to CC. The parcel details (carrier, tracking)
 *                           go on-chain only as ciphertext encrypted to CC's published key,
 *                           plus a salted commitment for disputes. Submission: AtCustodian.
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
        /// Carried over from the submission: the owner's declared value (USD cents) and the
        /// keccak256 of their intake evidence manifest (photos + condition report).
        uint64 declaredValueCents;
        bytes32 evidenceHash;
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
        /// Declared value for insurance, in USD cents.
        uint64 declaredValueCents;
        /// keccak256 of the evidence manifest: the intake photos' hashes, condition notes and
        /// declarations. The photos stay off-chain; this proves later exactly what was declared.
        bytes32 evidenceHash;
        /// Collector → Pokechain leg
        string inboundCarrier;
        string inboundTracking;
        /// Pokechain → Collector Crypt leg: keccak256(salt ‖ parcel details). The details
        /// themselves only appear encrypted, in the SubmissionForwarded event.
        bytes32 forwardCommitment;
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

    /// @notice Public encryption keys (X25519, 32 bytes) that parties publish so others can send
    ///         them data only they can read. Anyone can publish their own; nobody can set another's.
    mapping(address => bytes32) public encryptionKey;
    /// @notice The custodian's address (Collector Crypt). Forwarded parcel details are encrypted to its key.
    address public custodian;

    event SubmissionRequested(
        uint256 indexed submissionId,
        address indexed owner,
        string grader,
        string certNumber,
        uint64 declaredValueCents,
        bytes32 evidenceHash,
        string inboundTracking
    );
    event SubmissionReceived(uint256 indexed submissionId, address indexed owner);
    /**
     * @param recipient who the details are encrypted for (the custodian)
     * @param recipientKey the exact public key used, so key rotation stays traceable
     * @param commitment keccak256(salt ‖ plaintext), checkable with verifyForwardCommitment
     * @param ciphertext the parcel details, readable only with the recipient's private key
     */
    event SubmissionForwarded(
        uint256 indexed submissionId,
        address indexed owner,
        address indexed recipient,
        bytes32 recipientKey,
        bytes32 commitment,
        bytes ciphertext
    );
    event EncryptionKeySet(address indexed account, bytes32 key);
    event CustodianSet(address indexed custodian);
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

    error AccountNotActive(address account);
    error CertAlreadyTokenised(uint256 tokenId);
    error CertAlreadyPending(uint256 submissionId);
    error SubmissionNotPending(uint256 submissionId);
    error WrongSubmissionStatus(uint256 submissionId, SubmissionStatus current);
    error NotSlabOwner(uint256 tokenId);
    error WrongCustody(uint256 tokenId, Custody current);
    error SlabLocked(uint256 tokenId, Custody current);
    error SelfTransfer(uint256 tokenId);
    error EmptyField();
    error NoEncryptionKey(address account);
    error MissingEvidence();

    constructor(IAccountStatus accounts_, address operator) ERC721("Pokechain Slab", "SLAB") {
        accounts = accounts_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, operator);
    }

    /* ---------------------------- slab onboarding ---------------------------- */

    /**
     * @notice Step 1: the collector declares a slab they are sending to Pokechain.
     * @param declaredValueCents value declared for insurance, in USD cents
     * @param evidenceHash keccak256 of the intake evidence manifest (photo hashes, condition, declarations)
     * @param inboundCarrier carrier of the parcel to Pokechain (may be empty if dropped off)
     * @param inboundTracking its tracking number (may be empty if dropped off)
     */
    function requestSubmission(
        string calldata grader,
        string calldata certNumber,
        uint64 declaredValueCents,
        bytes32 evidenceHash,
        string calldata inboundCarrier,
        string calldata inboundTracking
    ) external returns (uint256 submissionId) {
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);
        if (bytes(grader).length == 0 || bytes(certNumber).length == 0 || declaredValueCents == 0) revert EmptyField();
        if (evidenceHash == bytes32(0)) revert MissingEvidence();
        bytes32 key = certKey(grader, certNumber);
        if (tokenOfCert[key] != 0) revert CertAlreadyTokenised(tokenOfCert[key]);
        if (pendingSubmissionOfCert[key] != 0) revert CertAlreadyPending(pendingSubmissionOfCert[key]);

        submissionId = nextSubmissionId++;
        Submission storage s = _submissions[submissionId];
        s.owner = msg.sender;
        s.grader = grader;
        s.certNumber = certNumber;
        s.status = SubmissionStatus.Pending;
        s.requestedAt = uint64(block.timestamp);
        s.declaredValueCents = declaredValueCents;
        s.evidenceHash = evidenceHash;
        s.inboundCarrier = inboundCarrier;
        s.inboundTracking = inboundTracking;
        s.updatedAt = uint64(block.timestamp);
        pendingSubmissionOfCert[key] = submissionId;
        emit SubmissionRequested(
            submissionId, msg.sender, grader, certNumber, declaredValueCents, evidenceHash, inboundTracking
        );
    }

    /// @notice Step 2: Pokechain's warehouse has received the slab from the collector.
    function markReceived(uint256 submissionId) external onlyRole(OPERATOR_ROLE) {
        Submission storage s = _moveSubmission(submissionId, SubmissionStatus.Pending, SubmissionStatus.ReceivedByPokechain);
        emit SubmissionReceived(submissionId, s.owner);
    }

    /* --------------------------- encrypted messaging --------------------------- */

    /// @notice Publishes the caller's public encryption key (X25519). Calling again rotates it.
    function setEncryptionKey(bytes32 key) external {
        if (key == bytes32(0)) revert EmptyField();
        encryptionKey[msg.sender] = key;
        emit EncryptionKeySet(msg.sender, key);
    }

    /// @notice Names the custodian (Collector Crypt) whose key forwarded parcel details are encrypted to.
    function setCustodian(address custodian_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        custodian = custodian_;
        emit CustodianSet(custodian_);
    }

    /**
     * @notice Step 3: Pokechain ships the slab on to Collector Crypt's vault and tells CC which
     *         parcel to expect, privately.
     * @param ciphertext carrier, tracking number and submission details, encrypted off-chain to
     *        encryptionKey[custodian]. Everyone can see it; only Collector Crypt can read it.
     * @param commitment keccak256(salt ‖ plaintext) with the salt kept by Pokechain, so in a
     *        dispute the plaintext can be revealed and checked against this value on-chain.
     */
    function markForwarded(uint256 submissionId, bytes calldata ciphertext, bytes32 commitment)
        external
        onlyRole(OPERATOR_ROLE)
    {
        bytes32 key = encryptionKey[custodian];
        if (custodian == address(0) || key == bytes32(0)) revert NoEncryptionKey(custodian);
        if (ciphertext.length == 0 || commitment == bytes32(0)) revert EmptyField();
        Submission storage s =
            _moveSubmission(submissionId, SubmissionStatus.ReceivedByPokechain, SubmissionStatus.AtCustodian);
        s.forwardCommitment = commitment;
        emit SubmissionForwarded(submissionId, s.owner, custodian, key, commitment, ciphertext);
    }

    /**
     * @notice Dispute check: does this plaintext (and the salt Pokechain kept) match what was
     *         committed when the slab was forwarded? Neither side can change its story later.
     */
    function verifyForwardCommitment(uint256 submissionId, bytes calldata plaintext, bytes32 salt)
        external
        view
        returns (bool)
    {
        bytes32 c = _submissions[submissionId].forwardCommitment;
        return c != bytes32(0) && keccak256(abi.encodePacked(salt, plaintext)) == c;
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
        slab.declaredValueCents = s.declaredValueCents;
        slab.evidenceHash = s.evidenceHash;
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
        // Built in two halves: one abi.encodePacked with every field runs out of stack slots.
        bytes memory head = abi.encodePacked(
            '{"name":"', s.title,
            '","description":"Graded slab held by the Pokechain vault. The token is never burned, so the custody trail stays on-chain.",',
            '"image":"', s.image,
            '","attributes":[{"trait_type":"Grader","value":"', s.grader,
            '"},{"trait_type":"Cert number","value":"', s.certNumber
        );
        bytes memory tail = abi.encodePacked(
            '"},{"trait_type":"Collector Crypt NFT (Solana)","value":"', s.custodianRef,
            '"},{"trait_type":"Custody","value":"', _custodyName(s.custody),
            '"},{"trait_type":"Declared value (USD cents)","display_type":"number","value":',
            uint256(s.declaredValueCents).toString(),
            '},{"trait_type":"Evidence hash","value":"', uint256(s.evidenceHash).toHexString(32),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes.concat(head, tail)));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
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
