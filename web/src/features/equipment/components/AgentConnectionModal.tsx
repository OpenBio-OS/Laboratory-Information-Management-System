import { useState, useEffect } from 'react';
import { X, Wifi, Monitor, Building2, Network, Loader2 } from 'lucide-react';

type ConnectionMode = 'local' | 'mdns' | 'enterprise';

interface AgentConnectionModalProps {
  onClose: () => void;
  onConnect: (mode: ConnectionMode, ipAddress?: string) => Promise<void>;
}

export function AgentConnectionModal({ onClose, onConnect }: AgentConnectionModalProps) {
  const [selectedMode, setSelectedMode] = useState<ConnectionMode | null>(null);
  const [ipAddress, setIpAddress] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isConnecting) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, isConnecting]);

  const handleConnect = async () => {
    if (!selectedMode) return;

    if (selectedMode === 'enterprise') {
      // Validate IP address
      const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipAddress || !ipPattern.test(ipAddress)) {
        setError('Please enter a valid IP address');
        return;
      }

      // Validate each octet
      const octets = ipAddress.split('.');
      if (octets.some(octet => parseInt(octet) > 255)) {
        setError('Invalid IP address: octets must be between 0-255');
        return;
      }
    }

    setIsConnecting(true);
    setError('');

    try {
      await onConnect(selectedMode, selectedMode === 'enterprise' ? ipAddress : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to agent');
      setIsConnecting(false);
    }
  };

  const modes = [
    {
      id: 'local' as ConnectionMode,
      icon: Monitor,
      title: 'This PC',
      description: 'Detect agent running on this computer',
      detail: 'Use to start an agent on this machine'
    },
    {
      id: 'mdns' as ConnectionMode,
      icon: Wifi,
      title: 'WiFi/LAN',
      description: 'Discover agents on your network',
      detail: 'Automatically finds agents using mDNS'
    },
    {
      id: 'enterprise' as ConnectionMode,
      icon: Building2,
      title: 'Enterprise',
      description: 'Connect via IP address',
      detail: 'For remote or enterprise deployments'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-neutral-900 border border-white/10 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-2">
            <Network size={20} className="text-brand-primary" />
            <h3 className="text-lg text-white">Connect to Agent</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
            disabled={isConnecting}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-white/60">
            Select how you want to connect to the openbio-agent for this equipment:
          </p>

          {/* Connection Modes */}
          <div className="grid gap-3">
            {modes.map((mode) => {
              const Icon = mode.icon;
              const isSelected = selectedMode === mode.id;

              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    setSelectedMode(mode.id);
                    setError('');
                  }}
                  disabled={isConnecting}
                  className={`
                                        w-full p-4 rounded-lg border-2 text-left transition-all
                                        ${isSelected
                      ? 'border-brand-primary bg-brand-primary/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                    }
                                        ${isConnecting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                                    `}
                >
                  <div className="flex items-start gap-3">
                    <div className={`
                                            p-2 rounded-lg 
                                            ${isSelected ? 'bg-brand-primary/20' : 'bg-white/10'}
                                        `}>
                      <Icon
                        size={20}
                        className={isSelected ? 'text-brand-primary' : 'text-white/60'}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="text-white mb-1">
                        {mode.title}
                      </div>
                      <div className="text-sm text-white/60">
                        {mode.description}
                      </div>
                      <div className="text-xs text-white/40 mt-1">
                        {mode.detail}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* IP Address Input for Enterprise Mode */}
          {selectedMode === 'enterprise' && (
            <div className="space-y-2 pt-2">
              <label className="text-sm font-medium text-white/80">
                IP Address
              </label>
              <input
                type="text"
                value={ipAddress}
                onChange={(e) => {
                  setIpAddress(e.target.value);
                  setError('');
                }}
                placeholder="192.168.1.100"
                className="w-full px-4 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-white/30 focus:outline-none focus:border-brand-primary/50 focus:ring-1 focus:ring-brand-primary/50"
                disabled={isConnecting}
                autoFocus
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex justify-between items-center bg-white/5">
          <button
            onClick={onClose}
            disabled={isConnecting}
            className="px-4 py-2 text-sm text-white/40 hover:text-white transition-all hover:bg-white/5 rounded-lg disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConnect}
            disabled={!selectedMode || isConnecting}
            className="px-6 py-2 bg-brand-primary text-black text-sm font-semibold rounded-lg hover:bg-brand-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(23,185,120,0.2)]"
          >
            {isConnecting && <Loader2 size={16} className="animate-spin" />}
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
