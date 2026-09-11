import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@pbl.edu" },
    update: {},
    create: {
      role: "admin",
      name: "Admin User",
      email: "admin@pbl.edu",
      password: passwordHash,
    },
  });

  const faculty = await prisma.user.upsert({
    where: { email: "faculty@pbl.edu" },
    update: {},
    create: {
      role: "faculty",
      name: "Dr. Faculty",
      email: "faculty@pbl.edu",
      password: passwordHash,
    },
  });

  const student1 = await prisma.user.upsert({
    where: { email: "student1@pbl.edu" },
    update: {},
    create: {
      role: "student",
      name: "Alice Student",
      email: "student1@pbl.edu",
      password: passwordHash,
    },
  });

  const student2 = await prisma.user.upsert({
    where: { email: "student2@pbl.edu" },
    update: {},
    create: {
      role: "student",
      name: "Bob Student",
      email: "student2@pbl.edu",
      password: passwordHash,
    },
  });

  const course = await prisma.course.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "PBL - Blockchain Attendance",
      facultyId: faculty.id,
    },
  });

  console.log("Seed complete:");
  console.log("  admin@pbl.edu / password123 (role: admin)");
  console.log("  faculty@pbl.edu / password123 (role: faculty)");
  console.log("  student1@pbl.edu / password123 (role: student)");
  console.log("  student2@pbl.edu / password123 (role: student)");
  console.log(`  course: ${course.name} (${course.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
