import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IJwtConfig } from '@/config';

interface IAuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) ?? ['http://localhost:3000'],
    credentials: true,
  },
  namespace: '/events',
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private readonly connectedClients = new Map<string, IAuthenticatedSocket>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(): void {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: IAuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractTokenFromHandshake(client);

      // No anonymous connections: every socket joins exactly its own
      // `user:<id>` room below, so an unauthenticated client has nothing
      // legitimate to do here and previously sat connected indefinitely.
      if (!token) {
        this.logger.warn(`Client ${client.id} rejected: no auth token`);
        client.disconnect();
        return;
      }

      const jwtConfig = this.configService.get<IJwtConfig>('jwt');
      const payload = await this.jwtService.verifyAsync(token, {
        secret: jwtConfig?.secret,
      });

      client.userId = payload.sub;
      client.email = payload.email;

      this.connectedClients.set(client.id, client);
      client.join(`user:${payload.sub}`);

      this.logger.log(`Client connected: ${client.id} (User: ${payload.email})`);
    } catch (error) {
      this.logger.warn(`Client connection failed: ${client.id} - Invalid token`);
      client.disconnect();
    }
  }

  handleDisconnect(client: IAuthenticatedSocket): void {
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() _client: Socket): { event: string; data: string } {
    return { event: 'pong', data: 'pong' };
  }

  // `join-room`/`leave-room` were removed: any authenticated client could
  // join ANY room name, including another user's `user:<id>` room, and from
  // then on silently receive that user's private events. Nothing in the app
  // calls emitToRoom yet (plumbing only), so there is no legitimate room to
  // self-serve into today. If a feature needs shared rooms, add a handler
  // that checks the caller is actually a participant (e.g. of that service
  // request) before joining — never trust a client-supplied room name.

  emitToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToRoom(room: string, event: string, data: unknown): void {
    this.server.to(room).emit(event, data);
  }

  emitToAll(event: string, data: unknown): void {
    this.server.emit(event, data);
  }

  private extractTokenFromHandshake(client: Socket): string | undefined {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return client.handshake.auth?.token;
  }
}
