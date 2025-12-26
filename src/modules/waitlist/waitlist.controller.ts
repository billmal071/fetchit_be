import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistDto, WaitlistResponseDto } from './dto';
import { Public, ApiCreatedSuccessResponse, ApiErrorResponses } from '@/common/decorators';

@ApiTags('Waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Post()
  @Public()
  @ApiOperation({ summary: 'Join the waitlist' })
  @ApiCreatedSuccessResponse(WaitlistResponseDto)
  @ApiErrorResponses()
  async create(
    @Body() createWaitlistDto: CreateWaitlistDto,
  ): Promise<{ data: WaitlistResponseDto; message: string }> {
    const waitlistEntry = await this.waitlistService.create(createWaitlistDto);
    return {
      data: waitlistEntry,
      message: 'Successfully joined the waitlist',
    };
  }
}
