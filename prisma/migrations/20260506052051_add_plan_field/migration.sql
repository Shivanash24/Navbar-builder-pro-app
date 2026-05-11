/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "User_shop_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "User";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Navbar" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "menuItems" JSONB NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free'
);
INSERT INTO "new_Navbar" ("designId", "id", "menuItems", "shop") SELECT "designId", "id", "menuItems", "shop" FROM "Navbar";
DROP TABLE "Navbar";
ALTER TABLE "new_Navbar" RENAME TO "Navbar";
CREATE UNIQUE INDEX "Navbar_shop_key" ON "Navbar"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
