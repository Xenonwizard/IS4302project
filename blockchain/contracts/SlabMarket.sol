// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SlabVault} from "./SlabVault.sol";
import {AccountRegistry} from "./AccountRegistry.sol";


contract SlabMarket is Ownable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint256 price;
        uint64 listedAt;
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
        string grader;
        string certNumber;
        string title;
        string image;
    }

    SlabVault public immutable vault;
    IERC20 public immutable usdc;
    AccountRegistry public immutable accounts;

    uint256 public constant MAX_FEE_BPS = 1000;
    uint256 public feeBps;
    address public feeRecipient;

    mapping(uint256 => Listing) public listings;
    uint256[] private _activeTokenIds;
    mapping(uint256 => uint256) private _activeIndexPlusOne;

    SaleRecord[] public sales;
    mapping(uint256 => uint256[]) private _tokenSaleIndices;

    event CardListed(uint256 indexed tokenId, address indexed seller, uint256 price, uint64 listedAt);
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
    error FeeTooHigh(uint256 feeBps, uint256 maxBps);
    error InvalidFeeRecipient();

    constructor(SlabVault vault_, IERC20 usdc_, AccountRegistry accounts_) Ownable(msg.sender) {
        vault = vault_;
        usdc = usdc_;
        accounts = accounts_;
        feeRecipient = msg.sender;
    }

    function list(uint256 tokenId, uint256 price) external {
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
            listedAt: uint64(block.timestamp)
        });

        if (currentSeller == address(0)) {
            vault.setListingRestriction(tokenId, true);
            _addActive(tokenId);
        }

        emit CardListed(tokenId, msg.sender, price, uint64(block.timestamp));
    }

    function setFeeConfig(uint256 newFeeBps, address newRecipient) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        if (newFeeBps > 0 && newRecipient == address(0)) revert InvalidFeeRecipient();
        feeBps = newFeeBps;
        feeRecipient = newRecipient;
        emit FeeConfigUpdated(newFeeBps, newRecipient);
    }

    function cancelListing(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed(tokenId);
        if (l.seller != msg.sender) revert NotSeller(tokenId);

        delete listings[tokenId];
        _removeActive(tokenId);
        vault.setListingRestriction(tokenId, false);

        emit ListingCancelled(tokenId, msg.sender, uint64(block.timestamp));
    }

    function buy(uint256 tokenId) external nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed(tokenId);
        if (msg.sender == l.seller) revert SelfPurchase(tokenId);
        if (!accounts.isActive(msg.sender)) revert AccountNotActive(msg.sender);

        SlabVault.Slab memory s = vault.slabOf(tokenId);
        if (s.custody != SlabVault.Custody.Vaulted) revert NotVaulted(tokenId, s.custody);

        delete listings[tokenId];
        _removeActive(tokenId);
        vault.setListingRestriction(tokenId, false);

        uint256 fee = (l.price * feeBps) / 10000;
        uint256 sellerProceeds = l.price - fee;

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

        accounts.moveBalance(msg.sender, l.seller, sellerProceeds);
        if (fee > 0 && feeRecipient != address(0)) {
            accounts.moveBalance(msg.sender, feeRecipient, fee);
        }

        vault.settleMarketTransfer(l.seller, msg.sender, tokenId);

        emit CardPurchased(tokenId, l.seller, msg.sender, l.price, fee, uint64(block.timestamp));
    }

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

