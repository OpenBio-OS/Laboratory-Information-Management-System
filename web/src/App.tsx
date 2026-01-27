import { useState, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryClient } from "./lib/queryClient";
import { ApiProvider, useApi } from "./lib/ApiContext";
import { SetupWizard, SetupConfig } from "./features/setup";
import { ChartScatter, Database, FlaskConical, LayoutDashboard, Microscope, Refrigerator, ScatterChart, Settings, SquareLibrary } from "lucide-react";
import "./App.css";

// Main App with providers
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider>
        <AppContent />
      </ApiProvider>
    </QueryClientProvider>
  );
}

// Navigation items
const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "freezer", label: "Freezer", icon: Refrigerator },
  { id: "library", label: "Library", icon: SquareLibrary },
  { id: "experiments", label: "Experiments", icon: FlaskConical },
  { id: "insight", label: "Insight", icon: ChartScatter },
  { id: "equipment", label: 'Equipment', icon: Microscope },
  { id: "settings", label: "Settings", icon: Settings },
];

function AppContent() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const { isConnected, isLoading, setApiUrl } = useApi();

  useEffect(() => {
    // Check if config exists via Tauri command
    invoke<boolean>('needs_setup')
      .then((result) => {
        setNeedsSetup(result);
        if (!result) {
          // If setup is complete, fetch connection details
          invoke('get_config').then((config: any) => {
            if (config.mode === 'local' || config.mode === 'hub') {
              setApiUrl(`http://localhost:${config.serverPort}`);
            } else if (config.apiUrl) {
              setApiUrl(config.apiUrl);
            }
          }).catch(err => console.error("Failed to load config:", err));
        }
      })
      .catch((err) => {
        console.error('Failed to check setup status:', err);
        // Fallback to localStorage for development without Tauri
        const hasConfig = localStorage.getItem('openbio_config');
        setNeedsSetup(!hasConfig);
      });
  }, []);

  const handleSetupComplete = async (config: SetupConfig) => {
    try {
      // Save config via Tauri
      await invoke('save_config', { config });

      // Set API URL based on mode
      if (config.mode === 'local' || config.mode === 'hub') {
        setApiUrl(`http://localhost:${config.serverPort}`);
      } else if (config.apiUrl) {
        setApiUrl(config.apiUrl);
      }
    } catch (err) {
      console.error('Failed to save config via Tauri:', err);
      // Fallback to localStorage
      localStorage.setItem('openbio_config', JSON.stringify(config));

      if (config.mode === 'local' || config.mode === 'hub') {
        setApiUrl(`http://localhost:${config.serverPort}`);
      } else if (config.apiUrl) {
        setApiUrl(config.apiUrl);
      }
    }

    setNeedsSetup(false);
  };

  // Still checking config
  if (needsSetup === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-main text-white">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <FlaskConical size={48} className="text-brand-primary animate-pulse" />
          <p className="text-white/60 font-medium">Loading OpenBio...</p>
        </div>
      </div>
    );
  }

  // Show Setup Wizard if no config
  if (needsSetup) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div className="flex h-screen bg-main text-white overflow-hidden font-sans selection:bg-brand-primary/30">
      {/* Sidebar */}
      <aside className="w-64 bg-surface/50 backdrop-blur-md border-r border-white/5 flex flex-col transition-all duration-300">
        <div className="h-20 flex items-center px-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <img src="/logo-with-green-text-tree.png" alt="OpenBio" className="h-8 object-contain" />
          </div>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${activeTab === item.id
                ? "bg-brand-primary/10 text-brand-primary shadow-[0_0_20px_rgba(23,185,120,0.1)]"
                : "text-white/60 hover:bg-white/5 hover:text-white"
                }`}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon size={20} className={activeTab === item.id ? "text-brand-primary" : "text-white/40 group-hover:text-white transition-colors"} />
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-black/20 border border-white/5 ${isLoading ? "animate-pulse" : ""}`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? "bg-brand-primary shadow-[0_0_10px_#17b978]" : "bg-red-500"}`} />
            <span className="text-xs font-medium text-white/50">
              {isLoading ? "Connecting..." : isConnected ? "System Online" : "Disconnected"}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">


        <header className="h-20 flex items-center px-8 z-10">
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
            {navItems.find(n => n.id === activeTab)?.label}
          </h1>
        </header>

        <div className="flex-1 overflow-y-auto px-8 pb-8 z-10 scrollbar-hide">
          <div className="max-w-7xl mx-auto w-full animate-fade-in">
            {activeTab === "dashboard" && <DashboardView />}
            {activeTab === "freezer" && <InventoryPage />}
            {activeTab === "library" && <LibraryView />}
            {activeTab === "experiments" && <ExperimentsView />}
            {activeTab === "insight" && <InsightView />}
            {activeTab === "settings" && <SettingsView onResetSetup={() => setNeedsSetup(true)} />}
          </div>
        </div>
      </main>
    </div>
  );
}

// Reusable components
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-neutral-800/30 backdrop-blur-sm border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors ${className}`}>
    {children}
  </div>
);

