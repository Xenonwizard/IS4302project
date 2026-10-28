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

/// @dev The slice of LostSlabRecovery this contract needs: a lost report can't close under an open finder claim.
interface ILostReportHook {
    function onLostReportClosed(uint256 tokenId) external;
}

/**
 * @title SlabVault
 * @notice One ERC-721 token per physical graded slab. The physical slab is stored by
 *         Collector Crypt (CC), whose own Solana NFT for it is held by Pokechain's escrow
 *         wallet. This token is the Pokechain-side title: trading moves this token only,
 *         while CC's NFT stays locked in the escrow.
 *
 *  Onboarding a slab: an intake request is not an NFT.
 *   1. `requestSubmission`  the collector declares grader + cert, the hash of their intake
 *                           evidence and the inbound tracking number. The numeric PSA cert is
 *                           the submission id. Nothing is minted yet.
 *   2. `markReceived`       Pokechain's warehouse has it. This mints one locked NFT to the
 *                           collector and sets custody to AtPokechain.
 *   3. `markForwarded`      Pokechain ships it on to CC. The parcel details (carrier, tracking)
 *                           go on-chain only as ciphertext encrypted to CC's published key,
 *                           plus a salted commitment for disputes. Custody: SentToCustodian.
 *   4. `confirmVaulted`     CC vaulted it and minted its Solana NFT to Pokechain's escrow; the
 *                           operator checked that NFT (DAS getAsset) and confirms it, storing CC's
 *                           asset id. Custody: Vaulted: only now can the token be traded.
 *                           (`rejectSubmission` at any open stage: Rejected, never burned.)
 *
 *  Offboarding a slab (the title NFT burns once Collector Crypt has been told to ship it)
 *   5. `requestRedemption`  the owner asks for the slab with their address hash. The token is
 *                           locked (no trades, listings or loans) and `redeemerOf` records who
 *                           asked. Custody: RedemptionRequested.
 *   6. `markShipped`        Pokechain, as holder of CC's NFT, asked CC to ship to the owner;
 *                           records CC's redemption id, carrier and tracking, then burns the
 *                           title NFT. Custody: Shipped.
 *   7. `confirmDelivery`    the redeemer confirms it arrived. Custody: Delivered.
 *                           A parcel lost on this leg is a claim against Collector Crypt and the
 *                           carrier (off-chain); there is no token left to report lost.
 *      `reportLost`         the owner reports a slab lost in the post on its way in, or missing
 *                           from Collector Crypt's vault. Custody: Lost. Lost reports are public:
 *                           the Lost page reads them from `SlabReportedLost` and `custodyOf`.
 *   8. `resolveLostReport`  the operator closes an inbound/vault return; a found outbound slab
 *                           is verified and sent through `markRecoveredShipped`.
 *      LostSlabRecovery      a finder's claim runs steps 8 for the operator (it holds OPERATOR_ROLE).
 *                           While a claim is open the owner can't cancel the report, and closing
 *                           a report any other way refunds its escrowed bounty.
 *      `writeOffLost`        the owner gives up on a lost slab (insurance pays out off-chain):
 *                           the bounty is refunded and the token burned. Custody: WrittenOff.
 *
 *  Trading: TradeEscrow (set with `setTradeEscrow`) may hold slabs that are in an open offer and
 *  move Vaulted slabs on its own authority when both sides of a trade have agreed.
 *
 *  The NFT survives every inbound and lost state. It is burned when Collector Crypt is notified
 *  to ship the slab out (or after a recovered slab is delivered, or written off); the slab record and events
 *  remain available as a permanent custody trail.
 */
