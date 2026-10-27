// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SlabVault} from "./SlabVault.sol";
import {AccountRegistry} from "./AccountRegistry.sol";

/**
 * @title SlabMarket
 * @notice Fixed-price marketplace for vaulted Pokéchain card slabs (ERC-721 SlabVault tokens).
 *
 * Implements Section 3.2.3 (Marketplace and Payment) business rules:
 *   Rule 1: Only the holder of a vaulted Pokéchain NFT may list it for sale, provided it is
 *           not locked or frozen and its vault custody is still confirmed.
 *   Rule 2: Listings use Pokéchain's supported stablecoin (USDC). Pokéchain charges 0% platform fee.
 *   Rule 3: Payment from the buyer's Pokechain account and NFT transfer settle atomically. If either fails, the entire transaction reverts.
 *   Rule 4: Successful settlement transfers the Pokéchain NFT to the buyer and distributes proceeds
 *           to the seller. The physical card and backing NFT remain in custody.
 *   Rule 5: A listed NFT cannot simultaneously be pledged, redeemed, or independently transferred.
 *           Cancelling its listing releases the sale restriction.
 *   Rule 6: Only successfully settled marketplace purchases are included in completed-sales data.
 *           The record identifies the token, price, buyer, seller, fees (0), and settlement time.
 *   Rule 7: Non-sale transfers, loans, or cancellations are excluded from completed-sales data.
 */
