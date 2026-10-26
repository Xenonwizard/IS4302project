// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccountRegistry} from "./AccountRegistry.sol";
import {SlabMarket} from "./SlabMarket.sol";
import {SlabVault} from "./SlabVault.sol";

/**
 * @title LoanEscrow
 * @notice Fully funded, fixed-term loans secured by one vaulted slab.
 *
 * The lender's principal is locked when an offer is made. Acceptance pays that principal
 * to the borrower and moves the slab into this contract. Repayment atomically pays principal
 * plus interest to the lender and returns the slab; after the deadline the lender may claim it.
 */
contract LoanEscrow is ReentrancyGuard {
    enum Status {
        None,
        Open,
        Active,
        Repaid,
        Declined,
        Withdrawn,
        Defaulted
    }

    struct Offer {
        address lender;
        address borrower;
        uint256 tokenId;
        uint256 principal;
        uint256 interest;
        uint64 duration;
        uint64 deadline;
        Status status;
        string room;
        uint64 createdAt;
        uint64 acceptedAt;
        uint64 closedAt;
    }

    uint64 public constant MIN_DURATION = 1 days;
    uint64 public constant MAX_DURATION = 365 days;

    AccountRegistry public immutable accounts;
    SlabVault public immutable vault;
    SlabMarket public immutable market;

    uint256 public nextOfferId = 1;
    mapping(uint256 => Offer) private _offers;
    mapping(address => uint256[]) private _offerIds;
    mapping(address => uint256) public commitments;
    mapping(uint256 => uint256) public activeLoanForToken;

    event LoanOffered(
        uint256 indexed offerId,
        address indexed lender,
        address indexed borrower,
        uint256 tokenId,
        uint256 principal,
        uint256 interest,
        uint64 duration,
        string room
    );
    event LoanAccepted(uint256 indexed offerId, uint64 acceptedAt, uint64 deadline);
    event LoanRepaid(uint256 indexed offerId, uint256 repayment, uint64 closedAt);
    event LoanDefaulted(uint256 indexed offerId, address indexed lender, uint256 tokenId, uint64 closedAt);
    event LoanDeclined(uint256 indexed offerId, uint64 closedAt);
    event LoanWithdrawn(uint256 indexed offerId, uint64 closedAt);

    error AccountNotActive(address account);
    error LoanNotAccepted(uint256 tokenId);
    error PrincipalBelowAsk(uint256 principal, uint256 ask);
    error PrincipalMustBeBelowPrice(uint256 principal, uint256 price);
    error InvalidDuration();
    error SelfLoan();
    error OfferNotOpen();
    error LoanNotActive();
    error NotBorrower();
    error NotLender();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error TokenAlreadyCollateral(uint256 tokenId);

    constructor(AccountRegistry accounts_, SlabVault vault_, SlabMarket market_) {
        accounts = accounts_;
        vault = vault_;
        market = market_;
    }

    function createOffer(
        uint256 tokenId,
        uint256 principal,
        uint256 interest,
        uint64 duration,
        string calldata room
    ) external nonReentrant returns (uint256 offerId) {
        SlabMarket.Listing memory listing = market.getListing(tokenId);
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);
        if (listing.seller == address(0) || !listing.acceptsLoan) revert LoanNotAccepted(tokenId);
        if (listing.seller == msg.sender) revert SelfLoan();
        if (principal < listing.loanAsk) revert PrincipalBelowAsk(principal, listing.loanAsk);
        if (principal >= listing.price) revert PrincipalMustBeBelowPrice(principal, listing.price);
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();

        offerId = nextOfferId++;
        _offers[offerId] = Offer({
            lender: msg.sender,
            borrower: listing.seller,
            tokenId: tokenId,
            principal: principal,
            interest: interest,
            duration: duration,
            deadline: 0,
            status: Status.Open,
            room: room,
            createdAt: uint64(block.timestamp),
            acceptedAt: 0,
            closedAt: 0
        });
        _offerIds[msg.sender].push(offerId);
        _offerIds[listing.seller].push(offerId);
        commitments[msg.sender] += 1;

        accounts.moveBalance(msg.sender, address(this), principal);
        emit LoanOffered(offerId, msg.sender, listing.seller, tokenId, principal, interest, duration, room);
    }

    function accept(uint256 offerId) external nonReentrant {
        Offer storage offer = _offers[offerId];
        if (offer.status != Status.Open) revert OfferNotOpen();
        if (msg.sender != offer.borrower) revert NotBorrower();
        if (activeLoanForToken[offer.tokenId] != 0) revert TokenAlreadyCollateral(offer.tokenId);

        SlabMarket.Listing memory listing = market.getListing(offer.tokenId);
        if (listing.seller != offer.borrower || !listing.acceptsLoan) revert LoanNotAccepted(offer.tokenId);
        if (offer.principal < listing.loanAsk) revert PrincipalBelowAsk(offer.principal, listing.loanAsk);
        if (offer.principal >= listing.price) revert PrincipalMustBeBelowPrice(offer.principal, listing.price);

        uint64 acceptedAt = uint64(block.timestamp);
        offer.status = Status.Active;
        offer.acceptedAt = acceptedAt;
        offer.deadline = acceptedAt + offer.duration;
        activeLoanForToken[offer.tokenId] = offerId;
        commitments[offer.borrower] += 1;

        market.releaseForLoan(offer.tokenId, offer.borrower);
        vault.transferFrom(offer.borrower, address(this), offer.tokenId);
        accounts.moveBalance(address(this), offer.borrower, offer.principal);
        emit LoanAccepted(offerId, acceptedAt, offer.deadline);
    }

    function repay(uint256 offerId) external nonReentrant {
        Offer storage offer = _offers[offerId];
        if (offer.status != Status.Active) revert LoanNotActive();
        if (msg.sender != offer.borrower) revert NotBorrower();
        if (block.timestamp > offer.deadline) revert DeadlinePassed();

        uint256 repayment = offer.principal + offer.interest;
        _closeActive(offer, Status.Repaid);
        accounts.moveBalance(offer.borrower, offer.lender, repayment);
        vault.transferFrom(address(this), offer.borrower, offer.tokenId);
        emit LoanRepaid(offerId, repayment, offer.closedAt);
    }

    function claimDefault(uint256 offerId) external nonReentrant {
        Offer storage offer = _offers[offerId];
        if (offer.status != Status.Active) revert LoanNotActive();
        if (msg.sender != offer.lender) revert NotLender();
        if (block.timestamp <= offer.deadline) revert DeadlineNotPassed();

        _closeActive(offer, Status.Defaulted);
        vault.transferFrom(address(this), offer.lender, offer.tokenId);
        emit LoanDefaulted(offerId, offer.lender, offer.tokenId, offer.closedAt);
    }

    function decline(uint256 offerId) external nonReentrant {
        Offer storage offer = _offers[offerId];
        if (offer.status != Status.Open) revert OfferNotOpen();
        if (msg.sender != offer.borrower) revert NotBorrower();
        _closeOpen(offer, Status.Declined);
        accounts.moveBalance(address(this), offer.lender, offer.principal);
        emit LoanDeclined(offerId, offer.closedAt);
    }

    function withdraw(uint256 offerId) external nonReentrant {
        Offer storage offer = _offers[offerId];
        if (offer.status != Status.Open) revert OfferNotOpen();
        if (msg.sender != offer.lender) revert NotLender();
        _closeOpen(offer, Status.Withdrawn);
        accounts.moveBalance(address(this), offer.lender, offer.principal);
        emit LoanWithdrawn(offerId, offer.closedAt);
    }

    function offerOf(uint256 offerId) external view returns (Offer memory) {
        return _offers[offerId];
    }

    function offerIdsOf(address participant) external view returns (uint256[] memory) {
        return _offerIds[participant];
    }

    function _closeOpen(Offer storage offer, Status status) private {
        offer.status = status;
        offer.closedAt = uint64(block.timestamp);
        commitments[offer.lender] -= 1;
    }

    function _closeActive(Offer storage offer, Status status) private {
        offer.status = status;
        offer.closedAt = uint64(block.timestamp);
        activeLoanForToken[offer.tokenId] = 0;
        commitments[offer.lender] -= 1;
        commitments[offer.borrower] -= 1;
    }
}
