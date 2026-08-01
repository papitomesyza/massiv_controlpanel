import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Globe, FileText, Play, XCircle, Lock, Instagram, Music2,
  Library, FolderKanban, Clapperboard, User, ChevronLeft,
} from 'lucide-react';

const BASE = '/api';

async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

function parseTags(tags) {
  if (!tags) return [];
  return tags.split(',').map(t => t.trim()).filter(Boolean);
}

function parseInstagramInfo(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const RESERVED = ['explore', 'stories', 'accounts', 'direct', 'login', 'ar', 'challenge', 'about', 'blog', 'legal', 'help'];
    let username = null;
    let postType = 'Post';
    if (parts[0] === 'p') postType = 'Post';
    else if (parts[0] === 'reel' || parts[0] === 'reels') postType = 'Reel';
    else if (parts[0] === 'tv') postType = 'Video';
    else if (parts[0] && !RESERVED.includes(parts[0])) {
      username = parts[0];
      if (parts[1] === 'p') postType = 'Post';
      else if (parts[1] === 'reel' || parts[1] === 'reels') postType = 'Reel';
      else if (parts[1] === 'tv') postType = 'Video';
      else postType = 'Profile';
    }
    return { username, postType };
  } catch (_) {
    return { username: null, postType: 'Post' };
  }
}

// ── Placeholder components ────────────────────────────────────────────────────

function InstagramPlaceholder({ url }) {
  const { username, postType } = parseInstagramInfo(url || '');
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(135deg, var(--color-mid-gray) 0%, var(--color-ember) 50%, var(--color-mid-gray) 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px',
    }}>
      <Instagram size={38} color="var(--color-ink)" strokeWidth={1.5} />
      <div style={{ textAlign: 'center', lineHeight: 1.4 }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-ink)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{postType}</div>
        {username && <div style={{ fontSize: '11px', color: 'var(--color-ink)', marginTop: '3px' }}>@{username}</div>}
      </div>
    </div>
  );
}

function TikTokPlaceholder() {
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'var(--surface-input-fill)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
    }}>
      <Music2 size={38} color="var(--color-ink)" strokeWidth={1.5} />
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-ink)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>TikTok</div>
    </div>
  );
}

function FaviconPlaceholder({ url }) {
  const domain = getDomain(url);
  const [failed, setFailed] = useState(false);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'var(--color-surface-alt)' }}>
      {!failed ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt={domain}
          onError={() => setFailed(true)}
          style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'contain' }}
        />
      ) : (
        <Globe size={36} color="var(--color-faint)" />
      )}
      <span style={{ fontSize: '12px', color: 'var(--color-mid-gray)', fontWeight: 500, maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{domain}</span>
    </div>
  );
}

// ── Public card components ────────────────────────────────────────────────────

function PublicCardThumbnail({ card }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasThumbnail = !!card.thumbnail_url && !imgFailed;
  const isInstagramReel = card.source === 'instagram' && !!card.url && /\/(reel|reels)\//.test(card.url);
  const isVideo = card.source === 'youtube' || card.source === 'vimeo' || card.source === 'tiktok' || isInstagramReel;
  const isInstagram = card.source === 'instagram';
  const isTikTok = card.source === 'tiktok';

  return (
    <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: 'var(--color-surface-alt)', flexShrink: 0 }}>
      {hasThumbnail ? (
        <img src={card.thumbnail_url} alt={card.title || ''} onError={() => setImgFailed(true)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
      ) : isInstagram ? (
        <InstagramPlaceholder url={card.url} />
      ) : isTikTok ? (
        <TikTokPlaceholder />
      ) : (
        <FaviconPlaceholder url={card.url || ''} />
      )}
      {isVideo && hasThumbnail && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--overlay-06)' }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--scrim-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Play size={18} color="white" fill="white" style={{ marginLeft: 2 }} />
          </div>
        </div>
      )}
    </div>
  );
}

