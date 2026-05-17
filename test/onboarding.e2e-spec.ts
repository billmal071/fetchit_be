import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/database/prisma.service';

/**
 * E2E test for the onboarding flow.
 *
 * Tests the full lifecycle:
 * 1. Register a user
 * 2. Verify email (direct DB update since we can't click email links in tests)
 * 3. Onboard as HANDYMAN — should succeed
 * 4. Attempt to re-onboard as CUSTOMER — should be rejected (403)
 * 5. Attempt to onboard with invalid role — should be rejected (400)
 */
describe('Onboarding Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let userId: string;

  const testUser = {
    username: `testuser_${Date.now()}`,
    email: `testuser_${Date.now()}@test.com`,
    password: 'TestP@ss123!',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    // Clean up test user
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
    await app.close();
  });

  it('should register a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(testUser)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    accessToken = res.body.data.tokens.accessToken;
    userId = res.body.data.user.id;

    expect(userId).toBeDefined();
    expect(accessToken).toBeDefined();
  });

  it('should reject onboarding before email verification (user inactive)', async () => {
    // User has PENDING status before email verification, JWT strategy rejects as 401
    await request(app.getHttpServer())
      .post('/api/v1/users/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'HANDYMAN' })
      .expect(401);
  });

  it('should verify email (simulate)', async () => {
    // Simulate email verification directly in DB — also activate the user
    // (In real flow, email verification triggers status change to ACTIVE)
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, status: 'ACTIVE' },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.emailVerified).toBe(true);
    expect(user?.status).toBe('ACTIVE');
    expect(user?.onboardedAt).toBeNull();
  });

  it('should successfully onboard as HANDYMAN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'HANDYMAN' })
      .expect(201);

    expect(res.body.data.role).toBe('HANDYMAN');

    // Verify onboardedAt was set
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.onboardedAt).not.toBeNull();
  });

  it('should reject re-onboarding (user already onboarded)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/users/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'CUSTOMER' })
      .expect(403);

    expect(res.body.message).toContain('already been onboarded');
  });

  it('should reject invalid role during onboarding', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users/onboard')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'ADMIN' })
      .expect(400);
  });

  it('should reject onboarding without authentication', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users/onboard')
      .send({ role: 'CUSTOMER' })
      .expect(401);
  });

  it('GET /users/roles should return onboardable roles (public)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/roles')
      .expect(200);

    expect(res.body.data.roles).toContain('CUSTOMER');
    expect(res.body.data.roles).toContain('PERSONAL_SHOPPER');
    expect(res.body.data.roles).toContain('HANDYMAN');
    expect(res.body.data.roles).not.toContain('ADMIN');
  });
});
