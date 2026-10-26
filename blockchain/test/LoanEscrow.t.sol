// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../contracts/MockUSDC.sol";
import {AccountRegistry, ISlabVaultCustody} from "../contracts/AccountRegistry.sol";
import {LoanEscrow} from "../contracts/LoanEscrow.sol";
import {SlabMarket} from "../contracts/SlabMarket.sol";
import {SlabVault, IAccountStatus} from "../contracts/SlabVault.sol";

contract LoanEscrowTest is Test {
    uint256 constant USD = 1e6;
    bytes32 constant EVIDENCE = keccak256("loan collateral intake");

    MockUSDC usdc;
    AccountRegistry accounts;
    SlabVault vault;
    SlabMarket market;
    LoanEscrow loans;

    address operator = makeAddr("operator");
    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");
    address custodian = makeAddr("custodian");
    uint256 tokenId;

    function setUp() public {
        usdc = new MockUSDC();
        accounts = new AccountRegistry(usdc);
        vault = new SlabVault(IAccountStatus(address(accounts)), operator);
        accounts.setSlabVault(ISlabVaultCustody(address(vault)));
        vault.setCustodian(custodian);
        vm.prank(custodian);
        vault.setEncryptionKey(keccak256("custodian key"));
        market = new SlabMarket(vault, usdc, accounts);
        accounts.setSlabMarket(address(market));
        vault.setMarketplace(address(market));
        loans = new LoanEscrow(accounts, vault, market);
        accounts.setLoanEscrow(address(loans));
        vault.setLoanEscrow(address(loans));
        market.setLoanEscrow(address(loans));

        vm.prank(borrower);
        accounts.register("borrower");
        vm.prank(lender);
        accounts.register("lender");

        vm.prank(borrower);
        uint256 sid = vault.requestSubmission("PSA", "12345678", EVIDENCE, "SingPost", "RR1SG");
        vm.startPrank(operator);
        vault.markReceived(sid);
        vault.markForwarded(sid, hex"01", keccak256("parcel"));
        vault.confirmVaulted(sid, "Charizard PSA 10", "image", "CC-asset");
        vm.stopPrank();
        tokenId = vault.submissionOf(sid).tokenId;

        _fundAccount(lender, 800 * USD);
        _fundAccount(borrower, 100 * USD);
        vm.prank(borrower);
        market.listWithLoan(tokenId, 1_000 * USD, 400 * USD);
    }

    function test_LoanAskMustStayBelowSalePrice() public {
        vm.prank(borrower);
        vm.expectRevert(SlabMarket.InvalidLoanAsk.selector);
        market.listWithLoan(tokenId, 1_000 * USD, 1_000 * USD);
    }

    function test_AcceptFundsBorrowerAndEscrowsSlabThenRepayReturnsIt() public {
        vm.prank(lender);
        uint256 id = loans.createOffer(tokenId, 500 * USD, 50 * USD, 30 days, "room-1");

        assertEq(accounts.balanceOf(lender), 300 * USD);
        assertEq(accounts.balanceOf(address(loans)), 500 * USD);
        assertEq(loans.commitments(lender), 1);

        vm.prank(borrower);
        loans.accept(id);

        LoanEscrow.Offer memory active = loans.offerOf(id);
        assertEq(uint8(active.status), uint8(LoanEscrow.Status.Active));
        assertEq(active.deadline, block.timestamp + 30 days);
        assertEq(vault.ownerOf(tokenId), address(loans));
        assertEq(accounts.balanceOf(borrower), 600 * USD);
        assertEq(market.getListing(tokenId).seller, address(0));

        vm.prank(borrower);
        loans.repay(id);

        assertEq(vault.ownerOf(tokenId), borrower);
        assertEq(accounts.balanceOf(lender), 850 * USD);
        assertEq(accounts.balanceOf(borrower), 50 * USD);
        assertEq(uint8(loans.offerOf(id).status), uint8(LoanEscrow.Status.Repaid));
        assertEq(loans.commitments(lender), 0);
        assertEq(loans.commitments(borrower), 0);
    }

    function test_DefaultLetsLenderClaimCollateralOnlyAfterDeadline() public {
        vm.prank(lender);
        uint256 id = loans.createOffer(tokenId, 500 * USD, 25 * USD, 7 days, "room-2");
        vm.prank(borrower);
        loans.accept(id);

        vm.prank(lender);
        vm.expectRevert(LoanEscrow.DeadlineNotPassed.selector);
        loans.claimDefault(id);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(lender);
        loans.claimDefault(id);

        assertEq(vault.ownerOf(tokenId), lender);
        assertEq(uint8(loans.offerOf(id).status), uint8(LoanEscrow.Status.Defaulted));
    }

    function test_OpenOfferCanBeWithdrawnAndPrincipalIsRefunded() public {
        vm.prank(lender);
        uint256 id = loans.createOffer(tokenId, 450 * USD, 20 * USD, 14 days, "room-3");
        vm.prank(lender);
        loans.withdraw(id);

        assertEq(accounts.balanceOf(lender), 800 * USD);
        assertEq(accounts.balanceOf(address(loans)), 0);
        assertEq(uint8(loans.offerOf(id).status), uint8(LoanEscrow.Status.Withdrawn));
    }

    function test_PrincipalMustRespectSellerRange() public {
        vm.startPrank(lender);
        vm.expectRevert(abi.encodeWithSelector(LoanEscrow.PrincipalBelowAsk.selector, 399 * USD, 400 * USD));
        loans.createOffer(tokenId, 399 * USD, 10 * USD, 30 days, "room-4");
        vm.expectRevert(abi.encodeWithSelector(LoanEscrow.PrincipalMustBeBelowPrice.selector, 1_000 * USD, 1_000 * USD));
        loans.createOffer(tokenId, 1_000 * USD, 10 * USD, 30 days, "room-4");
        vm.stopPrank();
    }

    function _fundAccount(address who, uint256 amount) private {
        vm.prank(who);
        usdc.faucet(amount);
        vm.startPrank(who);
        usdc.approve(address(accounts), amount);
        accounts.deposit(amount);
        vm.stopPrank();
    }
}
