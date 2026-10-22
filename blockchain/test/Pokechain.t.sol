// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../contracts/MockUSDC.sol";
import {AccountRegistry, ISlabVaultCustody} from "../contracts/AccountRegistry.sol";
import {SlabVault, IAccountStatus} from "../contracts/SlabVault.sol";

/// Unit and fuzz tests for account and slab onboarding / offboarding. Run with `npm test`.
contract PokechainTest is Test {
    MockUSDC usdc;
    AccountRegistry accounts;
    SlabVault vault;

    address operator = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant USD = 1e6;
    bytes32 constant EVIDENCE = keccak256("manifest: front.jpg, back.jpg, label.jpg");

    function setUp() public {
        usdc = new MockUSDC();
        accounts = new AccountRegistry(usdc);
        vault = new SlabVault(IAccountStatus(address(accounts)), operator);
        accounts.setSlabVault(ISlabVaultCustody(address(vault)));

        vm.prank(alice);
        usdc.faucet(1_000 * USD);
    }

    /* ---------------------------- helpers ---------------------------- */

    function _register(address who, string memory handle) internal {
        vm.prank(who);
        accounts.register(handle);
    }

    function _deposit(address who, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(accounts), amount);
        accounts.deposit(amount);
        vm.stopPrank();
    }

    /// Submit, then walk the inbound trail: Pokechain receives it and forwards it to Collector Crypt.
    function _submitAndForward(address who, string memory cert) internal returns (uint256 sid) {
        vm.prank(who);
        sid = vault.requestSubmission("PSA", cert, 250_000, EVIDENCE, "SingPost", "RR1SG");
        vm.startPrank(operator);
        vault.markReceived(sid);
        vault.markForwarded(sid, "SingPost", "SP123");
        vm.stopPrank();
    }

    function _mint(address who, string memory cert) internal returns (uint256 tokenId) {
        uint256 sid = _submitAndForward(who, cert);
        vm.prank(operator);
        tokenId = vault.mintSlab(sid, "Charizard PSA 10", "https://images.pokemontcg.io/base1/4_hires.png", "CCsol1111");
    }

    /* ------------------------ account onboarding ------------------------ */

    function test_RegisterOpensAccount() public {
        vm.expectEmit(true, false, false, true);
        emit AccountRegistry.AccountOpened(alice, "alice_01", uint64(block.timestamp));
        _register(alice, "alice_01");

        AccountRegistry.Account memory a = accounts.accountOf(alice);
        assertEq(a.handle, "alice_01");
        assertEq(uint8(a.status), uint8(AccountRegistry.Status.Active));
        assertTrue(accounts.isActive(alice));
    }

    function test_HandleIsUnique() public {
        _register(alice, "ash");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AccountRegistry.HandleTaken.selector, "ash"));
        accounts.register("ash");
    }

    function test_RejectsBadHandles() public {
        string[4] memory bad = ["ab", "Ash", "ash ketchum", "this_handle_is_way_too_long"];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(AccountRegistry.InvalidHandle.selector);
            accounts.register(bad[i]);
        }
    }

    function test_CannotRegisterTwice() public {
        _register(alice, "alice");
        vm.prank(alice);
        vm.expectRevert(AccountRegistry.AlreadyActive.selector);
        accounts.register("alice2");
    }

    function test_DepositNeedsAnAccount() public {
        vm.startPrank(alice);
        usdc.approve(address(accounts), 10 * USD);
        vm.expectRevert(AccountRegistry.NotActive.selector);
        accounts.deposit(10 * USD);
        vm.stopPrank();
    }

    function test_DepositWithPermitIsOneTransaction() public {
        uint256 pk = 0xA11CE;
        address signer = vm.addr(pk);
        vm.prank(signer);
        usdc.faucet(100 * USD);
        _register(signer, "permit_user");

        // Sign the EIP-2612 Permit struct off-chain, then deposit in a single call.
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                signer,
                address(accounts),
                40 * USD,
                usdc.nonces(signer),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        vm.prank(signer);
        accounts.depositWithPermit(40 * USD, deadline, v, r, s);
        assertEq(accounts.balanceOf(signer), 40 * USD);
        assertEq(usdc.balanceOf(signer), 60 * USD);
    }

    /// Fuzz: any deposit followed by any partial withdrawal leaves the books balanced.
    function testFuzz_DepositWithdrawConservesFunds(uint256 depositAmt, uint256 withdrawAmt) public {
        depositAmt = bound(depositAmt, 1, 1_000 * USD);
        withdrawAmt = bound(withdrawAmt, 1, depositAmt);
        _register(alice, "alice");
        _deposit(alice, depositAmt);

        vm.prank(alice);
        accounts.withdraw(withdrawAmt);

        assertEq(accounts.balanceOf(alice), depositAmt - withdrawAmt);
        assertEq(usdc.balanceOf(alice), 1_000 * USD - depositAmt + withdrawAmt);
        assertEq(usdc.balanceOf(address(accounts)), accounts.totalCustody());
    }

    function test_CannotOverdraw() public {
        _register(alice, "alice");
        _deposit(alice, 50 * USD);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AccountRegistry.InsufficientBalance.selector, 51 * USD, 50 * USD));
        accounts.withdraw(51 * USD);
    }

    /* ----------------------- account offboarding ------------------------ */

    function test_CloseRefundsBalance() public {
        _register(alice, "alice");
        _deposit(alice, 300 * USD);

        vm.prank(alice);
        accounts.closeAccount();

        assertEq(uint8(accounts.accountOf(alice).status), uint8(AccountRegistry.Status.Closed));
        assertEq(accounts.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), 1_000 * USD);
    }

    function test_CloseBlockedWhileSlabsVaulted() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "11111111");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AccountRegistry.SlabsStillVaulted.selector, 1));
        accounts.closeAccount();

        // Redeeming the slab takes it out of the vault, so the account can now close.
        vm.prank(alice);
        vault.requestRedemption(tokenId, keccak256("1 Pallet Town"));
        vm.prank(alice);
        accounts.closeAccount();
        assertFalse(accounts.isActive(alice));
        // The token is still hers after offboarding.
        assertEq(vault.ownerOf(tokenId), alice);
    }

    function test_ClosedHandleStaysReserved() public {
        _register(alice, "ash");
        vm.prank(alice);
        accounts.closeAccount();

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AccountRegistry.HandleTaken.selector, "ash"));
        accounts.register("ash");

        // Alice can come back, even under her old handle.
        _register(alice, "ash");
        assertTrue(accounts.isActive(alice));
    }

    /* -------------------------- slab onboarding ------------------------- */

    function test_SubmitAndMint() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");

        assertEq(vault.ownerOf(tokenId), alice);
        assertEq(vault.vaultedCount(alice), 1);
        SlabVault.Slab memory s = vault.slabOf(tokenId);
        assertEq(uint8(s.custody), uint8(SlabVault.Custody.Vaulted));
        assertEq(s.certNumber, "12345678");
        assertEq(s.custodianRef, "CCsol1111");
        assertEq(vault.tokenOfCert(vault.certKey("PSA", "12345678")), tokenId);
    }

    function test_SubmissionNeedsAnAccount() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SlabVault.AccountNotActive.selector, alice));
        vault.requestSubmission("PSA", "12345678", 250_000, EVIDENCE, "SingPost", "RR1SG");
    }

    function test_OnlyOperatorMints() public {
        _register(alice, "alice");
        uint256 sid = _submitAndForward(alice, "12345678");
        vm.prank(alice);
        vm.expectRevert();
        vault.mintSlab(sid, "x", "y", "z");
    }

    function test_SubmissionNeedsEvidenceAndValue() public {
        _register(alice, "alice");
        vm.startPrank(alice);
        vm.expectRevert(SlabVault.MissingEvidence.selector);
        vault.requestSubmission("PSA", "12345678", 250_000, bytes32(0), "", "");
        vm.expectRevert(SlabVault.EmptyField.selector);
        vault.requestSubmission("PSA", "12345678", 0, EVIDENCE, "", "");
        vm.stopPrank();
    }

    function test_EvidenceCarriesOntoToken() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");
        SlabVault.Slab memory slab = vault.slabOf(tokenId);
        assertEq(slab.evidenceHash, EVIDENCE);
        assertEq(slab.declaredValueCents, 250_000);
        assertEq(vault.submissionOf(1).inboundTracking, "RR1SG");
    }

    function test_InboundTrailIsRecorded() public {
        _register(alice, "alice");
        vm.prank(alice);
        uint256 sid = vault.requestSubmission("PSA", "12345678", 250_000, EVIDENCE, "SingPost", "RR1SG");

        vm.expectEmit(true, true, false, false);
        emit SlabVault.SubmissionReceived(sid, alice);
        vm.prank(operator);
        vault.markReceived(sid);

        vm.expectEmit(true, true, false, true);
        emit SlabVault.SubmissionForwarded(sid, alice, "SingPost", "SP123");
        vm.prank(operator);
        vault.markForwarded(sid, "SingPost", "SP123");

        SlabVault.Submission memory sub = vault.submissionOf(sid);
        assertEq(uint8(sub.status), uint8(SlabVault.SubmissionStatus.AtCustodian));
        assertEq(sub.forwardTracking, "SP123");
    }

    function test_CannotMintBeforeCollectorCryptHasIt() public {
        _register(alice, "alice");
        vm.prank(alice);
        uint256 sid = vault.requestSubmission("PSA", "12345678", 250_000, EVIDENCE, "SingPost", "RR1SG");
        vm.prank(operator);
        vault.markReceived(sid);
        // Still at Pokechain's warehouse, not yet forwarded to Collector Crypt.
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                SlabVault.WrongSubmissionStatus.selector, sid, SlabVault.SubmissionStatus.ReceivedByPokechain
            )
        );
        vault.mintSlab(sid, "x", "y", "z");
    }

    function test_InboundStepsMustBeInOrder() public {
        _register(alice, "alice");
        vm.prank(alice);
        uint256 sid = vault.requestSubmission("PSA", "12345678", 250_000, EVIDENCE, "SingPost", "RR1SG");
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(SlabVault.WrongSubmissionStatus.selector, sid, SlabVault.SubmissionStatus.Pending)
        );
        vault.markForwarded(sid, "SingPost", "SP123");
    }

    function test_RejectAtAnyOpenStage() public {
        _register(alice, "alice");
        uint256 sid = _submitAndForward(alice, "12345678");
        vm.prank(operator);
        vault.rejectSubmission(sid, "Collector Crypt found the slab was cracked");
        assertEq(uint8(vault.submissionOf(sid).status), uint8(SlabVault.SubmissionStatus.Rejected));
        // The cert is free to be submitted again.
        vm.prank(alice);
        vault.requestSubmission("PSA", "12345678", 250_000, EVIDENCE, "SingPost", "RR1SG");
    }

    function test_MintNeedsCustodianRecord() public {
        _register(alice, "alice");
        uint256 sid = _submitAndForward(alice, "12345678");
        vm.prank(operator);
        vm.expectRevert(SlabVault.EmptyField.selector);
        vault.mintSlab(sid, "x", "y", "");
    }

    function test_SameCertCannotBeTokenisedTwice() public {
        _register(alice, "alice");
        _register(bob, "bob");
        uint256 tokenId = _mint(alice, "12345678");
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(SlabVault.CertAlreadyTokenised.selector, tokenId));
        vault.requestSubmission("PSA", "12345678", 250_000, EVIDENCE, "SingPost", "RR1SG");
    }

    function test_TransfersOnlyToActiveAccounts() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SlabVault.AccountNotActive.selector, bob));
        vault.transferFrom(alice, bob, tokenId);

        _register(bob, "bob");
        vm.prank(alice);
        vault.transferFrom(alice, bob, tokenId);
        assertEq(vault.vaultedCount(alice), 0);
        assertEq(vault.vaultedCount(bob), 1);
    }

    /* ------------------------- slab offboarding ------------------------- */

    function test_RedeemShipDeliverKeepsToken() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");

        vm.prank(alice);
        vault.requestRedemption(tokenId, keccak256("1 Pallet Town"));
        assertEq(vault.vaultedCount(alice), 0);

        vm.prank(operator);
        vault.markShipped(tokenId, "CCR-1", "DHL", "JD0123456789");

        vm.prank(alice);
        vault.confirmDelivery(tokenId);

        SlabVault.Slab memory s = vault.slabOf(tokenId);
        assertEq(uint8(s.custody), uint8(SlabVault.Custody.Delivered));
        assertEq(s.trackingNumber, "JD0123456789");
        assertEq(s.redemptionRef, "CCR-1");
        assertEq(vault.ownerOf(tokenId), alice); // never burned
    }

    function test_CannotTransferToSelf() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SlabVault.SelfTransfer.selector, tokenId));
        vault.transferFrom(alice, alice, tokenId);
        assertEq(vault.vaultedCount(alice), 1);
    }

    /// A sells to B on Pokechain (the token moves), B withdraws: the slab ships to B, A has no claim.
    function test_TransferThenNewOwnerRedeems() public {
        _register(alice, "alice");
        _register(bob, "bob");
        uint256 tokenId = _mint(alice, "12345678");
        vm.prank(alice);
        vault.transferFrom(alice, bob, tokenId);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SlabVault.NotSlabOwner.selector, tokenId));
        vault.requestRedemption(tokenId, bytes32(0));

        vm.prank(bob);
        vault.requestRedemption(tokenId, keccak256("Bob, 2 Cerulean City"));
        vm.prank(operator);
        vault.markShipped(tokenId, "CCR-7", "DHL", "JD999");
        vm.prank(bob);
        vault.confirmDelivery(tokenId);
        assertEq(vault.ownerOf(tokenId), bob);
    }

    function test_RedeemedTokenIsLocked() public {
        _register(alice, "alice");
        _register(bob, "bob");
        uint256 tokenId = _mint(alice, "12345678");
        vm.prank(alice);
        vault.requestRedemption(tokenId, bytes32(0));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(SlabVault.SlabLocked.selector, tokenId, SlabVault.Custody.RedemptionRequested)
        );
        vault.transferFrom(alice, bob, tokenId);
    }

    function test_ReportLostInTransitAndResolve() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");
        vm.prank(alice);
        vault.requestRedemption(tokenId, bytes32(0));
        vm.prank(operator);
        vault.markShipped(tokenId, "CCR-1", "DHL", "JD0123456789");

        vm.expectEmit(true, true, false, true);
        emit SlabVault.SlabReportedLost(tokenId, alice, "JD0123456789", "Not delivered after 10 days");
        vm.prank(alice);
        vault.reportLost(tokenId, "Not delivered after 10 days");
        assertEq(uint8(vault.slabOf(tokenId).custody), uint8(SlabVault.Custody.Lost));

        // The carrier returns it to the vault: it counts as vaulted and tradeable again.
        vm.prank(operator);
        vault.resolveLostReport(tokenId, SlabVault.Custody.Vaulted);
        assertEq(vault.vaultedCount(alice), 1);
    }

    function test_CannotReportLostWhileVaulted() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SlabVault.WrongCustody.selector, tokenId, SlabVault.Custody.Vaulted));
        vault.reportLost(tokenId, "");
    }

    function test_TokenURIIsOnChainJson() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");
        string memory uri = vault.tokenURI(tokenId);
        assertEq(bytes(uri)[0], bytes1("d")); // data:application/json;base64,...
    }

    /// What the collector declared in the form is part of the NFT's own metadata.
    function test_TokenURICarriesDeclaredValueAndEvidence() public {
        _register(alice, "alice");
        uint256 tokenId = _mint(alice, "12345678");
        string memory uri = vault.tokenURI(tokenId);
        string memory decoded = string(_base64Decode(_after(uri, "data:application/json;base64,")));
        assertTrue(_contains(decoded, '"Declared value (USD cents)","display_type":"number","value":250000'));
        assertTrue(_contains(decoded, vm.toString(EVIDENCE)));
    }

    function _after(string memory s, string memory prefix) private pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(prefix);
        bytes memory out = new bytes(b.length - p.length);
        for (uint256 i; i < out.length; ++i) out[i] = b[i + p.length];
        return string(out);
    }

    function _contains(string memory hay, string memory needle) private pure returns (bool) {
        bytes memory h = bytes(hay);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i; i <= h.length - n.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function _base64Decode(string memory data) private pure returns (bytes memory) {
        bytes memory table = bytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
        bytes memory d = bytes(data);
        uint256 pad = d.length > 0 && d[d.length - 1] == "=" ? (d.length > 1 && d[d.length - 2] == "=" ? 2 : 1) : 0;
        bytes memory out = new bytes((d.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i; i < d.length; i += 4) {
            uint256 n;
            for (uint256 j; j < 4; ++j) {
                uint256 v;
                bytes1 c = d[i + j];
                if (c != "=") {
                    for (uint256 k; k < 64; ++k) {
                        if (table[k] == c) {
                            v = k;
                            break;
                        }
                    }
                }
                n = (n << 6) | v;
            }
            for (uint256 j; j < 3 && o < out.length; ++j) out[o++] = bytes1(uint8(n >> (16 - 8 * j)));
        }
        return out;
    }
}
