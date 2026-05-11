/*
  Warnings:

  - The primary key for the `Navbar` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `Navbar` table. All the data in the column will be lost.
  - You are about to drop the column `menu` on the `Navbar` table. All the data in the column will be lost.
  - You are about to alter the column `id` on the `Navbar` table. The data in that column could be lost. The data in that column will be cast from `String` to `Int`.
  - Added the required column `menuItems` to the `Navbar` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "purchasedDesigns" JSONB NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Navbar" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "menuItems" JSONB NOT NULL,
    CONSTRAINT "Navbar_shop_fkey" FOREIGN KEY ("shop") REFERENCES "User" ("shop") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Navbar" ("designId", "id", "shop") SELECT "designId", "id", "shop" FROM "Navbar";
DROP TABLE "Navbar";
ALTER TABLE "new_Navbar" RENAME TO "Navbar";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_shop_key" ON "User"("shop");
