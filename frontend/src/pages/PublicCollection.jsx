import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Globe, Link2, FileText, Play, Youtube, XCircle, Lock, Instagram, Music2 } from 'lucide-react';

const BASE = '/api';

async function publicGet(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

const SOURCE_LABEL = {
  youtube: 'YouTube', vimeo: 'Vimeo', pinterest: 'Pinterest',
  behance: 'Behance', instagram: 'Instagram', tiktok: 'TikTok',
  dribbble: 'Dribbble', twitter: 'X / Twitter', web: 'Web',
};

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

// ── Instagram branded placeholder ─────────────────────────────────────────────

function InstagramPlaceholder({ url }) {
  const { username, postType } = parseInstagramInfo(url || '');
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(135deg, #833ab4 0%, #fd1d1d 50%, #fcb045 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px',
    }}>
      <Instagram size={38} color="rgba(255,255,255,0.95)" strokeWidth={1.5} />
      <div style={{ textAlign: 'center', lineHeight: 1.4 }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {postType}
        </div>
        {username && (
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.72)', marginTop: '3px' }}>
            @{username}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TikTok branded placeholder ────────────────────────────────────────────────

function TikTokPlaceholder() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: '#010101',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '8px',
    }}>
      <Music2 size={38} color="rgba(255,255,255,0.90)" strokeWidth={1.5} />
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        TikTok
      </div>
    </div>
  );
}

// ── Favicon placeholder ───────────────────────────────────────────────────────

function FaviconPlaceholder({ url }) {
  const domain = getDomain(url);
  const [faviconFailed, setFaviconFailed] = useState(false);
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '10px', background: '#1a1a1a',
    }}>
      {!faviconFailed ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
          alt={domain}
          onError={() => setFaviconFailed(true)}
          style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'contain' }}
        />
      ) : (
        <Globe size={36} color="#555" />
      )}
      <span style={{ fontSize: '12px', color: '#888', fontWeight: 500, maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
        {domain}
      </span>
    </div>
  );
}

// ── Link card (public, read-only) ─────────────────────────────────────────────

