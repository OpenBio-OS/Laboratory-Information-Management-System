/**
 * License and Rules Agreement Screen
 * 
 * Displayed before mode selection during initial setup or when re-initializing from settings/tray.
 * Users must accept both the License Agreement and Community Rules to proceed.
 */

import { useState } from 'react';
import { ArrowRight, FileText, Users, Check } from 'lucide-react';

interface LicenseAgreementScreenProps {
  onAccept: () => void;
  onReject: () => void;
}

export function LicenseAgreementScreen({ onAccept, onReject }: LicenseAgreementScreenProps) {
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [rulesAccepted, setRulesAccepted] = useState(false);

  const canProceed = licenseAccepted && rulesAccepted;

  return (
    <div className="flex justify-center items-center min-h-screen bg-main p-8 font-sans text-white">
      {/* Background Gradient */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[20%] -right-[10%] w-[50%] h-[50%] bg-brand-primary/5 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] -left-[10%] w-[30%] h-[30%] bg-brand-secondary/5 rounded-full blur-[100px]" />
      </div>

      <div className="w-full max-w-4xl bg-surface/50 backdrop-blur-xl rounded-3xl overflow-hidden shadow-2xl border border-white/5 relative z-10 animate-fade-in">
        {/* Header */}
        <div className="text-center pt-8 pb-6 px-4">
          <div className="inline-flex p-3 rounded-full bg-brand-primary/10 text-brand-primary mb-4 shadow-[0_0_20px_rgba(23,185,120,0.2)]">
            <img src="/logo-transparent-green-text.png" alt="OpenBio Logo" className="w-14 h-14" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome to OpenBio</h1>
          <p className="text-white/60 text-lg">Please review and accept the following terms to continue</p>
        </div>

        {/* Content */}
        <div className="px-8 pb-8 space-y-6">
          {/* License Agreement Section */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-brand-primary/10 flex items-center justify-center">
                <FileText size={20} className="text-brand-primary" />
              </div>
              <h2 className="text-xl font-semibold text-white">License Agreement</h2>
            </div>
            
            <div className="bg-black/30 rounded-lg p-4 max-h-64 overflow-y-auto text-sm text-white/70 space-y-3 mb-4 font-mono">
              <p className="font-bold text-white">GNU AFFERO GENERAL PUBLIC LICENSE (AGPL v3)</p>
              <p>
                OpenBio is free and open-source software licensed under the GNU Affero General Public License version 3.
              </p>
              <p>
                <strong className="text-white">Key Terms:</strong>
              </p>
              <ul className="list-disc list-inside space-y-2 pl-4">
                <li>You may use, modify, and distribute this software freely</li>
                <li>Any modifications must also be released under AGPL v3</li>
                <li>If you run a modified version as a network service, you must make the source code available</li>
                <li>This software is provided "AS IS" without warranty of any kind</li>
                <li>Commercial licensing options are available for Hub and Enterprise modes</li>
              </ul>
              <p className="pt-2">
                <strong className="text-white">Commercial Use:</strong> Hub and Enterprise modes require a valid license key.
                Solo mode is completely free with no restrictions.
              </p>
              <p className="text-xs text-white/50 pt-2">
                For the complete license text, visit: https://www.gnu.org/licenses/agpl-3.0.html
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setLicenseAccepted(!licenseAccepted)}>
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  licenseAccepted
                    ? 'bg-brand-primary border-brand-primary'
                    : 'border-white/30 group-hover:border-white/50'
                }`}
              >
                {licenseAccepted && <Check size={14} className="text-white" />}
              </div>
              <span className="text-white/80 group-hover:text-white transition-colors">
                I accept the terms of the AGPL v3 License Agreement
              </span>
            </label>
          </div>

          {/* Community Rules Section */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-brand-secondary/10 flex items-center justify-center">
                <Users size={20} className="text-brand-secondary" />
              </div>
              <h2 className="text-xl font-semibold text-white">Community Rules & Ethics</h2>
            </div>
            
            <div className="bg-black/30 rounded-lg p-4 max-h-64 overflow-y-auto text-sm text-white/70 space-y-3 mb-4">
              <p className="font-bold text-white">Responsible Use Guidelines</p>
              <p>
                OpenBio is designed for legitimate scientific research and laboratory management. By using this software, you agree to:
              </p>
              <ul className="list-disc list-inside space-y-2 pl-4">
                <li>Use OpenBio only for lawful scientific research and laboratory operations</li>
                <li>Comply with all applicable biosafety regulations and institutional guidelines</li>
                <li>Not use this software for any harmful, illegal, or unethical purposes</li>
                <li>Respect data privacy and handle sensitive research data responsibly</li>
                <li>Follow proper laboratory safety protocols and documentation practices</li>
                <li>Contribute positively to the open-source scientific community</li>
                <li>Report security vulnerabilities responsibly</li>
              </ul>
              <p className="pt-2">
                <strong className="text-white">Data Privacy:</strong> OpenBio does not collect or transmit your research data 
                to external servers (except when you explicitly configure Enterprise mode). All data remains under your control.
              </p>
              <p className="pt-2">
                <strong className="text-white">Liability:</strong> Users are solely responsible for ensuring compliance with 
                their institutional policies, local laws, and ethical guidelines.
              </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer group" onClick={() => setRulesAccepted(!rulesAccepted)}>
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                  rulesAccepted
                    ? 'bg-brand-primary border-brand-primary'
                    : 'border-white/30 group-hover:border-white/50'
                }`}
              >
                {rulesAccepted && <Check size={14} className="text-white" />}
              </div>
              <span className="text-white/80 group-hover:text-white transition-colors">
                I agree to follow the Community Rules and use OpenBio responsibly
              </span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4">
            <button
              onClick={onReject}
              className="flex-1 px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all duration-200"
            >
              Decline
            </button>
            <button
              onClick={onAccept}
              disabled={!canProceed}
              className={`flex-1 px-6 py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                canProceed
                  ? 'bg-brand-primary text-white hover:bg-brand-secondary shadow-lg hover:shadow-brand-primary/25'
                  : 'bg-white/10 text-white/40 cursor-not-allowed'
              }`}
            >
              Accept & Continue
              <ArrowRight size={18} />
            </button>
          </div>

          <p className="text-xs text-white/40 text-center pt-2">
            By clicking "Accept & Continue", you acknowledge that you have read and agree to both the License Agreement and Community Rules.
          </p>
        </div>
      </div>
    </div>
  );
}
