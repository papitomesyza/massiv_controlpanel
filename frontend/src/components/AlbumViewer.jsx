import React, { useEffect, useState } from 'react';

// One card, many images: the full-screen viewer shared by the panel, the share
// link and the client view. Arrow keys, swipe, click outside or Escape to close.
export default function AlbumViewer({ media, start = 0, onClose }) {
  const [i, setI] = useState(start);
  const many = media.length > 1;
  const go = d => setI(prev => (prev + d + media.length) % media.length);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && many) go(-1);
      else if (e.key === 'ArrowRight' && many) go(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [many, onClose]);

  let touchX = null;
  const m = media[i] || {};
  const nav = {
    width: 46, height: 46, flex: '0 0 auto', borderRadius: '50%', fontSize: 26, lineHeight: 1,
    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', color: 'white', cursor: 'pointer',
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      onTouchStart={e => { touchX = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (many && Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '56px 12px',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{ ...nav, position: 'absolute', top: 14, right: 16, width: 42, height: 42, fontSize: 22 }}
      >
        ×
      </button>
      {many && <button type="button" onClick={e => { e.stopPropagation(); go(-1); }} aria-label="Previous image" style={nav}>‹</button>}
      <img
        src={m.url || m.thumbnail_url}
        alt=""
        style={{ maxWidth: 'min(1200px, 92vw)', maxHeight: '82vh', objectFit: 'contain', borderRadius: 12 }}
      />
      {many && <button type="button" onClick={e => { e.stopPropagation(); go(1); }} aria-label="Next image" style={nav}>›</button>}
      {many && (
        <span style={{
          position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          fontSize: 12, letterSpacing: '0.08em', color: 'white', background: 'rgba(0,0,0,0.6)',
          borderRadius: 18, padding: '4px 12px',
        }}>
          {`${i + 1} / ${media.length}`}
        </span>
      )}
    </div>
  );
}
