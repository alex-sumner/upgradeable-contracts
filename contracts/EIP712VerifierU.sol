// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

contract EIP712VerifierU is EIP712Upgradeable {
    address public external_signer;

    function __EIP712VerifierU_init(string memory domainName, string memory version, address signer) internal initializer {
        require(signer != address(0), "ZERO_SIGNER");
        __EIP712_init(domainName, version);
        external_signer = signer;
    }

    /*
        Standard EIP712 verifier but with different v combinations
    */
    function verify(bytes32 digest, uint8 v, bytes32 r, bytes32 s) internal view returns (bool) {

        address recovered_signer = ecrecover(digest, v, r, s);
        if (recovered_signer != external_signer) {
            uint8 other_v = 27;
            if (other_v == v) {
                other_v = 28;
            }

            recovered_signer = ecrecover(digest, other_v, r, s);
        }

        if (recovered_signer != external_signer) {
            return false;
        }

        return true;
    }
}
