export class ShopperApprovedEvent {
  constructor(
    public readonly userId: string,
    public readonly shopperProfileId: string,
    public readonly email: string,
    public readonly username: string,
  ) {}
}

/** The application was sent back for changes; the shopper can fix it and resubmit. */
export class ShopperSentBackEvent {
  constructor(
    public readonly userId: string,
    public readonly shopperProfileId: string,
    public readonly email: string,
    public readonly username: string,
    public readonly reason: string,
  ) {}
}
