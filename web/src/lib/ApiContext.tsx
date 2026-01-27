/**
 * API Context for dynamic URL injection from Tauri
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { setApiBaseUrl, getApiBaseUrl } from './api';

interface ApiContextType {
    apiUrl: string;
    isConnected: boolean;
    isLoading: boolean;
    setApiUrl: (url: string) => void;
}

const ApiContext = createContext<ApiContextType | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
    const [apiUrl, setApiUrlState] = useState(getApiBaseUrl());
    const [isConnected, setIsConnected] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Listen for config from Tauri
        const handleConfig = (event: CustomEvent<{ apiUrl: string }>) => {
            const url = event.detail.apiUrl;
            setApiBaseUrl(url);
            setApiUrlState(url);
        };

        window.addEventListener('openbio:config' as any, handleConfig);

        // Check connection on mount
        checkConnection();

        return () => {
            window.removeEventListener('openbio:config' as any, handleConfig);
        };
    }, []);

    async function checkConnection() {
        setIsLoading(true);
        try {
            const response = await fetch(`${apiUrl}/health`);
            setIsConnected(response.ok);
        } catch {
            setIsConnected(false);
        } finally {
            setIsLoading(false);
        }
    }

    function setApiUrl(url: string) {
        setApiBaseUrl(url);
        setApiUrlState(url);
        checkConnection();
    }

    return (
        <ApiContext.Provider value={{ apiUrl, isConnected, isLoading, setApiUrl }}>
            {children}
        </ApiContext.Provider>
    );
}

export function useApi() {
    const context = useContext(ApiContext);
    if (!context) {
        throw new Error('useApi must be used within an ApiProvider');
    }
    return context;
}
