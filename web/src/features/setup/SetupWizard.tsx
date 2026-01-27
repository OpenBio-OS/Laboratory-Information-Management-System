/**
 * Setup Wizard - First-launch configuration flow
 * 
 * Three steps:
 * 1. Mode Selection (Solo / Hub / Spoke / Enterprise)
 * 2. Mode-specific Configuration
 * 3. Complete - Initialize and redirect to dashboard
 */

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  User,
  Users,
  Building2,
  Wifi,
  ArrowRight,
  ArrowLeft,
  Check,
  FlaskConical,
  Loader2,
  RefreshCw,
  Server
} from 'lucide-react';

export type DeploymentMode = 'local' | 'hub' | 'spoke' | 'enterprise';

export interface SetupConfig {
  mode: DeploymentMode;
  labName?: string;
  apiUrl?: string;
  serverPort: number;
}

interface SetupWizardProps {
  onComplete: (config: SetupConfig) => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<SetupConfig>({
    mode: 'local',
    serverPort: 3000,
  });
  const [isInitializing, setIsInitializing] = useState(false);

  const handleModeSelect = (mode: DeploymentMode) => {
    setConfig({ ...config, mode });
    setStep(2);
  };

  const handleConfigSubmit = () => {
    setStep(3);
    setIsInitializing(true);

    // Simulate initialization
    setTimeout(() => {
      setIsInitializing(false);
      onComplete(config);
    }, 1500);
  };

