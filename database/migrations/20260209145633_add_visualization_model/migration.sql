-- CreateTable
CREATE TABLE "Visualization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "configJson" TEXT,
    "experimentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Visualization_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DigitalAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "experimentId" TEXT,
    "sampleId" TEXT,
    "pipelineRunId" TEXT,
    "visualizationId" TEXT,
    "assetType" TEXT NOT NULL DEFAULT 'RAW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,
    "machineId" TEXT,
    CONSTRAINT "DigitalAsset_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DigitalAsset_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DigitalAsset_pipelineRunId_fkey" FOREIGN KEY ("pipelineRunId") REFERENCES "PipelineRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DigitalAsset_visualizationId_fkey" FOREIGN KEY ("visualizationId") REFERENCES "Visualization" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DigitalAsset" ("assetType", "checksum", "createdAt", "experimentId", "filename", "id", "machineId", "mimeType", "pipelineRunId", "sampleId", "sizeBytes", "storageKey", "uploadedBy") SELECT "assetType", "checksum", "createdAt", "experimentId", "filename", "id", "machineId", "mimeType", "pipelineRunId", "sampleId", "sizeBytes", "storageKey", "uploadedBy" FROM "DigitalAsset";
DROP TABLE "DigitalAsset";
ALTER TABLE "new_DigitalAsset" RENAME TO "DigitalAsset";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