contract SlabMarket is Ownable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
        uint64 listedAt;
        bool acceptsLoan;
        uint256 loanAsk;
    }

    struct SaleRecord {
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 price;
        uint256 fee; // Always 0 per Rule 2
        uint64 settledAt;
    }

    struct ActiveListing {
        uint256 tokenId;
        address seller;
        string sellerHandle;
        uint256 price;
        uint64 listedAt;
        bool acceptsLoan;
        uint256 loanAsk;
        string grader;
        string certNumber;
        string title;
        string image;
    }

    SlabVault public immutable vault;
    IERC20 public immutable usdc;
    AccountRegistry public immutable accounts;
    address public loanEscrow;

    uint256 public constant MAX_FEE_BPS = 1000; // Max 10%
    /// @notice Protocol marketplace fee in basis points (100 = 1.00%). Deter wash trading.
    uint256 public feeBps;
    /// @notice Recipient of the platform fee in AccountRegistry custody.
    address public feeRecipient;

    /// @notice tokenId => active listing
    mapping(uint256 => Listing) public listings;
    uint256[] private _activeTokenIds;
    mapping(uint256 => uint256) private _activeIndexPlusOne;

    /// @notice Auditable record of successfully settled marketplace purchases (Rule 6).
    SaleRecord[] public sales;
    mapping(uint256 => uint256[]) private _tokenSaleIndices;

    event CardListed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 listedAt);
    event LoanTermsSet(uint256 indexed tokenId, bool acceptsLoan, uint256 loanAsk);
    event LoanEscrowSet(address indexed loanEscrow);
    event FeeConfigUpdated(uint256 feeBps, address indexed feeRecipient);
    event ListingCancelled(uint256 indexed tokenId, address indexed seller, uint64 cancelledAt);
    event CardPurchased(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 fee,
        uint64 settledAt
    );

    error AccountNotActive(address account);
    error NotSlabOwner(uint256 tokenId);
    error NotSeller(uint256 tokenId);
    error NotListed(uint256 tokenId);
    error AlreadyListed(uint256 tokenId);
    error InvalidPrice();
    error NotVaulted(uint256 tokenId, SlabVault.Custody custody);
    error TokenRestricted(uint256 tokenId);
    error SelfPurchase(uint256 tokenId);
    error InvalidLoanAsk();
    error LoanEscrowAlreadySet();
    error OnlyLoanEscrow();
    error FeeTooHigh(uint256 feeBps, uint256 maxBps);
    error InvalidFeeRecipient();

    constructor(SlabVault vault_, IERC20 usdc_, AccountRegistry accounts_) Ownable(msg.sender) {
        vault = vault_;
        usdc = usdc_;
        accounts = accounts_;
        feeRecipient = msg.sender;
    }

    /* ----------------------------- listing actions ---------------------------- */

    /**
     * @notice Lists a vaulted slab for sale at a fixed price in USDC.
     * @dev Enforces Rule 1 (only owner of vaulted slab, no active restriction).
     *      Applies the Rule 5 sale restriction to the token in SlabVault.
     */
    function list(uint256 tokenId, uint256 price) external {
        _list(tokenId, price, false, 0);
    }

    /**
     * @notice Lists a slab for sale and opts into secured loan offers.
     * @param loanAsk Lowest principal the owner is willing to consider. It must stay below
     *        the sale price so a loan can never masquerade as a purchase.
     */
    function listWithLoan(uint256 tokenId, uint256 price, uint256 loanAsk) external {
        if (loanAsk == 0 || loanAsk >= price) revert InvalidLoanAsk();
        _list(tokenId, price, true, loanAsk);
    }

    function _list(uint256 tokenId, uint256 price, bool acceptsLoan, uint256 loanAsk) private {
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);
        if (vault.ownerOf(tokenId) != msg.sender) revert NotSlabOwner(tokenId);
        if (price == 0) revert InvalidPrice();

        address currentSeller = listings[tokenId].seller;
        if (currentSeller != address(0) && currentSeller != msg.sender) revert AlreadyListed(tokenId);

        SlabVault.Slab memory s = vault.slabOf(tokenId);
        if (s.custody != SlabVault.Custody.Vaulted) revert NotVaulted(tokenId, s.custody);
        if (currentSeller == address(0) && vault.isRestricted(tokenId)) revert TokenRestricted(tokenId);

        listings[tokenId] = Listing({
            seller: msg.sender,
            price: price,
            listedAt: uint64(block.timestamp),
            acceptsLoan: acceptsLoan,
            loanAsk: loanAsk
        });

        // Lock the token from ordinary transfer and redemption while listed (Rule 5).
        if (currentSeller == address(0)) {
            vault.setListingRestriction(tokenId, true);
            _addActive(tokenId);
        }

        emit CardListed(tokenId, msg.sender, price, uint64(block.timestamp));
        emit LoanTermsSet(tokenId, acceptsLoan, loanAsk);
    }

    /// @notice Sets the marketplace fee and recipient. Max fee is capped at MAX_FEE_BPS (10%).
    function setFeeConfig(uint256 newFeeBps, address newRecipient) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        if (newFeeBps > 0 && newRecipient == address(0)) revert InvalidFeeRecipient();
        feeBps = newFeeBps;
        feeRecipient = newRecipient;
        emit FeeConfigUpdated(newFeeBps, newRecipient);
    }

    /// @notice One-time wiring to the collateral escrow.
    function setLoanEscrow(address escrow) external onlyOwner {
        if (loanEscrow != address(0)) revert LoanEscrowAlreadySet();
        loanEscrow = escrow;
        emit LoanEscrowSet(escrow);
    }

    /**
     * @notice Cancels an active listing, releasing the Rule 5 sale restriction.
     */
    function cancelListing(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed(tokenId);
        if (l.seller != msg.sender) revert NotSeller(tokenId);

        delete listings[tokenId];
        _removeActive(tokenId);
        vault.setListingRestriction(tokenId, false);

        emit ListingCancelled(tokenId, msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Releases a listing immediately before LoanEscrow takes custody of its slab.
     *         This is deliberately unavailable to collectors and other contracts.
     */
    function releaseForLoan(uint256 tokenId, address seller) external {
        if (msg.sender != loanEscrow || loanEscrow == address(0)) revert OnlyLoanEscrow();
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed(tokenId);
        if (l.seller != seller) revert NotSeller(tokenId);

        delete listings[tokenId];
        _removeActive(tokenId);
        vault.setListingRestriction(tokenId, false);
        emit ListingCancelled(tokenId, seller, uint64(block.timestamp));
    }

    /* ----------------------------- buying actions ----------------------------- */

    /**
     * @notice Purchases a listed slab atomically.
     * @dev Moves USDC inside Pokechain custody from buyer to seller (0% platform fee, Rule 2),
     *      releases the listing lock, and transfers the NFT to the buyer (Rules 3, 4).
     *      Records the completed purchase into the sales history (Rule 6).
     */
    function buy(uint256 tokenId) external nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed(tokenId);
        if (msg.sender == l.seller) revert SelfPurchase(tokenId);
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);

        // Verify vault custody is still confirmed (Rule 1)
        SlabVault.Slab memory s = vault.slabOf(tokenId);
        if (s.custody != SlabVault.Custody.Vaulted) revert NotVaulted(tokenId, s.custody);

        // 1. Effects: remove listing and clear listing restriction
        delete listings[tokenId];
        _removeActive(tokenId);
        vault.setListingRestriction(tokenId, false);

        uint256 fee = (l.price * feeBps) / 10000;
        uint256 sellerProceeds = l.price - fee;

        // Record completed sale for auditable comparable sales history (Rule 6)
        uint256 saleIdx = sales.length;
        sales.push(
            SaleRecord({
                tokenId: tokenId,
                seller: l.seller,
                buyer: msg.sender,
                price: l.price,
                fee: fee,
                settledAt: uint64(block.timestamp)
            })
        );
        _tokenSaleIndices[tokenId].push(saleIdx);

        // 2. Interactions: Atomic custody payment & token transfer.
        // Buyer pays seller proceeds; protocol fee moves to feeRecipient in custody.
        accounts.moveBalance(msg.sender, l.seller, sellerProceeds);
        if (fee > 0 && feeRecipient != address(0)) {
            accounts.moveBalance(msg.sender, feeRecipient, fee);
        }

        // SlabVault executes transfer from seller to buyer
        vault.settleMarketTransfer(l.seller, msg.sender, tokenId);

        emit CardPurchased(tokenId, l.seller, msg.sender, l.price, fee, uint64(block.timestamp));
    }

    /* --------------------------------- views --------------------------------- */

    function isListed(uint256 tokenId) external view returns (bool) {
        return listings[tokenId].seller != address(0);
    }

    function getListing(uint256 tokenId) external view returns (Listing memory) {
        return listings[tokenId];
    }

    function totalSales() external view returns (uint256) {
        return sales.length;
    }

    function getSalesForToken(uint256 tokenId) external view returns (SaleRecord[] memory) {
        uint256[] storage indices = _tokenSaleIndices[tokenId];
        uint256 len = indices.length;
        SaleRecord[] memory tokenSales = new SaleRecord[](len);
        for (uint256 i = 0; i < len; ++i) {
            tokenSales[i] = sales[indices[i]];
        }
        return tokenSales;
    }

    function getAllSales() external view returns (SaleRecord[] memory) {
        return sales;
    }

    /**
     * @notice Returns all currently active listings across Pokéchain with card metadata.
     *         Allows any collector or visitor to view live marketplace inventory on-chain.
     */
    function getActiveListings() external view returns (ActiveListing[] memory) {
        ActiveListing[] memory result = new ActiveListing[](_activeTokenIds.length);
        for (uint256 i = 0; i < _activeTokenIds.length; ++i) {
            uint256 tokenId = _activeTokenIds[i];
            SlabVault.Slab memory s = vault.slabOf(tokenId);
            Listing storage listing = listings[tokenId];
            string memory handle = accounts.accountOf(listing.seller).handle;
            result[i] = ActiveListing({
                tokenId: tokenId,
                seller: listing.seller,
                sellerHandle: handle,
                price: listing.price,
                listedAt: listing.listedAt,
                acceptsLoan: listing.acceptsLoan,
                loanAsk: listing.loanAsk,
                grader: s.grader,
                certNumber: s.certNumber,
                title: s.title,
                image: s.image
            });
        }
        return result;
    }

    function _addActive(uint256 tokenId) private {
        if (_activeIndexPlusOne[tokenId] != 0) return;
        _activeTokenIds.push(tokenId);
        _activeIndexPlusOne[tokenId] = _activeTokenIds.length;
    }

    function _removeActive(uint256 tokenId) private {
        uint256 indexPlusOne = _activeIndexPlusOne[tokenId];
        if (indexPlusOne == 0) return;
        uint256 index = indexPlusOne - 1;
        uint256 lastTokenId = _activeTokenIds[_activeTokenIds.length - 1];
        if (index != _activeTokenIds.length - 1) {
            _activeTokenIds[index] = lastTokenId;
            _activeIndexPlusOne[lastTokenId] = index + 1;
        }
        _activeTokenIds.pop();
        delete _activeIndexPlusOne[tokenId];
    }
}

