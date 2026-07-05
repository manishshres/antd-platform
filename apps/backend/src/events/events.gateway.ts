import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SseController } from './sse.controller';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedClients = new Map<
    string,
    { userId: string; orgId: string | null }
  >();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) {
        throw new Error('No token provided');
      }

      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const user = await this.usersService.findOneById(payload.sub);
      if (!user) {
        throw new Error('User not found');
      }

      this.connectedClients.set(client.id, {
        userId: user.id,
        orgId: user.organizationId ?? null,
      });

      if (user.organizationId) {
        void client.join(`org_${user.organizationId}`);
      }

      this.logger.log(`Client connected: ${client.id} (User: ${user.id})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Client connection rejected: ${client.id} - ${msg}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private extractToken(client: Socket): string | undefined {
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.split(' ')[0] === 'Bearer') {
      return authHeader.split(' ')[1];
    }
    const token = client.handshake.auth.token as string | undefined;
    if (token) return token;
    return undefined;
  }

  emitToOrganization(orgId: string, eventName: string, data: unknown) {
    this.server.to(`org_${orgId}`).emit(eventName, data);
    SseController.emitToOrganization(orgId, eventName, data);
  }
}
