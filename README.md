# FetchIt Backend API

A production-ready NestJS REST API with authentication, caching, queues, WebSockets, and more.

## Tech Stack

- **Framework**: NestJS 10
- **Language**: TypeScript 5
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT (access + refresh tokens)
- **Validation**: Zod (environment), class-validator (DTOs)
- **Caching**: Redis / In-memory
- **Queue**: Bull (Redis-based)
- **WebSockets**: Socket.io
- **Logging**: Winston
- **Documentation**: Swagger/OpenAPI
- **Security**: Helmet, CORS, Rate Limiting

## Project Structure

```
src/
├── common/                 # Shared utilities
│   ├── constants/          # App constants, cache keys, messages
│   ├── decorators/         # @Public, @Roles, @CurrentUser, API decorators
│   ├── dto/                # Shared DTOs (pagination)
│   ├── enums/              # Shared enums
│   ├── exceptions/         # Custom exception classes
│   ├── filters/            # Global exception filter
│   ├── guards/             # RolesGuard
│   ├── interceptors/       # Response, Logging, Timeout interceptors
│   ├── interfaces/         # TypeScript interfaces
│   ├── pipes/              # Validation pipes
│   └── utils/              # Helper functions
├── config/                 # Configuration & Zod validation
├── database/               # Prisma service
├── gateways/               # WebSocket gateways
├── jobs/                   # Bull queues & processors
├── logs/                   # Winston configuration
├── modules/
│   ├── auth/               # Authentication (JWT)
│   ├── health/             # Health checks
│   └── users/              # User management
├── app.module.ts
└── main.ts
prisma/
├── schema.prisma           # Database schema
└── seed.ts                 # Database seeder
```

## Prerequisites

- Node.js 18+
- pnpm 9+
- PostgreSQL 14+
- Redis 6+ (for caching and queues)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd fetchit_be
pnpm install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Required
DATABASE_URL=postgresql://postgres:password@localhost:5432/fetchit?schema=public
JWT_SECRET=your-super-secret-jwt-key-minimum-32-characters
JWT_REFRESH_SECRET=your-super-secret-refresh-key-minimum-32-characters

# Optional (defaults provided)
NODE_ENV=development
PORT=3000
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Database Setup

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate:dev

# Seed database (creates admin user)
pnpm db:seed
```

### 4. Start Development Server

```bash
pnpm start:dev
```

The API will be available at:
- **API**: http://localhost:3000/api/v1
- **Swagger Docs**: http://localhost:3000/docs
- **Health Check**: http://localhost:3000/api/v1/health

## Available Scripts

```bash
# Development
pnpm start:dev          # Start with hot-reload
pnpm start:debug        # Start with debugger

# Production
pnpm build              # Build for production
pnpm start:prod         # Run production build

# Database
pnpm db:generate    # Generate Prisma client
pnpm db:migrate:dev # Create and run migrations
pnpm db:migrate:deploy # Deploy migrations (production)
pnpm db:studio      # Open Prisma Studio GUI
pnpm db:seed        # Seed database

# Code Quality
pnpm lint               # Run ESLint
pnpm format             # Format with Prettier

# Testing
pnpm test               # Run unit tests
pnpm test:watch         # Run tests in watch mode
pnpm test:cov           # Run tests with coverage
pnpm test:e2e           # Run E2E tests
```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login user |
| POST | `/auth/logout` | Logout user |
| POST | `/auth/refresh` | Refresh access token |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | Get all users (Admin) |
| GET | `/users/me` | Get current user profile |
| GET | `/users/:id` | Get user by ID (Admin) |
| PATCH | `/users/me` | Update current user |
| PATCH | `/users/:id` | Update user (Admin) |
| DELETE | `/users/:id` | Delete user (Admin) |

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Full health check |
| GET | `/health/liveness` | Liveness probe |
| GET | `/health/readiness` | Readiness probe |

## Authentication

The API uses JWT Bearer tokens. Include the token in requests:

```
Authorization: Bearer <access_token>
```

### Public Endpoints
Endpoints marked with `@Public()` decorator don't require authentication:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /health/*`

## Environment Validation

Environment variables are validated at startup using Zod. The app will fail to start if required variables are missing or invalid.

Required variables:
- `DATABASE_URL` - Valid PostgreSQL connection string
- `JWT_SECRET` - Minimum 32 characters
- `JWT_REFRESH_SECRET` - Minimum 32 characters

## WebSocket

Connect to WebSocket at `/events` namespace:

```javascript
const socket = io('http://localhost:3000/events', {
  auth: { token: 'your-jwt-token' }
});

socket.on('connect', () => {
  console.log('Connected');
});

socket.emit('ping'); // Returns 'pong'
```

## Admin User

There is no default admin account. `pnpm db:seed` always seeds the service
categories, then prompts for an admin email, username, and password:

```
Enter admin email:
Enter admin username:
Enter admin password:
```

The prompt requires an interactive TTY. When stdin is not a TTY — CI, the
deploy pipeline, `pnpm db:seed < /dev/null` — admin creation is skipped and
only the categories are seeded. Deployed environments therefore have no admin
until someone runs the seed interactively on the server (or creates the user
directly).

## License

MIT
