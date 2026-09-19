// Shared filename helpers for document exports.
//
// Estimates use these today; invoices and other PDF exports are expected to
// want the same treatment, so the logic lives here rather than inline in a
// single route. Every export that slugifies a title should go through slugify
// so client facing filenames read the same way across the app.

// Turn an arbitrary string into a filename safe slug.
//
//   - Diacritics are stripped, so "Deçani" becomes "Decani" rather than
//     "Dec-ani". The string is normalised (NFD) and the combining marks the
//     decomposition produces are removed.
//   - Any run of non alphanumeric characters collapses to a single dash, so a
//     " - " sequence or a "(" no longer turns into a string of dashes.
//   - Leading and trailing dashes are trimmed.
//   - Capitalisation is preserved on purpose: a client facing filename reads
//     better with its original case.
//   - When maxLen is given, the slug is capped to it, cutting at the last dash
//     before the limit so a word is never sliced in half. If there is no dash
//     to cut at, the hard cut is used.
function slugify(input, maxLen = 0) {
  let s = String(input == null ? '' : input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // drop the combining diacritical marks
    .replace(/[^a-zA-Z0-9]+/g, '-')    // any run of non alphanumerics to one dash
    .replace(/^-+|-+$/g, '');          // trim leading and trailing dashes

  if (maxLen > 0 && s.length > maxLen) {
    const cut = s.slice(0, maxLen);
    const lastDash = cut.lastIndexOf('-');
    s = (lastDash > 0 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '');
  }
  return s;
}

// Pad a document id the same way the Ref line inside the document does (four
// digits, zero padded), so the filename and the document always agree on the
// number.
function padDocId(id) {
  return String(id == null ? 0 : id).padStart(4, '0');
}

// Compose a document filename as "<Prefix>-<paddedId>-<titleSlug>", for example
// "Estimate-0022-QTU-Shopping-Fest-TVC". When the title slugs to an empty
// string, fall back to "<Prefix>-<paddedId>" with no trailing dash. The title
// slug is capped at roughly 40 characters. The returned name carries no
// extension: the caller appends ".pdf".
function documentFilename(prefix, id, title, titleMaxLen = 40) {
  const slug = slugify(title, titleMaxLen);
  const base = `${prefix}-${padDocId(id)}`;
  return slug ? `${base}-${slug}` : base;
}

module.exports = { slugify, padDocId, documentFilename };
