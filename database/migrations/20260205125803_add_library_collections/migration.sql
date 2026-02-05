-- CreateTable
CREATE TABLE "Library" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Paper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "authors" TEXT,
    "journal" TEXT,
    "year" INTEGER,
    "doi" TEXT,
    "pmid" TEXT,
    "url" TEXT,
    "abstract" TEXT,
    "notes" TEXT,
    "pdfPath" TEXT,
    "tags" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "libraryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "addedBy" TEXT,
    CONSTRAINT "Paper_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Paper" ("abstract", "addedBy", "authors", "createdAt", "doi", "id", "journal", "notes", "pdfPath", "pmid", "tags", "title", "updatedAt", "url", "year") SELECT "abstract", "addedBy", "authors", "createdAt", "doi", "id", "journal", "notes", "pdfPath", "pmid", "tags", "title", "updatedAt", "url", "year" FROM "Paper";
DROP TABLE "Paper";
ALTER TABLE "new_Paper" RENAME TO "Paper";
CREATE UNIQUE INDEX "Paper_doi_key" ON "Paper"("doi");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
