-- CreateTable
CREATE TABLE "ExperimentFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExperimentFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ExperimentFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "content" TEXT NOT NULL DEFAULT '',
    "folderId" TEXT,
    "scheduledAt" DATETIME,
    "equipmentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT,
    CONSTRAINT "Experiment_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "ExperimentFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Experiment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Experiment" ("content", "createdAt", "createdBy", "description", "equipmentId", "id", "name", "scheduledAt", "status", "updatedAt") SELECT "content", "createdAt", "createdBy", "description", "equipmentId", "id", "name", "scheduledAt", "status", "updatedAt" FROM "Experiment";
DROP TABLE "Experiment";
ALTER TABLE "new_Experiment" RENAME TO "Experiment";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
