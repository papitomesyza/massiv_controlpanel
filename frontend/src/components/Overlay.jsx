import React, {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

// The one overlay in the app. Every modal, wizard, drawer and sheet renders
// through it, so they all share one scrim, one blur and one set of close rules.
//
// Sizes:
//   full    full screen editor: blurred scrim over the whole viewport, a top bar
//           with the title on the left and the actions plus the X on the right,
//           content floating in the middle (the InvoiceBuilder treatment)
//   card    centred card for small things, X in its top right corner
//   drawer  panel sliding in from the right edge
//   sheet   panel sliding up from the bottom edge
//
// Close rules, identical everywhere:
//   the X closes it, Escape closes it, and a click on the scrim closes it. A
//   scrim click only counts when both the press and the release land on the
//   scrim itself, so pressing inside a field and releasing over the scrim never
//   closes anything.
//
// Guard: when the overlay holds changes (any input or change event inside it
// unless trackInput is off, a markDirty() call from the content, or a true
// `dirty` prop from a caller that keeps its own flag), closing by
// scrim, Escape or X asks through ConfirmDialog before discarding. This is the
// estimate wizard's dirty flag plus confirm approach, lifted into one place.
//
// Stacking: overlays form a stack. Each one mounts above the last, and Escape
// and scrim clicks act only on the topmost. While any overlay is open the page
// behind is locked from scrolling, and closing returns keyboard focus to the
// element that opened it.

const stack = [];
let lockSaved = null;
let escListening = false;

function topEntry() { return stack[stack.length - 1] || null; }

function onGlobalKey(e) {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = topEntry();
  if (!top) return;
  e.preventDefault();
  top.requestClose.current();
}

function pushEntry(entry) {
  stack.push(entry);
  if (stack.length === 1) {
    const html = document.documentElement;
    lockSaved = { html: html.style.overflow, body: document.body.style.overflow };
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  if (!escListening) {
    document.addEventListener('keydown', onGlobalKey);
    escListening = true;
  }
}

function removeEntry(entry) {
  const i = stack.indexOf(entry);
  if (i !== -1) stack.splice(i, 1);
  if (stack.length === 0) {
    if (lockSaved) {
      document.documentElement.style.overflow = lockSaved.html;
      document.body.style.overflow = lockSaved.body;
      lockSaved = null;
    }
    document.removeEventListener('keydown', onGlobalKey);
    escListening = false;
  }
}

const OverlayContext = createContext({
  markDirty: () => {},
  requestClose: () => {},
  isTopmost: () => true,
});

// Content inside an overlay can mark it dirty (for edits that are not form
// inputs, such as adding a line or picking a card) or ask it to close through
// the guard, exactly as the X would.
export function useOverlay() {
  return useContext(OverlayContext);
}

export default function Overlay({
  size = 'card',
  title,
  onClose,
  children,
  footer,
  actions,
  width,
  dirty = false,
  trackInput = true,
  guard = true,
  discardTitle = 'Discard unsaved changes?',
  discardMessage,
  className = '',
  bodyClassName = '',
  hideClose = false,
  label,
}) {
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const pressOnScrim = useRef(false);
  const autoDirty = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [z, setZ] = useState(1000);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const isDirty = () => !!dirty || (trackInput && autoDirty.current);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const requestClose = useCallback(() => {
    if (guard && isDirtyRef.current()) { setConfirming(true); return; }
    onCloseRef.current && onCloseRef.current();
  }, [guard]);

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  const entryRef = useRef(null);
  if (!entryRef.current) entryRef.current = { requestClose: requestCloseRef };

  // Register on the stack before paint, so a stacked overlay takes its place
  // above its parent from the first frame.
  useLayoutEffect(() => {
    const entry = entryRef.current;
    const opener = document.activeElement;
    pushEntry(entry);
    setZ(1000 + stack.length * 10);
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    return () => {
      removeEntry(entry);
      if (opener && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  // Any user edit inside this overlay's own DOM marks it dirty. Portalled child
  // overlays are separate DOM trees, so a nested confirm never dirties its host.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const mark = e => {
      if (e.target && e.target.closest && e.target.closest('[data-overlay-root]') !== root) return;
      if (e.target && e.target.closest && e.target.closest('[data-overlay-noguard]')) return;
      autoDirty.current = true;
    };
    root.addEventListener('input', mark);
    root.addEventListener('change', mark);
    return () => {
      root.removeEventListener('input', mark);
      root.removeEventListener('change', mark);
    };
  }, []);

  const markDirty = useCallback(() => { autoDirty.current = true; }, []);
  const isTopmost = useCallback(() => topEntry() === entryRef.current, []);

  // The scrim is the root itself plus, on the full size, the scrolling area
  // around the floating content. Events from nested overlays reach this handler
  // through React's portal bubbling, so the closest root must be this one.
  function isOwnScrim(target) {
    if (!target || !target.hasAttribute) return false;
    if (!target.hasAttribute('data-overlay-scrim')) return false;
    return target.closest('[data-overlay-root]') === rootRef.current;
  }

  function onPointerDown(e) {
    pressOnScrim.current = isOwnScrim(e.target);
  }

  function onClick(e) {
    const both = pressOnScrim.current && isOwnScrim(e.target);
    pressOnScrim.current = false;
    if (both && isTopmost()) requestClose();
  }

  const closeBtn = hideClose ? null : (
    <button type="button" className="ov-close" onClick={requestClose} aria-label="Close">
      <X size={18} />
    </button>
  );

  const panelStyle = width ? { maxWidth: typeof width === 'number' ? `${width}px` : width } : undefined;

  let body;
  if (size === 'full') {
    body = (
      <div className={`ov-full ${className}`} ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label || (typeof title === 'string' ? title : undefined)}>
        <div className="ov-topbar">
          <div className="ov-topbar-title">{title}</div>
          {actions && <div className="ov-topbar-actions">{actions}</div>}
          <div className="ov-topbar-close">{closeBtn}</div>
        </div>
        <div className={`ov-full-body ${bodyClassName}`} data-overlay-scrim="">
          <div className="ov-full-content" style={panelStyle}>{children}</div>
        </div>
      </div>
    );
  } else {
    const panelClass = size === 'drawer' ? 'ov-drawer' : size === 'sheet' ? 'ov-sheet' : 'ov-card';
    body = (
      <div
        className={`${panelClass} ${className}`}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label || (typeof title === 'string' ? title : undefined)}
        style={panelStyle}
      >
        {(title || closeBtn) && (
          <div className={`ov-head ${title ? '' : 'ov-head-bare'}`}>
            {title ? <div className="ov-title">{title}</div> : <span />}
            {actions && <div className="ov-head-actions">{actions}</div>}
            {closeBtn}
          </div>
        )}
        <div className={`ov-body ${bodyClassName}`}>{children}</div>
        {footer && <div className="ov-footer">{footer}</div>}
      </div>
    );
  }

  return createPortal(
    <OverlayContext.Provider value={{ markDirty, requestClose, isTopmost }}>
      <div
        ref={rootRef}
        className={`ov-root ov-root-${size}`}
        style={{ zIndex: z }}
        data-overlay-root=""
        data-overlay-scrim=""
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {body}
      </div>
      {confirming && (
        <ConfirmDialog
          title={discardTitle}
          message={discardMessage}
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          tone="danger"
          onConfirm={() => { setConfirming(false); onCloseRef.current && onCloseRef.current(); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </OverlayContext.Provider>,
    document.body,
  );
}
