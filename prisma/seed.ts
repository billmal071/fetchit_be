import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';

const prisma = new PrismaClient();

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  console.log('Seeding database...');

  const email = await prompt('Enter admin email: ');
  const username = await prompt('Enter admin username: ');
  const password = await prompt('Enter admin password: ');

  if (!email || !username || !password) {
    throw new Error('Email, username, and password are required');
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      username,
      password: hashedPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  console.log('Created admin user:', admin.email);

  // Seed service categories
  const categories = [
    { name: 'Plumbing', slug: 'plumbing', description: 'Plumbing repairs, installations, and maintenance', icon: 'plumbing' },
    { name: 'Electrical', slug: 'electrical', description: 'Electrical wiring, repairs, and installations', icon: 'electrical' },
    { name: 'Carpentry', slug: 'carpentry', description: 'Woodwork, furniture repair, and custom builds', icon: 'carpentry' },
    { name: 'Painting', slug: 'painting', description: 'Interior and exterior painting services', icon: 'painting' },
    { name: 'Cleaning', slug: 'cleaning', description: 'Deep cleaning, regular cleaning, and sanitization', icon: 'cleaning' },
    { name: 'General Maintenance', slug: 'general-maintenance', description: 'General home and office maintenance', icon: 'maintenance' },
    { name: 'AC/HVAC', slug: 'ac-hvac', description: 'Air conditioning and HVAC system services', icon: 'hvac' },
    { name: 'Roofing', slug: 'roofing', description: 'Roof repairs, installations, and inspections', icon: 'roofing' },
    { name: 'Tiling', slug: 'tiling', description: 'Floor and wall tiling installations and repairs', icon: 'tiling' },
    { name: 'Furniture Assembly', slug: 'furniture-assembly', description: 'Furniture assembly and disassembly services', icon: 'furniture' },
  ];

  for (const category of categories) {
    await prisma.serviceCategory.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    });
  }

  console.log(`Seeded ${categories.length} service categories`);

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
