// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev The slice of AccountRegistry TradeEscrow uses.
interface ITradeAccounts {
    function isActive(address owner) external view returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function moveBalance(address from, address to, uint256 amount) external;
}

/// @dev The slice of SlabVault TradeEscrow uses. SlabVault lets this contract move slabs without approvals.
interface ITradeVault {
    function ownerOf(uint256 tokenId) external view returns (address);
    function custodyOf(uint256 tokenId) external view returns (uint8);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function vaultedCount(address owner) external view returns (uint256);
}

/**
 * @title TradeEscrow
 * @notice Swaps of slabs and cash between two collectors, settled all at once.
 *
 *  A trade is an offer: the maker gives some of their slabs and/or cash for some of the taker's
 *  slabs and/or cash, e.g. "3 Pikachus + $50 for your 2 Articunos", or "2 Charizards + $300
 *  for your 2 Bulbasaurs + $20".
 *
 *   1. `createOffer`   the maker's side is locked here: their slabs move into this contract and
 *                      their cash moves to this contract's custody balance. Nothing of the
 *                      taker's moves yet, they haven't agreed.
 *   2. `accept`        the taker agrees. In one transaction the taker's slabs and cash go to the
 *                      maker and the escrowed side goes to the taker. If any piece can't move
 *                      (a slab was withdrawn, not enough cash), the whole thing reverts.
 *      `decline`       the taker refuses; the maker's side is refunded.
 *      `withdraw`      the maker cancels; their side is refunded.
 *      `counter`       the taker declines and makes their own offer back in one step.
 *
 *  Every slab must be Vaulted at Collector Crypt, so only the token changes hands and the
 *  physical slabs never move. Cash is USDC already in Pokechain custody (AccountRegistry).
 */
