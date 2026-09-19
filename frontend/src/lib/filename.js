// Client side mirror of the server's document filename helper (lib/filename.js).
// The browser sets the download name via the anchor's `download` attribute,
// which overrides the server's Content-Disposition, so the two must agree on
// the shape: "<Prefix>-<paddedId>-<titleSlug>", diacritics stripped, runs of
// non alphanumerics collapsed to a single dash, dashes trimmed, capitalisation
// kept, and the title slug capped at roughly 40 characters cut on a dash.

export function slugify(input, maxLen = 0) {
  let s = String(input == null ? '' : input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (maxLen > 0 && s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const lastDash = cut.lastIndexOf('-');
    s = (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '');
  }
  return s;
}

export function padDocId(id) {
  return String(id == null ? 0 : id).padStart(4, '0');
}

export function documentFilename(prefix, id, title, titleMaxLen = 40) {
  const slug = slugify(title, titleMaxLen);
  const base = `${prefix}-${padDocId(id)}`;
  return slug ? `${base}-${slug}` : base;
}
