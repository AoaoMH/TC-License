import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconName } from './Icon';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}) => (
  <button
    type="button"
    className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', !children && 'btn-icon-only', className)}
    disabled={disabled || loading}
    {...rest}
  >
    {loading ? <Spinner size={size === 'sm' ? 13 : 15} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
    {children ? <span className="btn-label">{children}</span> : null}
    {iconRight ? <Icon name={iconRight} size={size === 'sm' ? 14 : 16} /> : null}
  </button>
);

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'ghost' | 'solid' | 'danger';
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  size = 'sm',
  variant = 'ghost',
  className,
  ...rest
}) => (
  <button
    type="button"
    className={cx('btn-icon', `btn-icon-${size}`, `btn-icon-${variant}`, className)}
    aria-label={label}
    title={label}
    {...rest}
  >
    <Icon name={icon} size={size === 'xs' ? 13 : size === 'sm' ? 15 : 17} />
  </button>
);

/* ------------------------------------------------------------------ */
/* Form primitives                                                     */
/* ------------------------------------------------------------------ */

interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, hint, error, required, htmlFor, className, children }) => (
  <div className={cx('field', className)}>
    {label ? (
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="field-req">*</span> : null}
      </label>
    ) : null}
    {children}
    {error ? (
      <div className="field-hint field-hint-error">{error}</div>
    ) : hint ? (
      <div className="field-hint">{hint}</div>
    ) : null}
  </div>
);

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
  suffix?: React.ReactNode;
  invalid?: boolean;
}

export const Input: React.FC<InputProps> = ({ icon, suffix, invalid, className, ...rest }) => (
  <div className={cx('input-wrap', invalid && 'invalid', className)}>
    {icon ? <Icon className="input-icon" name={icon} size={15} /> : null}
    <input className={cx('input', icon && 'has-icon', suffix ? 'has-suffix' : '')} {...rest} />
    {suffix ? <span className="input-suffix">{suffix}</span> : null}
  </div>
);

interface NumberFieldProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  value,
  onChange,
  min = 0,
  max = 1000000,
  step = 1,
  suffix,
  id,
  disabled,
  className,
  placeholder,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string>(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(Number.isFinite(value) ? String(value) : '');
  }, [value]);

  const clamp = (n: number) => Math.min(Math.max(n, min), max);

  return (
    <div className={cx('number-field', className)}>
      <button
        type="button"
        className="number-step"
        tabIndex={-1}
        disabled={disabled || value <= min}
        aria-label="减少"
        onClick={() => onChange(clamp(Number((value - step).toFixed(4))))}
      >
        −
      </button>
      <input
        ref={inputRef}
        id={id}
        className="number-input"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={e => {
          const raw = e.target.value.replace(/[^\d.]/g, '');
          setDraft(raw);
          if (raw === '' || raw === '.') return;
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(clamp(n));
        }}
        onBlur={() => {
          focused.current = false;
          const n = Number(draft);
          const next = Number.isFinite(n) && draft !== '' ? clamp(n) : min;
          setDraft(String(next));
          onChange(next);
        }}
      />
      {suffix ? <span className="number-suffix">{suffix}</span> : null}
      <button
        type="button"
        className="number-step"
        tabIndex={-1}
        disabled={disabled || value >= max}
        aria-label="增加"
        onClick={() => onChange(clamp(Number((value + step).toFixed(4))))}
      >
        +
      </button>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  icon?: IconName;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  minWidth?: number;
  searchable?: boolean;
  ariaLabel?: string;
}

