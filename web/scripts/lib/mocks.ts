// Minimal Solidity stand-ins for the Tempo precompiles the settlement contract talks to, used only by the
// offline EVM tests: ReceivePolicyGuard (claim / balanceOf), the TIP-1022 address registry, and a TIP-20 token.
// They model the behaviour PortunusSettlement relies on, nothing more.
export const MOCKS_SOURCE = /* solidity */ `
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockToken {
    mapping(address => uint256) public balanceOf;
    event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo);
    error InvalidAmount();
    error InsufficientBalance();
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external {
        if (amount == 0) revert InvalidAmount(); // the real chain may reject zero amounts: the contract must skip them
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit TransferWithMemo(msg.sender, to, amount, memo);
    }
}

contract MockGuard {
    struct Receipt {
        uint8 version; address token; address recoveryAuthority; address originator; address recipient;
        uint64 blockedAt; uint64 blockedNonce; uint8 blockedReason; uint8 kind; bytes32 memo;
    }
    mapping(bytes32 => uint256) public held;
    mapping(bytes32 => bool) public claimed;
    event ReceiptClaimed(address indexed token, address to, uint256 amount);
    error UnauthorizedClaimer();
    error InvalidReceipt();
    // Test setup: pretend 'amount' of the receipt's token was blocked (the token is minted to the guard).
    function hold(bytes calldata receipt, uint256 amount) external {
        Receipt memory r = abi.decode(receipt, (Receipt));
        held[keccak256(receipt)] = amount;
        (bool ok,) = r.token.call(abi.encodeWithSignature("mint(address,uint256)", address(this), amount));
        require(ok, "mint failed");
    }
    function balanceOf(bytes calldata receipt) external view returns (uint256) {
        bytes32 id = keccak256(receipt);
        return claimed[id] ? 0 : held[id];
    }
    function claim(address to, bytes calldata receipt) external {
        bytes32 id = keccak256(receipt);
        if (held[id] == 0 || claimed[id]) revert InvalidReceipt();
        Receipt memory r = abi.decode(receipt, (Receipt));
        if (msg.sender != r.recoveryAuthority) revert UnauthorizedClaimer();
        claimed[id] = true;
        uint256 amount = held[id];
        (bool ok,) = r.token.call(abi.encodeWithSignature("transferWithMemo(address,uint256,bytes32)", to, amount, bytes32(0)));
        require(ok, "token transfer failed");
        emit ReceiptClaimed(r.token, to, amount);
    }
}

contract MockRegistry {
    mapping(address => address) public masterOf;
    function setMaster(address virtualAddr, address master) external { masterOf[virtualAddr] = master; }
    function resolveRecipient(address to) external view returns (address) {
        address m = masterOf[to];
        return m == address(0) ? to : m;
    }
}
`;
