import { ApiProperty } from '@nestjs/swagger';

export class ServiceRequestResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() customerId: string;
  @ApiProperty() title: string;
  @ApiProperty({ required: false }) description?: string;
  @ApiProperty() status: string;
}

export class ApplicationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() serviceRequestId: string;
  @ApiProperty() handymanProfileId: string;
  @ApiProperty({ required: false }) coverMessage?: string;
  @ApiProperty() status: string;
}