contract TradeEscrow is Ownable, ReentrancyGuard {
    enum Status {
        None,
        Open,
        Accepted,
        Declined,
        Withdrawn,
        Countered
    }

    struct Offer {
        address maker;
        address taker;
        uint256[] makerSlabs;
        uint256 makerCash;
        uint256[] takerSlabs;
        uint256 takerCash;
        Status status;
        /// @notice The offer this one answers (0 if it isn't a counter-offer).
        uint256 counterOf;
        /// @notice The negotiation room it was made in, so the app can show it there.
        string room;
        uint64 createdAt;
        uint64 closedAt;
    }

    /// @dev SlabVault.Custody.Vaulted
    uint8 private constant VAULTED = 1;
    uint256 public constant MAX_SLABS_PER_SIDE = 10;
    uint256 public constant MAX_FEE_BPS = 1000; // Max 10%

    ITradeAccounts public immutable accounts;
    ITradeVault public immutable vault;

    /// @notice Protocol fee in basis points applied to cash legs (100 = 1.00%). Deters wash trading via cash swaps.
    uint256 public feeBps;
    /// @notice Recipient of the platform fee in AccountRegistry custody.
    address public feeRecipient;

    uint256 public nextOfferId = 1;
    mapping(uint256 => Offer) private _offers;
    /// @notice Offers each maker has open, i.e. with their assets in escrow.
    mapping(address => uint256) public openOffers;
    /// @notice Escrowed slab => the open offer holding it.
    mapping(uint256 => uint256) public offerHolding;
    mapping(address => uint256[]) private _offerIdsOf;

    event OfferCreated(
        uint256 indexed offerId,
        address indexed maker,
        address indexed taker,
        uint256[] makerSlabs,
        uint256 makerCash,
        uint256[] takerSlabs,
        uint256 takerCash,
        uint256 counterOf,
        string room
    );
    event OfferAccepted(uint256 indexed offerId, address indexed maker, address indexed taker);
    event OfferDeclined(uint256 indexed offerId, address indexed maker, address indexed taker);
    event OfferWithdrawn(uint256 indexed offerId, address indexed maker, address indexed taker);
    event OfferCountered(uint256 indexed offerId, uint256 indexed counterOfferId);
    event FeeConfigUpdated(uint256 feeBps, address indexed feeRecipient);

    error AccountNotActive(address account);
    error SelfTrade();
    error EmptySide();
    error TooManySlabs();
    error DuplicateSlab(uint256 tokenId);
    error NotYourSlab(uint256 tokenId, address owner);
    error SlabNotVaulted(uint256 tokenId);
    error NotEnoughCash(uint256 needed, uint256 available);
    error OfferNotOpen(uint256 offerId);
    error NotTaker(uint256 offerId);
    error NotMaker(uint256 offerId);
    error TooManyOpenOffers(address account, uint256 openCount);
    error FeeTooHigh(uint256 feeBps, uint256 maxBps);
    error InvalidFeeRecipient();

    uint256 public constant UNVAULTED_MAX_OPEN_OFFERS = 2;

    constructor(ITradeAccounts accounts_, ITradeVault vault_) Ownable(msg.sender) {
        accounts = accounts_;
        vault = vault_;
        feeRecipient = msg.sender;
    }

    /* -------------------------------- trading -------------------------------- */

    /**
     * @notice Offers `makerSlabs` + `makerCash` (yours) for `takerSlabs` + `takerCash` (theirs).
     *         Your side is locked here until the offer is accepted, declined or withdrawn.
     * @param makerCash USDC (6 decimals) you add; 0 for none
     * @param takerCash USDC (6 decimals) you ask for; 0 for none
     * @param room the negotiation room id, shown back by the app
     */
    function createOffer(
        address taker,
        uint256[] calldata makerSlabs,
        uint256 makerCash,
        uint256[] calldata takerSlabs,
        uint256 takerCash,
        string calldata room
    ) external nonReentrant returns (uint256 offerId) {
        Offer storage o;
        (offerId, o) = _newOffer(msg.sender, taker, 0, room);
        (o.makerSlabs, o.makerCash, o.takerSlabs, o.takerCash) = (makerSlabs, makerCash, takerSlabs, takerCash);
        _lock(offerId);
    }

    /// @notice Sets the cash trade fee and recipient. Max fee is capped at MAX_FEE_BPS (10%).
    function setFeeConfig(uint256 newFeeBps, address newRecipient) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        if (newFeeBps > 0 && newRecipient == address(0)) revert InvalidFeeRecipient();
        feeBps = newFeeBps;
        feeRecipient = newRecipient;
        emit FeeConfigUpdated(newFeeBps, newRecipient);
    }

    /// @notice The taker agrees: both sides swap in this one transaction, or nothing does.
    function accept(uint256 offerId) external nonReentrant {
        Offer storage o = _open(offerId);
        if (msg.sender != o.taker) revert NotTaker(offerId);
        if (!accounts.isActive(o.maker)) revert AccountNotActive(o.maker);
        if (!accounts.isActive(o.taker)) revert AccountNotActive(o.taker);
        _checkSide(o.taker, o.takerSlabs, o.takerCash);
        _close(o, Status.Accepted);

        // The taker's side, straight to the maker.
        for (uint256 i; i < o.takerSlabs.length; ++i) {
            vault.transferFrom(o.taker, o.maker, o.takerSlabs[i]);
        }
        if (o.takerCash > 0) {
            uint256 fee = (o.takerCash * feeBps) / 10000;
            uint256 proceeds = o.takerCash - fee;
            accounts.moveBalance(o.taker, o.maker, proceeds);
            if (fee > 0 && feeRecipient != address(0)) {
                accounts.moveBalance(o.taker, feeRecipient, fee);
            }
        }
        // The maker's escrowed side, to the taker.
        for (uint256 i; i < o.makerSlabs.length; ++i) {
            delete offerHolding[o.makerSlabs[i]];
            vault.transferFrom(address(this), o.taker, o.makerSlabs[i]);
        }
        if (o.makerCash > 0) {
            uint256 fee = (o.makerCash * feeBps) / 10000;
            uint256 proceeds = o.makerCash - fee;
            accounts.moveBalance(address(this), o.taker, proceeds);
            if (fee > 0 && feeRecipient != address(0)) {
                accounts.moveBalance(address(this), feeRecipient, fee);
            }
        }
        emit OfferAccepted(offerId, o.maker, o.taker);
    }

    /// @notice The taker refuses; the maker gets their side back.
    function decline(uint256 offerId) external nonReentrant {
        Offer storage o = _open(offerId);
        if (msg.sender != o.taker) revert NotTaker(offerId);
        _refund(o, Status.Declined);
        emit OfferDeclined(offerId, o.maker, o.taker);
    }

    /// @notice The maker cancels; they get their side back.
    function withdraw(uint256 offerId) external nonReentrant {
        Offer storage o = _open(offerId);
        if (msg.sender != o.maker) revert NotMaker(offerId);
        _refund(o, Status.Withdrawn);
        emit OfferWithdrawn(offerId, o.maker, o.taker);
    }

    /**
     * @notice The taker answers with their own terms: the offer is closed (maker refunded) and a
     *         new one is made from the taker to the maker, locking the taker's new side.
     *         `mySlabs`/`myCash` are what the caller now gives; `theirSlabs`/`theirCash` what they want.
     */
    function counter(
        uint256 offerId,
        uint256[] calldata mySlabs,
        uint256 myCash,
        uint256[] calldata theirSlabs,
        uint256 theirCash
    ) external nonReentrant returns (uint256 counterId) {
        Offer storage o = _open(offerId);
        if (msg.sender != o.taker) revert NotTaker(offerId);
        _refund(o, Status.Countered);
        Offer storage c;
        (counterId, c) = _newOffer(msg.sender, o.maker, offerId, o.room);
        (c.makerSlabs, c.makerCash, c.takerSlabs, c.takerCash) = (mySlabs, myCash, theirSlabs, theirCash);
        _lock(counterId);
        emit OfferCountered(offerId, counterId);
    }

    /* --------------------------------- views --------------------------------- */

    function offerOf(uint256 offerId) external view returns (Offer memory) {
        return _offers[offerId];
    }

    /// @notice Every offer an address made or received, oldest first.
    function offerIdsOf(address who) external view returns (uint256[] memory) {
        return _offerIdsOf[who];
    }

    /* ------------------------------- internals ------------------------------- */

    /// @dev Opens an offer record; the caller fills in both sides, then calls `_lock`.
    function _newOffer(address maker, address taker, uint256 counterOf, string memory room)
        private
        returns (uint256 offerId, Offer storage o)
    {
        if (maker == taker) revert SelfTrade();
        if (!accounts.isActive(maker)) revert AccountNotActive(maker);
        if (!accounts.isActive(taker)) revert AccountNotActive(taker);
        offerId = nextOfferId++;
        o = _offers[offerId];
        o.maker = maker;
        o.taker = taker;
        o.status = Status.Open;
        o.counterOf = counterOf;
        o.room = room;
        o.createdAt = uint64(block.timestamp);
    }

    /// @dev Checks both sides of a freshly filled offer and locks the maker's side in escrow.
    function _lock(uint256 offerId) private {
        Offer storage o = _offers[offerId];
        uint256[] memory makerSlabs = o.makerSlabs;
        uint256[] memory takerSlabs = o.takerSlabs;
        if (makerSlabs.length == 0 && o.makerCash == 0) revert EmptySide();
        if (takerSlabs.length == 0 && o.takerCash == 0) revert EmptySide();
        if (makerSlabs.length > MAX_SLABS_PER_SIDE || takerSlabs.length > MAX_SLABS_PER_SIDE) revert TooManySlabs();
        _noDuplicates(makerSlabs);
        _noDuplicates(takerSlabs);
        _checkSide(o.maker, makerSlabs, o.makerCash);
        // The taker's side is checked now too, so an offer for slabs they can't trade fails early.
        _checkSide(o.taker, takerSlabs, 0);

        // Sybil resistance: unvaulted accounts (zero vaulted slabs in custody and offering no slabs)
        // are capped on concurrent open offers to prevent spamming sellers.
        if (vault.vaultedCount(o.maker) == 0 && makerSlabs.length == 0) {
            if (openOffers[o.maker] >= UNVAULTED_MAX_OPEN_OFFERS) {
                revert TooManyOpenOffers(o.maker, openOffers[o.maker]);
            }
        }

        openOffers[o.maker] += 1;
        _offerIdsOf[o.maker].push(offerId);
        _offerIdsOf[o.taker].push(offerId);
        for (uint256 i; i < makerSlabs.length; ++i) {
            offerHolding[makerSlabs[i]] = offerId;
            vault.transferFrom(o.maker, address(this), makerSlabs[i]);
        }
        if (o.makerCash > 0) accounts.moveBalance(o.maker, address(this), o.makerCash);
        emit OfferCreated(
            offerId, o.maker, o.taker, makerSlabs, o.makerCash, takerSlabs, o.takerCash, o.counterOf, o.room
        );
    }

    function _refund(Offer storage o, Status outcome) private {
        _close(o, outcome);
        for (uint256 i; i < o.makerSlabs.length; ++i) {
            delete offerHolding[o.makerSlabs[i]];
            vault.transferFrom(address(this), o.maker, o.makerSlabs[i]);
        }
        if (o.makerCash > 0) accounts.moveBalance(address(this), o.maker, o.makerCash);
    }

    function _close(Offer storage o, Status outcome) private {
        o.status = outcome;
        o.closedAt = uint64(block.timestamp);
        openOffers[o.maker] -= 1;
    }

    function _open(uint256 offerId) private view returns (Offer storage o) {
        o = _offers[offerId];
        if (o.status != Status.Open) revert OfferNotOpen(offerId);
    }

    /// @dev Every slab is `who`'s and Vaulted, and `who` has `cash` in custody.
    function _checkSide(address who, uint256[] memory slabs, uint256 cash) private view {
        for (uint256 i; i < slabs.length; ++i) {
            // Custody first: a dispatched slab's token is burned, so ownerOf would revert unexplained.
            if (vault.custodyOf(slabs[i]) != VAULTED) revert SlabNotVaulted(slabs[i]);
            address owner = vault.ownerOf(slabs[i]);
            if (owner != who) revert NotYourSlab(slabs[i], owner);
        }
        uint256 available = accounts.balanceOf(who);
        if (cash > available) revert NotEnoughCash(cash, available);
    }

    function _noDuplicates(uint256[] memory slabs) private pure {
        for (uint256 i; i < slabs.length; ++i) {
            for (uint256 j = i + 1; j < slabs.length; ++j) {
                if (slabs[i] == slabs[j]) revert DuplicateSlab(slabs[i]);
            }
        }
    }
}
