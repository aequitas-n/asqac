import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Activity, ArrowUpRight, Check, Circle, Hexagon, X } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { humanize } from '../lib/format';
import { NumberTicker } from './widgets/LiveText';
import { EmptyDrawing } from './Illustrations';
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <Hexagon size={29} />
        <Activity size={17} />
      </span>
      {!compact && (
        <span>
          <strong>
            ASQAC<span className="accent">.</span>
          </strong>
          <small>CAPSULE CARE CONNECT</small>
        </span>
      )}
    </div>
  );
}
export function Badge({ value, children }: { value: string; children?: ReactNode }) {
  return (
    <span className={`badge badge-${value}`}>
      <span className="badge-dot" />
      {children ?? humanize(value)}
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  action?: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="page-heading"
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div>
        <div className="eyebrow">
          <span />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </motion.div>
  );
}
export function Panel({
  title,
  kicker,
  action,
  children,
  className = '',
}: {
  title?: string;
  kicker?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      className={`panel ${className}`}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32 }}
    >
      {title && (
        <div className="panel-head">
          <div>
            {kicker && <div className="eyebrow">{kicker}</div>}
            <h2>{title}</h2>
          </div>
          {action}
        </div>
      )}
      {children}
    </motion.section>
  );
}
export function Empty({
  title = 'Waiting for capsule telemetry',
  description = 'Start the simulator or power the capsule to see sensor readings here.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-signal">
        <EmptyDrawing />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="skeleton-grid" aria-label="Loading workspace" role="status">
      {Array.from({ length: 6 }, (_, i) => (
        <div className={`skeleton ${i > 3 ? 'wide' : ''}`} key={i} />
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">CAPSULE CARE CONNECT</div>
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function Journey({
  state = 'registered',
  created,
  started,
  arrived,
  closed,
}: {
  state?: string;
  created?: string;
  started?: string | null;
  arrived?: string | null;
  closed?: string | null;
}) {
  const states = ['registered', 'prepared', 'in_transit', 'arrived', 'closed'];
  const index = states.indexOf(state);
  const dates = [created, null, started, arrived, closed];
  return (
    <ol className="journey">
      {states.map((s, i) => (
        <li key={s} className={i < index ? 'done' : i === index ? 'current' : ''}>
          <span className="journey-node">
            {i < index ? <Check size={13} /> : <Circle size={i === index ? 9 : 5} />}
          </span>
          <div>
            <strong>{humanize(s)}</strong>
            {dates[i] && (
              <small>
                {new Date(dates[i]!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </small>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function Stat({
  label,
  value,
  suffix,
  icon: Icon,
  foot,
  tone = 'teal',
  href,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  icon: typeof Activity;
  foot: string;
  tone?: string;
  href?: string;
}) {
  const numeric =
    (typeof value === 'string' || typeof value === 'number') && Number.isFinite(Number(value));
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        {href ? (
          <Link to={href} className="stat-arrow" aria-label={`View ${label.toLowerCase()}`}>
            <ArrowUpRight size={20} />
          </Link>
        ) : (
          <span className="stat-arrow">
            <Icon size={19} />
          </span>
        )}
      </div>
      <div className="stat-number">
        {numeric ? (
          <NumberTicker value={Number(value)} pad={typeof value === 'string' ? value.length : 0} />
        ) : (
          value
        )}
        <small>{suffix}</small>
      </div>
      <div className="stat-foot">
        <span />
        {foot}
      </div>
    </div>
  );
}
export function TextLink({ children }: { children: ReactNode }) {
  return (
    <span className="text-link">
      {children}
      <ArrowUpRight size={14} />
    </span>
  );
}
