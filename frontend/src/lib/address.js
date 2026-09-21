// Client side mirror of the server's address shortener (lib/address.js). The
// map side list and popup show the short form while the full address stays
// stored and appears on hover, so both runtimes must agree on the shape: with
// more than two comma separated parts, keep the first and the last, otherwise
// return the value unchanged.
export function shortenAddress(addr) {
  const parts = String(addr || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length > 2) return `${parts[0]}, ${parts[parts.length - 1]}`;
  return addr;
}
