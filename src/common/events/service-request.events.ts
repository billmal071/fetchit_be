export class ServiceRequestCreatedEvent {
  constructor(
    public readonly serviceRequestId: string,
    public readonly customerId: string,
    public readonly categoryId: string,
    public readonly title: string,
  ) {}
}

export class ServiceRequestAssignedEvent {
  constructor(
    public readonly serviceRequestId: string,
    public readonly handymanProfileId: string,
    public readonly customerId: string,
  ) {}
}

export class ServiceRequestCompletedEvent {
  constructor(
    public readonly serviceRequestId: string,
    public readonly handymanProfileId: string,
    public readonly customerId: string,
  ) {}
}
