import { Suspense, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  CircleHelp,
  Cpu,
  FileBarChart2,
  FlaskConical,
  LayoutGrid,
  LogOut,
  Menu,
  Plus,
  Search,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { Brand, Modal, Skeleton } from '../ui';
import { RecoveryBoundary } from '../RecoveryBoundary';
import { useAuth } from '../../hooks/useAuth';
import { useData } from '../../hooks/useData';
import { useClock } from '../../hooks/useClock';
import { Simulator } from '../Simulator';
const navigation = [
  { to: '/dashboard', label: 'Overview', icon: LayoutGrid },
  { to: '/capsules', label: 'Capsules', icon: Box },
  { to: '/register', label: 'Register', icon: Plus },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/reports', label: 'Reports', icon: FileBarChart2 },
  { to: '/hardware', label: 'Hardware', icon: Cpu },
];
export default function Shell() {
  const { profile, preview, signOut, error: accessError, retryProfile } = useAuth();
  const { realtime, alerts, error, refresh, capsules, transports, specimens } = useData();
  const now = useClock();
  const location = useLocation();
  const [mobile, setMobile] = useState(() => window.innerWidth <= 900);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [simRequest, setSimRequest] = useState(0);
  const [simulated, setSimulated] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const open = alerts.filter((a) => !a.acknowledged).length;
  const role = profile?.role;
  const name = profile?.full_name || 'Setup preview';
  const allowed = navigation.filter(
    (n) => n.to !== '/register' || role === 'technician' || role === 'admin' || preview,
  );
  useEffect(() => {
    const media = window.matchMedia('(max-width:900px)');
    const resize = () => {
      setMobile(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    media.addEventListener('change', resize);
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuOpen(false);
        setSearchOpen((v) => !v);
      }
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', shortcut);
    return () => {
      media.removeEventListener('change', resize);
      document.removeEventListener('keydown', shortcut);
    };
  }, []);
  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    navRef.current?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = navRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)');
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === navRef.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [menuOpen, mobile]);
  const searchResults = [
    ...allowed.map((n) => ({ to: n.to, label: n.label, detail: 'Workspace page', icon: n.icon })),
    ...capsules.map((c) => ({
      to: `/capsules/${c.id}`,
      label: c.code,
      detail: c.label,
      icon: Box,
    })),
    ...transports.map((t) => ({
      to: `/reports/${t.id}`,
      label: t.transport_code,
      detail: specimens.find((s) => s.id === t.specimen_id)?.specimen_code ?? 'Transport record',
      icon: FileBarChart2,
    })),
  ]
    .filter((r) => `${r.label} ${r.detail}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {mobile && menuOpen && (
        <button
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      {(!mobile || menuOpen) && (
        <aside
          className={`nav-rail ${mobile ? 'nav-drawer' : ''}`}
          ref={navRef}
          tabIndex={-1}
          aria-label="Workspace navigation"
        >
          <div className="sidebar-brand-row">
            <Link
              to="/dashboard"
              className="rail-brand"
              aria-label="ASQAC overview"
              onClick={() => setMenuOpen(false)}
            >
              <Brand />
            </Link>
            {mobile && (
              <button
                className="icon-button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              >
                <X size={19} />
              </button>
            )}
          </div>
          <span className="rail-section">MENU</span>
          <nav aria-label="Main navigation">
            {allowed
              .filter((n) => n.to !== '/hardware')
              .map(({ to, label, icon: Icon }) => (
                <NavLink
                  to={to}
                  key={to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => `rail-link ${isActive ? 'selected' : ''}`}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                  {to === '/alerts' && <i className="rail-counter">{open}</i>}
                </NavLink>
              ))}
          </nav>
          <span className="rail-section general-label">GENERAL</span>
          <nav aria-label="General navigation">
            <NavLink
              to="/hardware"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `rail-link ${isActive ? 'selected' : ''}`}
            >
              <Cpu size={19} />
              <span>Hardware</span>
            </NavLink>
            <NavLink to="/setup" onClick={() => setMenuOpen(false)} className="rail-link">
              <CircleHelp size={19} />
              <span>Connection guide</span>
            </NavLink>
            <button
              className="rail-link"
              onClick={() => void signOut().catch((e) => toast.error(e.message))}
            >
              <LogOut size={19} />
              <span>Sign out</span>
            </button>
          </nav>
          <div className="rail-bottom">
            <button
              className="sidebar-simulator"
              onClick={() => {
                setMenuOpen(false);
                setSimRequest((n) => n + 1);
              }}
            >
              <FlaskConical size={21} />
              <span>
                <strong>Simulator</strong>
                <small>{simulated ? 'Running' : 'Open simulator'}</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          </div>
        </aside>
      )}
      <div className="main-shell">
        <header className="topbar">
          {mobile && (
            <button
              className="icon-button menu-toggle"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={21} />
            </button>
          )}
          <button className="workspace-search" onClick={() => setSearchOpen(true)}>
            <Search size={19} />
            <span>Search capsules, records…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="topbar-right">
            <Link to="/setup" className="top-icon" aria-label="Connection help">
              <CircleHelp size={19} />
            </Link>
            <Link
              to="/alerts"
              className="top-icon notification-button"
              aria-label={`Notifications, ${open} open alerts`}
            >
              <Bell size={20} />
              {open > 0 && <span />}
            </Link>
            <div className="staff">
              <span className="avatar">
                {name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <span>
                <strong>{name}</strong>
                <small>{profile?.email ?? 'Connect your workspace'}</small>
              </span>
            </div>
          </div>
        </header>
        <div className="workspace-status">
          <span className={`connection-label ${realtime === 'Connected' ? 'connected' : ''}`}>
            {realtime === 'Connected' ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span>
              {preview
                ? 'SETUP MODE'
                : realtime === 'Connected'
                  ? 'LIVE TELEMETRY'
                  : realtime.toUpperCase()}
            </span>
          </span>
          <span className="status-divider" />
          <span className="status-role">{role ?? 'Read-only preview'}</span>
          <span className="top-clock">
            {new Date(now).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata' })}
            <small> IST</small>
          </span>
          <Simulator openRequest={simRequest} onRunningChange={setSimulated} />
        </div>
        {preview && (
          <div className="setup-banner">
            <Activity size={16} />
            <span>
              <strong>Connect your workspace.</strong> Add your Supabase configuration to activate
              live capsule data.
            </span>
            <Link to="/setup">
              Setup guide
              <ArrowRight size={14} />
            </Link>
          </div>
        )}
        {accessError && (
          <div className="error-banner" role="alert">
            {accessError}
            <button onClick={retryProfile}>Retry connection</button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          aria-label={allowed.find((n) => location.pathname.startsWith(n.to))?.label ?? 'Workspace'}
        >
          <RecoveryBoundary key={location.pathname}>
            <Suspense fallback={<Skeleton />}>
              <Outlet />
            </Suspense>
          </RecoveryBoundary>
        </main>
        <footer className="app-footer">
          <span>ASQAC · Capsule Care Connect</span>
        </footer>
      </div>
      {searchOpen && (
        <Modal title="Search your workspace" onClose={() => setSearchOpen(false)}>
          <label className="command-input">
            <Search size={19} />
            <input
              autoFocus
              aria-label="Search workspace"
              placeholder="Capsule, transport or page…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>Esc</kbd>
          </label>
          <div className="command-results">
            {searchResults.map((r) => (
              <Link key={`${r.to}-${r.label}`} to={r.to} onClick={() => setSearchOpen(false)}>
                <span>
                  <r.icon size={18} />
                </span>
                <div>
                  <strong>{r.label}</strong>
                  <small>{r.detail}</small>
                </div>
                <ArrowUpRight size={15} />
              </Link>
            ))}
            {!searchResults.length && (
              <p className="muted">No matching records. Try a capsule code or page name.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
