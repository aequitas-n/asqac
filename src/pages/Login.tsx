import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Navigate, useNavigate } from 'react-router-dom';
import { Brand } from '../components/ui';
import { configured, supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { CapsuleDrawing } from '../components/Illustrations';
export default function Login() {
  const { user, loading, enterPreview, error: accessError, retryProfile } = useAuth();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (user && !loading) return <Navigate to="/dashboard" replace />;
  async function login(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError('Add your Supabase credentials to .env, then restart the development server.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      navigate('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="hero-grid" />
        <Brand />
        <div className="hero-main">
          <div className="eyebrow">
            <span className="live-dot" />
            INTELLIGENCE IN TRANSIT
          </div>
          <h1>
            {'Chain-of-custody you can hand to an auditor.'.split(' ').map((word, i) => (
              <motion.span
                key={i}
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.045, duration: 0.4 }}
              >
                {word}{' '}
              </motion.span>
            ))}
          </h1>
          <p>
            From the ward to the laboratory.
            <br />
            Every degree. Every movement. Every handoff.
          </p>
          <div className="hero-capsule-wrap">
            <CapsuleDrawing className="capsule-drawing" />
            <span className="illustration-caption">
              ADAPTIVE SPECIMEN QUALITY ASSURANCE CAPSULE · CONCEPT VIEW
            </span>
          </div>
        </div>
        <div className="hero-bottom">
          <ShieldCheck size={17} />
          <span>Designed around specimen integrity.</span>
          <svg viewBox="0 0 210 28" aria-hidden="true">
            <path d="M0 14H40L45 9L50 19L58 3L66 25L73 14H112L117 11L124 18L132 5L140 22L146 14H210" />
          </svg>
        </div>
      </section>
      <section className="login-form-side">
        <div className="auth-top">
          <span>UNIVERSITY BIOMEDICAL ENGINEERING</span>
          <span>RESEARCH PLATFORM / 01</span>
        </div>
        <div className="auth-card">
          <span className="auth-icon">
            <Fingerprint size={29} />
          </span>
          <div className="eyebrow">YOUR CARE WORKSPACE</div>
          <h2>
            Welcome back<span className="accent">.</span>
          </h2>
          <p>Sign in to keep every specimen accounted for.</p>
          <form onSubmit={login}>
            <label className="field">
              Staff email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@hospital.org"
                required
                autoComplete="username"
              />
            </label>
            <label className="field">
              Password
              <div className="password-input">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  aria-label={show ? 'Hide password' : 'Show password'}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {(error || accessError) && (
              <div className="field-error" role="alert">
                {error || accessError}
                {accessError && (
                  <button type="button" className="button secondary small" onClick={retryProfile}>
                    Retry connection
                  </button>
                )}
              </div>
            )}
            <button className="button primary auth-submit" disabled={busy || loading}>
              {busy ? 'Signing in…' : 'Enter workspace'}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="auth-security">
            <LockKeyhole size={13} /> Role-based access · Secure staff sign-in
          </div>
          <div className="demo-hint">
            <strong>Presenting the project?</strong>
            <p>Demo accounts are provisioned during setup.</p>
            <span>technician@asqac.test</span>
            <span>doctor@asqac.test</span>
          </div>
          {!configured && (
            <button
              className="preview-link"
              onClick={() => {
                enterPreview();
                navigate('/dashboard');
              }}
            >
              Explore the interface before connecting <ArrowRight size={14} />
            </button>
          )}
        </div>
        <div className="auth-bottom">
          <span>ASQAC · CAPSULE CARE CONNECT</span>
          <span>Care travels with the specimen.</span>
        </div>
      </section>
    </div>
  );
}
