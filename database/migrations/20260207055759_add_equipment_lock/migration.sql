-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "model" TEXT,
    "serialNumber" TEXT,
    "locationId" TEXT,
    "watchFolder" TEXT,
    "autoImport" BOOLEAN NOT NULL DEFAULT false,
    "agentStatus" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastSyncAt" DATETIME,
    "lockedByExperimentId" TEXT,
    "lockedAt" DATETIME,
    "maintenanceCycle" INTEGER,
    "lastMaintenance" DATETIME,
    "nextMaintenance" DATETIME,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Equipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "EquipmentLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Equipment_lockedByExperimentId_fkey" FOREIGN KEY ("lockedByExperimentId") REFERENCES "Experiment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Equipment" ("agentStatus", "autoImport", "createdAt", "externalId", "id", "lastMaintenance", "lastSyncAt", "locationId", "maintenanceCycle", "metadata", "model", "name", "nextMaintenance", "serialNumber", "type", "updatedAt", "watchFolder") SELECT "agentStatus", "autoImport", "createdAt", "externalId", "id", "lastMaintenance", "lastSyncAt", "locationId", "maintenanceCycle", "metadata", "model", "name", "nextMaintenance", "serialNumber", "type", "updatedAt", "watchFolder" FROM "Equipment";
DROP TABLE "Equipment";
ALTER TABLE "new_Equipment" RENAME TO "Equipment";
CREATE UNIQUE INDEX "Equipment_externalId_key" ON "Equipment"("externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
