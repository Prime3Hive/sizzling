import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Turnstile } from '@marsidev/react-turnstile';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import {
  Eye, EyeOff, Mail, Lock, User, ChevronLeft, CheckCircle2,
} from 'lucide-react';

type AuthMode = 'signin' | 'signup' | 'reset' | 'verify';

const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

const Auth = () => {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [isLoading, setIsLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [signInToken, setSignInToken] = useState('');
  const [signUpToken, setSignUpToken] = useState('');
  const signInRef = useRef<TurnstileInstance>(null);
  const signUpRef = useRef<TurnstileInstance>(null);

  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user) navigate('/');
  }, [user, navigate]);

  const switchMode = (m: AuthMode, keepEmail = false) => {
    setMode(m);
    if (!keepEmail) setEmail('');
    setPassword('');
    setConfirmPassword('');
    setFullName('');
    setResetSent(false);
    setShowPassword(false);
    setShowConfirm(false);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signInToken) {
      toast({ title: 'Security check required', description: 'Please complete the verification challenge.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await signIn(email, password);
      if (error) {
        if (error.message?.toLowerCase().includes('email not confirmed')) {
          switchMode('verify', true);
        } else {
          toast({ title: 'Sign in failed', description: error.message, variant: 'destructive' });
          signInRef.current?.reset();
          setSignInToken('');
        }
      }
    } catch {
      toast({ title: 'Authentication error', description: 'An unexpected error occurred.', variant: 'destructive' });
      signInRef.current?.reset();
      setSignInToken('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpToken) {
      toast({ title: 'Security check required', description: 'Please complete the verification challenge.', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', description: 'Please ensure both passwords are identical.', variant: 'destructive' });
      return;
    }
    if (password.length < 6) {
      toast({ title: 'Password too short', description: 'Password must be at least 6 characters.', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await signUp(email, password, fullName);
      if (error) {
        toast({ title: 'Account creation failed', description: error.message, variant: 'destructive' });
        signUpRef.current?.reset();
        setSignUpToken('');
      } else {
        switchMode('verify', true);
      }
    } catch {
      toast({ title: 'Registration error', description: 'An unexpected error occurred.', variant: 'destructive' });
      signUpRef.current?.reset();
      setSignUpToken('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    setIsLoading(false);
    if (error) {
      toast({ title: 'Reset failed', description: error.message, variant: 'destructive' });
    } else {
      setResetSent(true);
    }
  };

  const handleResendVerification = async () => {
    setResendLoading(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    setResendLoading(false);
    if (error) {
      toast({ title: 'Could not resend', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Email resent', description: 'A new verification link has been sent.' });
    }
  };

  const PasswordToggle = ({ show, onToggle }: { show: boolean; onToggle: () => void }) => (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      tabIndex={-1}
    >
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  const features = [
    'Real-time business analytics & reporting',
    'Staff payroll and HR management',
    'Inventory tracking and KPI monitoring',
  ];

  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1fr] bg-background">

      {/* ── Left brand panel (desktop only) ── */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-primary via-primary/85 to-primary/60 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl p-1.5 backdrop-blur-sm shrink-0">
            <img src="/favicon.png" alt="Sizzling Spices Logo" className="w-full h-full object-contain" />
          </div>
          <span className="text-xl font-bold tracking-tight">Sizzling Spices</span>
        </div>

        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold leading-tight">
              Your Staff Portal,<br />All in One Place.
            </h1>
            <p className="text-white/75 text-lg mt-3 leading-relaxed">
              Manage payroll, expenses, staff records, and business operations from a single unified platform.
            </p>
          </div>
          <ul className="space-y-3">
            {features.map(f => (
              <li key={f} className="flex items-center gap-3 text-white/85">
                <CheckCircle2 className="h-5 w-5 text-white/60 shrink-0" />
                <span className="text-sm">{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-white/40 text-xs">© {new Date().getFullYear()} Sizzling Spices. All rights reserved.</p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex items-center justify-center px-6 py-12 sm:px-10 bg-background">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 bg-gradient-primary rounded-xl p-1 shrink-0">
              <img src="/favicon.png" alt="Sizzling Spices Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-lg font-bold bg-gradient-primary bg-clip-text text-transparent">
              Sizzling Spices Portal
            </span>
          </div>

          {/* ── SIGN IN ── */}
          {mode === 'signin' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Welcome back</h2>
                <p className="text-muted-foreground mt-1 text-sm">Sign in to your staff account</p>
              </div>

              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="signin-password">Password</Label>
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="signin-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-9 pr-10"
                      required
                    />
                    <PasswordToggle show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                  </div>
                </div>

                <Turnstile
                  ref={signInRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={setSignInToken}
                  onExpire={() => setSignInToken('')}
                  onError={() => setSignInToken('')}
                  options={{ theme: 'auto', size: 'flexible' }}
                />

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-primary hover:shadow-primary transition-all duration-300 font-medium"
                  disabled={isLoading || !signInToken}
                >
                  {isLoading ? 'Signing in…' : 'Sign In'}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="text-primary font-medium hover:underline"
                >
                  Create one
                </button>
              </p>
            </div>
          )}

          {/* ── SIGN UP ── */}
          {mode === 'signup' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Create account</h2>
                <p className="text-muted-foreground mt-1 text-sm">Join the Sizzling Spices staff portal</p>
              </div>

              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="signup-name"
                      type="text"
                      placeholder="John Doe"
                      value={fullName}
                      onChange={e => setFullName(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email address</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="pl-9"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Min. 6 characters"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-9 pr-10"
                      required
                    />
                    <PasswordToggle show={showPassword} onToggle={() => setShowPassword(!showPassword)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-confirm">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="signup-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Repeat your password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="pl-9 pr-10"
                      required
                    />
                    <PasswordToggle show={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} />
                  </div>
                </div>

                <Turnstile
                  ref={signUpRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={setSignUpToken}
                  onExpire={() => setSignUpToken('')}
                  onError={() => setSignUpToken('')}
                  options={{ theme: 'auto', size: 'flexible' }}
                />

                <Button
                  type="submit"
                  className="w-full h-11 bg-gradient-primary hover:shadow-primary transition-all duration-300 font-medium"
                  disabled={isLoading || !signUpToken}
                >
                  {isLoading ? 'Creating account…' : 'Create Account'}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="text-primary font-medium hover:underline"
                >
                  Sign in
                </button>
              </p>
            </div>
          )}

          {/* ── VERIFY EMAIL ── */}
          {mode === 'verify' && (
            <div className="space-y-6">
              <div className="text-center space-y-5 py-4">
                <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <Mail className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Check your email</h2>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    We sent a verification link to{' '}
                    <span className="font-semibold text-foreground">{email}</span>.
                    Click the link in that email to activate your account.
                  </p>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-xs text-amber-800 space-y-1">
                  <p className="font-semibold">Didn't receive it?</p>
                  <p>Check your spam or junk folder. The link expires after 24 hours.</p>
                </div>

                <Button
                  className="w-full h-11"
                  onClick={handleResendVerification}
                  disabled={resendLoading}
                  variant="outline"
                >
                  {resendLoading ? 'Sending…' : 'Resend verification email'}
                </Button>

                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className="text-sm text-primary font-medium hover:underline"
                >
                  Back to Sign In
                </button>
              </div>
            </div>
          )}

          {/* ── PASSWORD RESET ── */}
          {mode === 'reset' && (
            <div className="space-y-6">
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to sign in
              </button>

              {resetSent ? (
                <div className="text-center space-y-5 py-4">
                  <div className="mx-auto w-16 h-16 bg-success/10 rounded-full flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-success" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">Check your email</h2>
                    <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                      A password reset link has been sent to{' '}
                      <span className="font-medium text-foreground">{email}</span>.
                      Follow the link to create a new password.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => switchMode('signin')}
                  >
                    Back to Sign In
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-2xl font-bold text-foreground">Reset password</h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Enter your email and we'll send you a reset link.
                    </p>
                  </div>

                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reset-email">Email address</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="reset-email"
                          type="email"
                          placeholder="you@company.com"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          className="pl-9"
                          required
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-11 bg-gradient-primary hover:shadow-primary transition-all duration-300 font-medium"
                      disabled={isLoading}
                    >
                      {isLoading ? 'Sending…' : 'Send Reset Link'}
                    </Button>
                  </form>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Auth;
