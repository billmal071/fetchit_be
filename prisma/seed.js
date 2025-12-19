"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding database...');
    const hashedPassword = await bcrypt.hash('Admin@123', 12);
    const admin = await prisma.user.upsert({
        where: { email: 'admin@fetchit.com' },
        update: {},
        create: {
            email: 'admin@fetchit.com',
            username: 'admin',
            password: hashedPassword,
            role: client_1.UserRole.ADMIN,
            status: client_1.UserStatus.ACTIVE,
            emailVerified: true,
        },
    });
    console.log('Created admin user:', admin.email);
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
//# sourceMappingURL=seed.js.map