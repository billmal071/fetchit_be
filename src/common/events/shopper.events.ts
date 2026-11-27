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

/** A shopper bid on a customer's shopping request. */
export class ShoppingOfferSubmittedEvent {
  constructor(
    public readonly customerId: string,
    public readonly requestId: string,
    public readonly requestReference: string,
    public readonly offerId: string,
    public readonly shopperName: string,
    public readonly shopperFee: number,
    public readonly customerTotal: number,
  ) {}
}
