/**
 * Equipment Management Page
 * Manage laboratory instruments and machines
 */
import React from 'react';
import { Microscope, Plus } from 'lucide-react';

export const EquipmentPage: React.FC = () => {
  // TODO: Implement with real API calls
  // For now, this is a placeholder that can be implemented later

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col">
        <div className="border-b border-white/5 p-4">
          <div className="flex items-center justify-between">
            <p className="flex text-sm text-white/50">
              Manage instruments and machines in your laboratory
            </p>
            <button className="flex items-center gap-2 px-3 py-1.5 bg-brand-primary text-black text-sm font-medium rounded-lg hover:bg-brand-secondary transition-colors">
              <Plus size={18} />
              Add Equipment
            </button>
          </div>
        </div>

        <div className="flex-1 p-6">
          <div className="text-center">
            <div className="w-20 h-20 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/5 shadow-inner">
              <Microscope size={32} className="text-brand-primary" />
            </div>

            <h3 className="text-2xl font-bold mb-2">Equipment Management</h3>
            <p className="text-white/50 mb-4">
              Add your laboratory equipment here to enable automatic data import
            </p>
            <div className="max-w-2xl mx-auto text-left space-y-4 mt-8">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2">Features:</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Track all laboratory instruments and machines</li>
                  <li>• Enable automatic data import from equipment PCs</li>
                  <li>• Link equipment to experiments via @mentions in notebooks</li>
                  <li>• Monitor equipment status (online/offline/locked)</li>
                  <li>• QR code labeling for easy identification</li>
                </ul>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-purple-900 mb-2">Auto-Import Workflow:</h4>
                <ol className="text-sm text-purple-800 space-y-1">
                  <li>1. Add equipment and configure watch folder</li>
                  <li>2. Install openbio-agent on equipment PC</li>
                  <li>3. When analysis completes, data auto-uploads</li>
                  <li>4. Data links to your experiment notebook automatically</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
