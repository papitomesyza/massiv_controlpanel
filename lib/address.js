// Shared address shortening for client facing output.
//
// A full Google or Nominatim formatted address, for example
// "Pristina, Municipality of Pristina, District of Prishtina, 10000, Kosovo",
// is machine formatting a client does not need to read. When it carries more
// than two comma separated parts, keep just the first and the last, giving
// "Pristina, Kosovo". Two parts or fewer are returned unchanged. The full
// address is always left stored untouched; this only shapes what is shown.
function shortenAddress(addr) {
  const parts = String(addr || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length > 2) return `${parts[0]}, ${parts[parts.length - 1]}`;
  return addr;
}

module.exports = { shortenAddress };
