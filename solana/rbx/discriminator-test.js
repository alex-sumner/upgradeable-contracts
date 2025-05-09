import crypto from 'crypto';

// Original expected discriminator
const expectedDiscriminator = [175, 175, 109, 31, 13, 152, 155, 237];
console.log('Expected discriminator:', expectedDiscriminator);

// Actual observed discriminator
const actualDiscriminator = [216, 146, 107, 94, 104, 75, 182, 177];
console.log('Actual discriminator:', actualDiscriminator);

// Try common hashing approaches
function hashString(input) {
  const hash = crypto.createHash('sha256').update(input).digest();
  return Array.from(hash.slice(0, 8));
}

// Try different preimages
console.log('Hash of "account:State":', hashString('account:State'));
console.log('Hash of "State":', hashString('State'));
console.log('Hash of "account:rbx:State":', hashString('account:rbx:State'));
console.log('Hash of "state":', hashString('state'));
console.log('Hash of "account:state":', hashString('account:state'));
console.log('Hash of "account:rbx-State":', hashString('account:rbx-State'));

// Try global namespace variations
console.log('Hash of "global:State":', hashString('global:State'));
console.log('Hash of "global:state":', hashString('global:state'));
console.log('Hash of "account:global:State":', hashString('account:global:State'));

// Try with program ID
console.log('Hash of "account:CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W:State":', 
  hashString('account:CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W:State'));
console.log('Hash of "CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W:State":', 
  hashString('CZBh9LezU7rC2vpxCBs8w1TSFYmHDjU2WmWYkkcocq9W:State'));

// Try with struct in lowercase
console.log('Hash of "account:rbx:state":', hashString('account:rbx:state'));
console.log('Hash of "account:struct:State":', hashString('account:struct:State'));
console.log('Hash of "account:struct:state":', hashString('account:struct:state'));

// Try Anchor's actual discriminator pattern (could be different)
console.log('Hash of "anchor:account:State":', hashString('anchor:account:State'));
console.log('Hash of "anchor:account:state":', hashString('anchor:account:state'));

// Try different hashing algorithm
function hashStringKeccak(input) {
  // Note: This is just a simulation, as Node.js doesn't have keccak built-in
  return hashString(input); // Use sha256 as a placeholder
}

console.log('Keccak hash of "account:State":', hashStringKeccak('account:State'));