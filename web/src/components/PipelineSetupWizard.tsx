// Pipeline Environment Setup Wizard
// Handles first-time installation of Nextflow + Java via micromamba.
// Uses a ref to prevent duplicate setup calls on React remounts.

import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface SetupProgress {
  stage: string;
  message: string;
  progress: number;
}

interface PipelineSetupWizardProps {
  onComplete: () => void;
}

export function PipelineSetupWizard({ onComplete }: PipelineSetupWizardProps) {
  const [stage, setStage] = useState<'installing' | 'docker-check' | 'complete' | 'error'>('installing');
  const [progress, setProgress] = useState<SetupProgress>({
    stage: 'init',
    message: 'Preparing pipeline environment...',
    progress: 0,
  });
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate setup calls (React strict mode / remounts)
  const setupStarted = useRef(false);

  useEffect(() => {
    if (setupStarted.current) return;
    setupStarted.current = true;

    console.log('[SetupWizard] mounting, setting up event listener');
    const unlistenPromise = listen<SetupProgress>('pipeline-setup-progress', (event) => {
      console.log('[SetupWizard] got progress event:', event.payload);
      setProgress(event.payload);
    });

    runSetup();

    return () => {
      console.log('[SetupWizard] unmounting, removing event listener');
      unlistenPromise.then(fn => fn());
    };
  }, []);

  const runSetup = async () => {
    try {
      setStage('installing');
      setError(null);

      console.log('[SetupWizard] calling setup_pipeline_environment...');
      await invoke('setup_pipeline_environment');
      console.log('[SetupWizard] setup_pipeline_environment returned OK');

      // Setup succeeded — check Docker
      await checkDocker();
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Unknown error';
      console.error('[SetupWizard] setup_pipeline_environment FAILED:', msg);

      if (msg.includes('__ALREADY_IN_PROGRESS__')) {
        console.log('[SetupWizard] another setup in progress, polling...');
        pollUntilReady();
        return;
      }

      setError(msg);
      setStage('error');
    }
  };

  const pollUntilReady = () => {
    const interval = setInterval(async () => {
      try {
        const ready = await invoke<boolean>('check_pipeline_environment');
        if (ready) {
          clearInterval(interval);
          await checkDocker();
        }
      } catch {
        // keep polling
      }
    }, 2000);

    // Safety: stop polling after 10 minutes
    setTimeout(() => clearInterval(interval), 600_000);
  };

  const checkDocker = async () => {
    try {
      const available = await invoke<boolean>('check_docker_installed');
      setStage(available ? 'complete' : 'docker-check');

      if (available) {
        setTimeout(onComplete, 1200);
      }
    } catch {
      setStage('docker-check');
    }
  };

  const handleRetry = () => {
    setupStarted.current = false; // allow re-trigger
    setError(null);
    setStage('installing');
    setProgress({ stage: 'init', message: 'Retrying...', progress: 0 });
    setupStarted.current = true;
    runSetup();
  };

  // ───── Installing ─────
  if (stage === 'installing') {
    return (
      <div className="flex items-center justify-center h-full bg-main">
        <div className="bg-neutral-800/30 backdrop-blur-sm border border-white/5 rounded-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-brand-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-brand-primary/20">
              <svg className="w-8 h-8 text-brand-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Setting Up Pipeline Engine</h2>
            <p className="text-white/60 text-sm">One-time install — this won't happen again.</p>
          </div>

          {/* Progress bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-white/60 mb-2">
              <span>{progress.message}</span>
              <span>{Math.round(progress.progress * 100)}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-brand-primary h-2 rounded-full transition-all duration-700 shadow-[0_0_10px_rgba(23,185,120,0.3)]"
                style={{ width: `${Math.max(progress.progress * 100, 2)}%` }}
              />
            </div>
          </div>

          {/* Step checklist */}
          <div className="space-y-2 text-sm text-white/50">
            <StepRow label="Package manager" done={['install', 'verify', 'complete'].includes(progress.stage)} active={progress.stage === 'init' || progress.stage === 'cleanup'} />
            <StepRow label="Java runtime + Nextflow" done={['verify', 'complete'].includes(progress.stage)} active={progress.stage === 'install'} />
            <StepRow label="Verification" done={progress.stage === 'complete'} active={progress.stage === 'verify'} />
          </div>

          <p className="text-xs text-white/40 mt-6 text-center">
            This takes 2-5 minutes depending on your connection
          </p>
        </div>
      </div>
    );
  }

  // ───── Docker check ─────
  if (stage === 'docker-check') {
    return (
      <div className="flex items-center justify-center h-full bg-main">
        <div className="bg-neutral-800/30 backdrop-blur-sm border border-white/5 rounded-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Docker Recommended</h2>
            <p className="text-white/60 text-sm mb-6">
              Pipelines use Docker to run analysis tools in isolated containers.
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => window.open('https://www.docker.com/products/docker-desktop/', '_blank')}
              className="w-full px-4 py-3 bg-brand-primary text-black font-medium rounded-lg hover:bg-brand-secondary transition-all active:scale-95"
            >
              Download Docker Desktop (Free)
            </button>
            <button
              onClick={checkDocker}
              className="w-full px-4 py-2 border border-white/10 text-white/80 rounded-lg hover:bg-white/5 transition-all text-sm"
            >
              I've Installed Docker — Recheck
            </button>
            <button
              onClick={onComplete}
              className="w-full px-4 py-2 text-white/40 hover:text-white/70 transition-all text-sm"
            >
              Skip for Now
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ───── Complete ─────
  if (stage === 'complete') {
    return (
      <div className="flex items-center justify-center h-full bg-main">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-brand-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-brand-primary/20">
            <svg className="w-8 h-8 text-brand-primary" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Pipeline Environment Ready!</h2>
          <p className="text-white/60 text-sm">Everything is set up. Redirecting...</p>
        </div>
      </div>
    );
  }

  // ───── Error ─────
  return (
    <div className="flex items-center justify-center h-full bg-main">
      <div className="bg-neutral-800/30 backdrop-blur-sm border border-white/5 rounded-2xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-500/20">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Setup Failed</h2>
        </div>

        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6 max-h-40 overflow-auto">
          <p className="text-red-400 text-sm font-mono break-words">{error}</p>
        </div>

        <button
          onClick={handleRetry}
          className="w-full px-4 py-2 bg-brand-primary text-black font-medium rounded-lg hover:bg-brand-secondary transition-all"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

/** Small helper for the step checklist */
function StepRow({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {active && !done && <div className="animate-spin rounded-full h-3 w-3 border-b border-brand-primary" />}
      {done && (
        <svg className="w-3 h-3 text-brand-primary" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
      {!active && !done && <div className="w-3 h-3" />}
      <span className={done ? 'text-white/70' : ''}>{label}</span>
    </div>
  );
}
