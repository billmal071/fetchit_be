import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
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
    origin: '*',
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

      if (token) {
        const jwtConfig = this.configService.get<IJwtConfig>('jwt');
        const payload = await this.jwtService.verifyAsync(token, {
          secret: jwtConfig?.secret,
        });

        client.userId = payload.sub;
        client.email = payload.email;

        this.connectedClients.set(client.id, client);
        client.join(`user:${payload.sub}`);

        this.logger.log(`Client connected: ${client.id} (User: ${payload.email})`);
      } else {
        this.logger.log(`Anonymous client connected: ${client.id}`);
      }
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

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @MessageBody() room: string,
    @ConnectedSocket() client: IAuthenticatedSocket,
  ): { event: string; data: { room: string; joined: boolean } } {
    if (!client.userId) {
      return { event: 'error', data: { room, joined: false } };
    }

    client.join(room);
    this.logger.log(`Client ${client.id} joined room: ${room}`);

    return { event: 'room-joined', data: { room, joined: true } };
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @MessageBody() room: string,
    @ConnectedSocket() client: Socket,
  ): { event: string; data: { room: string; left: boolean } } {
    client.leave(room);
    this.logger.log(`Client ${client.id} left room: ${room}`);

    return { event: 'room-left', data: { room, left: true } };
  }

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
