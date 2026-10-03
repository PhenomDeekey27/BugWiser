'use client';

import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LocalProviderConnectForm } from './LocalProviderConnectForm';
import { createConnectGate } from './connectState';
import type { CatalogProvider } from '@/app/models/page';

interface ProviderCardProps {
  provider: CatalogProvider;
  onConnect: (providerId: string, apiKey: string, options?: { baseUrl?: string }) => Promise<void>;
  onDisconnect: (providerId: string) => Promise<void>;
  modelCount?: number;
}

const AUTH_LABEL: Record<string, string> = {
  api_key: 'API key',
  oauth: 'OAuth',
  none: 'None',
};

export function ProviderCard({ provider, onConnect, onDisconnect, modelCount }: ProviderCardProps) {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyDisconnect, setBusyDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same single-flight latch as the local connect form: two clicks before the
  // re-render must not fire two disconnect requests.
  const disconnectGate = useRef(createConnectGate());

  const connected = provider.status === 'connected';
  const disabled = provider.disabled === true;
  const authType = provider.authType || 'api_key';
  // A server-env credential exists ⇒ keyless Connect/Enable/Reconnect is
  // available; no credential exists ⇒ only the "paste your key" flow.
  const serverEnvCapable = provider.serverConfigured;
  const sourceLabel =
    provider.connectionSource === 'user' || (!provider.connectionSource && !provider.serverConfigured)
      ? 'Your key'
      : 'Server available';

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

  // Keyless server-env connect/enable/reconnect: submits an empty key — the
  // server validates with its own credential and stores a keyless connected
  // row (which clears a disabled tombstone). Nothing key-shaped is handled in
  // the browser.
  const handleServerConnect = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConnect(provider.providerId, '');
      setShowKey(false);
    } catch (e) {
      setError((e as Error).message || 'Connection failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectGate.current.tryBegin()) return;
    setBusyDisconnect(true);
    try {
      await onDisconnect(provider.providerId);
    } catch {
      // The parent surfaces the error; the card just stops showing progress.
    } finally {
      setBusyDisconnect(false);
      disconnectGate.current.end();
    }
  };

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-bw-peach-light">{provider.displayName}</h3>
          <p className="text-xs text-bw-peach font-mono mt-0.5">{provider.providerId}</p>
        </div>
        <Badge variant={connected ? 'default' : 'outline'}>
          {connected ? 'Connected' : disabled ? 'Disabled' : 'Disconnected'}
        </Badge>
      </div>

      <p className="text-xs text-bw-peach leading-relaxed">{provider.description}</p>

      <div className="flex items-center gap-2 text-xs text-bw-peach">
        <span className="font-mono uppercase tracking-wider">Auth</span>
        <Badge variant="outline">{AUTH_LABEL[authType] || authType}</Badge>
        {provider.serverConfigured && <Badge variant="secondary">Server env</Badge>}
      </div>

      {disabled && (
        <p className="text-[11px] font-mono text-bw-peach/70">
          Disabled for your account
          {serverEnvCapable ? ' — server credentials available on reconnect' : ''}
        </p>
      )}

      {typeof modelCount === 'number' && (
        <p className="text-xs text-bw-peach font-mono">{modelCount} models</p>
      )}

      {connected ? (
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-xs text-bw-peach">{sourceLabel}</span>
            {provider.providerId === 'local' && provider.baseUrl && (
              <span className="text-[11px] font-mono text-bw-peach truncate" title={provider.baseUrl}>
                {provider.baseUrl}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            disabled={busyDisconnect}
            className="border-border cursor-pointer"
          >
            {busyDisconnect ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </div>
      ) : provider.providerId === 'local' ? (
        <LocalProviderConnectForm provider={provider} onConnect={onConnect} />
      ) : authType === 'api_key' ? (
        <div className="space-y-2">
          {!showKey ? (
            <div className="flex flex-col gap-2 items-start">
              {error && <p className="text-xs text-error-default">{error}</p>}
              {serverEnvCapable ? (
                <>
                  <Button
                    size="sm"
                    className="w-full btn-bw-primary font-medium cursor-pointer"
                    onClick={handleServerConnect}
                    disabled={saving}
                  >
                    {saving ? (disabled ? 'Enabling...' : 'Connecting...') : disabled ? 'Reconnect' : 'Connect'}
                  </Button>
                  <button
                    type="button"
                    className="text-[11px] text-bw-peach/70 underline-offset-2 hover:underline cursor-pointer"
                    onClick={() => {
                      setError(null);
                      setShowKey(true);
                    }}
                  >
                    Use my own API key
                  </button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="w-full btn-bw-primary font-medium cursor-pointer"
                  onClick={() => {
                    setError(null);
                    setShowKey(true);
                  }}
                >
                  Connect
                </Button>
              )}
            </div>
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
