import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, ValidateIf } from 'class-validator';
import { RawValue } from '@modules/shopping-requests/dto/raw-value';

class FlagEditorDto {
  @ApiProperty() id: string;
  @ApiProperty() username: string;
}

export class FeatureFlagAdminResponseDto {
  @ApiProperty({ example: 'shopper_marketplace' }) key: string;
  @ApiProperty({ description: 'What the flag gates, in plain words.' }) description: string;
  @ApiProperty({ description: 'The master switch. Off means off for everyone except ADMIN.' })
  enabled: boolean;
  @ApiProperty({
    enum: UserRole,
    isArray: true,
    description: 'Empty means everyone; otherwise only these roles (ADMIN always passes).',
  })
  allowedRoles: UserRole[];
  @ApiProperty() updatedAt: string;
  @ApiProperty({ type: FlagEditorDto, nullable: true, description: 'Null for the seeded values.' })
  updatedBy: FlagEditorDto | null;
}

/** A partial edit: at least one field. Types are strict ("true" is not a boolean). */
export class UpdateFeatureFlagDto {
  @ApiPropertyOptional({ description: 'Turn the flag on or off.' })
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description:
      'Limit the flag to these roles; [] means everyone. Unique, valid roles only. ADMIN may be listed (it is pointless: ADMIN always passes).',
  })
  @RawValue()
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(Object.keys(UserRole).length)
  @IsEnum(UserRole, { each: true })
  allowedRoles?: UserRole[];
}
