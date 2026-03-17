export class HandymanProfileCompletedEvent {
  constructor(
    public readonly userId: string,
    public readonly handymanProfileId: string,
    public readonly email: string,
  ) {}
}

export class HandymanDocumentsSubmittedEvent {
  constructor(
    public readonly userId: string,
    public readonly handymanProfileId: string,
    public readonly email: string,
  ) {}
}

export class HandymanVerifiedEvent {
  constructor(
    public readonly userId: string,
    public readonly handymanProfileId: string,
    public readonly email: string,
    public readonly username: string,
  ) {}
}

export class HandymanRejectedEvent {
  constructor(
    public readonly userId: string,
    public readonly handymanProfileId: string,
    public readonly email: string,
    public readonly username: string,
    public readonly reason: string,
  ) {}
}
