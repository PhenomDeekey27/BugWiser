'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CatalogProvider } from '@/app/models/page';

interface ProviderCardProps {
  provider: CatalogProvider;
  onConnect: (providerId: string, apiKey: string) => Promise<void>;
  onDisconnect: (providerId: string) => Promise<void>;
}

const AUTH_LABEL: Record<string, string> = {
  api_key: 'API key',
  oauth: 'OAuth',
  none: 'None',
};

export function ProviderCard({ provider, onConnect, onDisconnect }: ProviderCardProps) {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyDisconnect, setBusyDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = provider.status === 'connected';
  const authType = provider.authType || 'api_key';

  const handleConnect = async () => {
    if (authType !== 'api_key') return;
    setSaving(true);
    setError(null);
    try {
      await onConnect(provider.providerId, apiKey);
      setApiKey('');
      setShowKey(false);
    } catch (e) {
      setError((e as Error).message || 'Connection failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setBusyDisconnect(true);
    try {
      await onDisconnect(provider.providerId);
    } finally {
      setBusyDisconnect(false);
    }
  };

  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-bw-peach-light">{provider.displayName}</h3>
          <p className="text-xs text-bw-peach font-mono mt-0.5">{provider.providerId}</p>
        </div>
        <Badge variant={connected ? 'default' : 'outline'}>
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
      </div>

      <p className="text-xs text-bw-peach leading-relaxed">{provider.description}</p>

      <div className="flex items-center gap-2 text-xs text-bw-peach">
        <span className="font-mono uppercase tracking-wider">Auth</span>
        <Badge variant="outline">{AUTH_LABEL[authType] || authType}</Badge>
        {provider.serverConfigured && <Badge variant="secondary">Server env</Badge>}
      </div>

      {connected ? (
        <div className="flex items-center justify-between">
          <span className="text-xs text-bw-peach">{provider.serverConfigured ? 'Configured via server' : 'Your key'}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={busyDisconnect}
            className="border-border text-bw-peach"
          >
            {busyDisconnect ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </div>
      ) : authType === 'api_key' ? (
        <div className="space-y-2">
          {!showKey ? (
            <Button size="sm" className="w-full btn-bw-primary font-medium" onClick={() => setShowKey(true)}>
              Connect
            </Button>
          ) : (
            <>
              <Input
                type="password"
                placeholder="Paste your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                aria-label={`${provider.displayName} API key`}
              />
              {error && <p className="text-xs text-error-default">{error}</p>}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1 btn-bw-primary font-medium" onClick={handleConnect} disabled={saving}>
                  {saving ? 'Validating...' : 'Save key'}
                </Button>
                <Button size="sm" variant="outline" className="border-border text-bw-peach" onClick={() => setShowKey(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-bw-peach">
          {authType === 'oauth' ? 'OAuth flow not yet wired — connect a key or configure server-side.' : 'No credentials required.'}
        </p>
      )}
    </div>
  );
}