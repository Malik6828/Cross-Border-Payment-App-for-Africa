export function validateStellarAddress(address) {
  if (!address || typeof address !== 'string') {
    return 'Address is required';
  }
  const trimmed = address.trim();
  if (!trimmed.startsWith('G')) {
    return 'Invalid Stellar address (must start with G)';
  }
  if (trimmed.length !== 56) {
    return `Invalid Stellar address (must be 56 characters, got ${trimmed.length})`;
  }
  if (!/^[A-Z0-9]+$/.test(trimmed)) {
    return 'Invalid Stellar address (contains invalid characters)';
  }
  return null;
}
