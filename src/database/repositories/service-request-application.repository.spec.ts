import { ServiceRequestApplicationRepository } from './service-request-application.repository';
import { HANDYMAN_APPLICATION_INCLUDE } from './interfaces';
import { PrismaService } from '../prisma.service';

describe('ServiceRequestApplicationRepository.findByHandymanProfileId', () => {
  const findMany = jest.fn();
  const repo = new ServiceRequestApplicationRepository({
    serviceRequestApplication: { findMany },
  } as unknown as PrismaService);

  beforeEach(() => findMany.mockReset());

  it('loads every application of the profile with its request in a single query', async () => {
    const rows = [
      {
        id: 'a1',
        status: 'ACCEPTED',
        serviceRequest: { id: 'r1', status: 'ASSIGNED', customer: { id: 'c1' } },
      },
    ];
    findMany.mockResolvedValue(rows);

    const result = await repo.findByHandymanProfileId('p1');

    expect(result).toBe(rows);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { handymanProfileId: 'p1' },
      include: HANDYMAN_APPLICATION_INCLUDE,
    });
  });

  it('never selects customer contact details (same restriction as the browse feed)', () => {
    expect(HANDYMAN_APPLICATION_INCLUDE.serviceRequest.include.customer).toEqual({
      select: { id: true, username: true, avatar: true },
    });
  });
});
