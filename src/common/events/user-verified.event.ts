/**
 * Event emitted when a user successfully verifies their email address
 */
export class UserVerifiedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly username: string,
  ) {}
}
