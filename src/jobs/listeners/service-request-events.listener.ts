import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EVENTS } from '@/common/constants';
import {
  ServiceRequestCreatedEvent,
  ServiceRequestAssignedEvent,
  ServiceRequestCompletionSubmittedEvent,
  ServiceRequestCompletedEvent,
  ServiceRequestCancelledEvent,
  ServiceRequestUnassignedEvent,
} from '@/common/events';

@Injectable()
export class ServiceRequestEventsListener {
  private readonly logger = new Logger(ServiceRequestEventsListener.name);

  @OnEvent(EVENTS.SERVICE_REQUEST_CREATED)
  async handleServiceRequestCreated(event: ServiceRequestCreatedEvent): Promise<void> {
    try {
      this.logger.log(`Service request created: ${event.serviceRequestId} - ${event.title}`);
    } catch (error) {
      this.logger.error(
        `Failed to handle service request created event:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.SERVICE_REQUEST_ASSIGNED)
  async handleServiceRequestAssigned(event: ServiceRequestAssignedEvent): Promise<void> {
    try {
      this.logger.log(
        `Service request ${event.serviceRequestId} assigned to handyman ${event.handymanProfileId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle service request assigned event:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.SERVICE_REQUEST_COMPLETION_SUBMITTED)
  async handleServiceRequestCompletionSubmitted(
    event: ServiceRequestCompletionSubmittedEvent,
  ): Promise<void> {
    try {
      this.logger.log(
        `Service request ${event.serviceRequestId} marked complete by handyman ` +
          `${event.handymanProfileId} — awaiting confirmation from customer ${event.customerId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle service request completion submitted event:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.SERVICE_REQUEST_COMPLETED)
  async handleServiceRequestCompleted(event: ServiceRequestCompletedEvent): Promise<void> {
    try {
      this.logger.log(`Service request ${event.serviceRequestId} completed`);
    } catch (error) {
      this.logger.error(
        `Failed to handle service request completed event:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.SERVICE_REQUEST_CANCELLED)
  async handleServiceRequestCancelled(event: ServiceRequestCancelledEvent): Promise<void> {
    try {
      this.logger.log(
        `Service request ${event.serviceRequestId} cancelled` +
          (event.handymanProfileId
            ? ` — notifying assigned handyman ${event.handymanProfileId}`
            : ' (no handyman was assigned yet)'),
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle service request cancelled event:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  @OnEvent(EVENTS.SERVICE_REQUEST_UNASSIGNED)
  async handleServiceRequestUnassigned(event: ServiceRequestUnassignedEvent): Promise<void> {
    try {
      this.logger.log(
        `Handyman ${event.handymanProfileId} backed out of service request ` +
          `${event.serviceRequestId} — back to OPEN, notifying customer ${event.customerId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle service request unassigned event:`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
