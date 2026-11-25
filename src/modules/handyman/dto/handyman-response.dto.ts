import { ApiProperty } from '@nestjs/swagger';

export class HandymanProfileResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty({ required: false }) bio?: string;
  @ApiProperty({ required: false }) location?: string;
  @ApiProperty({ required: false }) hourlyRate?: number;
  @ApiProperty() verificationStatus: string;
}

export class HandymanDocumentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() handymanProfileId: string;
  @ApiProperty() type: string;
  @ApiProperty() fileUrl: string;
  @ApiProperty() status: string;
}

export class HandymanApplicationCustomerDto {
  @ApiProperty() id: string;
  @ApiProperty() username: string;
  @ApiProperty({ nullable: true, type: String }) avatar: string | null;
}

export class HandymanApplicationCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() slug: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ nullable: true, type: String }) icon: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class HandymanApplicationCountDto {
  @ApiProperty() applications: number;
}

export class HandymanApplicationServiceRequestDto {
  @ApiProperty() id: string;
  @ApiProperty() customerId: string;
  @ApiProperty() categoryId: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiProperty({
    description: 'Empty once the request went to someone else and this application is no longer PENDING/ACCEPTED',
  })
  location: string;
  @ApiProperty({ nullable: true, type: Number }) latitude: number | null;
  @ApiProperty({ nullable: true, type: Number }) longitude: number | null;
  @ApiProperty({ nullable: true, type: String, description: 'Decimal serialised as a string' })
  budgetMin: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Decimal serialised as a string' })
  budgetMax: string | null;
  @ApiProperty({
    enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'],
  })
  status: string;
  @ApiProperty({ nullable: true, type: String }) assignedHandymanId: string | null;
  @ApiProperty({ nullable: true, type: Date }) completedAt: Date | null;
  @ApiProperty({ nullable: true, type: Date }) cancelledAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: HandymanApplicationCategoryDto }) category: HandymanApplicationCategoryDto;
  @ApiProperty({
    type: HandymanApplicationCustomerDto,
    description: 'Public customer info only (no email/phone), same as the browse feed',
  })
  customer: HandymanApplicationCustomerDto;
  @ApiProperty({ type: HandymanApplicationCountDto }) _count: HandymanApplicationCountDto;
}

export class HandymanApplicationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() serviceRequestId: string;
  @ApiProperty() handymanProfileId: string;
  @ApiProperty({ required: false, nullable: true, type: String }) coverMessage?: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'Decimal as string' })
  proposedRate: string | null;
  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] }) status: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: HandymanApplicationServiceRequestDto })
  serviceRequest: HandymanApplicationServiceRequestDto;
}
