/**
 * OpenBio API Client
 * Handles communication with the backend server
 */

// API URL is injected from Tauri on app load
let apiBaseUrl = 'http://localhost:3000';

export function setApiBaseUrl(url: string) {
    apiBaseUrl = url;
}

export function getApiBaseUrl() {
    return apiBaseUrl;
}

/**
 * API client wrapper with error handling
 */
async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const method = options.method || 'GET';
    const url = `${apiBaseUrl}${endpoint}`;
    console.log(`[API] Request: ${method} ${url}`, options);

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        console.log(`[API] Response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const error = await response.text();
            console.error(`[API] Error Body:`, error);
            throw new Error(`API Error: ${response.status} - ${error}`);
        }

        return response.json();
    } catch (err) {
        console.error(`[API] Network/Fetch Error:`, err);
        throw err;
    }
}

// ============================================
// Inventory API
// ============================================

export interface Sample {
    id: string;
    externalId?: string;
    name: string;
    type: string;
    metadata?: string; // Free-form notes and description
    containerId?: string;
    slotPosition?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Container {
    id: string;
    externalId?: string;
    name: string;
    type: string;
    layoutConfig?: { rows?: number; cols?: number };
    parentId?: string;
    createdAt: string;
    updatedAt: string;
}

export const inventoryApi = {
    listSamples: () => apiRequest<Sample[]>('/api/inventory/samples'),
    getSample: (id: string) => apiRequest<Sample>(`/api/inventory/samples/${id}`),
    createSample: (data: Partial<Sample>) => {
        const payload: any = {
            name: data.name,
            type_: data.type,
            metadata: data.metadata,
            external_id: data.externalId,
            container_id: data.containerId,
            slot_position: data.slotPosition
        };
        return apiRequest<Sample>('/api/inventory/samples', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
    updateSample: (id: string, data: Partial<Sample>) => {
        const payload: any = {
            name: data.name,
            metadata: data.metadata,
        };
        return apiRequest<Sample>(`/api/inventory/samples/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
    },
    deleteSample: (id: string) =>
        apiRequest<void>(`/api/inventory/samples/${id}`, {
            method: 'DELETE',
        }),

    listContainers: async () => {
        const containers = await apiRequest<any[]>('/api/inventory/containers');
        // Parse layoutConfig from JSON string
        return containers.map(c => ({
            ...c,
            layoutConfig: c.layoutConfig ? JSON.parse(c.layoutConfig) : undefined
        })) as Container[];
    },
    getContainer: (id: string) => apiRequest<Container>(`/api/inventory/containers/${id}`),
    createContainer: (data: Partial<Container>) => {
        const payload: any = {
            name: data.name,
            type: data.type,
            external_id: data.externalId,
            parent_id: data.parentId,
            layout_config: data.layoutConfig
        };
        return apiRequest<Container>('/api/inventory/containers', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
    deleteContainer: (id: string) =>
        apiRequest<void>(`/api/inventory/containers/${id}`, {
            method: 'DELETE',
        }),
};

// ============================================
// Experiments API (Experiments ARE the notebooks)
// ============================================

export interface Experiment {
    id: string;
    name: string;
    description?: string;
    content: string; // Rich text notebook content
    status: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    scheduledAt?: string;
    equipmentId?: string;
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
}

export interface ExperimentEntry {
    id: string;
    experimentId: string;
    content: string;
    timestamp: string;
    author?: string;
    attachedAssetId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ExperimentMention {
    id: string;
    experimentId: string;
    entityType: 'sample' | 'equipment' | 'paper';
    entityId: string;
    snapshotData: string;
    position?: number;
    createdAt: string;
}

export interface SearchResult {
    entityType: 'sample' | 'equipment' | 'paper';
    id: string;
    name: string;
    metadata?: any;
}

export const experimentsApi = {
    list: () => apiRequest<Experiment[]>('/api/experiments'),
    get: (id: string) => apiRequest<Experiment>(`/api/experiments/${id}`),
    create: (data: Partial<Experiment>) =>
        apiRequest<Experiment>('/api/experiments', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    update: (id: string, data: Partial<Experiment>) =>
        apiRequest<Experiment>(`/api/experiments/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),
    delete: (id: string) =>
        apiRequest<void>(`/api/experiments/${id}`, {
            method: 'DELETE',
        }),
    
    // Entries (for equipment data import)
    listEntries: (experimentId: string) => 
        apiRequest<ExperimentEntry[]>(`/api/experiments/${experimentId}/entries`),
    createEntry: (experimentId: string, data: { content: string; author?: string; attachedAssetId?: string }) =>
        apiRequest<ExperimentEntry>(`/api/experiments/${experimentId}/entries`, {
            method: 'POST',
            body: JSON.stringify({
                content: data.content,
                author: data.author,
                attached_asset_id: data.attachedAssetId,
            }),
        }),
    
    // Mentions (for @sample, @equipment, @paper)
    listMentions: (experimentId: string) =>
        apiRequest<ExperimentMention[]>(`/api/experiments/${experimentId}/mentions`),
    createMention: (experimentId: string, data: { entityType: string; entityId: string; snapshotData: string; position?: number }) =>
        apiRequest<ExperimentMention>(`/api/experiments/${experimentId}/mentions`, {
            method: 'POST',
            body: JSON.stringify({
                entity_type: data.entityType,
                entity_id: data.entityId,
                snapshot_data: data.snapshotData,
                position: data.position,
            }),
        }),
    
    // Search for @mentions
    searchEntities: () => apiRequest<SearchResult[]>('/api/experiments/search-entities'),
};

// ============================================
// Library (Papers) API
// ============================================

export interface Paper {
    id: string;
    title: string;
    authors?: string;
    journal?: string;
    year?: number;
    doi?: string;
    pmid?: string;
    url?: string;
    abstract?: string;
    notes?: string;
    pdfPath?: string;
    tags?: string;
    createdAt: string;
    updatedAt: string;
    addedBy?: string;
}

export const libraryApi = {
    list: () => apiRequest<Paper[]>('/api/library'),
    get: (id: string) => apiRequest<Paper>(`/api/library/${id}`),
    create: (data: Partial<Paper>) =>
        apiRequest<Paper>('/api/library', {
            method: 'POST',
            body: JSON.stringify({
                ...data,
                abstract_: data.abstract, // Map abstract to abstract_
            }),
        }),
    update: (id: string, data: Partial<Paper>) =>
        apiRequest<Paper>(`/api/library/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        }),
    delete: (id: string) =>
        apiRequest<void>(`/api/library/${id}`, {
            method: 'DELETE',
        }),
};

// ============================================
// Health Check
// ============================================

export interface HealthResponse {
    status: string;
    version: string;
}

export const healthApi = {
    check: () => apiRequest<HealthResponse>('/health'),
};