function PublicLinkCard({ card }) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasThumbnail = !!card.thumbnail_url && !imgFailed;
  const isInstagramReel = card.source === 'instagram' && !!card.url && /\/(reel|reels)\//.test(card.url);
  const isVideo = card.source === 'youtube' || card.source === 'vimeo' || card.source === 'tiktok' || isInstagramReel;
  const isInstagram = card.source === 'instagram';
  const isTikTok = card.source === 'tiktok';
  const tags = parseTags(card.tags);
  const domain = getDomain(card.url);

  return (
    <div
      style={{
        background: '#2E2E2E', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16,
        overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        breakInside: 'avoid', marginBottom: 16,
      }}
      onClick={() => window.open(card.url, '_blank', 'noopener,noreferrer')}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.45)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
      title={card.url}
    >
      {/* Thumbnail area */}
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', background: '#1a1a1a', flexShrink: 0 }}>
        {hasThumbnail ? (
          <img
            src={card.thumbnail_url}
            alt={card.title || ''}
            onError={() => setImgFailed(true)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : isInstagram ? (
          <InstagramPlaceholder url={card.url} />
        ) : isTikTok ? (
          <TikTokPlaceholder />
        ) : (
          <FaviconPlaceholder url={card.url} />
        )}
        {isVideo && hasThumbnail && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.22)',
          }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Play size={18} color="white" fill="white" style={{ marginLeft: 2 }} />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '11px 14px 13px', display: 'flex', flexDirection: 'column', gap: '5px', flex: 1 }}>
        {card.title ? (
          <p style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.4, margin: 0, color: '#fff', wordBreak: 'break-word' }}>
            {card.title}
          </p>
        ) : (
          <p style={{ fontSize: '12px', color: '#888', margin: 0, wordBreak: 'break-all' }}>{domain}</p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#888', fontSize: '11px' }}>
          <Globe size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain}</span>
        </div>
        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '3px' }}>
            {tags.map(tag => (
              <span key={tag} style={{ padding: '2px 9px', borderRadius: 50, fontSize: '11px', fontWeight: 600, background: 'rgba(199,255,46,0.08)', color: '#C7FF2E' }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Note card (public, read-only) ─────────────────────────────────────────────

function PublicNoteCard({ card }) {
  const [expanded, setExpanded] = useState(false);
  const tags = parseTags(card.tags);
  const isLong = (card.note_text || '').length > 250;

  return (
    <div style={{
      background: 'rgba(199,255,46,0.04)', border: '1px solid rgba(199,255,46,0.11)', borderRadius: 16,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '9px',
      breakInside: 'avoid', marginBottom: 16,
    }}>
      {card.title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <FileText size={12} color="#C7FF2E" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.title}
          </span>
        </div>
      )}
      <p style={{
        fontSize: '13px', lineHeight: 1.65, color: '#888', margin: 0,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden',
        display: '-webkit-box', WebkitLineClamp: expanded ? 'unset' : 5, WebkitBoxOrient: 'vertical',
      }}>
        {card.note_text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(p => !p)}
          style={{ alignSelf: 'flex-start', fontSize: '11px', fontWeight: 700, color: '#C7FF2E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {expanded ? 'Collapse ↑' : 'Read more ↓'}
        </button>
      )}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {tags.map(tag => (
            <span key={tag} style={{ padding: '2px 9px', borderRadius: 50, fontSize: '11px', fontWeight: 600, background: 'rgba(199,255,46,0.08)', color: '#C7FF2E' }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PublicCollection() {
  const { token } = useParams();
  const [state, setState] = useState('loading');
  const [collection, setCollection] = useState(null);
  const [cards, setCards] = useState([]);
  const [agency, setAgency] = useState({ agency_name: null, agency_logo_base64: null });

  useEffect(() => {
    Promise.all([
      publicGet(`/public/collection/${token}`),
      publicGet('/settings/agency-public'),
    ]).then(([data, ag]) => {
      setAgency(ag);
      if (!data.valid) {
        setState(data.reason === 'revoked' ? 'revoked' : 'invalid');
      } else {
        setCollection(data.collection);
        setCards(data.cards || []);
        setState('valid');
      }
    }).catch(() => setState('invalid'));
  }, [token]);

  const page = {
    minHeight: '100vh',
    background: '#0F0F0F',
    display: 'flex', flexDirection: 'column',
    padding: '0 16px 48px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#fff',
  };

  const container = { maxWidth: 1000, margin: '0 auto', width: '100%' };

  if (state === 'loading') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#888' }}>Loading…</p>
      </div>
    );
  }

  if (state === 'revoked') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Lock size={40} color="#555" style={{ marginBottom: 16 }} />
          <p style={{ fontSize: '18px', fontWeight: 700, marginBottom: 8 }}>This link has been revoked.</p>
          <p style={{ color: '#888', fontSize: '14px' }}>The owner has disabled access to this shared collection.</p>
        </div>
      </div>
    );
  }

  if (state === 'invalid') {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <XCircle size={40} color="#e53e3e" style={{ marginBottom: 16 }} />
          <p style={{ fontSize: '18px', fontWeight: 700, marginBottom: 8 }}>Link not found.</p>
          <p style={{ color: '#888', fontSize: '14px' }}>This shared collection link is invalid or no longer exists.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      {/* Brand header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 32, paddingTop: 24, paddingBottom: 20 }}>
        <div style={container}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {agency.agency_logo_base64 ? (
                <img src={agency.agency_logo_base64} alt="Agency" style={{ height: 32, objectFit: 'contain' }} />
              ) : (
                <span style={{ fontWeight: 800, fontSize: '16px', letterSpacing: '-0.5px' }}>
                  {agency.agency_name || 'MASSIV TV'}
                </span>
              )}
            </div>
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#555', background: 'rgba(255,255,255,0.06)', borderRadius: 50, padding: '4px 12px' }}>
              Shared Collection
            </span>
          </div>
        </div>
      </div>

      <div style={container}>
        {/* Collection title & description */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px', margin: '0 0 8px' }}>
            {collection.name}
          </h1>
          {collection.description && (
            <p style={{ fontSize: '14px', color: '#888', margin: 0, lineHeight: 1.6 }}>
              {collection.description}
            </p>
          )}
          <p style={{ fontSize: '12px', color: '#555', marginTop: 8 }}>
            {cards.length} {cards.length === 1 ? 'card' : 'cards'} · read-only view
          </p>
        </div>

        {/* Card grid */}
        {cards.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: '#555', fontSize: '14px' }}>
            This collection has no cards yet.
          </div>
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
