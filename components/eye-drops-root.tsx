'use client';
import AuthGate from './auth-gate';
import EyeDropsApp from './eye-drops-app';
import { cloudConfigured } from '../lib/supabase';
export default function EyeDropsRoot(){return cloudConfigured()?<AuthGate>{id=><EyeDropsApp key={id} cloud/>}</AuthGate>:<EyeDropsApp/>;}
