// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../contracts/MockUSDC.sol";
import {AccountRegistry, ISlabVaultCustody} from "../contracts/AccountRegistry.sol";
import {SlabVault, IAccountStatus} from "../contracts/SlabVault.sol";
import {LostSlabRecovery} from "../contracts/LostSlabRecovery.sol";

/// A lost slab's bounty is escrowed, a finder files a claim, Pokechain returns it, and the finder is paid.
contract LostSlabRecoveryTest is Test {
    MockUSDC usdc;
    AccountRegistry accounts;
    SlabVault vault;
    LostSlabRecovery lf;

    address operator = makeAddr("operator");
    address owner = makeAddr("owner");
    address finder = makeAddr("finder");
    address collectorCrypt = makeAddr("collectorCrypt");

    uint256 constant USD = 1e6;
    uint256 constant BOUNTY = 50 * USD;
    bytes32 constant EVIDENCE = keccak256("found at a flea market, label intact");
    bytes32 constant ADDRESS_HASH = keccak256("Ash Ketchum, 1 Pallet Town Road");

    function setUp() public {
        usdc = new MockUSDC();
        accounts = new AccountRegistry(usdc);
        vault = new SlabVault(IAccountStatus(address(accounts)), operator);
        accounts.setSlabVault(ISlabVaultCustody(address(vault)));
        vault.setCustodian(collectorCrypt);
        vm.prank(collectorCrypt);
        vault.setEncryptionKey(keccak256("cc key"));
        lf = new LostSlabRecovery(accounts, vault, operator);
        accounts.setLostSlabRecovery(address(lf));
        vault.setLostSlabRecovery(address(lf));

        _register(owner, "owner");
        _register(finder, "finder");
        vm.startPrank(owner);
        usdc.faucet(1_000 * USD);
        usdc.approve(address(accounts), 1_000 * USD);
        accounts.deposit(1_000 * USD);
        vm.stopPrank();
    }

    function _register(address who, string memory handle) internal {
        vm.prank(who);
        accounts.register(handle);
    }

    /// A vaulted slab missing from Collector Crypt's vault: custody Lost, with a $50 bounty escrowed.
    function _lostWithBounty() internal returns (uint256 tokenId) {
        vm.prank(owner);
        uint256 sid = vault.requestSubmission("PSA", "12345678", EVIDENCE, "SingPost", "RR1SG");
        vm.startPrank(operator);
        vault.markReceived(sid);
        vault.markForwarded(sid, hex"01", keccak256("c"));
        vault.confirmVaulted(sid, "Charizard PSA 10", "img", "CCsol1111");
        vm.stopPrank();
        tokenId = sid;
        vm.startPrank(owner);
        vault.reportLost(tokenId, "Missing at audit");
        lf.setBounty(tokenId, BOUNTY);
        vm.stopPrank();
    }

    /// The usual intake from At Pokechain: forward to Collector Crypt, which vaults it under a new NFT.
    function _revault(uint256 tokenId, string memory ccRef) internal {
        vm.startPrank(operator);
        vault.markForwarded(tokenId, hex"02", keccak256("c2"));
        vault.confirmVaulted(tokenId, "Charizard PSA 10", "img", ccRef);
        vm.stopPrank();
    }

    function _fileAndReceive(uint256 tokenId) internal returns (uint256 claimId) {
        vm.prank(finder);
        claimId = lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR555SG");
        vm.prank(operator);
        lf.markReceived(claimId);
    }

    function test_BountyIsEscrowedFromTheOwnersBalance() public {
        uint256 tokenId = _lostWithBounty();
        assertEq(accounts.balanceOf(owner), 950 * USD);
        assertEq(accounts.balanceOf(address(lf)), BOUNTY);
        assertEq(lf.bountyOf(tokenId), BOUNTY);
    }

    function test_ReturnToVaultThenFinderIsPaid() public {
        uint256 tokenId = _lostWithBounty();
        uint256 claimId = _fileAndReceive(tokenId);

        vm.prank(owner);
        lf.chooseReturn(claimId, true, bytes32(0));
        vm.prank(operator);
        lf.completeReturn(claimId, "", "");
        // The slab is at Pokechain, not yet in Collector Crypt's vault: the bounty stays locked.
        assertEq(uint8(vault.custodyOf(tokenId)), uint8(SlabVault.Custody.AtPokechain));
        vm.prank(finder);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.NotReturnedYet.selector, tokenId));
        lf.claimBounty(claimId);

        _revault(tokenId, "CCsol1111-2");
        // Back in the vault: the owner holds the token and it counts as vaulted (tradeable).
        assertEq(uint8(vault.custodyOf(tokenId)), uint8(SlabVault.Custody.Vaulted));
        assertEq(vault.vaultedCount(owner), 1);
        assertEq(vault.slabOf(tokenId).custodianRef, "CCsol1111-2");

        vm.prank(finder);
        lf.claimBounty(claimId);
        assertEq(accounts.balanceOf(finder), BOUNTY);
        assertEq(accounts.balanceOf(address(lf)), 0);
        assertEq(uint8(lf.claimOf(claimId).status), uint8(LostSlabRecovery.Status.Paid));
    }

    function test_DeliveryPaysOnlyAfterTheOwnerConfirmsReceipt() public {
        uint256 tokenId = _lostWithBounty();
        uint256 claimId = _fileAndReceive(tokenId);
        vm.prank(owner);
        lf.chooseReturn(claimId, false, ADDRESS_HASH);
        vm.prank(operator);
        lf.completeReturn(claimId, "Pokechain Secure", "PCR-1");
        assertEq(uint8(vault.custodyOf(tokenId)), uint8(SlabVault.Custody.Shipped));

        // Shipped is not enough: the finder waits for the owner's confirmDelivery.
        vm.prank(finder);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.NotReturnedYet.selector, tokenId));
        lf.claimBounty(claimId);

        vm.prank(owner);
        vault.confirmDelivery(tokenId);
        vm.prank(finder);
        lf.claimBounty(claimId);
        assertEq(accounts.balanceOf(finder), BOUNTY);
    }

    function test_OwnerCannotCancelOrLowerTheBountyDuringAClaim() public {
        uint256 tokenId = _lostWithBounty();
        vm.prank(finder);
        uint256 claimId = lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR555SG");

        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.ClaimInProgress.selector, claimId));
        vault.cancelLostReport(tokenId);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.ClaimInProgress.selector, claimId));
        lf.setBounty(tokenId, 0);
        vm.stopPrank();
    }

    function test_CancellingTheReportRefundsTheBounty() public {
        uint256 tokenId = _lostWithBounty();
        vm.prank(owner);
        vault.cancelLostReport(tokenId);
        assertEq(accounts.balanceOf(owner), 1_000 * USD);
        assertEq(lf.bountyOf(tokenId), 0);
    }

    function test_WriteOffRefundsTheBountyAndBurns() public {
        uint256 tokenId = _lostWithBounty();
        vm.prank(owner);
        vault.writeOffLost(tokenId);
        assertEq(accounts.balanceOf(owner), 1_000 * USD);
        assertEq(lf.bountyOf(tokenId), 0);
        assertEq(uint8(vault.custodyOf(tokenId)), uint8(SlabVault.Custody.WrittenOff));
    }

    function test_CannotWriteOffDuringAClaim() public {
        uint256 tokenId = _lostWithBounty();
        uint256 claimId = _fileAndReceive(tokenId);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.ClaimInProgress.selector, claimId));
        vault.writeOffLost(tokenId);
    }

    function test_SlabLostInTheVaultIsFoundAndReturned() public {
        vm.prank(owner);
        uint256 sid = vault.requestSubmission("PSA", "87654321", EVIDENCE, "SingPost", "RR2SG");
        vm.startPrank(operator);
        vault.markReceived(sid);
        vault.markForwarded(sid, hex"01", keccak256("c"));
        vault.confirmVaulted(sid, "Pikachu PSA 9", "img", "CCsol2222");
        vm.stopPrank();
        vm.startPrank(owner);
        vault.reportLost(sid, "Missing at audit");
        lf.setBounty(sid, BOUNTY);
        vm.stopPrank();

        uint256 claimId = _fileAndReceive(sid);
        vm.prank(owner);
        lf.chooseReturn(claimId, true, bytes32(0));
        vm.prank(operator);
        lf.completeReturn(claimId, "", "");
        _revault(sid, "CCsol2222-2");
        assertEq(uint8(vault.custodyOf(sid)), uint8(SlabVault.Custody.Vaulted));
        assertEq(vault.vaultedCount(owner), 1);
        vm.prank(finder);
        lf.claimBounty(claimId);
        assertEq(accounts.balanceOf(finder), BOUNTY);
    }

    function test_RejectedClaimLeavesTheBountyPostedForTheNextFinder() public {
        uint256 tokenId = _lostWithBounty();
        vm.prank(finder);
        uint256 claimId = lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR555SG");
        vm.prank(operator);
        lf.rejectClaim(claimId, "Different cert on the label");
        assertEq(lf.activeClaimOf(tokenId), 0);
        assertEq(lf.bountyOf(tokenId), BOUNTY);
        vm.prank(finder);
        lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR556SG");
    }

    function test_InvalidClaimsAreRefused() public {
        uint256 tokenId = _lostWithBounty();
        vm.prank(owner);
        vm.expectRevert(LostSlabRecovery.OwnSlab.selector);
        lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR1");

        vm.prank(finder);
        lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR1");
        // Only the owner chooses, and only after Pokechain has the slab.
        vm.prank(finder);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.WrongClaimStatus.selector, 1, LostSlabRecovery.Status.Filed));
        lf.chooseReturn(1, true, bytes32(0));
        vm.prank(operator);
        lf.markReceived(1);
        vm.prank(finder);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.NotSlabOwner.selector, tokenId));
        lf.chooseReturn(1, true, bytes32(0));
        // Only the finder collects, and only after the return.
        vm.prank(finder);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.WrongClaimStatus.selector, 1, LostSlabRecovery.Status.AtPokechain));
        lf.claimBounty(1);
    }

    function test_CannotClaimASlabThatIsNotLost() public {
        uint256 tokenId = _lostWithBounty();
        vm.prank(owner);
        vault.cancelLostReport(tokenId);
        vm.prank(finder);
        vm.expectRevert(abi.encodeWithSelector(LostSlabRecovery.SlabNotLost.selector, tokenId));
        lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR1");
    }

    function test_ClaimBondLockedAndRefundedOnPayout() public {
        uint256 bondAmount = 10 * USD;
        lf.setClaimBond(bondAmount);
        assertEq(lf.claimBond(), bondAmount);

        // Fund finder with custody balance for the bond
        vm.startPrank(finder);
        usdc.faucet(100 * USD);
        usdc.approve(address(accounts), 100 * USD);
        accounts.deposit(100 * USD);
        vm.stopPrank();

        uint256 tokenId = _lostWithBounty();

        // Filing claim moves bond from finder to LostSlabRecovery contract
        vm.prank(finder);
        uint256 claimId = lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR555SG");
        assertEq(accounts.balanceOf(finder), 90 * USD);
        assertEq(lf.bondOf(claimId), bondAmount);

        // Intake: markReceived authenticates the slab and refunds the bond immediately
        vm.prank(operator);
        lf.markReceived(claimId);
        // Finder got their 10 USD bond back immediately upon intake verification (before owner acts)
        assertEq(accounts.balanceOf(finder), 100 * USD);
        assertEq(lf.bondOf(claimId), 0);

        vm.prank(owner);
        lf.chooseReturn(claimId, true, bytes32(0));
        vm.prank(operator);
        lf.completeReturn(claimId, "", "");
        _revault(tokenId, "CCsol2222-bond");

        // Claiming bounty pays the owner's BOUNTY (50 USD)
        vm.prank(finder);
        lf.claimBounty(claimId);
        assertEq(accounts.balanceOf(finder), 100 * USD + BOUNTY);
    }

    function test_BondRefundedOnIntakeEvenIfOwnerNeverResponds() public {
        uint256 bondAmount = 10 * USD;
        lf.setClaimBond(bondAmount);

        // Fund finder with 100 USD
        vm.startPrank(finder);
        usdc.faucet(100 * USD);
        usdc.approve(address(accounts), 100 * USD);
        accounts.deposit(100 * USD);
        vm.stopPrank();

        uint256 tokenId = _lostWithBounty();

        // Filing claim moves 10 USD bond into escrow
        vm.prank(finder);
        uint256 claimId = lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR555SG");
        assertEq(accounts.balanceOf(finder), 90 * USD);

        // Pokéchain receives and authenticates the parcel
        vm.prank(operator);
        lf.markReceived(claimId);

        // Finder gets their 10 USD bond back immediately!
        // No deadlock: Even if owner ghosts or never selects vault/delivery, the finder's stake is safe.
        assertEq(accounts.balanceOf(finder), 100 * USD);
        assertEq(lf.bondOf(claimId), 0);
    }

    function test_ClaimBondSlashedToOwnerOnRejection() public {
        uint256 bondAmount = 10 * USD;
        lf.setClaimBond(bondAmount);

        // Fund finder
        vm.startPrank(finder);
        usdc.faucet(100 * USD);
        usdc.approve(address(accounts), 100 * USD);
        accounts.deposit(100 * USD);
        vm.stopPrank();

        uint256 tokenId = _lostWithBounty();
        uint256 ownerBalanceBefore = accounts.balanceOf(owner); // 950 * USD

        vm.prank(finder);
        uint256 claimId = lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR555SG");
        assertEq(accounts.balanceOf(finder), 90 * USD);

        // Operator rejects fake/spam claim -> bond is awarded to owner
        vm.prank(operator);
        lf.rejectClaim(claimId, "Fraudulent tracking / empty parcel");

        assertEq(accounts.balanceOf(finder), 90 * USD);
        assertEq(accounts.balanceOf(owner), ownerBalanceBefore + bondAmount);
        assertEq(lf.bondOf(claimId), 0);
        assertEq(lf.activeClaimOf(tokenId), 0);
    }

    function test_CannotFileClaimWithoutBond() public {
        uint256 bondAmount = 10 * USD;
        lf.setClaimBond(bondAmount);

        uint256 tokenId = _lostWithBounty();

        // Finder has 0 balance, should revert InsufficientBalance
        vm.prank(finder);
        vm.expectRevert(abi.encodeWithSelector(AccountRegistry.InsufficientBalance.selector, bondAmount, 0));
        lf.fileClaim(tokenId, EVIDENCE, "SingPost", "RR555SG");
    }
}