contract SlabVault is ERC721, AccessControl {
    using Strings for uint256;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @dev New states are appended so the numbers of the existing ones never change.
    enum Custody {
        None,
        Vaulted,
        RedemptionRequested,
        Shipped,
        Delivered,
        Lost,
        PostedToPokechain,
        AtPokechain,
        SentToCustodian,
        Rejected,
        WrittenOff
    }

    enum SubmissionStatus {
        None,
        Pending,
        ReceivedByPokechain,
        AtCustodian,
        Vaulted,
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
        /// Carried over from the submission: the keccak256 of the owner's intake evidence manifest
        /// (photos + condition report).
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

    /// @notice For PSA slabs, the ERC-721 token id is the numeric PSA certificate id.

    mapping(uint256 => Slab) private _slabs;
    mapping(uint256 => Custody) private _custodyBeforeLoss;
    /// @notice Who asked to ship a slab out. Their token burns at dispatch, so this is who confirms delivery.
    mapping(uint256 => address) public redeemerOf;
    mapping(uint256 => Submission) private _submissions;
    /// @notice keccak256(grader, cert) => its token once Pokechain has received and minted it.
    mapping(bytes32 => uint256) public tokenOfCert;
    /// @notice keccak256(grader, cert) => its active intake request, including before minting.
    mapping(bytes32 => uint256) public submissionOfCert;
    /// @notice ERC-721 token => originating intake request.
    mapping(uint256 => uint256) public submissionOfToken;
    /// @notice The TradeEscrow contract: may hold slabs in open offers and move Vaulted slabs for agreed trades.
    address public tradeEscrow;
    /// @notice The collateral escrow: may hold a vaulted slab while its loan is active.
    address public loanEscrow;
    /// @notice The LostSlabRecovery contract: escrows bounties and runs a finder's recovery (see the notice).
    address public lostSlabRecovery;
    /// @notice Slabs each address holds that are still physically in the vault.
    mapping(address => uint256) public vaultedCount;

    /// @notice Public encryption keys (X25519, 32 bytes) that parties publish so others can send
    ///         them data only they can read. Anyone can publish their own; nobody can set another's.
    mapping(address => bytes32) public encryptionKey;
    /// @notice The custodian's address (Collector Crypt). Forwarded parcel details are encrypted to its key.
    address public custodian;
    /// @notice The approved marketplace contract allowed to settle card sales.
    address public marketplace;
    /// @notice Whether a slab is currently listed on the marketplace (Rule 5 sale restriction).
    mapping(uint256 => bool) public isListed;

    event SubmissionRequested(
        uint256 indexed submissionId,
        address indexed owner,
        string grader,
        string certNumber,
        bytes32 evidenceHash,
        string inboundTracking
    );
    event SubmissionReceived(uint256 indexed submissionId, uint256 indexed tokenId, address indexed owner);
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
    event SlabVaulted(uint256 indexed tokenId, address indexed owner, string certNumber, string custodianRef);
    event TradeEscrowSet(address indexed tradeEscrow);
    event LoanEscrowSet(address indexed loanEscrow);
    event LostSlabRecoverySet(address indexed lostSlabRecovery);
    event RedemptionRequested(uint256 indexed tokenId, address indexed owner, bytes32 shippingHash);
    event SlabShipped(
        uint256 indexed tokenId, address indexed owner, string redemptionRef, string carrier, string trackingNumber
    );
    event SlabDelivered(uint256 indexed tokenId, address indexed owner);
    event SlabReportedLost(uint256 indexed tokenId, address indexed owner, string trackingNumber, string details);
    event LostReportCancelled(uint256 indexed tokenId, address indexed owner, Custody restoredCustody);
    event LostReportResolved(uint256 indexed tokenId, address indexed owner, Custody outcome);
    event LostSlabWrittenOff(uint256 indexed tokenId, address indexed owner);
    event LostSlabRecovered(uint256 indexed tokenId, address indexed owner, string carrier, string trackingNumber);
    event MarketplaceSet(address indexed marketplace);
    event ListingRestrictionUpdated(uint256 indexed tokenId, bool restricted);

    error AccountNotActive(address account);
    error CertAlreadyTokenised(uint256 tokenId);
    error SubmissionNotPending(uint256 submissionId);
    error WrongSubmissionStatus(uint256 submissionId, SubmissionStatus current);
    error NotSlabOwner(uint256 tokenId);
    error WrongCustody(uint256 tokenId, Custody current);
    error SlabLocked(uint256 tokenId, Custody current);
    error SlabIsListed(uint256 tokenId);
    error OnlyMarketplace();
    error SelfTransfer(uint256 tokenId);
    error EmptyField();
    error NoEncryptionKey(address account);
    error MissingEvidence();
    error InvalidCertNumber();
    error UnknownSlab(uint256 tokenId);

    constructor(IAccountStatus accounts_, address operator) ERC721("Pokechain Slab", "SLAB") {
        accounts = accounts_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, operator);
    }

    /* ---------------------------- slab onboarding ---------------------------- */

    /**
     * @notice Step 1: the collector declares a slab they are sending to Pokechain.
     * @param evidenceHash keccak256 of the intake evidence manifest (photo hashes, condition, declarations)
     * @param inboundCarrier carrier of the parcel to Pokechain (may be empty if dropped off)
     * @param inboundTracking its tracking number (may be empty if dropped off)
     */
    function requestSubmission(
        string calldata grader,
        string calldata certNumber,
        bytes32 evidenceHash,
        string calldata inboundCarrier,
        string calldata inboundTracking
    ) external returns (uint256 submissionId) {
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);
        if (bytes(grader).length == 0 || bytes(certNumber).length == 0) revert EmptyField();
        if (evidenceHash == bytes32(0)) revert MissingEvidence();
        bytes32 key = certKey(grader, certNumber);
        submissionId = _submissionIdFromCert(certNumber);
        if (_submissions[submissionId].status != SubmissionStatus.None || submissionOfCert[key] != 0) {
            revert CertAlreadyTokenised(submissionId);
        }
        submissionOfCert[key] = submissionId;
        Submission storage s = _submissions[submissionId];
        s.owner = msg.sender;
        s.grader = grader;
        s.certNumber = certNumber;
        s.status = SubmissionStatus.Pending;
        s.requestedAt = uint64(block.timestamp);
        s.evidenceHash = evidenceHash;
        s.inboundCarrier = inboundCarrier;
        s.inboundTracking = inboundTracking;
        s.updatedAt = uint64(block.timestamp);
        // `tokenId` stays zero until Pokechain has physically received the slab.
        emit SubmissionRequested(
            submissionId, msg.sender, grader, certNumber, evidenceHash, inboundTracking
        );
    }

    /// @notice Step 2: Pokechain's warehouse has received the slab from the collector.
    function markReceived(uint256 submissionId) external onlyRole(OPERATOR_ROLE) {
        Submission storage s = _moveSubmission(submissionId, SubmissionStatus.Pending, SubmissionStatus.ReceivedByPokechain);
        uint256 tokenId = submissionId;
        s.tokenId = tokenId;
        submissionOfToken[tokenId] = submissionId;
        tokenOfCert[certKey(s.grader, s.certNumber)] = tokenId;
        _mintPending(submissionId, tokenId);
        _moveCustody(tokenId, Custody.PostedToPokechain, Custody.AtPokechain);
        emit SubmissionReceived(submissionId, tokenId, s.owner);
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
        _moveCustody(s.tokenId, Custody.AtPokechain, Custody.SentToCustodian);
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
     *         escrow (the operator checked this off-chain). The token, minted when Pokechain
     *         received the slab,
     *         becomes Vaulted: it now counts as held in the vault and can be traded.
     * @param title display name, e.g. "2021 Evolving Skies Umbreon VMAX #215 PSA 10"
     * @param image URL of the card image
     * @param custodianRef Collector Crypt's Solana asset id for this slab
     */
    function confirmVaulted(uint256 submissionId, string calldata title, string calldata image, string calldata custodianRef)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Submission storage s = _moveSubmission(submissionId, SubmissionStatus.AtCustodian, SubmissionStatus.Vaulted);
        if (bytes(custodianRef).length == 0) revert EmptyField();
        uint256 tokenId = s.tokenId;
        _moveCustody(tokenId, Custody.SentToCustodian, Custody.Vaulted);
        Slab storage slab = _slabs[tokenId];
        slab.title = title;
        slab.image = image;
        slab.custodianRef = custodianRef;
        // The inbound carrier/tracking fields are reused for the outbound shipment later.
        slab.carrier = "";
        slab.trackingNumber = "";
        address owner = ownerOf(tokenId);
        vaultedCount[owner] += 1;
        emit SlabVaulted(tokenId, owner, s.certNumber, custodianRef);
    }

    struct SeedParams {
        address recipient;
        string grader;
        string certNumber;
        string title;
        string image;
        string custodianRef;
        bytes32 evidenceHash;
    }

    /**
     * @notice Seeds an initial vaulted slab directly to an active collector account, as if it had been
     *         submitted, received, forwarded and vaulted already (so it has a submission record too).
     * @dev Only callable by the operator role, for platform initialisation and demo data.
     */
    function seedSlab(SeedParams calldata p) external onlyRole(OPERATOR_ROLE) returns (uint256 tokenId) {
        if (!accounts.isActive(p.recipient)) revert AccountNotActive(p.recipient);
        if (bytes(p.custodianRef).length == 0) revert EmptyField();
        bytes32 key = certKey(p.grader, p.certNumber);
        uint256 submissionId = _submissionIdFromCert(p.certNumber);
        if (tokenOfCert[key] != 0 || _submissions[submissionId].status != SubmissionStatus.None) {
            revert CertAlreadyTokenised(tokenOfCert[key] != 0 ? tokenOfCert[key] : submissionId);
        }

        tokenId = submissionId;
        tokenOfCert[key] = tokenId;
        submissionOfCert[key] = submissionId;
        submissionOfToken[tokenId] = submissionId;

        Submission storage sub = _submissions[submissionId];
        sub.owner = p.recipient;
        sub.grader = p.grader;
        sub.certNumber = p.certNumber;
        sub.status = SubmissionStatus.Vaulted;
        sub.requestedAt = uint64(block.timestamp);
        sub.updatedAt = uint64(block.timestamp);
        sub.evidenceHash = p.evidenceHash;
        sub.tokenId = tokenId;

        Slab storage slab = _slabs[tokenId];
        slab.grader = p.grader;
        slab.certNumber = p.certNumber;
        slab.title = p.title;
        slab.image = p.image;
        slab.custodianRef = p.custodianRef;
        slab.evidenceHash = p.evidenceHash;
        slab.mintedAt = uint64(block.timestamp);
        _setCustody(tokenId, Custody.Vaulted);

        _safeMint(p.recipient, tokenId);
        vaultedCount[p.recipient] += 1;
        emit SlabVaulted(tokenId, p.recipient, p.certNumber, p.custodianRef);
    }

    /// @notice Refuses a submission at any open stage. A received slab keeps its rejected NFT record; an unreceived request has no NFT.
    function rejectSubmission(uint256 submissionId, string calldata reason) external onlyRole(OPERATOR_ROLE) {
        Submission storage s = _submissions[submissionId];
        if (!_isOpen(s.status)) revert SubmissionNotPending(submissionId);
        s.status = SubmissionStatus.Rejected;
        s.updatedAt = uint64(block.timestamp);
        delete tokenOfCert[certKey(s.grader, s.certNumber)];
        delete submissionOfCert[certKey(s.grader, s.certNumber)];
        if (s.tokenId != 0) _setCustody(s.tokenId, Custody.Rejected);
        emit SubmissionRejected(submissionId, s.owner, reason);
    }

    /* --------------------------- slab offboarding ---------------------------- */

    /**
     * @notice Step 5: the owner asks for the physical slab. The token stays with them but is
     *         locked; it burns in `markShipped`, once Collector Crypt has been told to ship it.
     * @param shippingHash keccak256 of the shipping address, computed in the browser. It lets
     *        the operator prove later which address they shipped to without publishing it.
     */
    function requestRedemption(uint256 tokenId, bytes32 shippingHash) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        if (isListed[tokenId]) revert SlabIsListed(tokenId);
        _moveCustody(tokenId, Custody.Vaulted, Custody.RedemptionRequested);
        _slabs[tokenId].shippingHash = shippingHash;
        redeemerOf[tokenId] = msg.sender;
        vaultedCount[msg.sender] -= 1;
        emit RedemptionRequested(tokenId, msg.sender, shippingHash);
    }

    /**
     * @notice Step 6: Pokechain (holder of CC's NFT) asked Collector Crypt to ship the slab to the
     *         owner. Records CC's redemption id and the carrier's tracking number, then burns
     *         the title NFT: from here the slab is a parcel between CC, the carrier and the owner.
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
        emit SlabShipped(tokenId, redeemerOf[tokenId], redemptionRef, carrier, trackingNumber);
        _burn(tokenId);
    }

    /**
     * @notice Step 7: the owner confirms the slab arrived. A redeemed slab's token burned at
     *         dispatch, so its redeemer confirms; a recovered lost slab still has its token, which
     *         burns now.
     */
    function confirmDelivery(uint256 tokenId) external {
        bool redeemed = _ownerOf(tokenId) == address(0);
        address owner = redeemed ? redeemerOf[tokenId] : ownerOf(tokenId);
        if (owner != msg.sender) revert NotSlabOwner(tokenId);
        _moveCustody(tokenId, Custody.Shipped, Custody.Delivered);
        emit SlabDelivered(tokenId, msg.sender);
        if (!redeemed) _burn(tokenId);
    }

    /**
     * @notice The owner reports the slab lost: in the post on its way to Pokechain or to Collector
     *         Crypt (inbound), or missing from CC's vault. A recovered slab on its way back
     *         (Shipped, token not yet burned) can be reported again. A redemption can't: its token is
     *         locked until dispatch and burned after.
     */
    function reportLost(uint256 tokenId, string calldata details) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        if (isListed[tokenId]) revert SlabIsListed(tokenId);
        Custody c = _slabs[tokenId].custody;
        bool inPost = c == Custody.PostedToPokechain || c == Custody.AtPokechain || c == Custody.SentToCustodian
            || c == Custody.Shipped;
        if (!inPost && c != Custody.Vaulted) revert WrongCustody(tokenId, c);
        // A Lost slab can't trade, so it stops counting as vaulted until it's found.
        if (c == Custody.Vaulted) vaultedCount[msg.sender] -= 1;
        _custodyBeforeLoss[tokenId] = c;
        _setCustody(tokenId, Custody.Lost);
        emit SlabReportedLost(tokenId, msg.sender, _slabs[tokenId].trackingNumber, details);
    }

    /// @notice The owner withdraws a mistaken lost report and restores the preceding transit state.
    function cancelLostReport(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        Custody previous = _custodyBeforeLoss[tokenId];
        if (_slabs[tokenId].custody != Custody.Lost || previous == Custody.None) {
            revert WrongCustody(tokenId, _slabs[tokenId].custody);
        }
        _closeLostReport(tokenId);
        _moveCustody(tokenId, Custody.Lost, previous);
        delete _custodyBeforeLoss[tokenId];
        if (previous == Custody.Vaulted) vaultedCount[msg.sender] += 1;
        emit LostReportCancelled(tokenId, msg.sender, previous);
    }

    /**
     * @notice The owner writes a lost slab off (their insurance claim is handled off-chain): any
     *         escrowed bounty is refunded, the report closes for good and the title token burns.
     *         Refused while a finder's claim is open, like cancelling.
     */
    function writeOffLost(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        _closeLostReport(tokenId);
        _moveCustody(tokenId, Custody.Lost, Custody.WrittenOff);
        delete _custodyBeforeLoss[tokenId];
        emit LostSlabWrittenOff(tokenId, msg.sender);
        _burn(tokenId);
    }

    /**
     * @notice Step 8: the operator closes a lost report. `AtPokechain` if an inbound parcel turned
     *         up at Pokechain (onboarding carries on from there), or `Vaulted` if it came back to
     *         the vault. A recovered slab returned to its owner uses `markRecoveredShipped`, then
     *         only the owner can call `confirmDelivery`.
     */
    function resolveLostReport(uint256 tokenId, Custody outcome) external onlyRole(OPERATOR_ROLE) {
        if (outcome != Custody.Vaulted && outcome != Custody.AtPokechain) {
            revert WrongCustody(tokenId, outcome);
        }
        _closeLostReport(tokenId);
        _moveCustody(tokenId, Custody.Lost, outcome);
        delete _custodyBeforeLoss[tokenId];
        address owner = ownerOf(tokenId);
        if (outcome == Custody.Vaulted) vaultedCount[owner] += 1;
        if (outcome == Custody.AtPokechain) {
            Submission storage s = _submissions[submissionOfToken[tokenId]];
            s.status = SubmissionStatus.ReceivedByPokechain;
            s.updatedAt = uint64(block.timestamp);
        }
        emit LostReportResolved(tokenId, owner, outcome);
    }

    /** @notice Pokechain/CC verified a recovered lost slab and shipped it back to its latest owner. */
    function markRecoveredShipped(uint256 tokenId, string calldata carrier, string calldata trackingNumber)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (bytes(carrier).length == 0 || bytes(trackingNumber).length == 0) revert EmptyField();
        _closeLostReport(tokenId);
        _moveCustody(tokenId, Custody.Lost, Custody.Shipped);
        delete _custodyBeforeLoss[tokenId];
        Slab storage slab = _slabs[tokenId];
        slab.carrier = carrier;
        slab.trackingNumber = trackingNumber;
        address owner = ownerOf(tokenId);
        emit LostSlabRecovered(tokenId, owner, carrier, trackingNumber);
        emit SlabShipped(tokenId, owner, "RECOVERY", carrier, trackingNumber);
    }

    /// @notice Names the TradeEscrow contract (see the contract notice).
    function setTradeEscrow(address escrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        tradeEscrow = escrow;
        emit TradeEscrowSet(escrow);
    }

    function setLoanEscrow(address escrow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        loanEscrow = escrow;
        emit LoanEscrowSet(escrow);
    }

    /// @notice Names LostSlabRecovery and lets it close lost reports for a finder's claim.
    function setLostSlabRecovery(address lostSlabRecovery_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lostSlabRecovery = lostSlabRecovery_;
        _grantRole(OPERATOR_ROLE, lostSlabRecovery_);
        emit LostSlabRecoverySet(lostSlabRecovery_);
    }

    /* --------------------------------- views --------------------------------- */

    function certKey(string memory grader, string memory certNumber) public pure returns (bytes32) {
        return keccak256(abi.encode(grader, certNumber));
    }

    function slabOf(uint256 tokenId) external view returns (Slab memory) {
        if (_slabs[tokenId].mintedAt == 0) revert UnknownSlab(tokenId);
        return _slabs[tokenId];
    }

    function submissionOf(uint256 submissionId) external view returns (Submission memory) {
        return _submissions[submissionId];
    }

    /// @notice Where a Lost slab was when it was reported: Vaulted (missing from the vault) or a transit state.
    function custodyBeforeLossOf(uint256 tokenId) external view returns (Custody) {
        return _custodyBeforeLoss[tokenId];
    }

    /// @notice Just the custody state, for contracts (TradeEscrow) that only need that.
    function custodyOf(uint256 tokenId) external view returns (Custody) {
        return _slabs[tokenId].custody;
    }

    /**
     * @dev TradeEscrow may move slabs without a separate approval. It only does so inside
     *      createOffer (the maker's own slabs, called by the maker) and accept (the taker's own
     *      slabs, called by the taker), so nobody's slab moves without its owner's transaction.
     */
    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return (operator == tradeEscrow && tradeEscrow != address(0))
            || (operator == loanEscrow && loanEscrow != address(0)) || super.isApprovedForAll(owner, operator);
    }

    /// @notice Fully on-chain ERC-721 metadata: a base64 JSON document, no server or IPFS needed.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Slab storage s = _slabs[tokenId];
        // Built in two halves: one abi.encodePacked with every field runs out of stack slots.
        // Before Collector Crypt confirms it, the token has no verified title yet.
        string memory name = bytes(s.title).length > 0
            ? s.title
            : string.concat(s.grader, " ", s.certNumber, " (pending verification)");
        bytes memory head = abi.encodePacked(
            '{"name":"', name,
            '","description":"Graded slab held by the Pokechain vault. The NFT burns when the slab is dispatched to its owner.",',
            '"image":"', s.image,
            '","attributes":[{"trait_type":"Grader","value":"', s.grader,
            '"},{"trait_type":"Cert number","value":"', s.certNumber
        );
        bytes memory tail = abi.encodePacked(
            '"},{"trait_type":"Collector Crypt NFT (Solana)","value":"', s.custodianRef,
            '"},{"trait_type":"Custody","value":"', _custodyName(s.custody),
            '"},{"trait_type":"Evidence hash","value":"', uint256(s.evidenceHash).toHexString(32),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes.concat(head, tail)));
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
     *      Vaulted (pending, withdrawn or rejected tokens are locked), only to an active account
     *      (or TradeEscrow) other than its current owner, and the vaulted count follows it.
     *      A freshly minted token is pending, so it isn't counted as vaulted until confirmVaulted.
     */
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (to != address(0) && to != tradeEscrow && to != loanEscrow && !accounts.isActive(to)) {
            revert AccountNotActive(to);
        }
        if (from != address(0)) {
            if (to == from) revert SelfTransfer(tokenId);
            if (isListed[tokenId] && msg.sender != marketplace) revert SlabIsListed(tokenId);
            Custody c = _slabs[tokenId].custody;
            if (to == address(0)) {
                // vaultedCount was already reduced (redemption or lost report). Only a dispatched
                // redemption, a confirmed delivery or a written-off loss burns.
                if (c != Custody.Shipped && c != Custody.Delivered && c != Custody.WrittenOff) {
                    revert SlabLocked(tokenId, c);
                }
            } else {
                if (c != Custody.Vaulted) revert SlabLocked(tokenId, c);
                vaultedCount[from] -= 1;
                vaultedCount[to] += 1;
            }
        }
        return super._update(to, tokenId, auth);
    }

    /// @dev The NFT is minted exactly once, after Pokechain has received the physical slab.
    function _mintPending(uint256 submissionId, uint256 tokenId) private {
        Submission storage sub = _submissions[submissionId];
        Slab storage slab = _slabs[tokenId];
        slab.grader = sub.grader;
        slab.certNumber = sub.certNumber;
        slab.evidenceHash = sub.evidenceHash;
        slab.carrier = sub.inboundCarrier;
        slab.trackingNumber = sub.inboundTracking;
        slab.mintedAt = uint64(block.timestamp);
        _setCustody(tokenId, Custody.PostedToPokechain);
        _safeMint(sub.owner, tokenId);
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

    /// @dev Closing a report outside a finder's claim refunds its bounty; it reverts while a claim is open.
    function _closeLostReport(uint256 tokenId) private {
        if (lostSlabRecovery != address(0) && msg.sender != lostSlabRecovery) {
            ILostReportHook(lostSlabRecovery).onLostReportClosed(tokenId);
        }
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

    /// @dev PSA certificates are numeric. Their decimal value is the intake request id shown to operators.
    function _submissionIdFromCert(string calldata certNumber) private pure returns (uint256 id) {
        bytes calldata raw = bytes(certNumber);
        if (raw.length == 0) revert InvalidCertNumber();
        for (uint256 i; i < raw.length; ++i) {
            uint8 c = uint8(raw[i]);
            if (c < 48 || c > 57) revert InvalidCertNumber();
            id = id * 10 + (c - 48);
        }
        if (id == 0) revert InvalidCertNumber();
    }

    function _custodyName(Custody c) private pure returns (string memory) {
        if (c == Custody.Vaulted) return "Vaulted";
        if (c == Custody.RedemptionRequested) return "Redemption requested";
        if (c == Custody.Shipped) return "Shipped";
        if (c == Custody.Delivered) return "Delivered";
        if (c == Custody.Lost) return "Lost";
        if (c == Custody.PostedToPokechain) return "Posted to Pokechain";
        if (c == Custody.AtPokechain) return "At Pokechain";
        if (c == Custody.SentToCustodian) return "Sent to Collector Crypt";
        if (c == Custody.Rejected) return "Rejected";
        if (c == Custody.WrittenOff) return "Written off";
        return "None";
    }
}
