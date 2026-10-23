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

export class ServiceRequestCompletionSubmittedEvent {
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

export class ServiceRequestCancelledEvent {
  constructor(
    public readonly serviceRequestId: string,
    public readonly customerId: string,
    /** Null when cancelled before anyone was assigned. */
    public readonly handymanProfileId: string | null,
  ) {}
}

/**
 * The handyman backed out of an ASSIGNED job — distinct from
 * ServiceRequestCancelledEvent, which means the request is CANCELLED
 * (terminal). Here the request is back to OPEN and still live; a listener
 * that assumed "cancelled" meant terminal would be wrong to reuse that event.
 */
export class ServiceRequestUnassignedEvent {
  constructor(
    public readonly serviceRequestId: string,
    public readonly customerId: string,
    public readonly handymanProfileId: string,
  ) {}
}
