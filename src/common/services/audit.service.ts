import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';

export interface IAuditLogEntry {
  userId: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write one audit row. Pass `client` (a transaction client) to write it inside that
   * transaction, so the row commits or rolls back together with the change it records.
   */
  async log(
    entry: IAuditLogEntry,
    client: Pick<Prisma.TransactionClient, 'auditLog'> = this.prisma,
  ): Promise<void> {
    await client.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        details: entry.details,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    });
  }
}
