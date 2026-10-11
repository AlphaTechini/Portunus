// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Tempo ReceivePolicyGuard precompile (TIP-1028). Holds transfers blocked by a receive policy.
interface IReceivePolicyGuard {
    function claim(address to, bytes calldata receipt) external;
    function balanceOf(bytes calldata receipt) external view returns (uint256);
}

/// Tempo address registry precompile (TIP-1022). Resolves virtual addresses to their master.
interface IAddressRegistry {
    function resolveRecipient(address to) external view returns (address effectiveRecipient);
}

/// TIP-20 transfer with a 32-byte memo.
interface ITIP20 {
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external;
}

/// @title PortunusSettlement
/// @notice The recovery authority for one shipping line's container-deposit account. Every incoming
///         deposit to that account (or to any of its per-container virtual addresses) is held by the
///         protocol's ReceivePolicyGuard. This contract is the only party that can claim held funds, and it
///         can send them to exactly two places:
///           - `charges`: the shipping line's charges address (approved detention / damage charges), or
///           - `receipt.originator`: the original payer (refund).
///         No function takes a destination address. The fixed destinations and the "never more than the
///         receipt holds" cap are enforced on-chain. The timing rules (free days, daily accrual, settlement
///         window) are computed off-chain by the Portunus backend; this contract enforces only "charge <= deposit",
///         "settle at most once per receipt", and the post-deadline "anyone may refund" rule.
///
/// Who may do what:
///   - settle / settleMany / returnToSender: the operator (Portunus platform key) or the line (`charges`).
///   - resolveDispute: the resolver, once per disputed receipt.
///   - refundAfterDeadline: anyone, once `maxHold` seconds have passed since the deposit was blocked.
///
/// Receipt handling follows the proven "held" HeldArbiter `_load` checks: exact 320-byte length, we are the
/// recovery authority, and the receipt's recipient resolves to our deposits account.
contract PortunusSettlement {
    IReceivePolicyGuard public constant GUARD = IReceivePolicyGuard(0xB10C000000000000000000000000000000000000);
    IAddressRegistry public constant REGISTRY = IAddressRegistry(0xfDC0000000000000000000000000000000000000);
    // ClaimReceiptV1 is 10 static ABI words. With the exact length, abi.decode accepts only one encoding per
    // receipt, so keccak256(receipt) is a unique id for each held payment.
    uint256 internal constant RECEIPT_LENGTH = 320;

    /// ClaimReceiptV1 witness (ABI layout from TIP-1028 / ox ReceivePolicyReceipt).
    struct Receipt {
        uint8 version;
        address token;
        address recoveryAuthority;
        address originator;
        address recipient;
        uint64 blockedAt;
        uint64 blockedNonce;
        uint8 blockedReason;
        uint8 kind;
        bytes32 memo;
    }

    enum Status { None, Settled, Disputed, Returned }

    address public immutable depositsAccount; // the master account that carries the receive policy
    address public immutable charges;         // line's charges address: plain account, NO receive policy
    address public immutable operator;        // Portunus platform key (Convex), may settle
    address public immutable resolver;        // dispute resolver (platform by default)
    address public immutable token;           // AlphaUSD: the only token that can be settled to the line
    uint64 public immutable maxHold;          // seconds after blockedAt after which anyone may refund

    mapping(bytes32 => Status) public statusOf;
    mapping(bytes32 => uint256) public escrowOf; // disputed amount still held by this contract

    event Settled(
        bytes32 indexed id, address indexed originator, address indexed depositAddress,
        uint256 charged, uint256 refunded, uint256 disputedHeld
    );
    event Returned(bytes32 indexed id, address indexed originator, address token, uint256 amount);
    event DisputeResolved(bytes32 indexed id, uint256 toLine, uint256 toPayer);

    error BadConfig();
    error BadReceipt();
    error NotOurReceipt();
    error NotForAccount();
    error WrongToken();
    error NotAuthorized();
    error AlreadyHandled();
    error NotDisputed();
    error ExceedsDeposit();
    error LengthMismatch();
    error TooEarly();

    constructor(
        address depositsAccount_, address charges_, address operator_, address resolver_, address token_,
        uint64 maxHold_
    ) {
        if (
            depositsAccount_ == address(0) || charges_ == address(0) || operator_ == address(0)
                || resolver_ == address(0) || token_ == address(0) || maxHold_ == 0
        ) revert BadConfig();
        depositsAccount = depositsAccount_;
        charges = charges_;
        operator = operator_;
        resolver = resolver_;
        token = token_;
        maxHold = maxHold_;
    }

    // ------------------------------------------------------------------ views

    function decode(bytes calldata receipt) public pure returns (Receipt memory r) {
        r = abi.decode(receipt, (Receipt));
    }

    function idOf(bytes calldata receipt) public pure returns (bytes32) {
        return keccak256(receipt);
    }

    // ------------------------------------------------------------ actions

    /// Claims the full receipt to this contract, pays `charge` to `charges`, keeps `disputed` in escrow and
    /// refunds the remainder to the original payer. Operator or line only.
    function settle(bytes calldata receipt, uint256 charge, uint256 disputed, bytes32 chargeMemo, bytes32 refundMemo)
        external
    {
        _onlyOperatorOrLine();
        _settle(receipt, charge, disputed, chargeMemo, refundMemo);
    }

    /// Batch form of `settle`. Atomic: any revert reverts every item.
    function settleMany(
        bytes[] calldata receipts, uint256[] calldata chargesArr, uint256[] calldata disputedArr,
        bytes32[] calldata chargeMemos, bytes32[] calldata refundMemos
    ) external {
        _onlyOperatorOrLine();
        uint256 n = receipts.length;
        if (
            chargesArr.length != n || disputedArr.length != n || chargeMemos.length != n || refundMemos.length != n
        ) revert LengthMismatch();
        for (uint256 i; i < n; i++) {
            _settle(receipts[i], chargesArr[i], disputedArr[i], chargeMemos[i], refundMemos[i]);
        }
    }

    /// The full receipt goes straight back to its original payer, in whatever token it holds
    /// (wrong token / unknown sender). Operator or line only.
    function returnToSender(bytes calldata receipt) external {
        _onlyOperatorOrLine();
        (bytes32 id, Receipt memory r) = _load(receipt);
        if (statusOf[id] != Status.None) revert AlreadyHandled();
        statusOf[id] = Status.Returned;
        uint256 amount = GUARD.balanceOf(receipt);
        GUARD.claim(r.originator, receipt); // reroute claim: funds go back to the payer
        emit Returned(id, r.originator, r.token, amount);
    }

    /// Resolver only, once. Pays `toLine` of the escrowed amount to `charges` and the rest to the payer.
    function resolveDispute(bytes calldata receipt, uint256 toLine, bytes32 memo) external {
        if (msg.sender != resolver) revert NotAuthorized();
        (bytes32 id, Receipt memory r) = _load(receipt);
        if (statusOf[id] != Status.Disputed) revert NotDisputed();
        uint256 escrow = escrowOf[id];
        if (toLine > escrow) revert ExceedsDeposit();
        statusOf[id] = Status.Settled;
        escrowOf[id] = 0;
        uint256 toPayer = escrow - toLine;
        if (toLine > 0) ITIP20(r.token).transferWithMemo(charges, toLine, memo);
        if (toPayer > 0) ITIP20(r.token).transferWithMemo(r.originator, toPayer, memo);
        emit DisputeResolved(id, toLine, toPayer);
    }

    /// Anyone, once `maxHold` seconds have passed since the deposit was blocked and nothing happened to it:
    /// the full amount goes back to the payer.
    function refundAfterDeadline(bytes calldata receipt) external {
        (bytes32 id, Receipt memory r) = _load(receipt);
        if (statusOf[id] != Status.None) revert AlreadyHandled();
        if (block.timestamp < uint256(r.blockedAt) + maxHold) revert TooEarly();
        statusOf[id] = Status.Returned;
        uint256 amount = GUARD.balanceOf(receipt);
        GUARD.claim(r.originator, receipt);
        emit Returned(id, r.originator, r.token, amount);
    }

    // ----------------------------------------------------------- internal

    function _settle(bytes calldata receipt, uint256 charge, uint256 disputed, bytes32 chargeMemo, bytes32 refundMemo)
        internal
    {
        (bytes32 id, Receipt memory r) = _load(receipt);
        if (r.token != token) revert WrongToken();
        if (statusOf[id] != Status.None) revert AlreadyHandled();
        uint256 amount = GUARD.balanceOf(receipt);
        if (charge + disputed > amount) revert ExceedsDeposit();
        uint256 refund = amount - charge - disputed;
        // Effects before interactions.
        statusOf[id] = disputed > 0 ? Status.Disputed : Status.Settled;
        if (disputed > 0) escrowOf[id] = disputed;
        // Reroute the whole payment here (partial claims don't exist), then split it in this same transaction.
        GUARD.claim(address(this), receipt);
        if (charge > 0) ITIP20(r.token).transferWithMemo(charges, charge, chargeMemo);
        if (refund > 0) ITIP20(r.token).transferWithMemo(r.originator, refund, refundMemo);
        emit Settled(id, r.originator, r.recipient, charge, refund, disputed);
    }

    function _onlyOperatorOrLine() internal view {
        if (msg.sender != operator && msg.sender != charges) revert NotAuthorized();
    }

    function _load(bytes calldata receipt) internal view returns (bytes32 id, Receipt memory r) {
        if (receipt.length != RECEIPT_LENGTH) revert BadReceipt();
        r = decode(receipt);
        if (r.recoveryAuthority != address(this)) revert NotOurReceipt();
        if (r.recipient != depositsAccount && REGISTRY.resolveRecipient(r.recipient) != depositsAccount) {
            revert NotForAccount();
        }
        id = keccak256(receipt);
    }
}
