// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ITradeAccounts {
    function isActive(address owner) external view returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function moveBalance(address from, address to, uint256 amount) external;
}

interface ITradeVault {
    function ownerOf(uint256 tokenId) external view returns (address);
    function custodyOf(uint256 tokenId) external view returns (uint8);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function vaultedCount(address owner) external view returns (uint256);
}


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
        uint256 counterOf;
        string room;
        uint64 createdAt;
        uint64 closedAt;
    }

    uint8 private constant VAULTED = 1;
    uint256 public constant MAX_SLABS_PER_SIDE = 10;
    uint256 public constant MAX_FEE_BPS = 1000; // Max 10%

    ITradeAccounts public immutable accounts;
    ITradeVault public immutable vault;

    uint256 public feeBps;
    address public feeRecipient;

    uint256 public nextOfferId = 1;
    mapping(uint256 => Offer) private _offers;
    mapping(address => uint256) public openOffers;
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

    function setFeeConfig(uint256 newFeeBps, address newRecipient) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        if (newFeeBps > 0 && newRecipient == address(0)) revert InvalidFeeRecipient();
        feeBps = newFeeBps;
        feeRecipient = newRecipient;
        emit FeeConfigUpdated(newFeeBps, newRecipient);
    }

    function accept(uint256 offerId) external nonReentrant {
        Offer storage o = _open(offerId);
        if (msg.sender != o.taker) revert NotTaker(offerId);
        if (!accounts.isActive(o.maker)) revert AccountNotActive(o.maker);
        if (!accounts.isActive(o.taker)) revert AccountNotActive(o.taker);
        _checkSide(o.taker, o.takerSlabs, o.takerCash);
        _close(o, Status.Accepted);

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

    function decline(uint256 offerId) external nonReentrant {
        Offer storage o = _open(offerId);
        if (msg.sender != o.taker) revert NotTaker(offerId);
        _refund(o, Status.Declined);
        emit OfferDeclined(offerId, o.maker, o.taker);
    }

    function withdraw(uint256 offerId) external nonReentrant {
        Offer storage o = _open(offerId);
        if (msg.sender != o.maker) revert NotMaker(offerId);
        _refund(o, Status.Withdrawn);
        emit OfferWithdrawn(offerId, o.maker, o.taker);
    }

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

    function offerOf(uint256 offerId) external view returns (Offer memory) {
        return _offers[offerId];
    }

    function offerIdsOf(address who) external view returns (uint256[] memory) {
        return _offerIdsOf[who];
    }

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
        _checkSide(o.taker, takerSlabs, 0);

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

    function _checkSide(address who, uint256[] memory slabs, uint256 cash) private view {
        for (uint256 i; i < slabs.length; ++i) {
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
