-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "genderLocked" BOOLEAN NOT NULL DEFAULT true,
    "aadhaarVerified" BOOLEAN NOT NULL DEFAULT false,
    "aadhaarHash" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "avatar" TEXT,
    "personalNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "todos" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_aadhaarHash_key" ON "User"("aadhaarHash");
