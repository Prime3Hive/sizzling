import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Turnstile } from '@marsidev/react-turnstile';
import type { TurnstileInstance } from '@marsidev/react-turnstile';

// Use Cloudflare's always-pass test key if no real site key is configured
const TURNSTILE_SITE_KEY =
  import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [signInToken, setSignInToken] = useState('');
  const [signUpToken, setSignUpToken] = useState('');
  const signInRef = useRef<TurnstileInstance>(null);
  const signUpRef = useRef<TurnstileInstance>(null);
  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (!signInToken) {
      toast({ title: 'Security check required', description: 'Please complete the verification challenge.', variant: 'destructive' });
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await signIn(email, password);
      if (error) {
        toast({
          title: 'Sign in failed',
          description: error.message,
          variant: 'destructive',
        });
        signInRef.current?.reset();
        setSignInToken('');
      } else {
        toast({
          title: 'Signed in successfully',
          description: 'Welcome back! You are now logged in.',
        });
        setEmail('');
        setPassword('');
      }
    } catch (error) {
      toast({
        title: 'Authentication error',
        description: 'An unexpected error occurred during sign in.',
        variant: 'destructive',
      });
      signInRef.current?.reset();
      setSignInToken('');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (!signUpToken) {
      toast({ title: 'Security check required', description: 'Please complete the verification challenge.', variant: 'destructive' });
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await signUp(email, password, fullName);
      if (error) {
        toast({
          title: 'Account creation failed',
          description: error.message,
          variant: 'destructive',
        });
        signUpRef.current?.reset();
        setSignUpToken('');
      } else {
        toast({
          title: 'Account created successfully!',
          description: 'Please check your email and click the verification link to activate your account.',
        });
        setEmail('');
        setPassword('');
        setFullName('');
        signUpRef.current?.reset();
        setSignUpToken('');
      }
    } catch (error) {
      toast({
        title: 'Registration error',
        description: 'An unexpected error occurred during account creation.',
        variant: 'destructive',
      });
      signUpRef.current?.reset();
      setSignUpToken('');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-hero opacity-10"></div>
      <Card className="w-full max-w-md shadow-elegant bg-card/95 backdrop-blur-sm border-border/50 relative z-10">
        <CardHeader className="text-center pb-8">
          <CardTitle className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Sizzling Spices Portal
          </CardTitle>
          <CardDescription className="text-lg">
            Sign in to your staff portal
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="signin" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white">
                Sign In
              </TabsTrigger>
              <TabsTrigger value="signup" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white">
                Sign Up
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Turnstile
                  ref={signInRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={setSignInToken}
                  onExpire={() => setSignInToken('')}
                  onError={() => setSignInToken('')}
                  options={{ theme: 'auto', size: 'flexible' }}
                />
                <Button type="submit" className="w-full bg-gradient-primary hover:shadow-primary transition-all duration-300" disabled={isLoading || !signInToken}>
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="Enter your full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="Create a password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Turnstile
                  ref={signUpRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={setSignUpToken}
                  onExpire={() => setSignUpToken('')}
                  onError={() => setSignUpToken('')}
                  options={{ theme: 'auto', size: 'flexible' }}
                />
                <Button type="submit" className="w-full bg-gradient-primary hover:shadow-primary transition-all duration-300" disabled={isLoading || !signUpToken}>
                  {isLoading ? 'Creating account...' : 'Sign Up'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default Auth;