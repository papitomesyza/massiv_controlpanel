import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

// The one date field in the app. It always shows and accepts dd/mm/yyyy,
// whatever the browser locale, and stores yyyy-mm-dd exactly as a native date
// input did, so every caller and every API keeps the same value shape.
//
// Typing: digits are grouped into dd/mm/yyyy as they are typed, and dd.mm.yyyy
// or dd-mm-yyyy are read too. A complete, real date is passed up at once; an
// emptied field passes up ''. On blur an incomplete or impossible date falls
// back to the last good value, so nothing half typed is ever stored.
//
// Picking: the calendar button opens the browser's own picker through a hidden
// native date input, so there is still a calendar without any date library.
// Only the picker's popup follows the browser; the field itself never does.
//
// onChange receives the yyyy-mm-dd string, not an event.

function toDisplay(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

function isRealDate(y, m, d) {
  if (y < 1000 || m < 1 || m > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// dd/mm/yyyy (or . or - separated) to yyyy-mm-dd, or null when not a real date.
export function parseDisplayDate(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (!isRealDate(y, mo, d)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Group bare digits as dd/mm/yyyy while typing. Text that already carries its
// own separators is left as typed so dd.mm.yyyy still works.
function maskDigits(raw) {
  if (/[^\d/]/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `/${digits.slice(4)}`;
  return out;
}

export default function DateField({
  value,
  onChange,
  className = '',
  wrapClassName = '',
  disabled = false,
  min,
  max,
  placeholder = 'dd/mm/yyyy',
  title,
  autoFocus,
  id,
  'aria-label': ariaLabel,
}) {
  const [text, setText] = useState(toDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const pickerRef = useRef(null);

  // Follow the value from outside, except while the user is typing in the field.
  useEffect(() => {
    if (!focused.current) { setText(toDisplay(value)); setInvalid(false); }
  }, [value]);

  function commit(raw) {
    const masked = maskDigits(raw);
    setText(masked);
    if (masked.trim() === '') {
      setInvalid(false);
      if (value) onChange('');
      return;
    }
    const ymd = parseDisplayDate(masked);
    const inRange = ymd && (!min || ymd >= min) && (!max || ymd <= max);
    if (inRange) {
      setInvalid(false);
      if (ymd !== value) onChange(ymd);
    } else {
      setInvalid(masked.length >= 10);
    }
  }

  function onBlur() {
    focused.current = false;
    setText(toDisplay(value));
    setInvalid(false);
  }

  function openPicker() {
    const el = pickerRef.current;
    if (!el || disabled) return;
    try {
      if (typeof el.showPicker === 'function') { el.showPicker(); return; }
    } catch (_) { /* showPicker refuses outside a user gesture on some engines */ }
    el.focus();
    el.click();
  }

  return (
    <span className={`date-field ${wrapClassName}${disabled ? ' is-disabled' : ''}${invalid ? ' is-invalid' : ''}`}>
      <input
        id={id}
        className={`input date-field-input ${className}`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        maxLength={10}
        onFocus={() => { focused.current = true; }}
        onBlur={onBlur}
        onChange={e => commit(e.target.value)}
      />
      <button
        type="button"
        className="date-field-btn"
        onClick={openPicker}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Open calendar"
      >
        <CalendarDays size={15} />
      </button>
      <input
        ref={pickerRef}
        className="date-field-picker"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={e => { const v = e.target.value; setText(toDisplay(v)); setInvalid(false); if (v !== value) onChange(v); }}
      />
    </span>
  );
}