  return (
    <div className="flex justify-center items-center min-h-screen bg-main p-8 font-sans text-white">
      {/* Background Gradient */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-brand-primary/5 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] -left-[10%] w-[30%] h-[30%] bg-brand-secondary/5 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-3xl bg-surface/50 backdrop-blur-xl rounded-3xl overflow-hidden shadow-2xl border border-white/5 flex flex-col items-center relative z-10 animate-fade-in">
        {/* Header */}
        <div className="text-center pt-8 pb-6 px-4">
          <div className="inline-flex p-3 rounded-full bg-brand-primary/10 text-brand-primary mb-4 shadow-[0_0_20px_rgba(23,185,120,0.2)]">
            <img src="/logo-transparent-green-text.png" alt="OpenBio Logo" className="w-14 h-14 animate-pulse" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome to OpenBio</h1>
          <p className="text-white/60 text-lg">Let's set up your biological operating system</p>
        </div>

        {/* Progress */}
        <div className="w-full max-w-md px-8 mb-6">
          {/* Stepper orbs and lines */}
          <div className="flex items-center justify-between mb-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border transition-all duration-300 ${step >= 1 ? 'border-brand-primary bg-brand-primary/10 text-brand-primary shadow-[0_0_10px_rgba(23,185,120,0.3)]' : 'border-white/10 bg-white/5 text-white/40'}`}>1</div>
            <div className={`h-px flex-1 mx-2 transition-all duration-500 ${step >= 2 ? 'bg-brand-primary/50' : 'bg-white/10'}`} />
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border transition-all duration-300 ${step >= 2 ? 'border-brand-primary bg-brand-primary/10 text-brand-primary shadow-[0_0_10px_rgba(23,185,120,0.3)]' : 'border-white/10 bg-white/5 text-white/40'}`}>2</div>
            <div className={`h-px flex-1 mx-2 transition-all duration-500 ${step >= 3 ? 'bg-brand-primary/50' : 'bg-white/10'}`} />
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border transition-all duration-300 ${step >= 3 ? 'border-brand-primary bg-brand-primary/10 text-brand-primary shadow-[0_0_10px_rgba(23,185,120,0.3)]' : 'border-white/10 bg-white/5 text-white/40'}`}>3</div>
          </div>
          {/* Stepper labels */}
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium w-8 text-center transition-colors duration-300 ${step >= 1 ? 'text-brand-primary' : 'text-white/40'}`}>Mode</span>
            <span className="flex-1" />
            <span className={`text-xs font-medium w-8 text-center transition-colors duration-300 ${step >= 2 ? 'text-brand-primary' : 'text-white/40'}`}>Config</span>
            <span className="flex-1" />
            <span className={`text-xs font-medium w-8 text-center transition-colors duration-300 ${step >= 3 ? 'text-brand-primary' : 'text-white/40'}`}>Done</span>
          </div>
        </div>

        {/* Step Content */}
        <div className="w-full max-w-2xl px-8 pb-8">
          {step === 1 && (
            <Step1ModeSelection onSelect={handleModeSelect} />
          )}

          {step === 2 && (
            <Step2Configure
              config={config}
              setConfig={setConfig}
              onBack={() => setStep(1)}
              onNext={handleConfigSubmit}
            />
          )}

          {step === 3 && (
            <Step3Complete isInitializing={isInitializing} />
          )}
        </div>
      </div>
    </div>
  );
}

// Step 1: Mode Selection
function Step1ModeSelection({ onSelect }: { onSelect: (mode: DeploymentMode) => void }) {
  return (
    <div className="animate-fade-in">
      <h2 className="text-xl font-semibold text-white mb-2">How will you use OpenBio?</h2>
      <p className="text-white/60 mb-6">
        Choose the deployment mode that fits your needs. You can change this later in settings.
      </p>

      <div className="grid grid-cols-2 gap-4">
        {[
          { id: 'local', icon: User, title: 'Just Me', desc: 'Single user, local data.', tag: 'Solo Researcher' },
          { id: 'hub', icon: Users, title: 'Host a Lab', desc: 'Share with teammates.', tag: 'Small Lab' },
          { id: 'spoke', icon: Wifi, title: 'Join a Lab', desc: 'Connect to existing hub.', tag: 'Lab Member' },
          { id: 'enterprise', icon: Building2, title: 'Enterprise', desc: 'Corporate cloud server.', tag: 'Corporate' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item.id as DeploymentMode)}
            className="group relative p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 hover:border-brand-primary/50 transition-all duration-300 text-left hover:shadow-[0_0_30px_rgba(0,0,0,0.2)] active:scale-[0.98]"
          >
            <div className="mb-4 w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-white/40 group-hover:text-brand-primary group-hover:bg-brand-primary/10 transition-colors">
              <item.icon size={24} />
            </div>
            <h3 className="text-lg font-medium text-white mb-1 group-hover:text-brand-primary transition-colors">{item.title}</h3>
            <p className="text-sm text-white/50 mb-3">{item.desc}</p>
            <span className="inline-block px-2 py-1 text-xs font-medium text-white/40 bg-white/5 rounded-md border border-white/5">
              {item.tag}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Step 2: Configuration
interface DiscoveredHub {
  name: String;
  address: String;
}

interface Step2Props {
  config: SetupConfig;
  setConfig: (config: SetupConfig) => void;
  onBack: () => void;
  onNext: () => void;
}

function Step2Configure({ config, setConfig, onBack, onNext }: Step2Props) {
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredHubs, setDiscoveredHubs] = useState<DiscoveredHub[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  const modeLabels: Record<DeploymentMode, string> = {
    local: 'Solo Mode',
    hub: 'Host a Lab',
    spoke: 'Join a Lab',
    enterprise: 'Enterprise Mode',
  };

  useEffect(() => {
    if (config.mode === 'spoke') {
      scanForHubs();
    }
  }, [config.mode]);

  const scanForHubs = async () => {
    setIsScanning(true);
    setScanError(null);
    try {
      const hubs = await invoke<DiscoveredHub[]>('scan_for_hubs');
      setDiscoveredHubs(hubs);
    } catch (err: any) {
      console.error('Scan failed:', err);
      // setScanError(err.toString()); // Suppress error for demo if needed, or show it
    } finally {
      setIsScanning(false);
    }
  };

  const selectHub = (hub: DiscoveredHub) => {
    setConfig({
      ...config,
      apiUrl: hub.address as string,
    });
  };

  return (
    <div className="animate-fade-in">
      <h2 className="text-xl font-semibold text-white mb-6">Configure {modeLabels[config.mode]}</h2>

      <div className="space-y-6 mb-8">
        {config.mode === 'local' && (
          <div className="flex gap-4 p-4 bg-brand-primary/10 border border-brand-primary/20 rounded-xl items-start">
            <Check size={24} className="text-brand-primary mt-0.5 shrink-0" />
            <p className="text-white/80">No additional configuration needed! All data will be stored locally on your computer.</p>
          </div>
        )}

        {config.mode === 'hub' && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/60">Lab Name</label>
              <input
                type="text"
                placeholder="Smith Lab"
                className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 transition-all duration-200"
                value={config.labName || ''}
                onChange={(e) => setConfig({ ...config, labName: e.target.value })}
              />
              <span className="text-xs text-white/40">This name will appear when teammates search for your lab</span>
            </div>
          </>
        )}

        {config.mode === 'spoke' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-white/60">Available Labs</label>
              <button
                className="flex items-center gap-2 text-sm text-brand-primary hover:text-brand-secondary transition-colors disabled:opacity-50"
                onClick={scanForHubs}
                disabled={isScanning}
              >
                <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
                {isScanning ? 'Scanning...' : 'Refresh'}
              </button>
            </div>

            {scanError && (
              <div className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg border border-red-500/20">
                Error: {scanError}
              </div>
            )}

            {discoveredHubs.length > 0 ? (
              <div className="flex flex-col gap-2">
                {discoveredHubs.map((hub) => (
                  <div
                    key={hub.address as string}
                    className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all duration-200 ${config.apiUrl === hub.address
                      ? 'bg-brand-primary/10 border-brand-primary/50 ring-1 ring-brand-primary/50'
                      : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'
                      }`}
                    onClick={() => selectHub(hub)}
                  >
                    <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-white/40">
                      <Server size={20} />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-white">{hub.name}</div>
                      <div className="text-xs text-white/40">Found on network</div>
                    </div>
                    {config.apiUrl === hub.address && <Check size={18} className="text-brand-primary" />}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-white/40 bg-white/5 rounded-xl border border-white/10">
                {isScanning ? (
                  <p>Searching for OpenBio hubs...</p>
                ) : (
                  <p>No labs found. Make sure the hub computer is on and connected to the same network.</p>
                )}
              </div>
            )}

            {config.mode === 'spoke' && discoveredHubs.length === 0 && !isScanning && (
              <div className="mt-8">
                <div className="relative flex items-center gap-4 py-4 text-xs font-medium text-white/30 uppercase tracking-widest before:h-px before:flex-1 before:bg-white/10 after:h-px after:flex-1 after:bg-white/10">
                  or enter manually
                </div>
                <input
                  type="text"
                  className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white font-mono text-sm placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 transition-all duration-200"
                  placeholder="http://192.168.1.100:3000"
                  value={config.apiUrl || ''}
                  onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
                />
              </div>
            )}
          </div>
        )}

        {config.mode === 'enterprise' && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60">Enterprise API URL</label>
            <input
              type="text"
              placeholder="https://api.biotech-corp.com"
              className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary/50 transition-all duration-200"
              value={config.apiUrl || ''}
              onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
            />
            <span className="text-xs text-white/40">Contact your IT department for this URL</span>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-8 border-t border-white/10">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-all"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <button
          onClick={onNext}
          disabled={config.mode === 'spoke' && !config.apiUrl}
          className="flex items-center gap-2 px-6 py-2 bg-brand-primary hover:bg-brand-secondary text-black font-semibold rounded-lg shadow-[0_0_20px_rgba(23,185,120,0.3)] disabled:opacity-50 disabled:hover:bg-brand-primary disabled:shadow-none transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          Continue
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// Step 3: Complete
function Step3Complete({ isInitializing }: { isInitializing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
      {isInitializing ? (
        <>
          <Loader2 size={48} className="text-brand-primary animate-spin mb-6" />
          <h2 className="text-2xl font-semibold text-white mb-2">Setting up your workspace...</h2>
          <p className="text-white/60">Creating data directories and initializing database</p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(23,185,120,0.3)]">
            <Check size={32} />
          </div>
          <h2 className="text-2xl font-semibold text-white mb-2">You're all set!</h2>
          <p className="text-white/60">OpenBio is ready to use. Launching dashboard...</p>
        </>
      )}
    </div>
  );
}