const Button = ({ children, variant = "primary", className = "", ...props }: any) => {
  const baseStyle = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95";
  const variants = {
    primary: "bg-brand-primary text-black hover:bg-brand-secondary hover:shadow-[0_0_20px_rgba(23,185,120,0.3)]",
    secondary: "bg-white/5 text-white hover:bg-white/10 border border-white/5",
  };

  return (
    <button className={`${baseStyle} ${variants[variant as keyof typeof variants]} ${className}`} {...props}>
      {children}
    </button>
  );
};

import { InventoryPage } from "./features/inventory/InventoryPage";

// ... existing imports

// Views
function DashboardView() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {["Samples", "Experiments", "Pipelines", "Assets"].map((label) => (
          <Card key={label} className="group">
            <h3 className="text-white/40 text-sm font-medium uppercase tracking-wider mb-2">{label}</h3>
            <p className="text-4xl font-bold text-white group-hover:text-brand-primary transition-colors">0</p>
          </Card>
        ))}
      </div>

      <Card className="relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl font-bold mb-2">Welcome to OpenBio</h2>
          <p className="text-white/60 mb-6">
            Your local-first Biological Operating System. Get started by adding samples to your inventory or creating an experiment.
          </p>
          <div className="flex gap-4">
            <Button>Create Experiment</Button>
            <Button variant="secondary">View Docs</Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="h-64 flex flex-col justify-center items-center text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
            <LayoutDashboard className="text-white/20" />
          </div>
          <h3 className="text-lg font-medium mb-1">Recent Activity</h3>
          <p className="text-white/40 text-sm">No recent activity to show</p>
        </Card>
        <Card className="h-64 flex flex-col justify-center items-center text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
            <Database className="text-white/20" />
          </div>
          <h3 className="text-lg font-medium mb-1">Storage Status</h3>
          <p className="text-white/40 text-sm">Local storage is healthy</p>
        </Card>
      </div>
    </div>
  );
}

function LibraryView() {
  return (
    <div>
      Books
    </div>
  )
}

function ExperimentsView() {
  return (
    <div className="h-full flex flex-col items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md animate-slide-in-from-bottom">
        <div className="w-20 h-20 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/5 shadow-inner">
          <FlaskConical size={32} className="text-brand-primary" />
        </div>
        <h3 className="text-2xl font-bold mb-2">No experiments</h3>
        <p className="text-white/50 mb-8">Create your first experiment to start tracking your work and gathering data.</p>
        <Button className="w-full justify-center">New Experiment</Button>
      </div>
    </div>
  );
}

function InsightView() {
  return (
    <div className="h-full flex flex-col items-center justify-center min-h-[400px]">
      <div className="text-center max-w-md animate-slide-in-from-bottom">
        <div className="w-20 h-20 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-white/5 shadow-inner">
          <ScatterChart size={32} className="text-brand-primary" />
        </div>
        <h3 className="text-2xl font-bold mb-2">Insight Module</h3>
        <p className="text-white/50 mb-8">Single-cell data visualization and analysis. Upload a matrix file to begin exploring.</p>
        <Button className="w-full justify-center">Upload Data</Button>
      </div>
    </div>
  );
}

function SettingsView({ onResetSetup }: { onResetSetup: () => void }) {
  // const { apiUrl, setApiUrl, isConnected } = useApi();
  // const [urlInput, setUrlInput] = useState(apiUrl);

  const handleResetSetup = async () => {
    // Clear config - in production this would delete the config file
    localStorage.removeItem('openbio_config');
    onResetSetup();
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
          <div className="w-1 h-6 bg-red-500 rounded-full"></div>
          Danger Zone
        </h3>

        <div className="space-y-1">
          <div className="flex items-center !mt-6 justify-between p-4 rounded-xl bg-red-500/5 border border-red-500/10">
            <div>
              <h4 className="font-medium text-white mb-1">Reset Application</h4>
              <p className="text-sm text-white/40">Re-run the setup wizard to change your deployment mode.</p>
            </div>
            <Button variant="secondary" onClick={handleResetSetup} className="hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30">
              Re-run Setup
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
