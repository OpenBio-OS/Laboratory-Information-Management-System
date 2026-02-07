/*
  Warnings:

  - You are about to drop the column `location` on the `Equipment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Container" ADD COLUMN "lastMaintenance" DATETIME;
ALTER TABLE "Container" ADD COLUMN "maintenanceCycle" INTEGER;
ALTER TABLE "Container" ADD COLUMN "nextMaintenance" DATETIME;

-- CreateTable
CREATE TABLE "EquipmentLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EquipmentLocation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "EquipmentLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
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
    "maintenanceCycle" INTEGER,
    "lastMaintenance" DATETIME,
    "nextMaintenance" DATETIME,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Equipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "EquipmentLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Equipment" ("agentStatus", "autoImport", "createdAt", "externalId", "id", "lastSyncAt", "metadata", "model", "name", "serialNumber", "type", "updatedAt", "watchFolder") SELECT "agentStatus", "autoImport", "createdAt", "externalId", "id", "lastSyncAt", "metadata", "model", "name", "serialNumber", "type", "updatedAt", "watchFolder" FROM "Equipment";
DROP TABLE "Equipment";
ALTER TABLE "new_Equipment" RENAME TO "Equipment";
CREATE UNIQUE INDEX "Equipment_externalId_key" ON "Equipment"("externalId");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
