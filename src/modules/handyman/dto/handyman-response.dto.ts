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
