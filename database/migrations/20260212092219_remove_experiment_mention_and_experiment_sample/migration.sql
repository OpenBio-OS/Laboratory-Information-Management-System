/*
  Warnings:

  - You are about to drop the `ExperimentMention` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ExperimentSample` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ExperimentMention";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ExperimentSample";
PRAGMA foreign_keys=on;
