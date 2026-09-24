import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import '../styles/mind.css';

// A three dot button that opens a small row of icon actions under it. Used by
// the Collections tiles, the cards on a Collection and the Accounts cards, so
// every tile keeps one quiet control instead of a strip of buttons.
//
// items: [{ key, Icon, title, onClick, danger, active }]. The row renders in a
// portal so a tile's overflow never clips it, and it closes on an outside
// press, Escape, scroll or resize, and after any action.
export default function IconMenu({ items, title = 'More', size = 15 }) {
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [pos, setPos] = useState(null);
  const open = pos !== null;

  function toggle(e) {
    e.stopPropagation();
    if (open) { setPos(null); return; }
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setPos(null);
    function onDown(e) {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      close();
    }
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      if (btnRef.current) btnRef.current.focus();
    }
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`db-iconbtn icon-menu-btn ${open ? 'is-open' : ''}`}
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={e => e.stopPropagation()}
      >
        <MoreHorizontal size={size} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="icon-menu"
          role="menu"
          style={{ top: pos.top, right: pos.right }}
          onClick={e => e.stopPropagation()}
        >
          {items.filter(Boolean).map(({ key, Icon, title: t, onClick, danger, active }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className={`db-iconbtn ${danger ? 'danger' : ''} ${active ? 'is-active' : ''}`}
              title={t}
              aria-label={t}
              onClick={() => { setPos(null); onClick(); }}
            >
              <Icon size={15} fill={active ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
