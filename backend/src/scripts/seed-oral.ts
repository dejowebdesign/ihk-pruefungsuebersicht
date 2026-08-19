import { PrismaClient } from "@prisma/client";
import { seedOralPool } from "../oral/seed";

const db = new PrismaClient();
seedOralPool(db)
  .then((r) => {
    console.log("seeded:", r);
    return db.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