function PublicLinkCard({ card }) {
  const tags = parseTags(card.tags);
  const domain = getDomain(card.url);
  return (
    <div
      style={{ background: 'var(--surface-card)', border: '1px solid var(--color-hairline)', borderRadius: 24, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'transform 0.15s, box-shadow 0.15s', breakInside: 'avoid', marginBottom: 16 }}
      onClick={() => window.open(card.url, '_blank', 'noopener,noreferrer')}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px var(--overlay-07)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
      title={card.url}
    >
      <PublicCardThumbnail card={card} />
      <div style={{ padding: '11px 14px 13px', display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
        {card.title ? (
          <p style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.4, margin: 0, color: 'var(--color-ink)', wordBreak: 'break-word' }}>{card.title}</p>
        ) : (
          <p style={{ fontSize: '12px', color: 'var(--color-mid-gray)', margin: 0, wordBreak: 'break-all' }}>{domain}</p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--color-mid-gray)', fontSize: '11px' }}>
          <Globe size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain}</span>
        </div>
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
            {tags.map(tag => (
              <span key={tag} style={{ padding: '2px 9px', borderRadius: 18, fontSize: '11px', fontWeight: 600, background: 'var(--overlay-04)', color: 'var(--color-ink)' }}>{tag}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PublicNoteCard({ card }) {
  const [expanded, setExpanded] = useState(false);
  const tags = parseTags(card.tags);
  const isLong = (card.note_text || '').length > 250;
  return (
    <div style={{ background: 'var(--overlay-02)', border: '1px solid var(--color-hairline)', borderRadius: 24, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '9px', breakInside: 'avoid', marginBottom: 16 }}>
      {card.title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <FileText size={12} color="var(--color-ink)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.title}</span>
        </div>
      )}
      <p style={{ fontSize: '13px', lineHeight: 1.65, color: 'var(--color-mid-gray)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : 5, WebkitBoxOrient: 'vertical' }}>
        {card.note_text}
      </p>
      {isLong && (
        <button onClick={() => setExpanded(p => !p)} style={{ alignSelf: 'flex-start', fontSize: '11px', fontWeight: 700, color: 'var(--color-ink)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? 'Collapse ↑' : 'Read more ↓'}
        </button>
      )}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {tags.map(tag => (
            <span key={tag} style={{ padding: '2px 9px', borderRadius: 18, fontSize: '11px', fontWeight: 600, background: 'var(--overlay-04)', color: 'var(--color-ink)' }}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Collection tile (grid view) ───────────────────────────────────────────────

function PublicCollectionTile({ collection, onClick }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasCover = !!collection.cover_thumbnail && !imgFailed;
  const isInstagramCover = !hasCover && collection.cover_source === 'instagram';
  const isTikTokCover = !hasCover && collection.cover_source === 'tiktok';

  return (
    <div
      style={{ background: 'var(--surface-card)', border: '1px solid var(--color-hairline)', borderRadius: 24, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'transform 0.15s, box-shadow 0.15s' }}
      onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px var(--overlay-07)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
    >
      <div style={{ width: '100%', height: 118, background: 'var(--color-surface-alt)', flexShrink: 0, overflow: 'hidden' }}>
        {hasCover ? (
          <img src={collection.cover_thumbnail} alt="" onError={() => setImgFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
        ) : isInstagramCover ? (
          <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--color-mid-gray) 0%, var(--color-ember) 50%, var(--color-mid-gray) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Instagram size={28} color="var(--color-ink)" strokeWidth={1.5} />
          </div>
        ) : isTikTokCover ? (
          <div style={{ width: '100%', height: '100%', background: 'var(--surface-input-fill)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Music2 size={28} color="var(--color-ink)" strokeWidth={1.5} />
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Library size={26} color="var(--color-faint)" />
          </div>
        )}
      </div>
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-ink)' }}>{collection.name}</span>
        {collection.description && (
          <p style={{ fontSize: '12px', color: 'var(--color-mid-gray)', lineHeight: 1.4, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{collection.description}</p>
        )}
        <span style={{ fontSize: '11px', color: 'var(--color-mid-gray)' }}>{collection.card_count} {collection.card_count === 1 ? 'card' : 'cards'}</span>
      </div>
    </div>
  );
}

// ── Section heading icons ─────────────────────────────────────────────────────

const KIND_ICON = { project: FolderKanban, studio: Clapperboard, personal: User };

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PublicMind() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);
  const [agency, setAgency] = useState({ agency_name: null, agency_logo_base64: null });
  const [selectedCollection, setSelectedCollection] = useState(null);

  useEffect(() => {
    Promise.all([
      publicGet(`/public/mind/${token}`),
      publicGet('/settings/agency-public'),
    ]).then(([d, ag]) => {
      setAgency(ag);
      if (!d.valid) {
        setState('invalid');
      } else {
        setData(d);
        setState('valid');
      }
    }).catch(() => setState('invalid'));
  }, [token]);

  const page = {
    minHeight: '100vh', background: 'var(--surface-input-fill)',
    display: 'flex', flexDirection: 'column',
    padding: '0 16px 48px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: 'var(--color-ink)',
  };
  const container = { maxWidth: 1100, margin: '0 auto', width: '100%' };
  const sectionLabel = { fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-mid-gray)', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' };

  if (state === 'loading') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--color-mid-gray)' }}>Loading…</p>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <XCircle size={40} color="var(--color-ember)" style={{ marginBottom: 16 }} />
          <p style={{ fontSize: '18px', fontWeight: 700, marginBottom: 8 }}>This link is no longer available.</p>
          <p style={{ color: 'var(--color-mid-gray)', fontSize: '14px' }}>The shared collections link is invalid or has been revoked.</p>
        </div>
      </div>
    );
  }

  const brandHeader = (
    <div style={{ borderBottom: '1px solid var(--color-hairline)', marginBottom: 32, paddingTop: 24, paddingBottom: 20 }}>
      <div style={container}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {agency.agency_logo_base64 ? (
              <img src={agency.agency_logo_base64} alt="Agency" style={{ height: 32, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontWeight: 800, fontSize: '16px', letterSpacing: '-0.5px' }}>{agency.agency_name || 'MASSIV TV'}</span>
            )}
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-mid-gray)', background: 'var(--overlay-03)', borderRadius: 18, padding: '4px 12px' }}>
            Shared Collections
          </span>
        </div>
      </div>
    </div>
  );

  // ── Collection detail view ────────────────────────────────────────────────

  if (selectedCollection) {
    const cards = selectedCollection.cards || [];
    return (
      <div style={page}>
        {brandHeader}
        <div style={container}>
          <button
            onClick={() => setSelectedCollection(null)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'var(--color-mid-gray)', cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: '0 0 20px', letterSpacing: 0 }}
          >
            <ChevronLeft size={15} /> Back to collections
          </button>

          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 8px' }}>{selectedCollection.name}</h1>
            {selectedCollection.description && (
              <p style={{ fontSize: '14px', color: 'var(--color-mid-gray)', margin: 0, lineHeight: 1.6 }}>{selectedCollection.description}</p>
            )}
            <p style={{ fontSize: '12px', color: 'var(--color-mid-gray)', marginTop: 8 }}>
              {cards.length} {cards.length === 1 ? 'card' : 'cards'} · read-only view
            </p>
          </div>

          {cards.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-mid-gray)', fontSize: '14px' }}>This collection has no cards yet.</div>
          ) : (
            <div style={{ columnWidth: '300px', columnGap: '16px' }}>
              {cards.map(card => (
                card.type === 'link'
                  ? <PublicLinkCard key={card.id} card={card} />
                  : <PublicNoteCard key={card.id} card={card} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Grid view (categories + collection tiles) ─────────────────────────────

  return (
    <div style={page}>
      {brandHeader}
      <div style={container}>
        {(data.categories || []).map(cat => {
          const section = data.sections[cat];
          if (!section) return null;
          const Icon = KIND_ICON[cat] || Library;
          return (
            <section key={cat} style={{ marginBottom: '40px' }}>
              <h2 style={sectionLabel}>
                <Icon size={13} color="var(--color-faint)" />
                {section.label}
              </h2>
              {section.collections.length === 0 ? (
                <div style={{ padding: '18px 20px', background: 'var(--color-surface-alt)', borderRadius: 10, color: 'var(--color-mid-gray)', fontSize: '13px' }}>
                  No collections in this category.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
                  {section.collections.map(coll => (
                    <PublicCollectionTile
                      key={coll.id}
                      collection={coll}
                      onClick={() => setSelectedCollection(coll)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