function clampLeft(left: number, width: number): number {
  const max = window.innerWidth - width - 12;
  return Math.max(12, Math.min(left, max));
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '请选择',
  id,
  disabled,
  size = 'md',
  className,
  minWidth = 0,
  searchable,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState('');
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const selected = options.find(o => o.value === value);
  const filtered = searchable && query.trim()
    ? options.filter(o => (o.label + ' ' + (o.hint || '')).toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, minWidth, 180);
    const estimated = Math.min(320, 44 + filtered.length * 40 + (searchable ? 44 : 0));
    const openUp = rect.bottom + estimated + 8 > window.innerHeight && rect.top > estimated;
    const top = openUp ? Math.max(8, rect.top - estimated - 6) : rect.bottom + 6;
    setStyle({ left: clampLeft(rect.left, width), top, width });
  }, [open, minWidth, filtered.length, searchable]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    setActive(options.findIndex(o => o.value === value));
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      if (e.target instanceof Node && anchorRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    if (searchable) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, value, options, searchable]);

  const commit = (idx: number) => {
    const opt = filtered[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    anchorRef.current?.focus();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      setActive(prev => {
        const start = prev < 0 ? (dir > 0 ? -1 : 0) : prev;
        return (start + dir + filtered.length) % filtered.length;
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (open) {
        e.preventDefault();
        commit(active);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        id={id}
        ref={anchorRef}
        className={cx('select-btn', `select-${size}`, open && 'open', !selected && 'placeholder', className)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(v => !v)}
        onKeyDown={handleKey}
      >
        {selected?.icon ? <Icon name={selected.icon} size={14} /> : null}
        <span className="select-value">{selected ? selected.label : placeholder}</span>
        <Icon name="chevron-down" size={14} className="select-caret" />
      </button>

      {open
        ? createPortal(
            <div
              ref={popRef}
              className="popover select-pop"
              style={style}
              role="listbox"
              tabIndex={-1}
              onKeyDown={handleKey}
            >
              {searchable ? (
                <div className="select-search">
                  <Icon name="search" size={14} />
                  <input
                    ref={searchRef}
                    value={query}
                    placeholder="搜索…"
                    onChange={e => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    onKeyDown={handleKey}
                  />
                </div>
              ) : null}
              <div className="select-options">
                {filtered.length === 0 ? (
                  <div className="select-empty">无匹配选项</div>
                ) : (
                  filtered.map((opt, idx) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={opt.value === value}
                      className={cx(
                        'select-option',
                        opt.value === value && 'selected',
                        idx === active && 'active',
                        opt.disabled && 'disabled'
                      )}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => commit(idx)}
                      disabled={opt.disabled}
                    >
                      {opt.icon ? <Icon name={opt.icon} size={15} /> : null}
                      <span className="select-option-text">
                        <span>{opt.label}</span>
                        {opt.hint ? <small>{opt.hint}</small> : null}
                      </span>
                      {opt.value === value ? <Icon name="check" size={14} className="select-check" /> : null}
                    </button>
                  ))
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Segmented control / switch / badge                                  */
/* ------------------------------------------------------------------ */

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: IconName }>;
  size?: 'sm' | 'md';
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md', className }: SegmentedProps<T>) {
  return (
    <div className={cx('segmented', `segmented-${size}`, className)} role="tablist">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={cx('segmented-item', opt.value === value && 'on')}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon ? <Icon name={opt.icon} size={14} /> : null}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, hint, disabled }) => (
  <label className={cx('switch-row', disabled && 'disabled')}>
    <span className={cx('switch', checked && 'on')}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="switch-thumb" />
    </span>
    {label || hint ? (
      <span className="switch-text">
        {label ? <span className="switch-label">{label}</span> : null}
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </span>
    ) : null}
  </label>
);

type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'info';

export const Badge: React.FC<{ tone?: BadgeTone; dot?: boolean; children: React.ReactNode; className?: string }> = ({
  tone = 'neutral',
  dot,
  children,
  className,
}) => (
  <span className={cx('badge', `badge-${tone}`, className)}>
    {dot ? <span className="badge-dot" /> : null}
    {children}
  </span>
);

/* ------------------------------------------------------------------ */
/* Spinner / empty state / page header                                 */
/* ------------------------------------------------------------------ */

export const Spinner: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />
);

export const EmptyState: React.FC<{
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon = 'list', title, description, action }) => (
  <div className="empty-state">
    <div className="empty-icon">
      <Icon name={icon} size={22} />
    </div>
    <div className="empty-title">{title}</div>
    {description ? <div className="empty-desc">{description}</div> : null}
    {action ? <div className="empty-action">{action}</div> : null}
  </div>
);

export const PageHeader: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: IconName;
}> = ({ title, subtitle, actions, icon }) => (
  <div className="page-head">
    <div className="page-head-main">
      {icon ? (
        <div className="page-head-icon">
          <Icon name={icon} size={20} />
        </div>
      ) : null}
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="page-sub">{subtitle}</div> : null}
      </div>
    </div>
    {actions ? <div className="page-actions">{actions}</div> : null}
  </div>
);

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: IconName;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  className?: string;
  bodyClassName?: string;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  width = 560,
  className,
  bodyClassName,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => panelRef.current?.focus(), 20);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="mask"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={cx('modal', className)}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="modal-head">
          <div className="modal-head-main">
            {icon ? (
              <div className="modal-head-icon">
                <Icon name={icon} size={18} />
              </div>
            ) : null}
            <div className="modal-titles">
              <h3>{title}</h3>
              {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
            </div>
          </div>
          <IconButton icon="x" label="关闭" size="sm" onClick={onClose} />
        </div>
        <div className={cx('modal-body', bodyClassName)}>{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
};

/* ------------------------------------------------------------------ */
/* Dropdown menu                                                       */
/* ------------------------------------------------------------------ */

export type MenuEntry =
  | { key?: string; separator: true }
  | {
      key?: string;
      label: string;
      icon?: IconName;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

interface MenuProps {
  trigger: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
  items: MenuEntry[];
  align?: 'start' | 'end';
  width?: number;
  header?: React.ReactNode;
}

export const Menu: React.FC<MenuProps> = ({ trigger, items, align = 'end', width = 208, header }) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const estimated = 16 + items.length * 36;
    const openUp = rect.bottom + estimated + 8 > window.innerHeight && rect.top > estimated;
    const left = align === 'end' ? rect.right - width : rect.left;
    setStyle({
      left: clampLeft(left, width),
      top: openUp ? Math.max(8, rect.top - estimated - 6) : rect.bottom + 6,
      width,
    });
  }, [open, align, width, items.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      if (e.target instanceof Node && anchorRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const cloned = React.cloneElement(trigger, {
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      trigger.props.onClick?.(e);
      setOpen(v => !v);
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
  } as any);

  return (
    <>
      <span ref={anchorRef} className="menu-anchor">
        {cloned}
      </span>
      {open
        ? createPortal(
            <div ref={popRef} className="popover menu-pop" style={style} role="menu">
              {header ? <div className="menu-header">{header}</div> : null}
              {items.map((item, idx) =>
                'separator' in item ? (
                  <div key={item.key ?? `sep-${idx}`} className="menu-sep" role="separator" />
                ) : (
                  <button
                    key={item.key ?? `item-${idx}`}
                    type="button"
                    role="menuitem"
                    className={cx('menu-item', item.danger && 'danger')}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false);
                      item.onSelect();
                    }}
                  >
                    {item.icon ? <Icon name={item.icon} size={15} /> : <span className="menu-icon-gap" />}
                    <span className="menu-label">
                      {item.label}
                      {item.hint ? <small>{item.hint}</small> : null}
                    </span>
                  </button>
                )
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
};
