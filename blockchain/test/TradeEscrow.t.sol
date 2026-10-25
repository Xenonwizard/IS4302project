// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../contracts/MockUSDC.sol";
import {AccountRegistry, ISlabVaultCustody} from "../contracts/AccountRegistry.sol";
import {SlabVault, IAccountStatus} from "../contracts/SlabVault.sol";
import {TradeEscrow, ITradeAccounts, ITradeVault} from "../contracts/TradeEscrow.sol";

/// Multi-slab + cash trades between two collectors. Run with `npm test`.
contract TradeEscrowTest is Test {
    MockUSDC usdc;
    AccountRegistry accounts;
    SlabVault vault;
    TradeEscrow escrow;

    address operator = makeAddr("operator");
    address ash = makeAddr("ash");
    address misty = makeAddr("misty");
    address brock = makeAddr("brock");
    address cc = makeAddr("collectorCrypt");
    uint256 constant USD = 1e6;
    uint256 certSeq;

    function setUp() public {
        usdc = new MockUSDC();
        accounts = new AccountRegistry(usdc);
        vault = new SlabVault(IAccountStatus(address(accounts)), operator);
        accounts.setSlabVault(ISlabVaultCustody(address(vault)));
        vault.setCustodian(cc);
        vm.prank(cc);
        vault.setEncryptionKey(keccak256("cc key"));
        escrow = new TradeEscrow(ITradeAccounts(address(accounts)), ITradeVault(address(vault)));
        accounts.setTradeEscrow(address(escrow));
        vault.setTradeEscrow(address(escrow));

        _account(ash, "ash", 1_000 * USD);
        _account(misty, "misty", 1_000 * USD);
    }

    /* ---------------------------- helpers ---------------------------- */

    function _account(address who, string memory handle, uint256 cash) internal {
        vm.startPrank(who);
        accounts.register(handle);
        usdc.faucet(cash);
        usdc.approve(address(accounts), cash);
        accounts.deposit(cash);
        vm.stopPrank();
    }

    /// `n` Vaulted slabs for `who`.
    function _slabs(address who, uint256 n) internal returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            string memory cert = vm.toString(10_000_000 + ++certSeq);
            vm.prank(who);
            uint256 id = vault.requestSubmission("PSA", cert, keccak256("evidence"), "SingPost", "RR1SG");
            vm.startPrank(operator);
            vault.markReceived(id);
            vault.markForwarded(id, hex"01", keccak256("c"));
            vault.confirmVaulted(id, "slab", "img", "CCsol");
            vm.stopPrank();
            ids[i] = id;
        }
    }

    function _none() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _assertOwned(uint256[] memory ids, address who) internal view {
        for (uint256 i; i < ids.length; ++i) {
            assertEq(vault.ownerOf(ids[i]), who);
        }
    }

    /* ------------------------------ tests ------------------------------ */

    /// "2 Charizards + $300 for your 2 Bulbasaurs + $20"
    function test_SlabsAndCashBothWaysSwapAtOnce() public {
        uint256[] memory charizards = _slabs(ash, 2);
        uint256[] memory bulbasaurs = _slabs(misty, 2);

        vm.prank(ash);
        uint256 id = escrow.createOffer(misty, charizards, 300 * USD, bulbasaurs, 20 * USD, "room-1");

        // Ash's side is locked in escrow; Misty's hasn't moved.
        _assertOwned(charizards, address(escrow));
        assertEq(accounts.balanceOf(ash), 700 * USD);
        assertEq(accounts.balanceOf(address(escrow)), 300 * USD);
        assertEq(vault.vaultedCount(ash), 0);
        _assertOwned(bulbasaurs, misty);

        vm.prank(misty);
        escrow.accept(id);

        _assertOwned(charizards, misty);
        _assertOwned(bulbasaurs, ash);
        assertEq(accounts.balanceOf(ash), 700 * USD + 20 * USD);
        assertEq(accounts.balanceOf(misty), 1_000 * USD - 20 * USD + 300 * USD);
        assertEq(accounts.balanceOf(address(escrow)), 0);
        assertEq(vault.vaultedCount(ash), 2);
        assertEq(vault.vaultedCount(misty), 2);
        assertEq(uint8(escrow.offerOf(id).status), uint8(TradeEscrow.Status.Accepted));
        assertEq(escrow.openOffers(ash), 0);
    }

    /// "3 Pikachus and $50 for 2 of your Articunos": cash on one side only.
    function test_SlabsPlusCashForSlabs() public {
        uint256[] memory pikachus = _slabs(ash, 3);
        uint256[] memory articunos = _slabs(misty, 2);
        vm.prank(ash);
        uint256 id = escrow.createOffer(misty, pikachus, 50 * USD, articunos, 0, "room-2");
        vm.prank(misty);
        escrow.accept(id);
        _assertOwned(pikachus, misty);
        _assertOwned(articunos, ash);
        assertEq(accounts.balanceOf(misty), 1_050 * USD);
    }

    function test_DeclineAndWithdrawRefundTheMaker() public {
        uint256[] memory mine = _slabs(ash, 2);
        uint256[] memory theirs = _slabs(misty, 1);
        vm.startPrank(ash);
        uint256 a = escrow.createOffer(misty, mine, 100 * USD, theirs, 0, "r");
        vm.stopPrank();
        vm.prank(misty);
        escrow.decline(a);
        _assertOwned(mine, ash);
        assertEq(accounts.balanceOf(ash), 1_000 * USD);

        vm.startPrank(ash);
        uint256 b = escrow.createOffer(misty, mine, 100 * USD, theirs, 0, "r");
        escrow.withdraw(b);
        vm.stopPrank();
        _assertOwned(mine, ash);
        assertEq(accounts.balanceOf(ash), 1_000 * USD);
        assertEq(uint8(escrow.offerOf(b).status), uint8(TradeEscrow.Status.Withdrawn));
    }

    function test_CounterRefundsAndLocksTheOtherSide() public {
        uint256[] memory mine = _slabs(ash, 1);
        uint256[] memory theirs = _slabs(misty, 2);
        vm.prank(ash);
        uint256 a = escrow.createOffer(misty, mine, 0, theirs, 0, "room-9");

        // Misty: "I'll give you just one, and you add $40."
        uint256[] memory one = new uint256[](1);
        one[0] = theirs[0];
        vm.prank(misty);
        uint256 b = escrow.counter(a, one, 0, mine, 40 * USD);

        assertEq(uint8(escrow.offerOf(a).status), uint8(TradeEscrow.Status.Countered));
        _assertOwned(mine, ash); // refunded
        assertEq(vault.ownerOf(theirs[0]), address(escrow)); // misty's new side locked
        TradeEscrow.Offer memory o = escrow.offerOf(b);
        assertEq(o.maker, misty);
        assertEq(o.counterOf, a);
        assertEq(o.room, "room-9");

        vm.prank(ash);
        escrow.accept(b);
        assertEq(vault.ownerOf(theirs[0]), ash);
        assertEq(vault.ownerOf(mine[0]), misty);
        assertEq(accounts.balanceOf(misty), 1_040 * USD);
    }

    function test_OnlyTheRightPartyActs() public {
        uint256[] memory mine = _slabs(ash, 1);
        vm.prank(ash);
        uint256 id = escrow.createOffer(misty, mine, 0, _none(), 10 * USD, "r");
        vm.prank(ash);
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.NotTaker.selector, id));
        escrow.accept(id);
        vm.prank(misty);
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.NotMaker.selector, id));
        escrow.withdraw(id);
        vm.prank(misty);
        escrow.accept(id);
        vm.prank(misty);
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.OfferNotOpen.selector, id));
        escrow.accept(id);
    }

    function test_RefusesInvalidOffers() public {
        uint256[] memory mine = _slabs(ash, 1);
        uint256[] memory theirs = _slabs(misty, 1);
        vm.startPrank(ash);
        vm.expectRevert(TradeEscrow.SelfTrade.selector);
        escrow.createOffer(ash, mine, 0, theirs, 0, "r");
        vm.expectRevert(TradeEscrow.EmptySide.selector);
        escrow.createOffer(misty, _none(), 0, theirs, 0, "r");
        vm.expectRevert(TradeEscrow.EmptySide.selector);
        escrow.createOffer(misty, mine, 0, _none(), 0, "r");
        // Offering someone else's slab.
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.NotYourSlab.selector, theirs[0], misty));
        escrow.createOffer(misty, theirs, 0, mine, 0, "r");
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.NotEnoughCash.selector, 5_000 * USD, 1_000 * USD));
        escrow.createOffer(misty, mine, 5_000 * USD, theirs, 0, "r");
        uint256[] memory twice = new uint256[](2);
        (twice[0], twice[1]) = (mine[0], mine[0]);
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.DuplicateSlab.selector, mine[0]));
        escrow.createOffer(misty, twice, 0, theirs, 0, "r");
        vm.stopPrank();
    }

    function test_PendingSlabsCannotBeTraded() public {
        uint256[] memory theirs = _slabs(misty, 1);
        vm.prank(ash);
        uint256 pending = vault.requestSubmission("PSA", "99999999", keccak256("e"), "SingPost", "RR");
        uint256[] memory mine = new uint256[](1);
        mine[0] = pending;
        vm.prank(ash);
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.SlabNotVaulted.selector, pending));
        escrow.createOffer(misty, mine, 0, theirs, 0, "r");
    }

    /// If the taker's side can't move any more, nothing moves: all or nothing.
    function test_AcceptIsAllOrNothing() public {
        uint256[] memory mine = _slabs(ash, 1);
        uint256[] memory theirs = _slabs(misty, 2);
        vm.prank(ash);
        uint256 id = escrow.createOffer(misty, mine, 0, theirs, 0, "r");
        // Misty withdraws one of the asked-for slabs before accepting.
        vm.prank(misty);
        vault.requestRedemption(theirs[1], bytes32(0));

        vm.prank(misty);
        vm.expectRevert(abi.encodeWithSelector(TradeEscrow.SlabNotVaulted.selector, theirs[1]));
        escrow.accept(id);
        assertEq(vault.ownerOf(mine[0]), address(escrow));
        assertEq(vault.ownerOf(theirs[0]), misty);
        assertEq(uint8(escrow.offerOf(id).status), uint8(TradeEscrow.Status.Open));
    }

    function test_EscrowedSlabCannotBeRedeemedOrSentElsewhere() public {
        uint256[] memory mine = _slabs(ash, 1);
        uint256[] memory theirs = _slabs(misty, 1);
        vm.prank(ash);
        escrow.createOffer(misty, mine, 0, theirs, 0, "r");
        vm.prank(ash);
        vm.expectRevert(abi.encodeWithSelector(SlabVault.NotSlabOwner.selector, mine[0]));
        vault.requestRedemption(mine[0], bytes32(0));
    }

    function test_CannotCloseAccountWithOpenOffers() public {
        uint256[] memory theirs = _slabs(misty, 1);
        vm.prank(ash);
        escrow.createOffer(misty, _none(), 100 * USD, theirs, 0, "r");
        vm.prank(ash);
        vm.expectRevert(abi.encodeWithSelector(AccountRegistry.OffersStillOpen.selector, 1));
        accounts.closeAccount();
    }

    function test_OnlyEscrowMovesBalances() public {
        vm.prank(ash);
        vm.expectRevert(AccountRegistry.OnlyBalanceMover.selector);
        accounts.moveBalance(misty, ash, 1);
    }

    /// Fuzz: whatever the amounts, a settled trade never creates or destroys dollars.
    function testFuzz_TradeConservesCash(uint256 makerCash, uint256 takerCash, bool settle) public {
        makerCash = bound(makerCash, 0, 1_000 * USD);
        takerCash = bound(takerCash, 0, 1_000 * USD);
        uint256[] memory mine = _slabs(ash, 1);
        uint256[] memory theirs = _slabs(misty, 1);
        uint256 before = accounts.totalCustody();

        vm.prank(ash);
        uint256 id = escrow.createOffer(misty, mine, makerCash, theirs, takerCash, "r");
        vm.prank(misty);
        if (settle) escrow.accept(id);
        else escrow.decline(id);

        assertEq(accounts.totalCustody(), before);
        assertEq(accounts.balanceOf(ash) + accounts.balanceOf(misty), before);
        assertEq(accounts.balanceOf(address(escrow)), 0);
        assertEq(usdc.balanceOf(address(accounts)), before);
        if (settle) {
            assertEq(accounts.balanceOf(ash), 1_000 * USD - makerCash + takerCash);
        } else {
            assertEq(accounts.balanceOf(ash), 1_000 * USD);
        }
    }
}
